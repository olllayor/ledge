# Bug Log

> Audit-driven log of defects found while walking the user stories in
> `docs/feature-catalog.md`. Each entry includes severity, the user story
> affected, the root cause, and the fix (when applied).

## Severity legend
- **S0** — crash, data loss, completely blocks a flow
- **S1** — major feature broken or wrong outcome
- **S2** — minor / cosmetic / UX paper cut
- **S3** — internal-only / nice-to-have

## BUG-001 — clipboardPruneNow does not persist to disk
- **Severity:** S1
- **Affected user stories:** 6.18 (Prune now)
- **Files:** `src/main/services/clipboard/ipcController.ts:102`, `src/main/services/state/clipboardStore.ts:75`
- **Symptom:** User opens the Clipboard window and clicks the topbar "⟳" (prune now)
  button. The renderer filters entries in memory via `setEntries`/state update and
  everything looks fine. If the user then quits the app, on next launch the old
  entries are still on disk and re-appear.
- **Root cause:** `ClipboardStore.prune()` mutates `state.clipboardHistory` in
  place but does NOT call `this.persister.save(state)`. Other mutators
  (`appendEntry`, `clearHistory`, `removeEntry`) do call `save` themselves.
  `prune` was only ever reached from `appendEntry` (where the caller's
  subsequent `save` covers the prune) and `updateSettings` (same).
  The new top-level `clipboardPruneNow` IPC calls prune without saving.
- **Fix:** Make `prune` save itself when it actually mutates state, so every
  caller (including the new IPC) gets persistence for free. Also keep the
  pre-existing behaviour of returning early when no change is made so we don't
  needlessly touch disk on every append.

## BUG-002 — typo `ledeBundleId` (should be `ledgeBundleId`)
- **Severity:** S3 (code quality, not user-visible)
- **Affected user stories:** 7.10 (Skip paste into Ledge)
- **Files:** `src/main/services/quickPaste.ts:18,23`, `src/main/services/clipboard/ipcController.ts:43,199`
- **Symptom:** Codebase uses `ledeBundleId` everywhere — spelled like "lede" (the
  journalism term for the lead paragraph) rather than "ledge" (the app name).
  Functionally correct because the default value is the right bundle id
  (`com.ollayor.ledge`).
- **Root cause:** typo propagated across files.
- **Fix:** Rename parameter + property in both files to `ledgeBundleId` so the
  intent is obvious to future readers.

## BUG-003 — Onboarding: ArrowLeft always `preventDefault`s on step 0
- **Severity:** S3
- **Affected user stories:** 9.5 (Next/Back navigation)
- **Files:** `src/renderer/src/components/OnboardingView.tsx` (keydown handler around line 76)
- **Symptom:** On the very first step, pressing ArrowLeft is swallowed
  (`event.preventDefault()`) but does nothing. While a minor UX issue (most
  users won't press ArrowLeft on step 0), this also breaks the "Don't prevent
  default when there's no action" rule.
- **Root cause:** the `if (event.key === 'ArrowLeft')` block sits outside the
  `step > 0` guard inside `goBack`.
- **Fix:** Only call `preventDefault()` when the keypress actually triggers a
  navigation. Mirror the same fix for `Enter`/`Space` so they don't prevent
  default on the locked-step case where `advance` is a no-op.


## BUG-004 — file URL paths with spaces / unicode are not URL-decoded
- **Severity:** S2 (UX: silently drops the entry rather than crashing)
- **Affected user stories:** 6.2 (Capture file path from pasteboard)
- **Files:** `src/main/services/clipboard/payloads.ts:135` (`pathsFromFileUrlBuffer`)
- **Symptom:** A user copies a file whose name contains a space (e.g.
  `~/My Files/report.pdf`) and a `public.file-url` pasteboard payload
  arrives as `file:///Users/me/My%20Files/report.pdf`. The shelf entry is
  silently dropped: the path round-trips with the percent-escape intact,
  `fs.stat()` fails with `ENOENT`, and the entry is filtered out by
  `createPathItems`. The clipboard history shows the file briefly during
  the paste then it disappears.
- **Root cause:** `pathsFromFileUrlBuffer` strips the `file://` scheme
  but does not call `decodeURIComponent` on the remainder. URI-style
  escapes (`%20`, `%C3%A9`, etc.) survive the round trip.
- **Fix:** `decodeURIComponent` the stripped path (with a try/catch
  fallback so a malformed escape still produces a usable string). Added
  two regression tests in `payloads.test.ts`.
