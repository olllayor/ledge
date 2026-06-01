import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateStore } from './stateStore'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
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

  it('relinks a missing file-backed item on the live shelf', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-relink-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)
    store.createShelf('manual')
    store.appendItems([
      {
        id: 'item-1',
        kind: 'file',
        createdAt: '2026-05-09T00:00:00.000Z',
        order: 0,
        title: 'project.pdf',
        subtitle: '',
        preview: { summary: 'PDF', detail: '' },
        mimeType: 'application/pdf',
        file: {
          originalPath: '/missing/project.pdf',
          resolvedPath: '',
          bookmarkBase64: '',
          isMissing: true,
          isStale: false
        }
      }
    ])

    const shelf = store.relinkFileBackedItem('item-1', {
      originalPath: '/Users/me/Documents/project.pdf',
      resolvedPath: '/Users/me/Documents/project.pdf',
      bookmarkBase64: 'bookmark'
    })

    expect(shelf?.items[0]).toMatchObject({
      file: {
        originalPath: '/Users/me/Documents/project.pdf',
        resolvedPath: '/Users/me/Documents/project.pdf',
        bookmarkBase64: 'bookmark',
        isMissing: false,
        isStale: false
      }
    })
  })

  it('cycles only free shelf colors for free plans', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-free-colors-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)

    const colors = Array.from({ length: 6 }, () => {
      const shelf = store.createShelf('manual')
      store.appendItems([
        {
          id: randomId(),
          kind: 'text',
          createdAt: new Date().toISOString(),
          order: 0,
          title: 't',
          subtitle: '',
          preview: { summary: 't', detail: '' },
          text: 't'
        }
      ])
      store.closeShelf()
      return shelf.color
    })

    expect(colors.every((color) => color === 'ember' || color === 'wave')).toBe(true)
  })

  it('cycles pro shelf colors when the plan is pro', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-pro-colors-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)
    store.setSyncState({ plan: 'pro' })

    const colors = Array.from({ length: 8 }, () => {
      const shelf = store.createShelf('manual')
      store.appendItems([
        {
          id: randomId(),
          kind: 'text',
          createdAt: new Date().toISOString(),
          order: 0,
          title: 't',
          subtitle: '',
          preview: { summary: 't', detail: '' },
          text: 't'
        }
      ])
      store.closeShelf()
      return shelf.color
    })

    const palette = new Set(colors)
    expect(palette.size).toBeGreaterThan(2)
    expect(palette.has('forest') || palette.has('sand')).toBe(true)
  })

  it('caps recent shelves at the plan limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-free-recents-'))
    tempDirs.push(dir)
    const store = new StateStore(dir)

    for (let i = 0; i < 5; i++) {
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
})

let counter = 0
function randomId(): string {
  counter += 1
  return `id-${counter}-${Date.now().toString(36)}`
}
