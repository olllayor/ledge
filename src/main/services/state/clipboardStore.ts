import { randomUUID } from 'node:crypto'
import type {
  ClipboardCategory,
  ClipboardEntry,
  ClipboardSettings,
  ShelfColor,
  ShelfItemRecord,
} from '@shared/schema'
import { getFileBackedPath } from '@shared/fileUtils'
import { MAX_CLIPBOARD_HISTORY_BYTES } from '@shared/shelfLimits'
import type { PersisterBinding, PersistedState } from './types'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function estimateEntryBytes(entry: ClipboardEntry): number {
  const item = entry.item
  if (item.kind === 'text' || item.kind === 'code') {
    return Buffer.byteLength(item.text, 'utf8')
  }
  return 0
}

export interface ClipboardEntryInput {
  capturedAt: string
  sourceBundleId: string
  sourceAppName: string
  item: ShelfItemRecord
  thumbnailDataUri?: string
  imageSha256?: string
  categoryIds?: string[]
}

/**
 * Local-first clipboard history, never reaches Convex. Three
 * concerns (entries, categories, settings) are colocated here because
 * they share the same persisted slice and the same `save` pipeline.
 */
export class ClipboardStore {
  constructor(
    private readonly persister: PersisterBinding,
    private readonly getState: () => PersistedState,
  ) {}

  getEntries(): ClipboardEntry[] {
    return [...this.getState().clipboardHistory]
  }

  getCategories(): ClipboardCategory[] {
    return [...this.getState().clipboardCategories]
  }

  getSettings(): ClipboardSettings {
    return this.getState().clipboardSettings
  }

  appendEntry(input: ClipboardEntryInput): ClipboardEntry {
    const state = this.getState()
    // Dedup: if the same content already exists (common when user hits Cmd+C
    // repeatedly), drop the older copy and keep the newest at the top instead
    // of growing the history with identical entries. Image entries dedup by
    // PNG content hash — each capture writes a fresh uuid-named asset file,
    // so path comparison can never match.
    const dupIdx = state.clipboardHistory.findIndex((e) =>
      input.imageSha256 && e.imageSha256
        ? e.imageSha256 === input.imageSha256
        : isSameItem(e.item, input.item),
    )
    let entry: ClipboardEntry
    if (dupIdx !== -1) {
      // Re-copy of existing content: keep the original entry id (and its
      // asset file + thumbnail) so selected cards and in-flight undo
      // snapshots stay valid, and merge the user's category assignments
      // instead of silently stripping them.
      const dup = state.clipboardHistory[dupIdx]!
      state.clipboardHistory.splice(dupIdx, 1)
      entry = {
        ...dup,
        capturedAt: input.capturedAt,
        sourceBundleId: input.sourceBundleId,
        sourceAppName: input.sourceAppName,
        thumbnailDataUri: input.thumbnailDataUri ?? dup.thumbnailDataUri,
        imageSha256: dup.imageSha256 ?? input.imageSha256,
        categoryIds: [...new Set([...dup.categoryIds, ...(input.categoryIds ?? [])])]
      }
    } else {
      entry = {
        id: randomUUID(),
        capturedAt: input.capturedAt,
        sourceBundleId: input.sourceBundleId,
        sourceAppName: input.sourceAppName,
        item: input.item,
        thumbnailDataUri: input.thumbnailDataUri,
        imageSha256: input.imageSha256,
        categoryIds: input.categoryIds ?? []
      }
    }
    state.clipboardHistory.unshift(entry)
    this.applyPrune()
    this.persister.save(state)
    return entry
  }

  removeEntry(id: string): void {
    const state = this.getState()
    state.clipboardHistory = state.clipboardHistory.filter((entry) => entry.id !== id)
    this.persister.save(state)
  }

  togglePin(id: string): boolean {
    const state = this.getState()
    const entry = state.clipboardHistory.find((e) => e.id === id)
    if (!entry) return false
    entry.pinnedAt = entry.pinnedAt ? undefined : new Date().toISOString()
    if (!entry.pinnedAt) delete entry.pinnedAt
    this.persister.save(state)
    return Boolean(entry.pinnedAt)
  }

  clearHistory(): void {
    const state = this.getState()
    state.clipboardHistory = []
    // Categories are intentionally kept; they're orthogonal workspace.
    this.persister.save(state)
  }

  restoreHistory(entries: ClipboardEntry[]): void {
    const state = this.getState()
    // Defensive clone — callers may mutate the array after.
    state.clipboardHistory = [...entries]
    // Enforce the limit and the 30-day cutoff; a restored set can
    // otherwise exceed both indefinitely (prune otherwise only runs on
    // append, settings change, or manual prune).
    this.applyPrune()
    this.persister.save(state)
  }

  prune(): void {
    if (this.applyPrune()) {
      this.persister.save(this.getState())
    }
  }

  private applyPrune(): boolean {
    const state = this.getState()
    const limit = Math.max(1, state.clipboardSettings.historyLimit)
    const cutoff = Date.now() - THIRTY_DAYS_MS
    const previousLength = state.clipboardHistory.length

    // Pinned entries are exempt from the age cutoff and the count
    // limit; only unpinned entries fill and overflow the limit.
    let unpinnedKept = 0
    state.clipboardHistory = state.clipboardHistory.filter((entry) => {
      if (entry.pinnedAt) return true

      const t = Date.parse(entry.capturedAt)
      if (!Number.isFinite(t) || t < cutoff) return false
      if (unpinnedKept >= limit) return false
      unpinnedKept += 1
      return true
    })

    // Total-text byte budget: one huge capture must not bloat the
    // state file forever, regardless of count limits. Newest-first
    // walk (index order), oldest entries dropped first.
    let remainingBytes = MAX_CLIPBOARD_HISTORY_BYTES
    const withinBudget: ClipboardEntry[] = []
    for (const entry of state.clipboardHistory) {
      const bytes = estimateEntryBytes(entry)
      if (bytes > remainingBytes) continue
      remainingBytes -= bytes
      withinBudget.push(entry)
    }
    state.clipboardHistory = withinBudget

    return state.clipboardHistory.length !== previousLength
  }

  createCategory(name: string, color: ShelfColor): ClipboardCategory {
    const state = this.getState()
    const category: ClipboardCategory = {
      id: randomUUID(),
      name: name.trim(),
      color,
      createdAt: new Date().toISOString()
    }
    state.clipboardCategories.push(category)
    this.persister.save(state)
    return category
  }

  renameCategory(id: string, name: string): void {
    const state = this.getState()
    const category = state.clipboardCategories.find((c) => c.id === id)
    if (!category) return
    const trimmed = name.trim()
    if (!trimmed) return
    category.name = trimmed
    this.persister.save(state)
  }

  removeCategory(id: string): void {
    const state = this.getState()
    state.clipboardCategories = state.clipboardCategories.filter((c) => c.id !== id)
    // Strip the id from every entry that referenced it.
    for (const entry of state.clipboardHistory) {
      entry.categoryIds = entry.categoryIds.filter((cid) => cid !== id)
    }
    this.persister.save(state)
  }

  assignEntryToCategory(entryId: string, categoryId: string): void {
    const state = this.getState()
    const entry = state.clipboardHistory.find((e) => e.id === entryId)
    if (!entry) return
    if (!state.clipboardCategories.some((c) => c.id === categoryId)) return
    if (!entry.categoryIds.includes(categoryId)) {
      entry.categoryIds = [...entry.categoryIds, categoryId]
      this.persister.save(state)
    }
  }

  unassignEntryFromCategory(entryId: string, categoryId: string): void {
    const state = this.getState()
    const entry = state.clipboardHistory.find((e) => e.id === entryId)
    if (!entry) return
    const next = entry.categoryIds.filter((cid) => cid !== categoryId)
    if (next.length !== entry.categoryIds.length) {
      entry.categoryIds = next
      this.persister.save(state)
    }
  }

  updateSettings(patch: Partial<ClipboardSettings>): ClipboardSettings {
    const state = this.getState()
    state.clipboardSettings = {
      ...state.clipboardSettings,
      ...patch
    }
    // Re-enforce limits after a patch (e.g. user lowered historyLimit).
    this.applyPrune()
    this.persister.save(state)
    return state.clipboardSettings
  }
}

function isSameItem(a: ShelfItemRecord, b: ShelfItemRecord): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'text':
      return a.text === (b as typeof a).text
    case 'code':
      return a.text === (b as typeof a).text
    case 'url':
      return a.url === (b as typeof a).url
    case 'color':
      return a.hex.toLowerCase() === (b as typeof a).hex.toLowerCase()
    case 'file':
    case 'folder':
    case 'imageAsset': {
      const pa = getFileBackedPath(a)
      const pb = getFileBackedPath(b as typeof a)
      return !!pa && pa === pb
    }
    default:
      return false
  }
}
