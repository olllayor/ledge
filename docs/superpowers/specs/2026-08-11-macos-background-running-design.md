# Background Running on macOS — Design

**Date:** 2026-08-11
**Status:** Approved (approach B of 3)
**Scope:** Make Ledge a well-behaved always-on macOS menu-bar citizen: reliable silent launch-at-login, single-instance enforcement with resurface, background health (sleep/wake, throttling), and visible login-item status in Settings.

## Goals

1. **Never two instances.** Any second launch (Finder, Spotlight, `open -a`, login item racing a manual launch) exits immediately and resurfaces the running instance.
2. **Silent login startup.** When macOS launches Ledge at login, the user sees only the tray icon — no windows, no Dock flash.
3. **Honest settings.** The "Launch at login" row shows the *actual* OS state (Electron's `getLoginItemSettings()`), including "starts hidden" and a visible state when `launchAtLogin` is on but macOS hasn't confirmed activation.
4. **Instant wake-ups.** Shelf/quick-paste/peek panels respond immediately after hours in the background (no Chromium background throttling); after system resume the native agent + tray are re-asserted.

## Non-goals

- No SMAppService / native bridge changes (Electron's `setLoginItemSettings` already works end-to-end).
- No crash watchdog / keep-alive (out of scope unless raised later).
- No `LSUIElement` in Info.plist — runtime `app.dock.hide()` is already correct and lets transient shimmer be re-asserted.
- No new persisted preference keys — "run in background" is not a toggle; it's how menu-bar apps behave. Nothing touches `convex/sharedSchemas.ts`.

## Current state (as of this design)

- `launchAtLogin` exists end-to-end: schema → `PreferencesSyncService.sync()` → `setLoginItemSettings({openAtLogin})` (packaged only) → Convex → Settings toggle.
- No `requestSingleInstanceLock`, no `window-all-closed` handler, no `getLoginItemSettings` read-back, no `openAsHidden`, no `powerMonitor`, no `backgroundThrottling` config.
- Windows are lazily-created panels; `quickPasteWindow` hides on blur; nothing auto-shows at startup (so "silent login" is already mostly true — the gap is *confirming* it via status + `openAsHidden`).

## Design

### 1. Single-instance lock with marker-file resurface

**New file:** `src/main/services/singleInstance.ts`

At the very top of `src/main/index.ts`, before `app.whenReady()`:

```ts
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  writeSecondInstanceMarker(app.getPath('userData'))  // tmp + rename
  app.quit()  // no windows/state touched; globalShortcut was never registered
}
```

The primary instance starts an `fs.watch` on `userData` (recursive=false), debounced ~100 ms. When the marker appears, it deletes the marker and fires the resurface callback.

**Resurface gesture:** when the marker fires, the primary instance runs `handleResurface()`:
- If a live shelf exists (`stateStore.getLiveShelf()` non-null) → do nothing visible (user is mid-work; the duplicate launch was almost certainly accidental), just log.
- Otherwise → show the preferences window (a user deliberately re-launching an app with no visible surface almost always wants Settings; this mirrors the existing `activate` handler's behavior).

Marker file: `userData/.second-instance-signal`, written via `writeFileSync(tmp)` + `renameSync` (matching the StatePersister atomicity convention). Contains the ISO timestamp for debuggability.

`TrayController.reassert()`: new public method that re-creates the status item if macOS dropped it — implementation is `this.tray.destroy()` + re-run the constructor body (icon + handlers), no-op when the tray is healthy.

`fs.watch` is used instead of Electron's `second-instance` event because the loser calls `app.quit()` before `whenReady` resolves; `second-instance` only reaches a ready app and argv handoff is unnecessary here. Marker also survives a theoretically-slow primary startup.

**Edge cases:**
- Zombie lock after crash: Electron's lock is per-user-data-dir and released on process death — self-healing.
- Dev vs packaged: lock is keyed by userData path, which differs between dev and packaged builds (`Electron` vs `Ledge`), so dev never fights the installed app.
- Marker leak on crash: primary deletes on sight; stale marker on *startup* is ignored (watch starts after ready).

### 2. Login-item read-back + settings surface

In `PreferencesSyncService`:

- Private `loginItemStatus: { openAtLogin: boolean; wasOpenedAtLogin: boolean; wasOpenedAsHidden: boolean }`, captured via `app.getLoginItemSettings()` (packaged only; dev returns schema defaults).
- `sync()` passes `openAsHidden: true` when enabling login (macOS honors it: no activation flash).
- `currentPermissionStatus()` spreads the new fields; `permissionStatusSchema` gains:
  ```ts
  loginItemOpenAtLogin: z.boolean().default(false),
  loginItemWasOpenedAtLogin: z.boolean().default(false),
  loginItemWasOpenedAsHidden: z.boolean().default(false),
  ```
- Status re-read after every `sync()` and once at startup.

In `GeneralSettings.tsx`, the Startup group gains a status row under the toggle:

| `launchAtLogin` pref | OS `openAtLogin` | Pill |
|---|---|---|
| off | — | *(no row)* |
| on | true | `StatusPill "Starts hidden in background" variant="good"` |
| on | false | `StatusPill "Check System Settings › Login Items" variant="warn"` |

Copy under the row explains that approval lives in System Settings → General → Login Items (macOS 13+). No deep-link for v1.

### 3. Explicit "never quit on window close"

`src/main/index.ts` gains:

```ts
app.on('window-all-closed', () => {
  // Menu-bar utility: closing every window must not quit the app.
})
```

This is a no-op handler whose *purpose* is documentation + protection against platform-default behavior drift.

### 4. Keep panels hot in the background

Add `backgroundThrottling: false` to `webPreferences` of: `shelfWindow`, `quickPasteWindow`, `peekWindow`, `notchDropoutWindow`, `clipboardWindow`. Excluded: `preferencesWindow` (640×780 settings window is fine to throttle when hidden/Mission Control'd).

### 5. Power resume re-assertion

In `app.whenReady()` after native agent start:

```ts
powerMonitor.on('resume', () => {
  // Re-assert the tray (Sleep can drop status items on macOS < 15 in rare paths)
  tray.reassert()           // no-op rebuild; new method, idempotent
  void nativeAgent.ping()   // liveness; existing respawn covers a dead child
})
```

## Error handling

- `setLoginItemSettings` throws on some environments → already swallowed with comment; read-back failure → status defaults to schema zeros (toggle still reflects the *preference*).
- Marker write fails (disk full) → second instance still exits; worst case is duplicate suppression lost for that launch, which the lock already covers.
- `fs.watch` failure → logged once, single-instance still enforced by the lock alone.

## Testing

- `singleInstance.ts`: unit-test marker write/rotate (tmp+rename) and the watch→callback flow against a temp dir (colocated vitest, following `stateStore.test.ts` patterns).
- `preferencesSync` login status: extract the read-back into a small injectable seam (`getLoginItemSettings` as a fn param defaulting to Electron's) so tests can simulate "approved / not approved / hidden" matrices.
- Schema: extend an existing round-trip test to cover the three new fields' defaults.
- Manual: `pnpm dist` → install → register login item → logout/login → confirm: single tray icon, no window, no Dock flash; relaunch from Spotlight → preferences appears rather than a second process (verify via Activity Monitor).

## Conventional-commit sketch

```
feat: single-instance lock with resurface on second launch
feat: login-item status read-back in Settings
fix: keep shelf panels hot behind background throttling
feat: re-assert tray and native agent after system resume
```
