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
    recentShelves: [],
    preferences: defaultPreferences(),
    sync: defaultSyncStateRecord(),
    clipboardHistory: [],
    clipboardCategories: [],
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
})
