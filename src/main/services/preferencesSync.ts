import { app, globalShortcut } from 'electron'
import { normalizeExcludedBundleIds } from '@shared/preferences'
import { permissionStatusSchema, type PreferencePatch, type PermissionStatus, type PreferencesRecord } from '@shared/schema'
import { normalizeGlobalShortcut, validateGlobalShortcut } from './systemUtils'
import type { StateStore } from './stateStore'
import type { NativeAgentClient } from '../native/nativeAgent'
import type { QuickPasteWindow } from '../windows/quickPasteWindow'
import type { PeekWindow } from '../windows/peekWindow'
import type { ClipboardMonitor } from './clipboardMonitor'

/**
 * Owns the system-side mirror of user preferences: login items, global
 * shortcuts, and the live permission status. Lives outside the state
 * store because none of this is persisted there — Electron and macOS
 * own the source of truth.
 */
export class PreferencesSyncService {
  private status: Pick<PermissionStatus, 'shortcutRegistered' | 'shortcutError'> = {
    shortcutRegistered: false,
    shortcutError: '',
  }

  constructor(
    private readonly stateStore: StateStore,
    private readonly nativeAgent: NativeAgentClient,
    private readonly quickPasteWindow: QuickPasteWindow,
    private readonly peekWindow: PeekWindow,
    private readonly clipboardMonitor: ClipboardMonitor,
    private readonly onCreateShelfFromShortcut: () => Promise<void>,
  ) {}

  getStatus(): Pick<PermissionStatus, 'shortcutRegistered' | 'shortcutError'> {
    return this.status
  }

  currentPermissionStatus(): PermissionStatus {
    return permissionStatusSchema.parse({
      ...this.nativeAgent.getStatus(),
      ...this.status,
    })
  }

  /**
   * Apply the persisted preferences to the OS: login items, global
   * shortcuts, etc. Called whenever preferences change.
   */
  sync(): void {
    let preferences = this.stateStore.getPreferences()
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({
          openAtLogin: preferences.launchAtLogin,
        })
      } catch {
        // Some macOS environments can still reject login-item writes.
      }
    }
    globalShortcut.unregisterAll()
    this.status = {
      shortcutRegistered: false,
      shortcutError: '',
    }

    const normalizedShortcut = normalizeGlobalShortcut(preferences.globalShortcut)
    if (normalizedShortcut !== preferences.globalShortcut) {
      preferences = this.stateStore.setPreferences({
        globalShortcut: normalizedShortcut,
      })
    }

    if (!normalizedShortcut) {
      return
    }

    const shortcutError = validateGlobalShortcut(normalizedShortcut)
    if (shortcutError) {
      this.status = {
        shortcutRegistered: false,
        shortcutError,
      }
      return
    }

    try {
      const registered = globalShortcut.register(normalizedShortcut, () => {
        void this.onCreateShelfFromShortcut()
      })

      this.status = registered
        ? {
            shortcutRegistered: true,
            shortcutError: '',
          }
        : {
            shortcutRegistered: false,
            shortcutError: 'Shortcut could not be registered. It may already be in use.',
          }

      this.registerClipboardShortcuts(preferences)
    } catch (error) {
      this.status = {
        shortcutRegistered: false,
        shortcutError:
          error instanceof Error ? error.message : 'Shortcut could not be registered.',
      }
    }
  }

  private registerClipboardShortcuts(preferences: PreferencesRecord): void {
    const settings = this.stateStore.getClipboardSettings()
    const mainShortcut = normalizeGlobalShortcut(preferences.globalShortcut)

    // Quick-paste hotkey
    const quickPasteShortcut = settings.quickPasteHotkey.trim()
    if (quickPasteShortcut && quickPasteShortcut !== mainShortcut) {
      try {
        globalShortcut.register(quickPasteShortcut, () => {
          const previousBundleId = this.clipboardMonitor.getLastFrontmostApp()?.bundleId ?? ''
          void this.quickPasteWindow.show(previousBundleId)
        })
      } catch (error) {
        console.error('[ledge] quick-paste hotkey registration failed:', error)
      }
    }

    // Peek hotkey (opt-in; empty by default)
    const peekShortcut = settings.peekHotkey.trim()
    if (
      peekShortcut &&
      peekShortcut !== mainShortcut &&
      peekShortcut !== quickPasteShortcut
    ) {
      try {
        globalShortcut.register(peekShortcut, () => {
          void this.peekWindow.show()
        })
      } catch (error) {
        console.error('[ledge] peek hotkey registration failed:', error)
      }
    }
  }
}

/**
 * Normalize a preference patch coming from the renderer: the renderer
 * is allowed to send `globalShortcut` in a few human-acceptable shapes
 * (`Cmd+Shift+Z`, `cmd+shift+z`, `  Cmd+Shift+Z  `) and we want the
 * persisted value to be canonical. Excluded bundle ids are also
 * normalized to lowercase reverse-DNS and rejected if any entry
 * doesn't parse.
 */
export function normalizePreferencePatch(patch: PreferencePatch): PreferencePatch {
  let nextPatch = patch
  if (patch.globalShortcut !== undefined) {
    nextPatch = {
      ...nextPatch,
      globalShortcut: normalizeGlobalShortcut(patch.globalShortcut),
    }
  }
  if (patch.excludedBundleIds !== undefined) {
    const { normalized, invalid } = normalizeExcludedBundleIds(patch.excludedBundleIds)
    if (invalid.length > 0) {
      throw new Error(
        invalid.length === 1
          ? `Invalid macOS bundle identifier: ${invalid[0]}`
          : `Invalid macOS bundle identifiers: ${invalid.join(', ')}`,
      )
    }
    nextPatch = {
      ...nextPatch,
      excludedBundleIds: normalized,
    }
  }
  return nextPatch
}
