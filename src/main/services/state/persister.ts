import { existsSync, mkdirSync, readFileSync, renameSync, promises as fs } from 'node:fs'
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
const persistedStateEnvelopeV1Schema = appStateSchema
  .omit({ permissionStatus: true, sync: true })
  .extend({ version: z.literal(1) })
const persistedStateEnvelopeV2Schema = persistedStateSchema.extend({ version: z.literal(2) })
const persistedStateEnvelopeV3Schema = persistedStateSchema.extend({ version: z.literal(3) })
const persistedStateEnvelopeV4Schema = persistedStateSchema.extend({ version: z.literal(4) })

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
            const tempPath = `${this.statePath}.tmp-${process.pid}`
            await fs.writeFile(tempPath, serialized, 'utf8')
            await fs.rename(tempPath, this.statePath)
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
    this.onCorruptionDetected?.({ backupPath, cause })
  }
}

function migratePersistedState(parsed: unknown, _defaultState: PersistedState): LoadResult {
  if (parsed && typeof parsed === 'object' && 'version' in parsed) {
    const version = (parsed as { version: number }).version

    if (version === 4) {
      const envelope = persistedStateEnvelopeV4Schema.parse(parsed)
      return { state: envelope, didMigrate: false }
    }

    if (version === 3) {
      const envelope = persistedStateEnvelopeV3Schema.parse(parsed)
      return {
        state: {
          liveShelf: envelope.liveShelf,
          recentShelves: envelope.recentShelves,
          preferences: envelope.preferences,
          sync: envelope.sync,
          team: { activeTeamId: null },
          clipboardHistory: envelope.clipboardHistory,
          clipboardCategories: envelope.clipboardCategories,
          clipboardSettings: envelope.clipboardSettings
        },
        didMigrate: true
      }
    }

    if (version === 2) {
      const envelope = persistedStateEnvelopeV2Schema.parse(parsed)
      return {
        state: {
          liveShelf: envelope.liveShelf,
          recentShelves: envelope.recentShelves,
          preferences: envelope.preferences,
          sync: envelope.sync,
          team: { activeTeamId: null },
          clipboardHistory: envelope.clipboardHistory,
          clipboardCategories: envelope.clipboardCategories,
          clipboardSettings: envelope.clipboardSettings
        },
        didMigrate: true
      }
    }

    if (version === 1) {
      const envelope = persistedStateEnvelopeV1Schema.parse(parsed)
      return {
        state: {
          liveShelf: envelope.liveShelf,
          recentShelves: envelope.recentShelves,
          preferences: envelope.preferences,
          sync: syncStateSchema.parse({}),
          team: { activeTeamId: null },
          clipboardHistory: envelope.clipboardHistory,
          clipboardCategories: envelope.clipboardCategories,
          clipboardSettings: envelope.clipboardSettings
        },
        didMigrate: true
      }
    }
  }

  return {
    state: {
      ...persistedStateSchema.omit({ sync: true }).parse(parsed),
      sync: syncStateSchema.parse({}),
      team: { activeTeamId: null },
    },
    didMigrate: true
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
