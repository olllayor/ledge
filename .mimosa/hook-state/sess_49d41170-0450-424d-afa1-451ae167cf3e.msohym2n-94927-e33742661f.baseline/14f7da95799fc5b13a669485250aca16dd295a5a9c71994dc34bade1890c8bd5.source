import { randomUUID } from 'node:crypto'
import { recentShelvesLimitForPlan, shelfColorsForPlan } from '@shared/syncUtils'
import type {
  BillingPlan,
  FileRef,
  ShelfItemRecord,
  ShelfRecord,
} from '@shared/schema'
import { defaultShelfName, nextShelfColor } from './shelfNaming'
import type { PersisterBinding, PersistedState, ShelfOrigin } from './types'

/**
 * Owns the live-shelf + recent-shelves lifecycle. Mutators edit the
 * shared `PersistedState` snapshot in place and call `persister.save`
 * exactly once per logical change. Reads return defensive copies so
 * callers can't mutate persisted state by accident.
 */
export class ShelfStore {
  constructor(
    private readonly persister: PersisterBinding,
    private readonly getState: () => PersistedState,
  ) {}

  getLiveShelf(): ShelfRecord | null {
    return this.getState().liveShelf
  }

  getRecentShelves(): ShelfRecord[] {
    return [...this.getState().recentShelves]
  }

  getAllShelves(): ShelfRecord[] {
    const state = this.getState()
    return [state.liveShelf, ...state.recentShelves].filter(
      (shelf): shelf is ShelfRecord => Boolean(shelf),
    )
  }

  currentPlan(): BillingPlan {
    return this.getState().sync.plan
  }

  createShelf(origin: ShelfOrigin): ShelfRecord {
    this.archiveLiveShelf()
    const state = this.getState()
    state.liveShelf = {
      id: randomUUID(),
      name: defaultShelfName(),
      color: nextShelfColor(state.recentShelves.length, state.sync.plan),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin,
      items: []
    }
    this.persister.save(state)
    return state.liveShelf
  }

  ensureLiveShelf(origin: ShelfOrigin): ShelfRecord {
    const state = this.getState()
    return state.liveShelf ?? this.createShelf(origin)
  }

  appendItems(items: ShelfItemRecord[]): ShelfRecord {
    const state = this.getState()
    const liveShelf = state.liveShelf ?? this.createShelf('manual')
    const nextOrder = liveShelf.items.length
    liveShelf.items.push(
      ...items.map((item, index) => ({
        ...item,
        order: nextOrder + index
      })),
    )
    liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return liveShelf
  }

  renameLiveShelf(name: string): ShelfRecord | null {
    const state = this.getState()
    if (!state.liveShelf) {
      return null
    }

    state.liveShelf.name = name.trim() || defaultShelfName()
    state.liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return state.liveShelf
  }

  removeItem(itemId: string): ShelfRecord | null {
    const state = this.getState()
    if (!state.liveShelf) {
      return null
    }

    state.liveShelf.items = state.liveShelf.items
      .filter((item) => item.id !== itemId)
      .map((item, index) => ({ ...item, order: index }))
    state.liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return state.liveShelf
  }

  clearLiveShelf(): ShelfRecord | null {
    const state = this.getState()
    if (!state.liveShelf) {
      return null
    }

    state.liveShelf.items = []
    state.liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return state.liveShelf
  }

  reorderItems(itemIds: string[]): ShelfRecord | null {
    const state = this.getState()
    const liveShelf = state.liveShelf
    if (!liveShelf) {
      return null
    }

    const byId = new Map(liveShelf.items.map((item) => [item.id, item]))
    const reordered = itemIds
      .map((id) => byId.get(id))
      .filter((item): item is ShelfItemRecord => Boolean(item))

    const missing = liveShelf.items.filter((item) => !itemIds.includes(item.id))
    liveShelf.items = [...reordered, ...missing].map((item, index) => ({
      ...item,
      order: index
    }))
    liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return liveShelf
  }

  replaceLiveShelf(shelf: ShelfRecord | null): void {
    const state = this.getState()
    state.liveShelf = shelf
    this.persister.save(state)
  }

  replaceRecentShelf(shelf: ShelfRecord): void {
    const state = this.getState()
    const index = state.recentShelves.findIndex((entry) => entry.id === shelf.id)
    if (index === -1) {
      return
    }
    state.recentShelves[index] = shelf
    this.persister.save(state)
  }

  closeShelf(): void {
    this.archiveLiveShelf()
    this.persister.save(this.getState())
  }

  restoreShelf(id: string): ShelfRecord | null {
    const state = this.getState()
    const shelf = state.recentShelves.find((entry) => entry.id === id)
    if (!shelf) {
      return null
    }

    this.archiveLiveShelf()
    state.recentShelves = state.recentShelves.filter((entry) => entry.id !== id)
    state.liveShelf = {
      ...shelf,
      origin: 'restore',
      updatedAt: new Date().toISOString()
    }
    this.persister.save(state)
    return state.liveShelf
  }

  relinkFileBackedItem(
    itemId: string,
    fileRef: Pick<FileRef, 'originalPath' | 'bookmarkBase64' | 'resolvedPath'>,
  ): ShelfRecord | null {
    const state = this.getState()
    const liveShelf = state.liveShelf
    if (!liveShelf) {
      return null
    }

    const itemIndex = liveShelf.items.findIndex((item) => item.id === itemId)
    if (itemIndex === -1) {
      return null
    }

    const item = liveShelf.items[itemIndex]
    if (!('file' in item)) {
      return null
    }

    liveShelf.items[itemIndex] = {
      ...item,
      file: {
        ...item.file,
        ...fileRef,
        isMissing: false,
        isStale: false
      }
    }
    liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return liveShelf
  }

  /**
   * Enforce the plan-based recents cap. Called after sync state
   * changes (plan upgrade/downgrade) by `PreferencesStore` via the
   * shared `getState` reference.
   */
  applyPlanLimits(): void {
    const state = this.getState()
    const recentsLimit = recentShelvesLimitForPlan(state.sync.plan)
    if (state.recentShelves.length > recentsLimit) {
      state.recentShelves = state.recentShelves.slice(0, recentsLimit)
      this.persister.save(state)
    }
  }

  private archiveLiveShelf(): void {
    const state = this.getState()
    const liveShelf = state.liveShelf
    if (!liveShelf) {
      return
    }

    // Empty shelves are transient workspace, not recent history.
    if (liveShelf.items.length > 0) {
      const existing = state.recentShelves.filter((entry) => entry.id !== liveShelf.id)
      const recentsLimit = recentShelvesLimitForPlan(state.sync.plan)
      state.recentShelves = [liveShelf, ...existing].slice(0, recentsLimit)
    }

    state.liveShelf = null
  }
}

// `shelfColorsForPlan` is re-exported so the orchestrator can keep
// importing both pieces from the same module if it wants to.
export { shelfColorsForPlan }
