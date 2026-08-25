import { app, globalShortcut } from 'electron'
import { normalizeExcludedBundleIds } from '@shared/preferences'
import { permissionStatusSchema, type PreferencePatch, type PermissionStatus } from '@shared/schema'
import { normalizeGlobalShortcut, validateGlobalShortcut } from './systemUtils'
import type { StateStore } from './stateStore'
import type { NativeAgentClient } from '../native/nativeAgent'
import type { QuickPasteWindow } from '../windows/quickPasteWindow'
import type { PeekWindow } from '../windows/peekWindow'
import type { NotchDropoutWindow } from '../windows/notchDropoutWindow'
import type { ClipboardMonitor } from './clipboardMonitor'
import { FEATURE_FLAGS } from './featureFlags'

/**
 * Owns the system-side mirror of user preferences: login items, global
 * shortcuts, and the live permission status. Lives outside the state
 * store because none of this is persisted there — Electron and macOS
 * own the source of truth.
 */
export interface LoginItemSettingsSnapshot {
  openAtLogin: boolean
  wasOpenedAtLogin: boolean
  wasOpenedAsHidden: boolean
}

/** Injectable seam so tests can simulate approved/hidden matrices. */
export type LoginItemSettingsPort = () => LoginItemSettingsSnapshot

const LOGIN_ITEM_DEV_DEFAULTS: LoginItemSettingsSnapshot = {
  openAtLogin: false,
  wasOpenedAtLogin: false,
  wasOpenedAsHidden: false,
}

export class PreferencesSyncService {
  private status: Pick<PermissionStatus, 'shortcutRegistered' | 'shortcutError'> = {
    shortcutRegistered: false,
    shortcutError: '',
  }
  private lastRegisteredMain: string | null = null
  private lastRegisteredSecondary = new Set<string>()
  private loginItemStatus: LoginItemSettingsSnapshot = { ...LOGIN_ITEM_DEV_DEFAULTS }

  constructor(
    private readonly stateStore: StateStore,
    private readonly nativeAgent: NativeAgentClient,
    private readonly quickPasteWindow: QuickPasteWindow,
    private readonly peekWindow: PeekWindow,
    private readonly clipboardMonitor: ClipboardMonitor,
    private readonly onCreateShelfFromShortcut: () => Promise<void>,
    private readonly notchDropoutWindow?: NotchDropoutWindow,
    private readonly getLoginItemSettings: LoginItemSettingsPort = () =>
      app.isPackaged ? app.getLoginItemSettings() : { ...LOGIN_ITEM_DEV_DEFAULTS },
  ) {}

  getStatus(): Pick<PermissionStatus, 'shortcutRegistered' | 'shortcutError'> {
    return this.status
  }

  currentPermissionStatus(): PermissionStatus {
    return permissionStatusSchema.parse({
      ...this.nativeAgent.getStatus(),
      ...this.status,
      loginItemOpenAtLogin: this.loginItemStatus.openAtLogin,
      loginItemWasOpenedAtLogin: this.loginItemStatus.wasOpenedAtLogin,
      loginItemWasOpenedAsHidden: this.loginItemStatus.wasOpenedAsHidden,
    })
  }

  /** Current OS-side login-item truth (zeros in dev builds). */
  currentLoginItemStatus(): LoginItemSettingsSnapshot {
    return { ...this.loginItemStatus }
  }

  private refreshLoginItemStatus(): void {
    try {
      this.loginItemStatus = this.getLoginItemSettings()
    } catch (error) {
      console.warn('[ledge] login-item status read-back failed:', error)
      this.loginItemStatus = { ...LOGIN_ITEM_DEV_DEFAULTS }
    }
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
          // Menu-bar utility: starting at login must never surface a
          // window or steal focus — tray icon only.
          openAsHidden: true,
        })
      } catch {
        // Some macOS environments can still reject login-item writes.
      }
    }
    this.refreshLoginItemStatus()
    // Granular re-register to avoid flicker: only touch shortcuts that
    // actually changed. unregisterAll() left a window where QuickPaste
    // was briefly dead if main failed.
    const normalizedShortcut = normalizeGlobalShortcut(preferences.globalShortcut)
    if (normalizedShortcut !== preferences.globalShortcut) {
      preferences = this.stateStore.setPreferences({
        globalShortcut: normalizedShortcut,
      })
    }

    this.syncShortcutsGranular(normalizedShortcut)
  }

  private syncShortcutsGranular(normalizedMain: string): void {
    this.status = { shortcutRegistered: false, shortcutError: '' }

    // Main shortcut. Order matters: validate and register the NEW
    // accelerator BEFORE releasing the old one, so a failed registration
    // never leaves the user with no hotkey at all.
    if (normalizedMain) {
      const err = validateGlobalShortcut(normalizedMain)
      if (err) {
        // Invalid input: keep whatever is still registered and say why.
        this.status = { shortcutRegistered: Boolean(this.lastRegisteredMain), shortcutError: err }
      } else if (this.lastRegisteredMain === normalizedMain) {
        const already = globalShortcut.isRegistered?.(normalizedMain) ?? false
        if (!already && this.lastRegisteredMain) {
          try { globalShortcut.register(normalizedMain, () => void this.onCreateShelfFromShortcut()) } catch {}
        }
        this.status = { shortcutRegistered: true, shortcutError: '' }
      } else {
        try {
          const ok = globalShortcut.register(normalizedMain, () => void this.onCreateShelfFromShortcut())
          if (ok) {
            // New binding is live — only now release the previous one.
            if (this.lastRegisteredMain) {
              try { globalShortcut.unregister(this.lastRegisteredMain) } catch {}
            }
            this.lastRegisteredMain = normalizedMain
            this.status = { shortcutRegistered: true, shortcutError: '' }
          } else {
            this.status = {
              shortcutRegistered: Boolean(this.lastRegisteredMain),
              shortcutError: 'Shortcut could not be registered. It may already be in use.',
            }
          }
        } catch (error) {
          this.status = {
            shortcutRegistered: Boolean(this.lastRegisteredMain),
            shortcutError: error instanceof Error ? error.message : 'Shortcut could not be registered.',
          }
        }
      }
    } else if (this.lastRegisteredMain) {
      // Shortcut intentionally cleared in preferences.
      try { globalShortcut.unregister(this.lastRegisteredMain) } catch {}
      this.lastRegisteredMain = null
      this.status = { shortcutRegistered: false, shortcutError: '' }
    }

    // Secondary shortcuts: diff against lastRegisteredSecondary to avoid flicker.
    const settings = this.stateStore.getClipboardSettings()
    const desired = new Map<string, { label: string; onTrigger: () => void }>()
    const addDesired = (raw: string, label: string, onTrigger: () => void) => {
      const norm = normalizeGlobalShortcut(raw)
      if (!norm) return
      if (norm === normalizedMain) {
        // Surface conflict instead of silently skipping.
        this.status = {
          ...this.status,
          shortcutError: `${label} hotkey conflicts with main shortcut and was skipped.`,
        }
        console.warn(`[ledge] ${label} hotkey equals main, skipped`)
        return
      }
      if (desired.has(norm)) return
      const vErr = validateGlobalShortcut(norm)
      if (vErr) {
        this.status = { ...this.status, shortcutRegistered: false, shortcutError: vErr }
        console.error(`[ledge] ${label} hotkey registration failed:`, vErr)
        return
      }
      desired.set(norm, { label, onTrigger })
    }

    // Only register clipboard hotkeys when history is enabled — otherwise
    // Quick Paste / Peek are dead UI that still steal the shortcut.
    if (settings.enabled) {
      addDesired(settings.quickPasteHotkey, 'quick-paste', () => {
        const previousApp = this.clipboardMonitor.getLastFrontmostApp()
        void this.quickPasteWindow.show(previousApp?.bundleId ?? '', previousApp?.name ?? '')
      })
      addDesired(settings.peekHotkey, 'peek', () => {
        if (FEATURE_FLAGS.useNotchDropout && this.notchDropoutWindow) void this.notchDropoutWindow.toggle()
        else void this.peekWindow.show()
      })
    }

    // Unregister stale secondary
    for (const old of [...this.lastRegisteredSecondary]) {
      if (!desired.has(old)) {
        try { globalShortcut.unregister(old) } catch {}
        this.lastRegisteredSecondary.delete(old)
      }
    }
    // Register new. Electron signals failure by returning false rather
    // than throwing — ignoring the boolean left a dead hotkey recorded
    // as registered until restart.
    for (const [norm, { label, onTrigger }] of desired) {
      if (this.lastRegisteredSecondary.has(norm)) continue
      try {
        const ok = globalShortcut.register(norm, onTrigger)
        if (ok) {
          this.lastRegisteredSecondary.add(norm)
        } else {
          this.status = {
            ...this.status,
            shortcutError: `${label} hotkey could not be registered. It may already be in use.`,
          }
          console.error(`[ledge] ${label} hotkey registration failed (register returned false)`)
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Shortcut could not be registered.'
        this.status = { ...this.status, shortcutRegistered: false, shortcutError: msg }
        console.error(`[ledge] ${label} hotkey registration failed:`, error)
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
