import { appStateSchema, type AppState, type PermissionStatus } from '@shared/schema'
import { ShelfStore } from './state/shelfStore'
import { ClipboardStore, type ClipboardEntryInput } from './state/clipboardStore'
import { PreferencesStore } from './state/preferencesStore'
import { SyncStore } from './state/syncStore'
import {
  StatePersister,
  buildStateFileLayout,
  defaultClipboardSettingsRecord,
  defaultPreferences,
  defaultSyncStateRecord,
  type CorruptionListener,
  type PersistenceErrorListener,
} from './state/persister'
import type { PersistedState } from './state/types'

export type { ClipboardEntryInput } from './state/clipboardStore'

export interface StateStoreOptions {
  onPersistenceError?: PersistenceErrorListener
  onCorruptionDetected?: CorruptionListener
}

export type { CorruptionListener, PersistenceErrorListener }

/**
 * Thin facade over the per-domain stores (`ShelfStore`,
 * `ClipboardStore`, `PreferencesStore`, `SyncStore`) sharing one
 * atomic-write `StatePersister`. The public API is the union of
 * their methods so existing call sites (`ShelfController`,
 * `IpcRegistrar`, `ClipboardHistoryService`, …) keep working
 * unchanged.
 *
 * The split exists so each domain can be reasoned about — and
 * unit-tested — independently, and so the file-format details
 * (migrations, atomic writes) live in one place (`StatePersister`)
 * rather than being mixed with shelf-lifecycle code.
 */
export class StateStore {
  readonly assetsDir: string
  readonly exportsDir: string
  readonly statePath: string
  readonly shelves: ShelfStore
  readonly clipboard: ClipboardStore
  readonly preferences: PreferencesStore
  readonly sync: SyncStore

  private readonly persister: StatePersister
  private readonly persisted: PersistedState

  constructor(userDataDir: string, options: StateStoreOptions = {}) {
    const layout = buildStateFileLayout(userDataDir)
    this.assetsDir = layout.assetsDir
    this.exportsDir = layout.exportsDir
    this.statePath = layout.statePath

    const defaultState: PersistedState = {
      liveShelf: null,
      recentShelves: [],
      preferences: defaultPreferences(),
      sync: defaultSyncStateRecord(),
      clipboardHistory: [],
      clipboardCategories: [],
      clipboardSettings: defaultClipboardSettingsRecord()
    }

    this.persister = new StatePersister({
      statePath: layout.statePath,
      onPersistenceError: options.onPersistenceError,
      onCorruptionDetected: options.onCorruptionDetected
    })

    const loaded = this.persister.load(defaultState)
    this.persisted = loaded.state

    this.shelves = new ShelfStore(this.persister, () => this.persisted)
    this.clipboard = new ClipboardStore(this.persister, () => this.persisted)
    this.preferences = new PreferencesStore(this.persister, () => this.persisted)
    this.sync = new SyncStore(this.persister, () => this.persisted)

    if (loaded.didMigrate) {
      this.persister.save(this.persisted)
    }

    this.sync.ensureDeviceId()
  }

  snapshot(permissionStatus: PermissionStatus): AppState {
    return appStateSchema.parse({
      ...this.persisted,
      permissionStatus
    })
  }

  whenIdle(): Promise<void> {
    return this.persister.whenIdle()
  }

  // ---- Shelf facade (delegated to `ShelfStore`) ----

  getLiveShelf() {
    return this.shelves.getLiveShelf()
  }

  getRecentShelves() {
    return this.shelves.getRecentShelves()
  }

  getAllShelves() {
    return this.shelves.getAllShelves()
  }

  createShelf(origin: Parameters<ShelfStore['createShelf']>[0]) {
    return this.shelves.createShelf(origin)
  }

  ensureLiveShelf(origin: Parameters<ShelfStore['ensureLiveShelf']>[0]) {
    return this.shelves.ensureLiveShelf(origin)
  }

  appendItems(items: Parameters<ShelfStore['appendItems']>[0]) {
    return this.shelves.appendItems(items)
  }

  renameLiveShelf(name: string) {
    return this.shelves.renameLiveShelf(name)
  }

  removeItem(itemId: string) {
    return this.shelves.removeItem(itemId)
  }

  clearLiveShelf() {
    return this.shelves.clearLiveShelf()
  }

  reorderItems(itemIds: string[]) {
    return this.shelves.reorderItems(itemIds)
  }

  replaceLiveShelf(shelf: Parameters<ShelfStore['replaceLiveShelf']>[0]) {
    return this.shelves.replaceLiveShelf(shelf)
  }

  replaceRecentShelf(shelf: Parameters<ShelfStore['replaceRecentShelf']>[0]) {
    return this.shelves.replaceRecentShelf(shelf)
  }

  closeShelf() {
    return this.shelves.closeShelf()
  }

  restoreShelf(id: string) {
    return this.shelves.restoreShelf(id)
  }

  relinkFileBackedItem(
    itemId: string,
    fileRef: Parameters<ShelfStore['relinkFileBackedItem']>[1],
  ) {
    return this.shelves.relinkFileBackedItem(itemId, fileRef)
  }

  // ---- Preferences facade (delegated to `PreferencesStore`) ----

  getPreferences() {
    return this.preferences.get()
  }

  setPreferences(patch: Parameters<PreferencesStore['set']>[0]) {
    return this.preferences.set(patch)
  }

  // ---- Sync facade (delegated to `SyncStore`) ----

  getSyncState() {
    return this.sync.get()
  }

  setSyncState(patch: Parameters<SyncStore['set']>[0]) {
    const next = this.sync.set(patch)
    this.shelves.applyPlanLimits()
    return next
  }

  currentPlan() {
    return this.sync.get().plan
  }

  // ---- Clipboard facade (delegated to `ClipboardStore`) ----

  getClipboardEntries() {
    return this.clipboard.getEntries()
  }

  getClipboardCategories() {
    return this.clipboard.getCategories()
  }

  getClipboardSettings() {
    return this.clipboard.getSettings()
  }

  appendClipboardEntry(input: ClipboardEntryInput) {
    return this.clipboard.appendEntry(input)
  }

  removeClipboardEntry(id: string) {
    return this.clipboard.removeEntry(id)
  }

  clearClipboardHistory() {
    return this.clipboard.clearHistory()
  }

  pruneClipboardHistory() {
    return this.clipboard.prune()
  }

  createClipboardCategory(name: string, color: Parameters<ClipboardStore['createCategory']>[1]) {
    return this.clipboard.createCategory(name, color)
  }

  renameClipboardCategory(id: string, name: string) {
    return this.clipboard.renameCategory(id, name)
  }

  removeClipboardCategory(id: string) {
    return this.clipboard.removeCategory(id)
  }

  assignEntryToCategory(entryId: string, categoryId: string) {
    return this.clipboard.assignEntryToCategory(entryId, categoryId)
  }

  unassignEntryFromCategory(entryId: string, categoryId: string) {
    return this.clipboard.unassignEntryFromCategory(entryId, categoryId)
  }

  updateClipboardSettings(patch: Parameters<ClipboardStore['updateSettings']>[0]) {
    return this.clipboard.updateSettings(patch)
  }
}
