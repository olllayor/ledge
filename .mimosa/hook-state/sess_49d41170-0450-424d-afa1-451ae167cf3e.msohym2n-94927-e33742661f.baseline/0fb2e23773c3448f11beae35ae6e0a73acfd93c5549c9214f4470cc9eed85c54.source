import type {
  ClipboardCategory,
  ClipboardEntry,
  ClipboardSettings,
  PreferencesRecord,
  ShelfRecord,
  SyncState,
  TeamState,
} from '@shared/schema'

/**
 * The shape of state that the main process owns and persists to disk.
 * Kept separate from `AppState` (the IPC broadcast shape) so the
 * `permissionStatus` field is owned by the orchestrator, not the
 * on-disk file. Each domain slice (shelf / clipboard / preferences /
 * sync) lives in its own sub-store and writes to the shared
 * `PersistedState` snapshot.
 */
export interface PersistedState {
  liveShelf: ShelfRecord | null
  recentShelves: ShelfRecord[]
  preferences: PreferencesRecord
  sync: SyncState
  team: TeamState
  clipboardHistory: ClipboardEntry[]
  clipboardCategories: ClipboardCategory[]
  clipboardSettings: ClipboardSettings
}

/**
 * Read-only handle each sub-store holds so it can call back into the
 * persister without depending on a concrete sub-store type. Splits the
 * domain logic (`ShelfStore` / `ClipboardStore` / …) from the
 * persistence pipeline (`StatePersister`).
 */
export interface PersisterBinding {
  save(snapshot: PersistedState): void
  whenIdle(): Promise<void>
}

export type ShelfOrigin = ShelfRecord['origin']
