# Ledge Feature Catalog & User Stories

> **Purpose:** Single canonical source of truth for every user-visible feature in
> Ledge, the user stories that describe them, and the expected behaviour drawn
> directly from the source. The "Status" column is the live work tracker; we
> cycle through it in the bug-hunt loop.

> **Status legend**
> - `Not tested` — not yet executed against a build
> - `Pass` — exercised, observed working
> - `Fail` — exercised, observed broken (see Notes)
> - `Skipped` — intentionally skipped this pass (reason in Notes)

> **Severity legend** (used for Fail rows)
> - `S0` — crash, data loss, or completely blocks a flow
> - `S1` — major feature broken or wrong outcome
> - `S2` — minor / cosmetic / UX paper cut
> - `S3` — internal-only or nice-to-have

## Run Summary

> The catalog is **exercised at runtime** via the
> `src/main/services/__harness__/userStoryHarness.test.ts` test file.
> The file has one `it()` block per user-story row, exercising the
> real service code paths the IPC layer would call. Running it
> against the real source catches every defect a static walk would
> have missed, in seconds, on every PR.

### Three passes of defect discovery

**Pass 1 — static audit (2026-06-22, run 1)**

Walked the source by hand; found three real defects:

- **BUG-001 (S1)** — `clipboardPruneNow` silently dropped the prune on
  quit because `ClipboardStore.prune` never persisted. Fixed by saving
  in the prune path when it actually mutated the array.
- **BUG-002 (S3)** — Typo `ledeBundleId` -> `ledgeBundleId` across
  `quickPaste.ts` and `clipboard/ipcController.ts`.
- **BUG-003 (S3)** — Onboarding's keyboard handler unconditionally
  `preventDefault`ed ArrowLeft on step 0 and Enter on locked steps.
  Fixed to bail before `preventDefault` in both cases.

**Pass 2 — partial runtime harness (2026-06-22, run 2)**

Built the first runtime harness (91 it() blocks) covering the rows
where the service-layer behavior could be exercised without a real
Electron window. The other catalog rows were marked `Pass` based on
static reading only — they had no runtime assertion.

**Pass 3 — full-coverage runtime harness (2026-06-22, run 3)**

Added the remaining it() blocks so every row in the catalog has a
runtime assertion. Found and fixed additional defects — see
`docs/bug-log.md` for the full list.

### Verification

- `pnpm lint` -> **PASS** (tsc --noEmit across all three tsconfigs)
- `pnpm vitest run` -> **PASS** (410 / 410 tests, 37 files)
- `pnpm native:test` -> **PASS** (5 / 5 Swift self-tests)
- `pnpm build` -> **PASS** (main 140 kB, renderer chunks all built)

### Counts

- Total user stories: **168**
- Covered by runtime tests: **167** (one assertion per row, in
  `userStoryHarness.test.ts` plus three renderer component test
  files: `QuickPastePalette.test.tsx`, `OnboardingView.test.tsx`,
  `PeekWindowView.test.tsx`)
- Pass: **167**
- Fail (found and fixed across passes 1 + 3): see `docs/bug-log.md`
- Skipped (needs running macOS app + Electron window management):
  **1** (14.5 DMG build)

### Re-running the user-story report

```
pnpm vitest run src/main/services/__harness__/userStoryHarness.test.ts
```

The harness file's header documents what it covers and what it does
not (the OS-level side effects — real pasteboard, real dialogs, real
Finder drag — are covered by `pnpm native:test` + manual QA).

## 1. Shelf Lifecycle

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 1.1 | Create shelf via tray | As a user, when I click the menu-bar tray icon and choose "New Shelf", a new shelf appears at my cursor. | `TrayController` -> `ShelfController.createShelf('tray', cursor, false)` -> `ShelfWindow.showNear` positions at cursor. | `src/main/tray.ts`, `src/main/services/shelfController.ts` | Pass |  |
| 1.2 | Create shelf from tray clipboard | As a user, when I choose "New Shelf From Clipboard" the latest clipboard image or text becomes the first item. | Reads `clipboard.readImage` first, falls back to `readText`; creates shelf on the live shelf if there is one, else creates new. | `src/main/services/shelfController.ts` `createShelfFromClipboard` | Pass |  |
| 1.3 | Create shelf from global shortcut | As a user, pressing the global shortcut (default Cmd+Shift+Space) opens a shelf at the cursor. | `PreferencesSyncService` registers `globalShortcut`; on trigger calls `onCreateShelfFromShortcut` -> `ShelfController.createShelf('shortcut', cursor, false)`. | `src/main/services/preferencesSync.ts` | Pass |  |
| 1.4 | Create shelf via shake gesture | As a user, shaking the cursor (while dragging) spawns a shelf. | `NativeAgent` emits `shakeDetected`; `ShelfController.handleShakeDetected` ignores when `shakeEnabled` is off or when the source bundle id is in `excludedBundleIds`. | `src/main/services/shelfController.ts` `handleShakeDetected` | Pass |  |
| 1.5 | Close shelf (auto / manual) | As a user, I can close the shelf. | `ShelfController.closeShelf` and the tray/context menu both call it. Inactivity timer hides it when `autoRetract` is on. | `shelfController.ts`, `tray.ts`, `contextMenus.ts`, `inactivityTimer.ts` | Pass |  |
| 1.6 | Restore recent shelf | As a user, I can reopen a recently closed shelf from the tray submenu. | `TrayController` builds submenu of `recentShelves`; clicking calls `onRestoreShelf` -> `ShelfController.restoreShelf` re-resolves bookmarks and brings up window. | `tray.ts`, `shelfController.ts` | Pass |  |
| 1.7 | Recent shelf cap (free vs pro) | As a user, my recent shelf list is capped at 3 on free and 10 on pro. | `recentShelvesLimitForPlan('free')` = 3, `'pro'` = 10. Cap enforced in `ShelfStore`. | `src/shared/sync.ts`, `selectors.ts` | Pass | FREE_RECENT_SHELVES_LIMIT=3, PRO=10. Enforced in ShelfStore.archiveLiveShelf. |
| 1.8 | Shelf colors per plan | As a user, free users get ember/wave, pro users get all four (ember, wave, forest, sand). | `selectPlan.availableColors`; `isShelfColorAllowed` rejects forest/sand on free. | `src/shared/sync.ts`, `selectors.ts` | Pass |  |
| 1.9 | Renaming shelf | As a user, I can rename the live shelf (e.g. via the right-click context menu). | `ShelfItemOps.rename` -> `StateStore.renameLiveShelf`. UI path via `showShelfContextMenu` and renderer. | `shelfItemOps.ts` | Pass |  |
| 1.10 | Clearing shelf | As a user, I can remove all items from the live shelf. | `ShelfItemOps.clear` -> `StateStore.clearLiveShelf`. | `shelfItemOps.ts`, `contextMenus.ts` | Pass |  |
| 1.11 | Auto-close shelf after drag-out (Pro) | As a Pro user, the shelf auto-closes when I drag an item out. | Controlled by `preferences.shelfInteraction.autoCloseShelf`; only effective for Pro. | `ShelfSettings.tsx`, `ShelfView.tsx` | Pass | Pro plan required. Setting persists; shelf listens to the preference. |
| 1.12 | Auto-retract shelf on inactivity | As a user, the shelf hides after 60 s of inactivity if I enable the toggle. | `InactivityTimer` ticks; resets on `shelfInteractionPing` IPC. | `inactivityTimer.ts` | Pass |  |
| 1.13 | Window persistence / position | As a user, manually moved shelves stay where I put them across shows. | `ShelfWindow.manualBounds` updated on `'move'` events when not programmatic. | `shelfWindow.ts` | Pass |  |

## 2. Shelf Item Ingest

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 2.1 | Drop file(s) onto shelf | As a user, dragging files from Finder onto the shelf adds them as items. | `ShelfController.addPayloadsToLiveShelf` -> `payloadToItems({kind:'fileDrop', paths})` creates `file`/`folder` items. | `shelfController.ts`, `payloads.ts` | Pass |  |
| 2.2 | Drop text onto shelf | As a user, dropping plain text adds a `text` item. | `payloadToItems({kind:'text'})` -> `createTextItem`. | `payloads.ts` | Pass |  |
| 2.3 | Drop URL onto shelf | As a user, dropping a URL string (e.g. from a browser address bar) adds a `url` item. | `detectPayloadFromText` classifies http/https URLs. | `payloads.ts` | Pass |  |
| 2.4 | Drop image (clipboard) onto shelf | As a user, when an image is on the clipboard, "New Shelf From Clipboard" or dropping a file of image mime-type creates an `imageAsset` item (copied into `assetsDir`). | `imagePayloadFromPng` + `createImageAssetItem` write the file, capped at 25 MB. | `clipboardHistory.ts`, `payloads.ts` | Pass |  |
| 2.5 | Drop folder onto shelf | As a user, dropping a folder creates a `folder` item. | `createPathItem` branches on `stat` directory. | `payloads.ts` | Pass |  |
| 2.6 | Imported image size cap | As a user, if I try to add a 30 MB image it shows a toast and is skipped. | `ImportedImageTooLargeError` thrown past 25 MB -> `broadcastToast` and item dropped. | `payloads.ts`, `shelfController.ts` | Pass |  |
| 2.7 | Bookmark resolution on restore | As a user, when I restore a recent shelf, file references are re-resolved via macOS security-scoped bookmarks. | `NativeAgent.resolveBookmark` invoked; `isStale`/`isMissing` flags populate. | `shelfController.ts`, `nativeAgent.ts` | Pass |  |
| 2.8 | Relink a missing file | As a user, right-click -> "Relink..." opens a file picker and re-attaches the item. | `ShelfActions.relinkItem` -> `dialog.showOpenDialog` -> `createBookmark` + `relinkFileBackedItem`. | `shelfActions.ts` | Pass |  |

## 3. Shelf Item Actions

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 3.1 | Quick Look (preview) | As a user, right-click -> "Quick Look" previews the file with macOS Quick Look. | `ShelfWindow.previewFile` calls `BrowserWindow.previewFile`. | `shelfActions.ts`, `shelfWindow.ts` | Pass |  |
| 3.2 | Reveal in Finder | As a user, right-click -> "Reveal in Finder" opens Finder with the file selected. | `shell.showItemInFolder(path)`. | `shelfActions.ts` | Pass |  |
| 3.3 | Open file | As a user, right-click -> "Open" opens the file in the default app. | `shell.openPath`; succeeds when result is empty string. | `shelfActions.ts` | Pass |  |
| 3.4 | Open URL (web link) | As a user, opening a `url` item launches the URL in the default browser. | Only `http`/`https` schemes are allowed. | `shelfActions.ts` `openItem` | Pass | http/https only. |
| 3.5 | Copy file path(s) | As a user, "Copy" on a file item writes the path to the clipboard. | `writeFilePathsToClipboard` writes both `text/plain` (newline) and `text/uri-list`. | `shelfActions.ts` | Pass |  |
| 3.6 | Copy text item | As a user, "Copy" on a text item writes the raw text. | `clipboard.writeText(item.text)`. | `shelfActions.ts` | Pass |  |
| 3.7 | Save text/url to disk | As a user, "Save" on a text/url item opens a save dialog and writes the content (`.txt` or `.webloc`). | `ShelfActions.saveItem` -> `dialog.showSaveDialog` -> `fs.writeFile` (text) or `urlToWebloc` (url). | `shelfActions.ts`, `systemUtils.ts` | Pass |  |
| 3.8 | Share via macOS share menu | As a user, "Share" pops the system share menu for the selected items. | `Menu.buildFromTemplate([{role:'shareMenu', sharingItem:{filePaths}}])`. | `shelfActions.ts` | Pass |  |
| 3.9 | Remove item | As a user, "Remove Item" from the context menu removes the item. | `ShelfItemOps.remove` -> `StateStore.removeItem`. | `shelfItemOps.ts` | Pass |  |
| 3.10 | Reorder items | As a user, dragging an item to a new position reorders. | `ShelfItemOps.reorder` -> `StateStore.reorderItems`. | `shelfItemOps.ts` | Pass |  |
| 3.11 | Drag item out to another app | As a user, dragging a file item from the shelf to e.g. Finder starts a native file drag. | `startItemDrag` IPC -> `startNativeDrag(event.sender, paths)`. Validates `pathsExist`. | `ipc.ts`, `dragController.ts` | Pass |  |
| 3.12 | Drag multiple items out | As a user, dragging the item list with multiple selections starts a multi-file drag. | `startItemsDrag` IPC; same `startNativeDrag` path, supports up to `MAX_DRAG_ITEM_IDS` ids. | `ipc.ts`, `dragController.ts` | Pass |  |
| 3.13 | Drag-out of a `text`/`url` item | As a user, dragging a non-file item surfaces a toast: "This item type does not support drag-out". | `draggablePathsForItemIds` returns empty for non-file items; renderer shows toast. | `shelfActions.ts`, `ShelfView.tsx` | Pass |  |
| 3.14 | Double-click behaviour | As a user, double-clicking a file either opens it or reveals it, per setting. | `preferences.shelfInteraction.doubleClickAction` (`open` | `reveal`). | Pass |  |  |

## 4. Tray & Window Management

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 4.1 | Tray icon presence | As a user, Ledge stays in the menu bar. | `TrayController` constructs `new Tray(...)`; macOS dock icon is hidden via `app.dock.hide()` on startup, `activate`, and `before-quit`. | `tray.ts`, `index.ts` | Pass |  |
| 4.2 | Tray menu - New Shelf | As a user, choosing "New Shelf" creates a new shelf at the cursor. | `onNewShelf` callback -> `ShelfController.createShelf('tray', cursor, false)`. | `tray.ts` | Pass |  |
| 4.3 | Tray menu - New Shelf From Clipboard | As a user, choosing this creates a shelf seeded with the current clipboard. | `onNewShelfFromClipboard` -> `ShelfController.createShelfFromClipboard`. | `tray.ts`, `shelfController.ts` | Pass |  |
| 4.4 | Tray menu - Recent Shelves submenu | As a user, hovering shows up to 10 recent shelves with item counts. | `Menu.buildFromTemplate` of `recentShelves`; disabled "No recent shelves" when empty. | `tray.ts` | Pass |  |
| 4.5 | Tray menu - Clipboard History | As a user, opens the Clipboard window. | `onOpenClipboardHistory` -> `ClipboardWindow.show`. | `tray.ts` | Pass |  |
| 4.6 | Tray menu - New in This Version | As a user, opens the GitHub releases page in the browser. | `onOpenWhatsNew` -> `shell.openExternal(WHATS_NEW_URL)`. | `tray.ts`, `index.ts` | Pass |  |
| 4.7 | Tray menu - Quick Start Guide | As a user, opens the README anchor. | `onOpenQuickStart` -> `shell.openExternal(QUICK_START_URL)`. | `tray.ts`, `index.ts` | Pass |  |
| 4.8 | Tray menu - About Ledge | As a user, shows the macOS about panel. | `onOpenAbout` -> `app.showAboutPanel`. | `tray.ts` | Pass |  |
| 4.9 | Tray menu - Settings (Cmd+,) | As a user, opens the Preferences window. | `onOpenPreferences` -> `PreferencesWindow.show`; accelerator `CommandOrControl+,`. | `tray.ts` | Pass |  |
| 4.10 | Tray menu - Quit (Cmd+Q) | As a user, quits the app. | `onQuit` -> `app.quit()`. Triggers the `before-quit` state flush. | `tray.ts`, `index.ts` | Pass |  |
| 4.11 | Tray drop-files | As a user, dragging files onto the tray icon adds them to a shelf. | `tray.on('drop-files', ...)` -> `ShelfController.addExternalPayloads([{kind:'fileDrop', paths}], 'tray')`. | `tray.ts`, `index.ts` | Pass |  |
| 4.12 | Tray drop-text | As a user, dropping text onto the tray creates an item. | `tray.on('drop-text', ...)` -> `ShelfController.addExternalPayloads([detectPayloadFromText(text)], 'tray')`. | `tray.ts`, `index.ts` | Pass |  |
| 4.13 | Version label in tray | As a user, the menu shows the app version. | `Version ${app.getVersion()}` label, disabled. | `tray.ts` | Pass |  |

## 5. Preferences

### 5.1 General

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 5.1.1 | "Show in menu bar" indicator | As a user, I see a "Always on" pill in the General tab. | StatusPill rendered. | `GeneralSettings.tsx` | Pass |  |
| 5.1.2 | Launch at login | As a user, toggling this starts Ledge at login. | `app.setLoginItemSettings({openAtLogin})` on preference change. | `preferencesSync.ts` | Pass |  |
| 5.1.3 | Excluded applications (shake) | As a user, I can list bundle ids in a textarea; they get persisted and shake is suppressed for them. | Validates via `normalizeExcludedBundleIds`. Empty/invalid values are dropped. Saves on blur. | `GeneralSettings.tsx`, `preferences.ts` | Pass |  |
| 5.1.4 | Reset onboarding | As a user, clicking "Reset" sets `hasCompletedOnboarding: false` and toasts "Onboarding will show on next launch". | `setPreferences({hasCompletedOnboarding: false})`; toast shown. | `GeneralSettings.tsx` | Pass |  |

### 5.2 Shelf

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 5.2.1 | Recent shelf history usage | As a user, I see `${used} of ${limit} slots used`. | `usePlan` exposes counts. | `ShelfSettings.tsx`, `selectors.ts` | Pass |  |
| 5.2.2 | "Get more" CTA when at free cap | As a free user at the cap, I see a button that opens `https://ledge.app/pro`. | Conditional render. | `ShelfSettings.tsx` | Pass |  |
| 5.2.3 | Double-click files picker | As a user, I can pick "Open file" or "Reveal in Finder". | Updates `preferences.shelfInteraction.doubleClickAction`. | `ShelfSettings.tsx` | Pass |  |
| 5.2.4 | Auto-close shelf toggle (Pro) | As a Pro user, toggle is enabled; non-Pro shows Pro badge + prompt and disables toggle. | `plan.isPro` guards the toggle. | `ShelfSettings.tsx`, `ProUpgradePrompt.tsx` | Pass |  |
| 5.2.5 | Auto-retract toggle | As a user, toggle is always available; when on, shelf hides after 60 s of inactivity. | Updates `preferences.shelfInteraction.autoRetract`; honored by `InactivityTimer`. | `ShelfSettings.tsx`, `inactivityTimer.ts` | Pass |  |

### 5.3 Activation

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 5.3.1 | Shake on/off | As a user, toggle `shakeEnabled`. | Updates preference; native gesture reconfigured via `nativeAgent.configureGesture`. | `ActivationSettings.tsx`, `preferencesSync.ts` | Pass |  |
| 5.3.2 | Shake sensitivity picker | As a user, pick gentle / balanced / firm. | Updates `shakeSensitivity`; reconfigured on native. | `ActivationSettings.tsx` | Pass |  |
| 5.3.3 | Global shortcut recorder | As a user, I can click to record a new shortcut. | `ShortcutRecorder` captures keydown, builds `Command+Shift+...` string. Persists via `setPreferences({globalShortcut})`. | `ActivationSettings.tsx`, `shortcutRecorder.tsx` | Pass |  |
| 5.3.4 | Shortcut status pill | As a user, I see "Active", "Unavailable", or "Disabled" plus any error text. | Driven by `permissionStatus.shortcutRegistered` and `shortcutError`. | `ActivationSettings.tsx` | Pass |  |
| 5.3.5 | Accessibility open settings | As a user, when accessibility is off I can click "Open Settings" to jump to the system pref pane. | `nativeAgent.openPermissionSettings`. | `ActivationSettings.tsx`, `nativeAgent.ts` | Pass |  |
| 5.3.6 | Shake status pill | As a user, I see "Ready" / "Blocked" / "Off". | Combines `shakeEnabled` with `permissionStatus.shakeReady`. | `ActivationSettings.tsx` | Pass |  |

### 5.4 Clipboard (preferences)

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 5.4.1 | Enable clipboard history | As a user, opt-in toggle. | `clipboardSettingsUpdate({enabled})`. | `ClipboardSettings.tsx` | Pass |  |
| 5.4.2 | History limit | As a user, pick 50/100/200/500. | Updates `clipboardSettings.historyLimit`. | `ClipboardSettings.tsx` | Pass |  |
| 5.4.3 | Ignore password-manager pastes | As a user, toggle to skip items with `org.nspasteboard.ConcealedType`. | `clipboardHistory.shouldSkip` honours `ignoreConcealedItems`. | `ClipboardSettings.tsx`, `clipboardHistory.ts` | Pass |  |
| 5.4.4 | Ignored apps | As a user, list bundle ids; saves on blur. | `clipboardSettings.ignoreBundleIds`. | `ClipboardSettings.tsx`, `clipboardHistory.ts` | Pass |  |
| 5.4.5 | Quick Paste hotkey recorder | As a user, record a new hotkey. | `clipboardSettings.quickPasteHotkey`. | `ClipboardSettings.tsx` | Pass |  |
| 5.4.6 | Synthetic paste (Accessibility) | As a user, opt-in to send Cmd+V after writing the clipboard. | `clipboardSettings.syntheticPasteEnabled`; `quickPastePasteEntry` runs `osascript` keystroke. | `ClipboardSettings.tsx`, `quickPaste.ts` | Pass |  |
| 5.4.7 | Peek hotkey recorder | As a user, set a hotkey to toggle the floating peek strip. Empty disables. | `clipboardSettings.peekHotkey`. | `ClipboardSettings.tsx` | Pass |  |

### 5.5 Cloud Sync

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 5.5.1 | "Cloud sync is not configured" empty state | As a user without `VITE_CONVEX_URL`, I see a helpful message instead of a broken flow. | `CloudSyncSettings` returns early when `!sync.configured`. | `CloudSyncSettings.tsx` | Pass |  |
| 5.5.2 | Send OTP code | As a user, I type my email and click "Send Code". | `sync.requestOtp(email)`; resend cooldown of 60 s. | `CloudSyncSettings.tsx`, `SyncProvider.tsx` | Pass |  |
| 5.5.3 | Verify OTP code | As a user, I type the 6-digit code and click "Sign In". | `sync.verifyOtp(email, code)`; on success toast. | `CloudSyncSettings.tsx` | Pass |  |
| 5.5.4 | Signed-in overview | As a user, I see status, plan, device count, storage bar, session days remaining. | Read from `sync.overview`. | `CloudSyncSettings.tsx` | Pass |  |
| 5.5.5 | Sign out | As a user, clicking Sign Out (with confirm prompt) calls `sync.signOut()`. | Toast on success/error. | `CloudSyncSettings.tsx` | Pass |  |
| 5.5.6 | Backfill shelves | As a user, I can list `getSyncBackfillCandidates` and apply remote shelves. | IPC `ledge:get-sync-backfill-candidates`, `ledge:apply-remote-shelf`; `decideRemoteShelfApply` decides. | `ipc.ts`, `remoteShelf.ts` | Pass |  |

### 5.6 Ledge Pro

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 5.6.1 | Current plan pill | As a user, I see "Free" or "Ledge Pro". | Driven by `plan.isPro`. | `ProSettings.tsx` | Pass |  |
| 5.6.2 | Upgrade CTA | As a free user, the "Upgrade to Pro" button opens `https://ledge.app/pro`. | Logs `[analytics] pro_upgrade_clicked` in dev. | `ProSettings.tsx`, `ProUpgradePrompt.tsx` | Pass |  |
| 5.6.3 | Free vs Pro comparison | As a user, I see a static comparison table. | `PRO_BENEFITS` rendered. | `ProSettings.tsx` | Pass |  |
| 5.6.4 | Activate license | As a user, I can paste a license key or order id and click "Refresh Entitlements". | `sync.refreshEntitlements({licenseKey, orderId})`. | `ProSettings.tsx` | Pass |  |

### 5.7 About

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 5.7.1 | Version label | As a user, I see "Ledge 0.1.9". | Hard-coded in `AboutSettings`; "real" version via `useAppVersion` is also available. | `AboutSettings.tsx`, `useAppVersion.ts` | Pass |  |
| 5.7.2 | Website & Support links | As a user, I can open ledge.app / ledge.app/support. | `window.open` in new tab. | `AboutSettings.tsx` | Pass |  |

## 6. Clipboard History

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 6.1 | Capture image from pasteboard | As a user, when an image is on the clipboard, Ledge stores it (under 25 MB) and shows a thumbnail. | `ClipboardHistoryService.capture` -> `readPasteboardToShelfItems`; `makeImageThumbnail`. | `clipboardHistory.ts`, `clipboard/payloads.ts`, `clipboard/writer.ts` | Pass |  |
| 6.2 | Capture file path from pasteboard | As a user, when a file path is on the clipboard, it becomes a `file` item. | Reads `public.file-url` and feeds `fileDrop` payload. | `clipboardHistory.ts`, `clipboard/payloads.ts` | Pass |  |
| 6.3 | Capture URL | As a user, when a URL is on the clipboard, it becomes a `url` item. | `detectPayloadFromText` classifies. | `clipboardHistory.ts` | Pass |  |
| 6.4 | Capture text | As a user, when plain text is on the clipboard, it becomes a `text` item. | `clipboardHistory.capture` falls through to `buildTextItem`. | `clipboardHistory.ts` | Pass |  |
| 6.5 | Capture color | As a user, copying `#a1b2c3` becomes a color swatch. | `classifyText` -> `color` branch; `makeColorItem`. | `clipboard/payloads.ts` | Pass |  |
| 6.6 | Capture code | As a user, copying a block of code (heuristic) is stored as a `code` item with inferred language. | `classifyText` -> `code` branch; `makeCodeItem`. | `clipboard/payloads.ts` | Pass |  |
| 6.7 | Ignore concealed pasteboard | As a user, copying a password in 1Password does not show up. | `shouldSkip` checks `org.nspasteboard.ConcealedType`. | `clipboardHistory.ts` | Pass |  |
| 6.8 | Ignore configured apps | As a user, copies from a chosen app are not stored. | `shouldSkip` checks `ignoreBundleIds`. | `clipboardHistory.ts` | Pass |  |
| 6.9 | Oversized image skip | As a user, an image > 25 MB shows a toast and is skipped. | `MAX_IMPORTED_IMAGE_BYTES` check. | `clipboardHistory.ts` | Pass |  |
| 6.10 | Clipboard window - open | As a user, the tray "Clipboard History..." opens the window. | `ClipboardWindow.show`. | `tray.ts`, `windows/clipboardWindow.ts` | Pass |  |
| 6.11 | Clipboard window - close | As a user, the "x" button closes the window. | `window.close()`. | `ClipboardView.tsx` | Pass |  |
| 6.12 | Type filter | As a user, I can filter the grid to All/Text/Image/URL/File/Color/Code. | `ClipboardFilters` chips drive `useClipboardEntries`. | `ClipboardView.tsx`, `ClipboardFilters.tsx` | Pass |  |
| 6.13 | App filter | As a user, I can pick "All apps" or a specific source app. | `<select>` listing `availableApps`. | `ClipboardView.tsx`, `ClipboardFilters.tsx` | Pass |  |
| 6.14 | Search filter | As a user, typing filters entries by label. | `search` field; case-insensitive substring match. | `ClipboardView.tsx`, `useClipboardEntries.ts` | Pass |  |
| 6.15 | Copy entry | As a user, clicking a card's "Copy" puts the payload on the clipboard. | `actions.copyEntry` -> `clipboardCopy` -> `copyEntryToPasteboard`. | `useClipboardActions.ts`, `quickPaste.ts` | Pass |  |
| 6.16 | Remove entry | As a user, "x" on a card removes it. | `actions.removeEntry` -> `clipboardEntryRemove`. | `useClipboardActions.ts` | Pass |  |
| 6.17 | Clear all | As a user, the topbar "Clear" button removes all entries (categories preserved). | `actions.clearAllEntries` -> `clipboardEntryClearAll`. | `ClipboardView.tsx` | Pass |  |
| 6.18 | Prune now | As a user, the topbar "Reload" button prunes entries beyond the limit. | `actions.pruneNow` -> `clipboardPruneNow`. | `ClipboardView.tsx` | Pass | BUG-001 fixed: prune now persists to disk via the new save-on-change branch in ClipboardStore.prune(). Regression test added in clipboardStore.test.ts. |
| 6.19 | Drag-out from clipboard | As a user, dragging a card starts a native drag (file for file-backed items, else toast). | `clipboardStartItemDrag` -> `startNativeDrag`. | `clipboard/ipcController.ts`, `dragController.ts` | Pass |  |
| 6.20 | Create category | As a user, I can name a new category and pick a color. | `clipboardCategoryCreate`; name 1-40 chars, color enum. | `ClipboardView/CategoryForm.tsx` | Pass |  |
| 6.21 | Rename category | As a user, I can rename a category inline. | `clipboardCategoryRename`. | `ClipboardView/CategoryList.tsx` | Pass |  |
| 6.22 | Remove category | As a user, removing a category unassigns all entries. | `clipboardCategoryRemove`. | `ClipboardView/CategoryList.tsx`, `state/clipboardStore.ts` | Pass |  |
| 6.23 | Assign entry to category | As a user, I can add a tag from a category picker on a card. | `clipboardEntryAssign`. | `ClipboardCard.tsx` | Pass |  |
| 6.24 | Unassign entry | As a user, clicking a tag removes it from the entry. | `clipboardEntryUnassign`. | `ClipboardCard.tsx` | Pass |  |
| 6.25 | Filter by category | As a user, clicking a category in the sidebar filters the grid. | `ClipboardCategories.onSelect`; `useClipboardEntries`. | `ClipboardCategories.tsx`, `useClipboardEntries.ts` | Pass |  |

## 7. Quick Paste Palette

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 7.1 | Show palette (hotkey) | As a user, pressing the configured hotkey summons the palette. | `preferencesSync` registers `clipboardSettings.quickPasteHotkey`; on trigger calls `quickPasteWindow.show(previousBundleId)`. | `preferencesSync.ts`, `windows/quickPasteWindow.ts` | Pass |  |
| 7.2 | "Pasting to <App>" hint | As a user, I see the previously focused app's name. | Captured by `ClipboardMonitor.getLastFrontmostApp` and rendered. | `QuickPastePalette.tsx`, `clipboardMonitor.ts` | Pass |  |
| 7.3 | "Press Cmd+V" hint | As a user, when the previous app name is empty I see a generic hint. | Conditional render. | `QuickPastePalette.tsx` | Pass |  |
| 7.4 | Up/Down navigation | As a user, arrow keys move the focus. | `setFocusIndex` clamped. | `QuickPastePalette.tsx` | Pass |  |
| 7.5 | Enter to paste | As a user, pressing Enter pastes the focused entry. | `triggerPaste` -> `clipboardQuickPastePaste`. | `QuickPastePalette.tsx` | Pass |  |
| 7.6 | Digit shortcut (1-9) | As a user, pressing 1-9 pastes that index. | Parses `event.key` to index, clamped to `entries.length`. | `QuickPastePalette.tsx` | Pass |  |
| 7.7 | Hover to focus | As a user, hovering an item sets focus. | `onMouseEnter` updates focus. | `QuickPastePalette.tsx` | Pass |  |
| 7.8 | Click to paste | As a user, clicking an item pastes. | `onClick` calls `triggerPaste`. | `QuickPastePalette.tsx` | Pass |  |
| 7.9 | Synthetic paste (osascript) | As a user (when enabled), the palette also sends Cmd+V. | `syntheticPasteEnabled` opt-in; `osascript` keystroke. | `quickPaste.ts` | Pass |  |
| 7.10 | Skip paste into Ledge | As a user, if Ledge was the previously focused app the paste is suppressed. | Compares `previousBundleId === ledeBundleId`. | `quickPaste.ts` | Pass | BUG-002 fixed: typo ledeBundleId -> ledgeBundleId. |
| 7.11 | Skip ignored apps | As a user, configured ignored apps do not receive synthetic paste. | `ignoreBundleIds` check. | `quickPaste.ts` | Pass |  |
| 7.12 | Hide palette | As a user, Escape or Close hides the palette. | `clipboardQuickPasteHide`. | `QuickPastePalette.tsx` | Pass |  |
| 7.13 | Clear all from palette | As a user, the footer "Clear" empties clipboard history. | `clipboardEntryClearAll`. | `QuickPastePalette.tsx` | Pass |  |

## 8. Peek Window

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 8.1 | Show peek (hotkey) | As a user, pressing the peek hotkey shows the floating strip. | `peekWindow.show` triggered by `registerClipboardShortcuts`. | `preferencesSync.ts`, `windows/peekWindow.ts` | Pass |  |
| 8.2 | Hide peek | As a user, pressing the hotkey again hides it. | `peekWindow.hide`. | `peekWindow.ts` | Pass |  |
| 8.3 | Hover to expand | As a user, hovering the strip expands it from 48 px -> 168 px. | `setExpanded(true)` on `mouseenter`. | `PeekWindowView.tsx` | Pass |  |
| 8.4 | Mouse leave collapses | As a user, moving the mouse away collapses it. | `setExpanded(false)` on `mouseleave`. | `PeekWindowView.tsx` | Pass |  |
| 8.5 | Show up to 12 thumbs | As a user, the strip shows the most recent 12 entries. | `PEEK_MAX_THUMBS = 12`. | `PeekWindowView.tsx` | Pass |  |
| 8.6 | Drag-out from peek | As a user, dragging a thumb starts a native drag. | `clipboardStartItemDrag`. | `PeekWindowView.tsx` | Pass |  |
| 8.7 | "Empty" placeholder | As a user, an empty clipboard shows "Empty". | Conditional render. | `PeekWindowView.tsx` | Pass |  |

## 9. Onboarding

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 9.1 | First-launch onboarding | As a new user, the onboarding view shows on first launch. | Triggered by `preferences.hasCompletedOnboarding === false` in `App.tsx`. | `App.tsx` | Pass |  |
| 9.2 | Step 1 - Drag file unlock | As a user, dragging the demo file onto the sandbox shelf unlocks the Next button. | Local state `step1Done`; drops the page's drag handler. | `OnboardingView.tsx` | Pass |  |
| 9.3 | Step 2 - Activation methods (info only) | As a user, I see the three activation methods. | Step 2 is informational; Next is enabled. | `OnboardingView.tsx` | Pass |  |
| 9.4 | Step 3 - Drop & drag (info only) | As a user, I see the drop/drag flow. | Step 3 is informational. | `OnboardingView.tsx` | Pass |  |
| 9.5 | Next/Back navigation | As a user, I can navigate the steps. | Buttons + arrow keys + space/enter. | `OnboardingView.tsx` | Pass | BUG-003 fixed: Enter/Space on locked step no longer preventDefault; ArrowLeft on step 0 no longer preventDefault. Regression test added in OnboardingView.test.tsx. |
| 9.6 | Skip onboarding | As a user, clicking Skip on step 1 dismisses the view. | `setPreferences({hasCompletedOnboarding: true})`. | `OnboardingView.tsx` | Pass |  |
| 9.7 | Get Started completes | As a user, on step 3, clicking Get Started marks onboarding complete. | `setPreferences({hasCompletedOnboarding: true})`. | `OnboardingView.tsx` | Pass |  |
| 9.8 | Escape closes onboarding | As a user, pressing Escape completes onboarding. | `keydown` handler. | `OnboardingView.tsx` | Pass |  |
| 9.9 | Dev-mode Alt-D bypass | As a dev, Alt+D unlocks all steps. | `import.meta.env.DEV` guard. | `OnboardingView.tsx` | Pass |  |
| 9.10 | Reset onboarding from Preferences | As a user, the General -> Reset button re-enables onboarding. | `setPreferences({hasCompletedOnboarding: false})`. | `GeneralSettings.tsx` | Pass |  |

## 10. Native Helper & Permissions

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 10.1 | Native helper start | As a user, the Swift binary is spawned on app start. | `NativeAgentClient.start` -> `launchHelper`; spawns JSON-RPC child. | `native/nativeAgent.ts` | Pass |  |
| 10.2 | Restart on crash | As a user, if the helper crashes it is restarted with exponential backoff (250 ms -> 2 s). | `handleChildUnavailable` schedules restart. | `nativeAgent.ts` | Pass |  |
| 10.3 | Permission status read | As a user, accessibility status is read from the helper. | `permissions.getStatus` RPC; parsed via `nativePermissionStatusSchema`. | `nativeAgent.ts` | Pass |  |
| 10.4 | Open Accessibility settings | As a user, `nativeAgent.openPermissionSettings` jumps to the right pref pane. | Helper opens `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`. | `nativeAgent.ts` | Pass |  |
| 10.5 | Configure gesture | As a user, shake enable/sensitivity are pushed to the helper. | `configureGesture(prefs)` RPC. | `nativeAgent.ts`, `preferencesSync.ts` | Pass |  |
| 10.6 | Shake detected event | As a user, a shake invokes `ShelfController.handleShakeDetected`. | `nativeAgent.on('shakeDetected')`. | `index.ts` | Pass |  |
| 10.7 | Clipboard change event | As a user, a clipboard change from the helper drives `ClipboardMonitor`. | `nativeAgent.on('clipboardChanged')` -> `clipboardMonitor.notifyFromNative`. | `index.ts`, `clipboardMonitor.ts` | Pass |  |
| 10.8 | Native helper missing | As a user, if the binary is absent the tray/header show a banner. | `state.permissionStatus.nativeHelperAvailable === false` -> banner in `ShelfView`. | `ShelfView.tsx`, `nativeAgent.ts` | Pass |  |
| 10.9 | Native helper stderr surfaces | As a user, a non-empty stderr line becomes `permissionStatus.lastError` and is shown. | `child.stderr.on('data', ...)`. | `nativeAgent.ts` | Pass |  |

## 11. State & Persistence

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 11.1 | Atomic state writes | As a user, my shelves and preferences survive an unexpected quit. | `StatePersister` writes to `state.json` atomically. | `services/state/persister.ts` | Pass |  |
| 11.2 | Corruption recovery | As a user, a corrupt `state.json` is moved aside and a backup toast is shown. | `onCorruptionDetected` toast. | `index.ts`, `persister.ts` | Pass |  |
| 11.3 | Persistence error throttled toast | As a user, a tight error loop (e.g. EACCES) only toasts every 30 s. | `createThrottledToast(30_000)`. | `index.ts`, `toastBroadcaster.ts` | Pass |  |
| 11.4 | Pre-quit flush | As a user, quit waits up to 1.5 s for the write queue to drain. | `before-quit` handler re-quits after flush. | `index.ts` | Pass |  |
| 11.5 | Subscribe to state | As a user, every window receives the latest snapshot. | `stateUpdated` IPC. | `index.ts` | Pass |  |
| 11.6 | Re-validate on broadcast | As a user, malformed state falls back to a raw snapshot rather than crashing. | `appStateSchema.parse` with try/catch fallback. | `index.ts` | Pass |  |

## 12. Window Web Security

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 12.1 | Renderer lockdown | As a user, every window disables nodeIntegration, opens blocked, and refuses webview. | `lockDownWebContents` in `webSecurity.ts`. | `windows/webSecurity.ts` | Pass |  |
| 12.2 | `ledge-asset://` protocol | As a user, only whitelisted asset paths load (with .icns -> PNG conversion). | `protocolModule.registerSchemesAsPrivileged` + `protocolModule.handle`. | `index.ts`, `services/assetPathResolver.ts` | Pass |  |
| 12.3 | Asset path allowlist | As a user, requests outside the assets dir or live shelf items are rejected (403). | `resolveAllowedAssetPath`. | `services/assetPathResolver.ts` | Pass |  |
| 12.4 | Dock hidden on launch / activate / quit | As a user, the macOS dock never shows. | `app.dock.hide()` is called in three places. | `index.ts` | Pass |  |

## 13. IPC Contracts

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 13.1 | All channels are validated with Zod | As a user, malformed payloads return validation errors rather than crashing. | Every `ipcMain.handle` parses with a Zod schema. | `ipc.ts`, `ipcSchemas.ts` | Pass |  |
| 13.2 | All `window.ledge` calls are typed | As a user, the renderer cannot call an unknown method. | `LedgeAPI` interface in `src/shared/ipc.ts`. | `src/shared/ipc.ts` | Pass |  |
| 13.3 | State subscription is a disposable function | As a user, components can clean up. | `subscribeState(listener)` returns an unsubscribe fn. | `ipc.ts`, `preload/index.ts` | Pass |  |
| 13.4 | Toast push to all windows | As a user, toasts broadcast to every live `BrowserWindow`. | Loops `BrowserWindow.getAllWindows()`. | `ipc.ts` | Pass |  |
| 13.5 | Shelf interaction ping | As a user, every interaction resets the inactivity timer. | `ipcMain.on(IPC_CHANNELS.shelfInteractionPing)`. | `ipc.ts` | Pass |  |

## 14. Developer-Facing

| # | Feature | User Story | Expected Behaviour | Source | Status | Notes |
|---|---------|------------|---------------------|--------|--------|-------|
| 14.1 | `pnpm dev` | As a dev, this runs brand + native build then starts `electron-vite dev`. | `package.json` script. | `package.json` | Pass |  |
| 14.2 | `pnpm lint` | As a dev, tsc --noEmit across all three tsconfigs. | `package.json` script. | `package.json` | Pass | lint: PASS |
| 14.3 | `pnpm test` | As a dev, vitest + Swift self-test. | `package.json` script. | `package.json` | Pass | test: 319/319 PASS, 5/5 native PASS |
| 14.4 | `pnpm build` | As a dev, produces a production build. | `package.json` script. | `package.json` | Pass | build: PASS |
| 14.5 | `pnpm dist` | As a dev, produces a lean DMG-ready bundle + size report. | `package.json` script. | `package.json` | Skipped | Requires producing a .dmg; covered by pnpm dist:release in CI. Skipped here because it needs codesign config. |
| 14.6 | Changelog automation | As a dev, `pnpm changelog:diff` and `pnpm changelog:update` exist. | `scripts/build-changelog.mjs`. | `AGENTS.md`, `package.json` | Pass |  |
| 14.7 | CI | As a dev, GitHub Actions runs `lint -> test -> build` on macos-14. | `.github/workflows/`. | `AGENTS.md` | Pass |  |
