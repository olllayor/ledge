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

## BUG-005 — pending team invitations never surface in the UI
- **Severity:** S1
- **Affected user stories:** Teams invite accept/reject, admin pending list
- **Files:** `src/renderer/src/lib/apiClient.ts` (`listPendingInvites`,
  `listPendingInvitesForTeam`), `cloudflare/src/teams.ts`
- **Symptom:** `myPendingInvitations` stays empty and the team settings
  "Pending invitations" panel is empty even after a successful invite.
  Invitees never see the Accept/Decline banner.
- **Root cause:** Client read `result.invites`; the Worker returns
  `{ invitations: [...] }`. Also, the admin per-team list called
  `GET /teams/:teamId/invites`, which did not exist on the Worker (404).
- **Fix:** Align both list methods on `invitations`, and add the admin
  `GET /teams/:teamId/invites` route (pending only, no raw tokens).

## BUG-006 — team code items lose their body on push and pull
- **Severity:** S1
- **Affected user stories:** Shared team shelf code snippets
- **Files:** `src/renderer/src/providers/teamSync.ts`, `cloudflare/src/teams.ts`
- **Symptom:** A `code` item syncs to the team shelf with empty text.
  After another member pulls, the snippet is still empty.
- **Root cause:** Client pushed/read `codeText`; the Worker
  `sanitizeTeamItem` stores and returns `text` (same field as personal
  sync). Round-trip dropped the payload.
- **Fix:** Client uses `text` for code items on both push and pull.
  Added a `teamSync` regression test.

## BUG-007 — team shelf mirror throws when createdAt is missing
- **Severity:** S1
- **Affected user stories:** Team shelf pull / apply
- **Files:** `src/renderer/src/providers/teamSync.ts`,
  `cloudflare/src/teams.ts` (`sanitizeTeamItem`)
- **Symptom:** `remoteToLocalItems` calls `new Date(doc.createdAt).toISOString()`.
  Server team items historically never stored `createdAt`, so every pull
  threw and the team shelf never mirrored.
- **Root cause:** Wire mismatch — client required `createdAt`, server
  payload omitted it.
- **Fix:** Persist `createdAt` in the team item payload; client falls
  back to epoch when the field is missing so fingerprints stay stable.

## BUG-008 — tombstoned shelves still accept item and asset writes
- **Severity:** S2
- **Affected user stories:** Discard synced shelf, then mutate items
- **Files:** `cloudflare/src/db.ts` (`personalShelfExists`)
- **Symptom:** After a shelf is tombstoned (user discard), item upsert/
  delete and image upload still succeed against that shelf id.
- **Root cause:** Ownership check did not filter `deleted_at IS NULL`.
- **Fix:** Only active shelves pass the check.

## BUG-009 — first shelf poll never learns about offline deletions
- **Severity:** S2
- **Affected user stories:** Multi-device shelf delete convergence
- **Files:** `cloudflare/src/sync.ts` (`GET /sync/shelves`)
- **Symptom:** Device A was offline; Device B deleted a shelf; Device A's
  first poll (`since` omitted) returned active shelves only, so A kept
  the deleted shelf locally forever.
- **Root cause:** Full snapshot intentionally skipped tombstones; the
  client's initial pull has no `since` cursor.
- **Fix:** Full snapshot now includes tombstones from the last 30 days
  so a cold poll can drop local copies.

## BUG-010 — orphan R2 cleanup only scanned the first page
- **Severity:** S3
- **Affected user stories:** Storage hygiene after failed uploads
- **Files:** `cloudflare/src/cron.ts`
- **Symptom:** Objects beyond the first 1000 keys listed were never
  considered for orphan cleanup.
- **Root cause:** Single `R2.list({ limit: 1000 })` without following
  `truncated` / `cursor`.
- **Fix:** Paginate up to 20 pages (20k objects) per cron run.

## BUG-011 — Worker has no CORS headers; Electron renderer cannot call it
- **Severity:** S1
- **Affected user stories:** All cloud features (sign-in OTP, sync, teams)
- **Files:** `cloudflare/src/index.ts`
- **Symptom:** Preferences → Cloud Sync shows Status "Error"; Send Code
  fails. `curl` to the Worker works, so the backend looks healthy.
- **Root cause:** Dev renderer origin (`http://localhost:5173`) and the
  Worker origin (`http://127.0.0.1:8787`) are cross-origin. Chromium
  enforces CORS even inside Electron. The Worker sent no
  `Access-Control-*` headers, and OPTIONS preflights fell through to 401.
- **Fix:** Global middleware reflects `Origin`, answers OPTIONS with 204,
  and allows the Authorization / Content-Type / asset upload headers.
  Auth is Bearer tokens (not cookies), so reflecting Origin is safe.

## BUG-012 — "Skip secret-looking text" toggle is dead
- **Severity:** S1
- **Affected user stories:** Clipboard sensitive-text skip preference
- **Files:** `src/shared/ipcSchemas.ts`, `src/shared/schema.ts`, `src/shared/ipc.ts`
- **Symptom:** Toggling "Skip secret-looking text" in Preferences always
  errors; the setting never changes.
- **Root cause:** Main validated updates with a hand-rolled `.strict()`
  schema that omitted `skipSensitiveText`. Preload used
  `clipboardSettingsSchema.partial()` which includes it — schema drift
  between the two files.
- **Fix:** Shared `clipboardSettingsFields` (no defaults); both the full
  settings schema and the strict partial update schema derive from it.
  Partial patches must not fill defaults (updateSettings spreads).

## BUG-013 — Personal cloud pull of file-backed shelves fails Zod
- **Severity:** S1
- **Affected user stories:** Multi-device sync of shelves with files/images
- **Files:** `src/shared/sync.ts`, `src/renderer/src/providers/SyncProvider.tsx`
- **Symptom:** Shelves containing file/folder/imageAsset items never apply
  from cloud (caught + console.error). Text/url/color/code shelves work.
- **Root cause:** Worker strips path fields on store. Client cast remote
  items to `ShelfItemRecord[]` and main parsed with `shelfRecordSchema`,
  which requires `originalPath`. Team sync reconstructs the full FileRef;
  personal path did not.
- **Fix:** `coerceCloudItemsToLocal` rebuilds empty-path + isMissing
  FileRefs (same invariant as teamSync / sanitizeRemoteItem) before IPC.

## BUG-014 — Double-quit during flush abandons the state write
- **Severity:** S2
- **Affected user stories:** Quit after a mutation
- **Files:** `src/main/index.ts`
- **Symptom:** Double Cmd+Q (or tray Quit + Cmd+Q) during the pre-quit
  flush exits while `stateStore.whenIdle()` is still writing.
- **Root cause:** Second `before-quit` saw `isFlushingStateForQuit` and
  returned without `preventDefault`, allowing an immediate quit.
- **Fix:** Separate `hasFlushedStateForQuit` flag; extra quits during
  flush are swallowed; only the post-flush re-quit is allowed through.

## BUG-015 — Hung native helper freezes clipboard capture
- **Severity:** S2
- **Affected user stories:** Clipboard history while helper is hung
- **Files:** `src/main/native/nativeAgent.ts`
- **Symptom:** After 3 consecutive request timeouts the circuit breaker
  left the helper process alive and `nativeHelperAvailable: true`. The
  TS fallback poller only starts when that flag is false, so clipboard
  capture froze until app restart.
- **Root cause:** Breaker only logged; did not dispose the child or mark
  it unavailable.
- **Fix:** Breaker now disposes the hung helper, rejects pending calls,
  cancels restart, and marks `nativeHelperAvailable: false` so the TS
  poller takes over.

## BUG-016 — resolveBookmark claims files exist when helper is down
- **Severity:** S2
- **Affected user stories:** Restore/heal of file-backed shelf items
- **Files:** `src/main/native/nativeAgent.ts`
- **Symptom:** Missing files marked present when helper is down; open/
  preview fail later with no Relink affordance.
- **Root cause:** Early return with `isMissing: false` when `!child`.
- **Fix:** Return `isMissing: true, isStale: true` so the UI offers Relink.

## BUG-017 — OTP verify is not atomic (check + consume)
- **Severity:** S2
- **Affected user stories:** Sign-in
- **Files:** `cloudflare/src/auth.ts`
- **Symptom:** Two concurrent verifies of the same code can both pass
  evaluation and mint sessions.
- **Root cause:** SELECT then UPDATE without a consume guard.
- **Fix:** `UPDATE … SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`
  as the claim; 0 rows changed → 401.



