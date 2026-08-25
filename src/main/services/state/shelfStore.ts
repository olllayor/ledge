import { randomUUID } from 'node:crypto'
import { recentShelvesLimitForPlan, shelfColorsForPlan } from '@shared/syncUtils'
import type {
  BillingPlan,
  FileRef,
  ShelfItemRecord,
  ShelfRecord,
} from '@shared/schema'
import { defaultShelfName, nextShelfColor } from './shelfNaming'
import { MAX_ITEMS_PER_SHELF, ShelfCapacityError } from '@shared/shelfLimits'
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
    return this.getActiveLiveShelf(this.getState())
  }

  getRecentShelves(): ShelfRecord[] {
    return [...this.getState().recentShelves]
  }

  // Personal shelves only. The only consumer is the personal-cloud
  // sync backfill (`getSyncBackfillCandidates`); team shelves are
  // local-only until per-item team sync ships and must never be pushed
  // into the user's personal cloud store.
  getAllShelves(): ShelfRecord[] {
    const state = this.getState()
    return [state.liveShelf, ...state.recentShelves].filter(
      (shelf): shelf is ShelfRecord => Boolean(shelf),
    )
  }

  // Explicitly personal-scoped reads/writes for the whole-shelf cloud
  // sync path, which must ignore team context even when a team is
  // active (`applyRemoteShelfSnapshot`, `findLocalShelf`).
  getPersonalLiveShelf(): ShelfRecord | null {
    return this.getState().liveShelf
  }

  replacePersonalLiveShelf(shelf: ShelfRecord): void {
    const state = this.getState()
    state.liveShelf = shelf
    this.persister.save(state)
  }

  /**
   * Mirror write for team shelf sync: replace the given team's local
   * shelf items with a server snapshot. The shelf record is created on
   * first write so switching to a team always has a container. Never
   * touches the personal slot or recents.
   */
  applyTeamShelfItems(teamId: string, items: ShelfItemRecord[]): ShelfRecord {
    const state = this.getState()
    const existing = state.teamLiveShelves[teamId]
    const shelf: ShelfRecord = existing
      ? { ...existing, items, updatedAt: new Date().toISOString() }
      : {
          id: randomUUID(),
          name: defaultShelfName(),
          color: nextShelfColor(0, state.sync.plan),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          origin: 'manual',
          items,
        }
    state.teamLiveShelves[teamId] = shelf
    this.persister.save(state)
    return shelf
  }

  currentPlan(): BillingPlan {
    return this.getState().sync.plan
  }

  createShelf(origin: ShelfOrigin): ShelfRecord {
    this.archiveLiveShelf()
    const state = this.getState()
    const newShelf: ShelfRecord = {
      id: randomUUID(),
      name: defaultShelfName(),
      color: nextShelfColor(state.recentShelves.length, state.sync.plan),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin,
      items: []
    }
    this.setActiveLiveShelf(state, newShelf)
    this.persister.save(state)
    return newShelf
  }

  ensureLiveShelf(origin: ShelfOrigin): ShelfRecord {
    const state = this.getState()
    return this.getActiveLiveShelf(state) ?? this.createShelf(origin)
  }

  appendItems(items: ShelfItemRecord[]): ShelfRecord {
    const state = this.getState()
    const liveShelf = this.getActiveLiveShelf(state) ?? this.createShelf('manual')
    if (liveShelf.items.length + items.length > MAX_ITEMS_PER_SHELF) {
      // Ingest door for the item ceiling: every append flows through
      // here, so overflow is rejected before touching persisted state.
      throw new ShelfCapacityError(liveShelf.items.length, items.length, MAX_ITEMS_PER_SHELF)
    }
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
    const liveShelf = this.getActiveLiveShelf(state)
    if (!liveShelf) {
      return null
    }

    liveShelf.name = name.trim() || defaultShelfName()
    liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return liveShelf
  }

  removeItem(itemId: string): ShelfRecord | null {
    const state = this.getState()
    const liveShelf = this.getActiveLiveShelf(state)
    if (!liveShelf) {
      return null
    }

    liveShelf.items = liveShelf.items
      .filter((item) => item.id !== itemId)
      .map((item, index) => ({ ...item, order: index }))
    liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return liveShelf
  }

  clearLiveShelf(): ShelfRecord | null {
    const state = this.getState()
    const liveShelf = this.getActiveLiveShelf(state)
    if (!liveShelf) {
      return null
    }

    liveShelf.items = []
    liveShelf.updatedAt = new Date().toISOString()
    this.persister.save(state)
    return liveShelf
  }

  reorderItems(itemIds: string[]): ShelfRecord | null {
    const state = this.getState()
    const liveShelf = this.getActiveLiveShelf(state)
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
    this.setActiveLiveShelf(state, shelf)
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

  removeRecentShelf(id: string): void {
    const state = this.getState()
    const next = state.recentShelves.filter((entry) => entry.id !== id)
    if (next.length === state.recentShelves.length) {
      return
    }
    state.recentShelves = next
    this.persister.save(state)
  }

  closeShelf(): void {
    const state = this.getState()
    const teamId = state.team.activeTeamId
    if (teamId) {
      // Closing a team shelf discards the local copy — team content is
      // server-backed via per-item sync and must not leak into the
      // personal recents list (which the personal cloud syncs).
      delete state.teamLiveShelves[teamId]
      this.persister.save(state)
      return
    }
    this.archiveLiveShelf()
    this.persister.save(state)
  }

  restoreShelf(id: string): ShelfRecord | null {
    const state = this.getState()
    const shelf = state.recentShelves.find((entry) => entry.id === id)
    if (!shelf) {
      return null
    }

    this.archiveLiveShelf()
    state.recentShelves = state.recentShelves.filter((entry) => entry.id !== id)
    const restored: ShelfRecord = {
      ...shelf,
      origin: 'restore',
      updatedAt: new Date().toISOString()
    }
    this.setActiveLiveShelf(state, restored)
    this.persister.save(state)
    return restored
  }

  relinkFileBackedItem(
    itemId: string,
    fileRef: Pick<FileRef, 'originalPath' | 'bookmarkBase64' | 'resolvedPath'>,
  ): ShelfRecord | null {
    const state = this.getState()
    const liveShelf = this.getActiveLiveShelf(state)
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

  private getActiveLiveShelf(state: PersistedState): ShelfRecord | null {
    const teamId = state.team.activeTeamId
    if (!teamId) {
      return state.liveShelf
    }
    return state.teamLiveShelves[teamId] ?? null
  }

  private setActiveLiveShelf(state: PersistedState, shelf: ShelfRecord | null): void {
    const teamId = state.team.activeTeamId
    if (!teamId) {
      state.liveShelf = shelf
    } else if (shelf) {
      state.teamLiveShelves[teamId] = shelf
    } else {
      delete state.teamLiveShelves[teamId]
    }
  }

  private archiveLiveShelf(): void {
    const state = this.getState()
    const teamId = state.team.activeTeamId
    if (teamId) {
      return
    }

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
