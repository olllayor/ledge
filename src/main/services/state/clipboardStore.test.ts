import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ClipboardStore } from './clipboardStore'
import { StatePersister, buildStateFileLayout, defaultPreferences, defaultSyncStateRecord, defaultClipboardSettingsRecord } from './persister'
import type { PersistedState } from './types'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }),
    ),
  )
})

async function buildStore(): Promise<{
  clipboard: ClipboardStore
  persister: StatePersister
  state: PersistedState
}> {
  const dir = await mkdtemp(join(tmpdir(), 'clipboard-store-'))
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
  const clipboard = new ClipboardStore(persister, () => state)
  return { clipboard, persister, state }
}

function makeTextItem(id: string) {
  return {
    id,
    kind: 'text' as const,
    createdAt: new Date().toISOString(),
    order: 0,
    title: id,
    subtitle: '',
    preview: { summary: id, detail: '' },
    text: id
  }
}

describe('ClipboardStore', () => {
  it('appends entries newest-first', async () => {
    const { clipboard, persister } = await buildStore()

    clipboard.appendEntry({
      capturedAt: new Date().toISOString(),
      sourceBundleId: 'app.a',
      sourceAppName: 'A',
      item: makeTextItem('a')
    })
    clipboard.appendEntry({
      capturedAt: new Date().toISOString(),
      sourceBundleId: 'app.b',
      sourceAppName: 'B',
      item: makeTextItem('b')
    })

    const entries = clipboard.getEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.item.kind).toBe('text')
    expect(entries[1]?.item.kind).toBe('text')
    if (entries[0]?.item.kind === 'text' && entries[1]?.item.kind === 'text') {
      expect(entries[0].item.text).toBe('b')
      expect(entries[1].item.text).toBe('a')
    }
    await persister.whenIdle()
  })

  it('removes a category from every entry that references it', async () => {
    const { clipboard, persister } = await buildStore()

    const category = clipboard.createCategory('Work', 'wave')
    const entry = clipboard.appendEntry({
      capturedAt: new Date().toISOString(),
      sourceBundleId: '',
      sourceAppName: '',
      item: makeTextItem('i')
    })
    clipboard.assignEntryToCategory(entry.id, category.id)
    expect(clipboard.getEntries()[0]?.categoryIds).toEqual([category.id])

    clipboard.removeCategory(category.id)
    expect(clipboard.getEntries()[0]?.categoryIds).toEqual([])
    expect(clipboard.getCategories()).toEqual([])

    await persister.whenIdle()
  })

  it('re-enforces the history limit when settings drop the cap', async () => {
    const { clipboard, persister } = await buildStore()

    for (let i = 0; i < 5; i++) {
      clipboard.appendEntry({
        capturedAt: new Date().toISOString(),
        sourceBundleId: '',
        sourceAppName: '',
        item: makeTextItem(`i${i}`)
      })
    }
    expect(clipboard.getEntries()).toHaveLength(5)

    clipboard.updateSettings({ historyLimit: 2 })
    expect(clipboard.getEntries()).toHaveLength(2)

    await persister.whenIdle()
  })

  it('refuses to assign a non-existent category', async () => {
    const { clipboard, persister } = await buildStore()

    const entry = clipboard.appendEntry({
      capturedAt: new Date().toISOString(),
      sourceBundleId: '',
      sourceAppName: '',
      item: makeTextItem('i')
    })

    clipboard.assignEntryToCategory(entry.id, 'nonexistent')
    expect(clipboard.getEntries()[0]?.categoryIds).toEqual([])

    await persister.whenIdle()
  })

  it('does not duplicate a category assignment', async () => {
    const { clipboard, persister } = await buildStore()

    const category = clipboard.createCategory('Work', 'wave')
    const entry = clipboard.appendEntry({
      capturedAt: new Date().toISOString(),
      sourceBundleId: '',
      sourceAppName: '',
      item: makeTextItem('i')
    })

    clipboard.assignEntryToCategory(entry.id, category.id)
    clipboard.assignEntryToCategory(entry.id, category.id)
    expect(clipboard.getEntries()[0]?.categoryIds).toEqual([category.id])

    await persister.whenIdle()
  })

  it('dedup keeps the original id and category tags when content is re-copied', async () => {
    const { clipboard, persister } = await buildStore()

    const category = clipboard.createCategory('Work', 'wave')
    const first = clipboard.appendEntry({
      capturedAt: new Date().toISOString(),
      sourceBundleId: 'app.a',
      sourceAppName: 'A',
      item: makeTextItem('same')
    })
    clipboard.assignEntryToCategory(first.id, category.id)

    // Re-copy the same text later from another app.
    const second = clipboard.appendEntry({
      capturedAt: new Date(Date.now() + 5_000).toISOString(),
      sourceBundleId: 'app.b',
      sourceAppName: 'B',
      item: makeTextItem('same')
    })

    expect(second.id).toBe(first.id)
    expect(second.categoryIds).toEqual([category.id])
    expect(clipboard.getEntries()).toHaveLength(1)
    expect(clipboard.getEntries()[0]?.sourceBundleId).toBe('app.b')

    await persister.whenIdle()
  })

  it('image entries with the same content hash dedup even when asset paths differ', async () => {
    const { clipboard, persister } = await buildStore()

    const mkImage = (path: string) => ({
      kind: 'imageAsset' as const,
      id: `img-${Math.random()}`,
      createdAt: new Date().toISOString(),
      order: 0,
      title: 'Screenshot',
      subtitle: '',
      preview: { summary: 'Screenshot', detail: '' },
      mimeType: 'image/png',
      file: { originalPath: path, resolvedPath: path, bookmarkBase64: '', isStale: false, isMissing: false },
    })

    const first = clipboard.appendEntry({
      capturedAt: new Date().toISOString(),
      sourceBundleId: '',
      sourceAppName: '',
      item: mkImage('/assets/aaa.png'),
      thumbnailDataUri: 'data:image/png;base64,old',
      imageSha256: 'abc123'
    })
    // Same bytes re-copied → payloadToItems wrote a fresh uuid-named file,
    // so paths differ and path-based dedup would never match.
    const second = clipboard.appendEntry({
      capturedAt: new Date(Date.now() + 1_000).toISOString(),
      sourceBundleId: '',
      sourceAppName: '',
      item: mkImage('/assets/bbb.png'),
      imageSha256: 'abc123'
    })

    expect(second.id).toBe(first.id)
    expect(clipboard.getEntries()).toHaveLength(1)
    // Original item (and its asset file) survives the merge.
    expect(clipboard.getEntries()[0]?.item).toMatchObject({ file: { resolvedPath: '/assets/aaa.png' } })
    expect(clipboard.getEntries()[0]?.thumbnailDataUri).toBe('data:image/png;base64,old')

    await persister.whenIdle()
  })

  it('restoreHistory prunes restored entries past the limit and cutoff', async () => {
    const { clipboard, persister, state } = await buildStore()
    state.clipboardSettings.historyLimit = 2

    const now = Date.now()
    clipboard.restoreHistory([
      {
        id: 'fresh-1',
        capturedAt: new Date(now).toISOString(),
        sourceBundleId: '',
        sourceAppName: '',
        item: makeTextItem('f1'),
        categoryIds: []
      },
      {
        id: 'fresh-2',
        capturedAt: new Date(now - 60_000).toISOString(),
        sourceBundleId: '',
        sourceAppName: '',
        item: makeTextItem('f2'),
        categoryIds: []
      },
      {
        id: 'over-limit',
        capturedAt: new Date(now - 120_000).toISOString(),
        sourceBundleId: '',
        sourceAppName: '',
        item: makeTextItem('old-but-in-range'),
        categoryIds: []
      },
      {
        id: 'ancient',
        capturedAt: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
        sourceBundleId: '',
        sourceAppName: '',
        item: makeTextItem('ancient'),
        categoryIds: []
      }
    ])

    const entries = clipboard.getEntries()
    expect(entries.map((e) => e.id)).toEqual(['fresh-1', 'fresh-2'])

    await persister.whenIdle()
  })
})

describe('ClipboardStore.prune (regression: BUG-001)', () => {
  it('persists to disk when the prune actually trims the history', async () => {
    const { clipboard, persister, state } = await buildStore()

    // Seed 5 entries within the last hour (well within the 30-day cutoff)
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      state.clipboardHistory.unshift({
        id: `e${i}`,
        capturedAt: new Date(now - i * 60_000).toISOString(),
        sourceBundleId: '',
        sourceAppName: '',
        item: makeTextItem(`i${i}`),
        categoryIds: []
      })
    }
    // Set the limit so prune will trim the array
    state.clipboardSettings.historyLimit = 2

    expect(state.clipboardHistory).toHaveLength(5)

    clipboard.prune()
    expect(state.clipboardHistory).toHaveLength(2)

    // Wait for the persister's queued write to land.
    await persister.whenIdle()

    // Reload from disk and confirm the trim was persisted.
    const layout = buildStateFileLayout((persister as unknown as { statePath: string }).statePath.replace(/state\.json$/, ''))
    const reloaded = new StatePersister({ statePath: layout.statePath })
    const { state: onDisk } = reloaded.load({
      liveShelf: null,
      teamLiveShelves: {},
      recentShelves: [],
      preferences: defaultPreferences(),
      sync: defaultSyncStateRecord(),
      clipboardHistory: [],
      clipboardCategories: [],
      team: { activeTeamId: null },
      clipboardSettings: defaultClipboardSettingsRecord()
    })
    expect(onDisk.clipboardHistory).toHaveLength(2)
  })

  it('does not write to disk when the prune is a no-op', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clipboard-store-noop-'))
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
    const clipboard = new ClipboardStore(persister, () => state)

    // Empty history, large limit — nothing to prune, and we never call
    // appendEntry (which would itself enqueue a write), so the persister
    // queue stays untouched by the prune call.
    state.clipboardSettings.historyLimit = 100
    clipboard.prune()
    // pendingSerialized is the latest queued payload. A no-op prune must
    // not enqueue a new write, so it stays null.
    expect((persister as unknown as { pendingSerialized: string | null }).pendingSerialized).toBeNull()
    await persister.whenIdle()
  })
})

describe('ClipboardStore pinning', () => {
  it('toggles pinnedAt and reports state', async () => {
    const { clipboard } = await buildStore()
    clipboard.appendEntry({
      capturedAt: new Date().toISOString(),
      sourceBundleId: 'app.a',
      sourceAppName: 'A',
      item: makeTextItem('a')
    })
    const id = clipboard.getEntries()[0]!.id

    expect(clipboard.togglePin(id)).toBe(true)
    expect(clipboard.getEntries()[0]?.pinnedAt).toBeTruthy()
    expect(clipboard.togglePin(id)).toBe(false)
    expect(clipboard.getEntries()[0]?.pinnedAt).toBeUndefined()
  })

  it('returns false when toggling a missing entry', async () => {
    const { clipboard } = await buildStore()
    expect(clipboard.togglePin('nope')).toBe(false)
  })

  it('keeps pinned entries past the age cutoff and count limit', async () => {
    const { clipboard, state } = await buildStore()

    // Pin while fresh (prune runs on every append), then backdate it
    // past the 30-day cutoff and tighten limits.
    clipboard.appendEntry({ capturedAt: new Date().toISOString(), sourceBundleId: '', sourceAppName: '', item: makeTextItem('old-pinned') })
    clipboard.togglePin(clipboard.getEntries()[0]!.id)
    state.clipboardHistory[0]!.capturedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    clipboard.updateSettings({ historyLimit: 2 })

    for (const id of ['n1', 'n2', 'n3']) {
      clipboard.appendEntry({
        capturedAt: new Date().toISOString(),
        sourceBundleId: '',
        sourceAppName: '',
        item: makeTextItem(id)
      })
    }

    const entries = clipboard.getEntries()
    // The pinned entry survives both the 30-day cutoff and the count cap;
    // unpinned entries trim to the limit of 2.
    expect(entries.find((e) => e.item.kind === 'text' && (e.item as { text: string }).text.includes('old-pinned'))).toBeTruthy()
    const unpinned = entries.filter((e) => !e.pinnedAt)
    expect(unpinned.length).toBe(2)
  })
})
