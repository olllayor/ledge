import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ShelfStore } from './shelfStore'
import { StatePersister, buildStateFileLayout, defaultPreferences, defaultSyncStateRecord, defaultClipboardSettingsRecord } from './persister'
import type { PersistedState } from './types'
import type { ShelfItemRecord, ShelfRecord } from '@shared/schema'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }),
    ),
  )
})

function makeItem(id: string, order: number): ShelfItemRecord {
  return {
    id,
    kind: 'text',
    createdAt: new Date().toISOString(),
    order,
    title: id,
    subtitle: '',
    preview: { summary: id, detail: '' },
    text: id
  }
}

async function buildShelfStore(): Promise<{
  shelves: ShelfStore
  persister: StatePersister
  state: PersistedState
}> {
  const dir = await mkdtemp(join(tmpdir(), 'shelf-store-'))
  tempDirs.push(dir)
  const layout = buildStateFileLayout(dir)
  const persister = new StatePersister({ statePath: layout.statePath })
  const state: PersistedState = {
    liveShelf: null,
    teamLiveShelves: {},
    recentShelves: [],
    preferences: defaultPreferences(),
    sync: defaultSyncStateRecord(),
    clipboardHistory: [],
    clipboardCategories: [],
    team: { activeTeamId: null },
    clipboardSettings: defaultClipboardSettingsRecord()
  }
  const shelves = new ShelfStore(persister, () => state)
  return { shelves, persister, state }
}

describe('ShelfStore', () => {
  it('isolates team live shelf from personal live shelf', async () => {
    const { shelves, persister, state } = await buildShelfStore()

    // Create personal shelf item
    shelves.createShelf('manual')
    shelves.appendItems([makeItem('personal-item-1', 0)])
    await persister.whenIdle()
    expect(shelves.getLiveShelf()?.items[0]?.id).toBe('personal-item-1')

    // Switch to team 1
    state.team.activeTeamId = 'team-alpha'
    expect(shelves.getLiveShelf()).toBeNull()

    // Create team shelf item
    shelves.createShelf('manual')
    shelves.appendItems([makeItem('team-item-1', 0)])
    await persister.whenIdle()
    expect(shelves.getLiveShelf()?.items[0]?.id).toBe('team-item-1')

    // Switch back to personal
    state.team.activeTeamId = null
    expect(shelves.getLiveShelf()?.items[0]?.id).toBe('personal-item-1')

    // Switch back to team 1
    state.team.activeTeamId = 'team-alpha'
    expect(shelves.getLiveShelf()?.items[0]?.id).toBe('team-item-1')
  })

  it('closeShelf in team context drops the team shelf without touching personal state', async () => {
    const { shelves, persister, state } = await buildShelfStore()

    const personal = shelves.createShelf('manual')
    shelves.appendItems([makeItem('personal-a', 0)])

    state.team.activeTeamId = 'team-alpha'
    shelves.createShelf('manual')
    shelves.appendItems([makeItem('team-a', 0)])

    shelves.closeShelf()
    await persister.whenIdle()

    expect(shelves.getLiveShelf()).toBeNull()
    expect(state.teamLiveShelves['team-alpha']).toBeUndefined()
    // Personal shelf stays live and nothing leaks into personal recents.
    state.team.activeTeamId = null
    expect(shelves.getLiveShelf()?.id).toBe(personal.id)
    expect(shelves.getRecentShelves()).toHaveLength(0)
  })

  it('getAllShelves excludes team shelves so personal sync backfill stays clean', async () => {
    const { shelves, state } = await buildShelfStore()

    const personal = shelves.createShelf('manual')
    shelves.appendItems([makeItem('personal-a', 0)])
    shelves.closeShelf() // archives into recents

    state.team.activeTeamId = 'team-alpha'
    shelves.createShelf('manual')
    shelves.appendItems([makeItem('team-a', 0)])

    state.team.activeTeamId = null
    const all = shelves.getAllShelves()
    expect(all.map((shelf) => shelf.id)).toEqual([personal.id])
  })

  it('getPersonalLiveShelf ignores team context', async () => {
    const { shelves, state } = await buildShelfStore()

    const personal = shelves.createShelf('manual')
    state.team.activeTeamId = 'team-alpha'
    shelves.createShelf('manual')

    expect(shelves.getPersonalLiveShelf()?.id).toBe(personal.id)

    shelves.replacePersonalLiveShelf({ ...personal, name: 'renamed' })
    expect(state.liveShelf?.name).toBe('renamed')
    expect(Object.keys(state.teamLiveShelves)).toEqual(['team-alpha'])
  })

  it('applyTeamShelfItems mirrors items into the team shelf without touching personal state', async () => {
    const { shelves, persister, state } = await buildShelfStore()

    const personal = shelves.createShelf('manual')
    shelves.appendItems([makeItem('personal-a', 0)])

    const mirrored = shelves.applyTeamShelfItems('team-alpha', [
      makeItem('team-a', 0),
      makeItem('team-b', 1),
    ])
    await persister.whenIdle()

    expect(mirrored.items.map((i) => i.id)).toEqual(['team-a', 'team-b'])
    expect(state.teamLiveShelves['team-alpha']?.items).toHaveLength(2)
    // Personal slot and recents are untouched by team mirror writes.
    expect(state.liveShelf?.id).toBe(personal.id)
    expect(shelves.getRecentShelves()).toHaveLength(0)

    // A second mirror replaces items in place, keeping shelf identity.
    const again = shelves.applyTeamShelfItems('team-alpha', [makeItem('team-c', 0)])
    expect(again.id).toBe(mirrored.id)
    expect(state.teamLiveShelves['team-alpha']?.items.map((i) => i.id)).toEqual(['team-c'])
  })

  it('archives non-empty live shelves into recents on close', async () => {
    const { shelves, persister } = await buildShelfStore()

    shelves.createShelf('manual')
    shelves.appendItems([makeItem('a', 0)])

    shelves.closeShelf()
    await persister.whenIdle()

    expect(shelves.getLiveShelf()).toBeNull()
    expect(shelves.getRecentShelves()).toHaveLength(1)
  })

  it('restores a recent shelf into the live slot', async () => {
    const { shelves, persister } = await buildShelfStore()

    const shelf = shelves.createShelf('manual')
    shelves.appendItems([makeItem('a', 0)])
    shelves.closeShelf()
    const restored = shelves.restoreShelf(shelf.id)
    await persister.whenIdle()

    expect(restored?.id).toBe(shelf.id)
    expect(shelves.getRecentShelves()).toHaveLength(0)
    expect(shelves.getLiveShelf()?.items[0]?.id).toBe('a')
  })

  it('reorders items by id and compacts the order field', async () => {
    const { shelves, persister } = await buildShelfStore()

    shelves.createShelf('manual')
    shelves.appendItems([makeItem('a', 0), makeItem('b', 1), makeItem('c', 2)])

    const reordered = shelves.reorderItems(['c', 'a', 'b'])
    await persister.whenIdle()

    expect(reordered?.items.map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(reordered?.items.map((i) => i.order)).toEqual([0, 1, 2])
  })

  it('reorders appends unknown items after the requested order', async () => {
    const { shelves, persister } = await buildShelfStore()

    shelves.createShelf('manual')
    shelves.appendItems([makeItem('a', 0), makeItem('b', 1), makeItem('c', 2)])

    const reordered = shelves.reorderItems(['c'])
    await persister.whenIdle()

    expect(reordered?.items.map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })

  it('relinks a file-backed item in place', async () => {
    const { shelves, persister } = await buildShelfStore()

    shelves.createShelf('manual')
    shelves.appendItems([
      {
        id: 'file-1',
        kind: 'file',
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'doc',
        subtitle: '',
        preview: { summary: 'doc', detail: '' },
        file: {
          originalPath: '/old',
          resolvedPath: '',
          bookmarkBase64: '',
          isMissing: true,
          isStale: true
        },
        mimeType: 'text/plain'
      }
    ])

    const updated = shelves.relinkFileBackedItem('file-1', {
      originalPath: '/new',
      resolvedPath: '/new',
      bookmarkBase64: 'B64'
    })
    await persister.whenIdle()

    expect(updated?.items[0]?.kind).toBe('file')
    if (updated?.items[0]?.kind === 'file') {
      expect(updated.items[0].file.originalPath).toBe('/new')
      expect(updated.items[0].file.isMissing).toBe(false)
      expect(updated.items[0].file.isStale).toBe(false)
    }
  })

  it('refuses to relink non-file-backed items', async () => {
    const { shelves, persister } = await buildShelfStore()

    shelves.createShelf('manual')
    shelves.appendItems([makeItem('text-1', 0)])

    const updated = shelves.relinkFileBackedItem('text-1', {
      originalPath: '/whatever',
      resolvedPath: '/whatever',
      bookmarkBase64: 'b'
    })
    await persister.whenIdle()

    // relinkFileBackedItem returns null when the target item is not
    // file-backed; no shelf mutation should have happened.
    expect(updated).toBeNull()
    expect(shelves.getLiveShelf()?.items[0]?.id).toBe('text-1')
  })

  it('upsertRecentShelf inserts unknown remotes and updates known ones', async () => {
    const { shelves, persister } = await buildShelfStore()

    shelves.createShelf('manual')
    shelves.appendItems([makeItem('a', 0)])
    shelves.closeShelf()
    const live = shelves.createShelf('manual')
    void live

    const unknown: ShelfRecord = {
      id: 'from-other-device',
      name: 'remote',
      color: 'ember',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin: 'manual',
      items: [makeItem('r1', 0)],
    }
    shelves.upsertRecentShelf(unknown)
    await persister.whenIdle()

    const recents = shelves.getRecentShelves()
    expect(recents.find((s) => s.id === 'from-other-device')?.name).toBe('remote')

    shelves.upsertRecentShelf({ ...unknown, name: 'remote-updated' })
    await persister.whenIdle()
    expect(shelves.getRecentShelves().find((s) => s.id === 'from-other-device')?.name).toBe(
      'remote-updated',
    )
  })
})
