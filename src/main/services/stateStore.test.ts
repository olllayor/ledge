import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateStore } from './stateStore'
import type { ShelfRecord } from '@shared/schema'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }),
    ),
  )
})

describe('StateStore', () => {
  it('archives non-empty live shelves into recents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-store-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)

    store.createShelf('manual')
    store.appendItems([
      {
        id: 'item-1',
        kind: 'text',
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'Hello',
        subtitle: '',
        preview: {
          summary: 'Hello',
          detail: ''
        },
        text: 'Hello'
      }
    ])

    store.closeShelf()
    await store.whenIdle()

    expect(store.getLiveShelf()).toBeNull()
    expect(store.getRecentShelves()).toHaveLength(1)
  })

  it('restores a recent shelf into the live shelf slot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-restore-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)

    const live = store.createShelf('manual')
    store.appendItems([
      {
        id: 'item-1',
        kind: 'text',
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'Hello',
        subtitle: '',
        preview: {
          summary: 'Hello',
          detail: ''
        },
        text: 'Hello'
      }
    ])
    store.closeShelf()

    const restored = store.restoreShelf(live.id)
    await store.whenIdle()

    expect(restored?.id).toBe(live.id)
    expect(store.getLiveShelf()?.items).toHaveLength(1)
    expect(store.getRecentShelves()).toHaveLength(0)
  })

  it('does not archive empty shelves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-empty-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)

    store.createShelf('manual')
    store.closeShelf()
    await store.whenIdle()

    expect(store.getLiveShelf()).toBeNull()
    expect(store.getRecentShelves()).toHaveLength(0)
  })

  it('migrates legacy persisted state to version 2 on load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-legacy-'))
    tempDirs.push(dir)
    const statePath = join(dir, 'state.json')
    await writeFile(
      statePath,
      JSON.stringify({
        liveShelf: null,
        recentShelves: [],
        preferences: {}
      }),
      'utf8'
    )

    const store = new StateStore(dir)
    await store.whenIdle()
    const persisted = JSON.parse(await readFile(statePath, 'utf8')) as { version: number; preferences: { globalShortcut: string } }

    expect(persisted.version).toBe(2)
    expect(persisted.preferences.globalShortcut).toBe('CommandOrControl+Shift+Space')
  })

  it('flushes the latest state after rapid successive mutations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-flush-'))
    tempDirs.push(dir)
    const statePath = join(dir, 'state.json')
    const store = new StateStore(dir)

    store.createShelf('manual')
    store.renameLiveShelf('Pinned')
    store.setPreferences({
      launchAtLogin: true
    })
    store.closeShelf()
    await store.whenIdle()

    const persisted = JSON.parse(await readFile(statePath, 'utf8')) as {
      version: number
      liveShelf: null
      preferences: { launchAtLogin: boolean }
    }

    expect(persisted.version).toBe(2)
    expect(persisted.liveShelf).toBeNull()
    expect(persisted.preferences.launchAtLogin).toBe(true)
  })

  it('caps recent shelves to the free-plan limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-cap-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)
    for (let i = 0; i < 6; i++) {
      const shelf = store.createShelf('manual')
      store.appendItems([
        {
          id: randomId(),
          kind: 'text',
          createdAt: new Date().toISOString(),
          order: 0,
          title: `t${i}`,
          subtitle: '',
          preview: { summary: 't', detail: '' },
          text: 't'
        }
      ])
      store.closeShelf()
      void shelf
    }
    await store.whenIdle()

    expect(store.getRecentShelves()).toHaveLength(3)
  })

  it('trims existing recents when the plan downgrades to free', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-downgrade-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)
    store.setSyncState({ plan: 'pro' })

    for (let i = 0; i < 6; i++) {
      const shelf = store.createShelf('manual')
      store.appendItems([
        {
          id: randomId(),
          kind: 'text',
          createdAt: new Date().toISOString(),
          order: 0,
          title: `t${i}`,
          subtitle: '',
          preview: { summary: 't', detail: '' },
          text: 't'
        }
      ])
      store.closeShelf()
      void shelf
    }

    expect(store.getRecentShelves()).toHaveLength(6)

    store.setSyncState({ plan: 'free' })
    expect(store.getRecentShelves()).toHaveLength(3)
  })

  it('invokes the persistence error listener when the state file cannot be written', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-persist-err-'))
    tempDirs.push(dir)
    const errors: Error[] = []
    const store = new StateStore(dir, {
      onPersistenceError: (error) => errors.push(error),
    })

    // Force a write failure: lock the user-data directory so neither the
    // temp-file write nor the atomic rename can succeed.
    await chmod(dir, 0o500)
    try {
      store.setPreferences({ launchAtLogin: true })
      await store.whenIdle()
    } finally {
      await chmod(dir, 0o700)
    }

    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toBeInstanceOf(Error)
  })

  it('replaceLiveShelf overwrites the live shelf and triggers a save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-replace-live-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)
    const initial = store.createShelf('manual')
    store.appendItems([
      {
        id: randomId(),
        kind: 'text',
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'before',
        subtitle: '',
        preview: { summary: 'before', detail: '' },
        text: 'before'
      }
    ])

    const incoming: ShelfRecord = {
      ...initial,
      items: [],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    }
    store.replaceLiveShelf(incoming)
    await store.whenIdle()

    expect(store.getLiveShelf()?.items).toHaveLength(0)
    expect(store.getLiveShelf()?.updatedAt).toBe(incoming.updatedAt)
  })

  it('replaceLiveShelf with null clears the live shelf', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-replace-null-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)
    store.createShelf('manual')

    store.replaceLiveShelf(null)
    await store.whenIdle()

    expect(store.getLiveShelf()).toBeNull()
  })

  it('replaceRecentShelf updates the matching entry and ignores unknowns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-replace-recent-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)
    const a = store.createShelf('manual')
    store.appendItems([
      {
        id: randomId(),
        kind: 'text',
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'a',
        subtitle: '',
        preview: { summary: 'a', detail: '' },
        text: 'a'
      }
    ])
    store.closeShelf()
    const b = store.createShelf('manual')
    void b
    store.appendItems([
      {
        id: randomId(),
        kind: 'text',
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'b',
        subtitle: '',
        preview: { summary: 'b', detail: '' },
        text: 'b'
      }
    ])
    store.closeShelf()

    const initialRecents = store.getRecentShelves()
    expect(initialRecents).toHaveLength(2)
    const [newest, older] = initialRecents

    const updatedNewer: ShelfRecord = {
      ...newest,
      name: 'newer-from-cloud',
      updatedAt: new Date(Date.now() + 120_000).toISOString(),
    }
    store.replaceRecentShelf(updatedNewer)
    await store.whenIdle()

    const afterUpdate = store.getRecentShelves()
    expect(afterUpdate.find((shelf) => shelf.id === newest.id)?.name).toBe('newer-from-cloud')
    expect(afterUpdate.find((shelf) => shelf.id === older.id)?.name).toBe(older.name)

    // Unknown id is a no-op (does not insert).
    store.replaceRecentShelf({
      ...a,
      id: 'unknown-shelf-id',
      name: 'should-not-appear',
    } as ShelfRecord)
    await store.whenIdle()
    expect(store.getRecentShelves()).toHaveLength(2)
  })

  it('quarantines a corrupt state file and signals the listener', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-corrupt-'))
    tempDirs.push(dir)
    const statePath = join(dir, 'state.json')
    await writeFile(statePath, '{not valid json', 'utf8')

    const reports: { backupPath: string; cause: Error }[] = []
    const store = new StateStore(dir, {
      onCorruptionDetected: (details) => reports.push(details),
    })

    // Default state is used; the listener fires; the bad file was renamed.
    expect(store.getLiveShelf()).toBeNull()
    expect(reports).toHaveLength(1)
    expect(reports[0]!.cause).toBeInstanceOf(Error)
    expect(reports[0]!.backupPath).toMatch(/state\.json\.corrupt-\d+$/)
    expect(reports[0]!.backupPath.startsWith(statePath)).toBe(true)

    // A new save should succeed against the fresh, empty state.json.
    store.setPreferences({ launchAtLogin: true })
    await store.whenIdle()
    const reread = await readFile(statePath, 'utf8')
    expect(reread).toContain('launchAtLogin')
  })
})

let counter = 0
function randomId(): string {
  counter += 1
  return `id-${counter}-${Date.now().toString(36)}`
}

describe('StateStore atomic write', () => {
  it('persists valid JSON that round-trips on reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-atomic-'))
    tempDirs.push(dir)

    const first = new StateStore(dir)
    first.createShelf('manual')
    first.setPreferences({ launchAtLogin: true })
    await first.whenIdle()

    const second = new StateStore(dir)
    expect(second.getLiveShelf()).not.toBeNull()
    expect(second.getPreferences().launchAtLogin).toBe(true)
  })

  it('does not leave stale .tmp files after a successful write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-tmp-cleanup-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)
    store.createShelf('manual')
    await store.whenIdle()
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(dir)
    const tmps = files.filter((name) => name.startsWith('state.json.tmp-'))
    expect(tmps).toEqual([])
  })
})
