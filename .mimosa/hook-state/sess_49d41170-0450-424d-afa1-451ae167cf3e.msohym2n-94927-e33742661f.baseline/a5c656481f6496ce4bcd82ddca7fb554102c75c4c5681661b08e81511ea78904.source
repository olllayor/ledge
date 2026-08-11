import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ShelfStore } from './shelfStore'
import { StatePersister, buildStateFileLayout, defaultPreferences, defaultSyncStateRecord, defaultClipboardSettingsRecord } from './persister'
import type { PersistedState } from './types'
import type { ShelfItemRecord } from '@shared/schema'

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
})
