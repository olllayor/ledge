# Shelf upgrades from vorssaint-utils

Source study: https://github.com/vorssaint/vorssaint-utils (native Swift menu bar suite, GPL-3.0-or-later). It ships a shelf that overlaps with ours, and its shelf code solves several problems we have not solved yet. This plan turns the useful ideas into work items grounded in our codebase.

## License rule

The repo is GPL-3.0-or-later. We do not copy source. We reimplement ideas independently. Constants (distances, timeouts, caps) are facts, not copyrightable expression, so matching numbers are fine. Code structure and comments must be our own.

## What we are not taking

- Their pile/batch grouping model for now (see Phase 5, decision needed)
- Screen-edge dwell trigger (see Phase 6, overlaps our shake gesture)
- Their feature install/uninstall hub. Our env-based `featureFlags.ts` covers current needs; revisit if Ledge grows past ~10 features
- Permission transparency portal. Electron apps face a different permission model than native ones

---

## Phase 1: Heal-on-restore instead of drop-on-restore

**Problem today.** When the app loads a shelf and a file's path no longer resolves, the item stays flagged `isMissing` and mostly dead until the user manually relinks it.

**Their idea.** At restore time, give every dead file one chance to live again through its bookmark. A file moved or renamed behind our back gets found at its new path, the entry keeps its identity, and the title updates to the new name. Only unresolvable items stay missing.

**Where.**

- Load path: `src/main/services/stateStore.ts` → `src/main/services/state/shelfStore.ts`
- Resolution helpers: `src/main/services/payloads.ts` (already wraps `resolveBookmark`)
- Pure logic home: `src/shared/fileUtils.ts`

**How.**

1. Add a pure function `healFileRef(fileRef, { exists(path), resolveBookmark(bookmarkBase64, originalPath) })` in shared code. Injected predicates keep it unit-testable without Electron, same pattern as `payloads.ts`.
2. On shelf load, before broadcasting state, run every file-backed item through it:
   - Path exists → leave alone
   - Path gone, bookmark resolves to an existing path → rewrite `resolvedPath` and title, clear `isMissing`, mark `isStale: false`
   - Both fail → keep item, set `isMissing: true` (never silently delete)
3. Persist only when something healed, mirroring their "needs persist after restore" check so normal launches do not rewrite the store file.

**Tests.** Colocated `.test.ts` for the pure function: heals rename, heals move, keeps missing when bookmark dead, keeps missing when bookmark absent, does not touch healthy items.

**Done when.** Moving a file on disk while Ledge is closed, then launching, shows the item intact under its new path with no user action.

## Phase 2: Do not prune files on unmounted volumes

**Problem today.** An external or network drive that mounts after launch makes everything on it read as missing. Nothing prunes today, but once any future cleanup pass lands this becomes a data-loss trap.

**Their idea.** For paths under `/Volumes/<name>/`, absence only counts as real when the volume root itself is absent. A laptop that wakes before the drive appears must not lose shelf entries.

**Where.** Pure function next to Phase 1 healing, e.g. `unmountedVolumeRoot(path): string | null` in `src/shared/fileUtils.ts`.

**How.** Parse path components. Return `/Volumes/<name>` for third-level-and-deeper paths, null otherwise. The healer treats "volume root missing" as "wait", not "dead". Re-check on volume mount events (`systemUtils.ts` already owns system observation).

**Tests.** Boot-volume paths return null, `/Volumes/USB/file.txt` returns `/Volumes/USB`, root paths return null. Healer defers when volume root missing.

**Done when.** Unit test proves a file on a not-yet-mounted volume survives a sanitize pass, and heals once mounted.

## Phase 3: Persistence ceilings

**Problem today.** `shelfStore.ts` trusts whatever JSON sits on disk. A corrupted or hand-edited store can balloon startup or wedge rendering with a million-item list.

**Their idea.** Hard ceilings enforced everywhere items enter: max leaves per shelf, max stored text length, max nesting depth. Rationale: a shelf is a curated surface, not an archive.

**Proposed values for Ledge.** Start with max 200 items per shelf, 200_000 chars per text payload, and no nesting while the shelf stays flat (Phase 5 may add depth). Tune later against real usage.

**Where.**

- Schema: `src/shared/schema.ts` (add named constants, reference them in Zod `.max()` validators)
- Ingest: `src/main/services/shelfItemOps.ts` rejects overflow at `append()`
- Load: sanitizer drops oldest-first beyond the cap and logs once
- Cloud sync: `src/shared/sync.ts` inherits limits free because it serializes validated records

**Tests.** Append past cap rejected with typed error; oversized text truncated or rejected at schema level; corrupt store loads bounded.

**Done when.** Hand-editing the store file to 50k items still launches fast and trims to the cap.

## Phase 4: Selection and dismissal polish

Small renderer-side items from their tile interactions.

1. **Escape clears selection only when bare.** In `ShelfView.tsx`, the Escape handler must ignore presses carrying modifiers so we never swallow future shortcuts (Cmd+Escape etc.). One predicate function, colocated test.
2. **Trash button doubles as remove-selected.** When a selection exists, the clear affordance removes selected items; empty selection clears all. Label and tooltip switch on `selection.isEmpty`.
3. **Drag-out removal requires copy semantics.** Today dragging an item out of the shelf should only remove it when the drop target copied rather than moved the underlying file. `src/renderer/src/lib/shelfDrop.ts` knows the drop outcome; thread an `outcome: 'copy' | 'move'` back through the bridge and gate removal on it. Their comment explains the failure mode: removing after a move leaves a persisted URL pointing at a file that walked away.
4. **Pin beats auto-dismiss.** Before adding any auto-hide-on-drop behavior, add a `pinned` boolean to shelf state (`src/shared/preferences.ts` patch flow) so users can opt out of dismissal forever.

**Where.** `src/renderer/src/components/ShelfView.tsx`, `src/renderer/src/lib/shelfDrop.test.ts`, `src/renderer/src/lib/shelfFlow.ts`.

**Done when.** Each bullet has a harness row in `docs/feature-catalog.md` style plus a runtime assertion in `src/main/services/__harness__/userStoryHarness.test.ts` where main-process state is involved.

## Phase 5: Piles (decision needed)

Their shelf groups multiple dropped files into one collapsible batch tile. Emptied batches vanish, single-child batches collapse into their child, and those rules run identically live and at restore. Tooltips break piles down by kind.

This is the biggest gap between our shelf and theirs and the biggest schema change:

- New discriminated union member in `src/shared/schema.ts` (`kind: 'pile'`) or a nullable `parentId`
- Order handling through our LexoRank keys (`src/shared/lexorank.ts`)
- Sync implications in `convex/` (schema validators, merge rules)
- Every consumer that assumes flat lists: `contextMenus.ts`, `shelfActions.ts`, `ShelfView.tsx`, `shelfFlow.ts`

Recommendation: defer until Phases 1–4 ship. The collapse rules themselves are cheap; the blast radius is not. When we take it, port the invariant list (empty pile dies, singleton unwraps, depth-capped) into pure functions with tests first.

## Phase 6: Screen-edge reveal (decision needed)

Their edge trigger uses three tuned numbers worth recording even if we skip the feature: open within 200px of the edge, dismiss boundary wider at 330px to kill flicker, 150ms dwell so fast pointer passes never fire. Retreat checks test the edge actually shown, display seams never count, and side-mounted Dock margins are excluded.

Ledge already reveals via shake detection in the Swift helper (`native/DropShelfNativeAgent`). An edge trigger would mean either a CGEvent-based pointer watcher in the native agent or a polling loop in main. That competes with shake for the same "summon the shelf" job, and running both invites double-summon confusion.

Decision to make: is edge-drag a replacement for shake on machines where accessibility permissions fail, or a second summon path? If replacement, prototype behind a new `FEATURE_FLAGS` entry (`featureFlags.ts` pattern supports exactly this).

## Phase 7: Docs hygiene quick wins

Half a day, no code risk.

1. `SECURITY.md` with a private reporting channel (we currently lack one)
2. `SUPPORT.md` pointing issues and questions to the right places
3. Extend `Tools`-style cleanup: document full uninstall including `tccutil reset` for our TCC grants, login item removal, support-folder paths. Fold into CONTRIBUTING or a dedicated UNINSTALL section in README

---

## Suggested order

| # | Item | Size | Risk |
|---|------|------|------|
| 1 | Phase 7 docs | half day | none |
| 2 | Phase 3 ceilings | 1 day | low |
| 3 | Phase 2 volume guard | half day | low |
| 4 | Phase 1 heal-on-restore | 1–2 days | medium |
| 5 | Phase 4 selection polish | 1–2 days | low |
| 6 | Phase 5 piles | multi-day | high |
| 7 | Phase 6 edge reveal | unknown | blocked on product call |

Ceilings land early because every later phase writes more items through the same door. Healing depends on the volume guard being in place, so 2 precedes 1.

Verification for every phase: `pnpm lint` → `pnpm test` → `pnpm build`.
