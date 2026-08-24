import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  appStateSchema,
  preferencesRecordSchema,
  syncStateSchema,
} from '@shared/schema'
import type {
  ClipboardSettings,
  PreferencesRecord,
  SyncState,
} from '@shared/schema'
import type { PersistedState } from './types'

const persistedStateSchema = appStateSchema.omit({ permissionStatus: true })

export const PERSISTED_STATE_VERSION = 4

export interface StateFileLayout {
  userDataDir: string
  statePath: string
  assetsDir: string
  exportsDir: string
}

export function buildStateFileLayout(userDataDir: string): StateFileLayout {
  const assetsDir = join(userDataDir, 'assets')
  const exportsDir = join(userDataDir, 'exports')
  const statePath = join(userDataDir, 'state.json')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(assetsDir, { recursive: true })
  mkdirSync(exportsDir, { recursive: true })
  return { userDataDir, statePath, assetsDir, exportsDir }
}

export interface CorruptionDetails {
  backupPath: string
  cause: Error
}

export type PersistenceErrorListener = (error: Error) => void
export type CorruptionListener = (details: CorruptionDetails) => void

export interface PersisterOptions {
  statePath: string
  onPersistenceError?: PersistenceErrorListener
  onCorruptionDetected?: CorruptionListener
}

export interface LoadResult {
  state: PersistedState
  didMigrate: boolean
}

/**
 * Owns the read/write/queue/migration pipeline for the on-disk state.
 * It does not know what is in `PersistedState`; it just stores the last
 * snapshot it was handed and writes it atomically to disk.
 *
 * Extracted from `StateStore` so the file-format details (migrations,
 * atomic temp-then-rename, corruption quarantine) live in one place
 * and the domain stores (shelf/clipboard/preferences) can focus on
 * shaping their own slice.
 */
export class StatePersister {
  private pendingSerialized: string | null = null
  private writeScheduled = false
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly statePath: string
  private readonly onPersistenceError: PersistenceErrorListener | null
  private readonly onCorruptionDetected: CorruptionListener | null

  constructor(options: PersisterOptions) {
    this.statePath = options.statePath
    this.onPersistenceError = options.onPersistenceError ?? null
    this.onCorruptionDetected = options.onCorruptionDetected ?? null
  }

  /**
   * Load persisted state from disk, applying the v1->v2->v3 migration
   * chain. Returns the supplied default state if the file is missing
   * or unreadable; in the unreadable case, the corrupt file is
   * quarantined and a corruption event is raised so the orchestrator
   * can surface a toast.
   *
   * `didMigrate` tells the caller whether the file was on a legacy
   * envelope so the orchestrator can re-save and commit the new
   * version.
   */
  load(defaultState: PersistedState): LoadResult {
    if (!existsSync(this.statePath)) {
      return { state: defaultState, didMigrate: false }
    }

    try {
      const raw = readFileSync(this.statePath, 'utf8')
      const parsed = JSON.parse(raw)
      return migratePersistedState(parsed, defaultState)
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error))
      this.quarantineCorruptStateFile(cause)
      return { state: defaultState, didMigrate: false }
    }
  }

  /**
   * Enqueue a write of the current persisted-state snapshot. Writes
   * are serialized: a burst of `save()` calls collapses into a single
   * disk write carrying the latest snapshot. The write is atomic via
   * a sibling temp file + rename so a crash mid-write can't leave
   * the state file truncated.
   */
  save(state: PersistedState): void {
    this.pendingSerialized = JSON.stringify(
      {
        version: PERSISTED_STATE_VERSION,
        ...state
      },
      null,
      2,
    )

    if (this.writeScheduled) {
      return
    }

    this.writeScheduled = true
    this.writeQueue = this.writeQueue
      .then(async () => {
        while (this.pendingSerialized !== null) {
          const serialized = this.pendingSerialized
          this.pendingSerialized = null

          try {
            const tempPath = `${this.statePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            await fs.writeFile(tempPath, serialized, 'utf8')
            // Ensure data hits disk before rename; crash during write
            // without fsync could leave temp truncated and rename moot.
            try {
              const handle = await fs.open(tempPath, 'r')
              await handle.sync()
              await handle.close()
            } catch {
              // Best-effort fsync; rename still provides atomicity.
            }
            await fs.rename(tempPath, this.statePath)
            // Best-effort fsync of directory for durability on macOS.
            try {
              const dir = this.statePath.slice(0, this.statePath.lastIndexOf('/')) || '.'
              const dirHandle = await fs.open(dir, 'r')
              await dirHandle.sync()
              await dirHandle.close()
            } catch {
              // Non-critical on platforms that don't support dir fsync.
            }
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))
            console.error('Failed to persist Ledge state.', err)
            this.onPersistenceError?.(err)
          }
        }

        this.writeScheduled = false
      })
      .catch(() => {
        // Swallow rejections from the async writer so the chain stays
        // resolved and subsequent save() calls continue to flush.
        // Errors are already reported via onPersistenceError above.
      })
  }

  whenIdle(): Promise<void> {
    return this.writeQueue
  }

  private quarantineCorruptStateFile(cause: Error): void {
    const backupPath = `${this.statePath}.corrupt-${Date.now()}`
    try {
      renameSync(this.statePath, backupPath)
    } catch (renameError) {
      console.error('Failed to quarantine corrupt Ledge state file.', renameError)
      this.onPersistenceError?.(
        renameError instanceof Error ? renameError : new Error(String(renameError)),
      )
      return
    }
    console.error(`Ledge state file was unreadable (${cause.message}); moved to ${backupPath}`)
    // Prune old corrupt backups to avoid disk fill; keep last 3.
    try {
      const dir = this.statePath.slice(0, this.statePath.lastIndexOf('/')) || '.'
      const prefix = this.statePath.slice(dir.length + 1) + '.corrupt-'
      const corruptFiles = readdirSync(dir)
        .filter((name: string) => name.startsWith(prefix))
        .sort()
      for (const old of corruptFiles.slice(0, Math.max(0, corruptFiles.length - 3))) {
        try {
          unlinkSync(join(dir, old))
        } catch {
          // Best-effort cleanup.
        }
      }
    } catch {
      // Pruning is best-effort.
    }
    this.onCorruptionDetected?.({ backupPath, cause })
  }
}

function migratePersistedState(parsed: unknown, defaultState: PersistedState): LoadResult {
  const version =
    parsed && typeof parsed === 'object' && 'version' in parsed
      ? (parsed as { version: unknown }).version
      : null

  // Per-slice parsing with fallback-to-default. The historical envelopes
  // used to be validated against the *current* field shapes, so any shape
  // drift since that version threw and quarantined a perfectly good file,
  // resetting shelves AND clipboard history. Parsing each slice
  // independently confines damage to the slice that actually changed;
  // everything else survives the upgrade.
  const raw = (parsed ?? {}) as Record<string, unknown>
  const shapes = persistedStateSchema.shape
  let salvaged = false

  const slice = <T>(schema: z.ZodType<T>, key: keyof typeof shapes & string): T | null => {
    const result = schema.safeParse(raw[key])
    if (result.success) {
      return result.data
    }
    salvaged = true
    console.warn(`Ledge state slice "${key}" failed validation and was reset to defaults.`)
    return null
  }

  const liveShelf = slice(shapes.liveShelf, 'liveShelf')
  const recentShelves = slice(shapes.recentShelves, 'recentShelves')
  const preferences = slice(shapes.preferences, 'preferences') ?? defaultState.preferences
  const clipboardHistory = slice(shapes.clipboardHistory, 'clipboardHistory')
  const clipboardCategories = slice(shapes.clipboardCategories, 'clipboardCategories')
  const clipboardSettings = slice(shapes.clipboardSettings, 'clipboardSettings')

  // Sync arrived in v2; v1 files predate it entirely.
  const hasSyncSlice = version === null || (typeof version === 'number' && version >= 2)
  const sync = hasSyncSlice
    ? (slice(shapes.sync, 'sync') ?? defaultSyncStateRecord())
    : defaultSyncStateRecord()

  // Team live shelves arrived in v4.
  const hasTeamSlices = typeof version === 'number' && version >= 4 && version <= PERSISTED_STATE_VERSION
  const teamLiveShelves =
    hasTeamSlices ?
      (slice(shapes.teamLiveShelves, 'teamLiveShelves') ?? {})
    : {}
  const team =
    hasTeamSlices ?
      (slice(shapes.team, 'team') ?? { activeTeamId: null })
    : { activeTeamId: null }

  return {
    state: {
      liveShelf: liveShelf ?? defaultState.liveShelf,
      recentShelves: recentShelves ?? defaultState.recentShelves,
      teamLiveShelves,
      preferences,
      sync,
      team,
      clipboardHistory: clipboardHistory ?? defaultState.clipboardHistory,
      clipboardCategories: clipboardCategories ?? defaultState.clipboardCategories,
      clipboardSettings: clipboardSettings ?? defaultState.clipboardSettings,
    },
    // Any salvage (or a legacy envelope missing newer slices) means the
    // on-disk layout differs from the canonical snapshot; re-save it.
    didMigrate: salvaged || version !== PERSISTED_STATE_VERSION,
  }
}

export function defaultPreferences(): PreferencesRecord {
  return preferencesRecordSchema.parse({})
}

export function defaultSyncStateRecord(): SyncState {
  return syncStateSchema.parse({})
}

export function defaultClipboardSettingsRecord(): ClipboardSettings {
  return {
    enabled: false,
    historyLimit: 200,
    ignoreConcealedItems: true,
    ignoreBundleIds: [],
    quickPasteHotkey: 'CommandOrControl+Shift+V',
    peekHotkey: '',
    syntheticPasteEnabled: false,
  }
}
