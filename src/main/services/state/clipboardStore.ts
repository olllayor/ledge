import { randomUUID } from 'node:crypto'
import type {
  ClipboardCategory,
  ClipboardEntry,
  ClipboardSettings,
  ShelfColor,
  ShelfItemRecord,
} from '@shared/schema'
import type { PersisterBinding, PersistedState } from './types'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export interface ClipboardEntryInput {
  capturedAt: string
  sourceBundleId: string
  sourceAppName: string
  item: ShelfItemRecord
  thumbnailDataUri?: string
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
    const entry: ClipboardEntry = {
      id: randomUUID(),
      capturedAt: input.capturedAt,
      sourceBundleId: input.sourceBundleId,
      sourceAppName: input.sourceAppName,
      item: input.item,
      thumbnailDataUri: input.thumbnailDataUri,
      categoryIds: input.categoryIds ?? []
    }
    state.clipboardHistory.unshift(entry)
    this.prune()
    this.persister.save(state)
    return entry
  }

  removeEntry(id: string): void {
    const state = this.getState()
    state.clipboardHistory = state.clipboardHistory.filter((entry) => entry.id !== id)
    this.persister.save(state)
  }

  clearHistory(): void {
    const state = this.getState()
    state.clipboardHistory = []
    // Categories are intentionally kept; they're orthogonal workspace.
    this.persister.save(state)
  }

  prune(): void {
    const state = this.getState()
    const limit = Math.max(1, state.clipboardSettings.historyLimit)
    const cutoff = Date.now() - THIRTY_DAYS_MS

    state.clipboardHistory = state.clipboardHistory
      .filter((entry) => {
        const t = Date.parse(entry.capturedAt)
        return Number.isFinite(t) && t >= cutoff
      })
      .slice(0, limit)
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
    this.prune()
    this.persister.save(state)
    return state.clipboardSettings
  }
}
