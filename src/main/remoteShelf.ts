import type { ShelfRecord } from '@shared/schema';
import { isFileBackedItem } from '@shared/fileUtils';

/**
 * Strip every file-path field from a remote-sourced shelf before it lands
 * in the local state store. The cloud copy must not be allowed to
 * designate any local file path: the main process asset protocol
 * (`ledge-asset://`) trusts items' file paths, and a maliciously-crafted
 * shelf could otherwise pivot the renderer into reading arbitrary local
 * files (e.g. /etc/passwd, ~/.ssh/id_rsa, ...).
 *
 * After sanitization, file-backed items carry empty paths and `isMissing`
 * so the renderer skips preview generation and the user is guided to
 * `Relink…` the local copy via the security-scoped bookmark.
 */
export function sanitizeRemoteFileRefs(shelf: ShelfRecord): ShelfRecord {
  return {
    ...shelf,
    items: shelf.items.map((item) => {
      if (!isFileBackedItem(item)) {
        return item;
      }

      return {
        ...item,
        file: {
          ...item.file,
          // Strip every path field on a remote-sourced item. The cloud copy
          // must not be allowed to designate any local file path — the
          // asset protocol below trusts items' file paths, so a
          // maliciously-crafted shelf could otherwise pivot the renderer
          // into reading arbitrary local files (e.g. /etc/passwd).
          originalPath: '',
          resolvedPath: '',
          bookmarkBase64: '',
          isMissing: true,
          isStale: true,
        },
      };
    }),
  };
}

export type RemoteShelfDecision =
  | { apply: false; reason: 'no-local'; nextWatermark: number }
  | { apply: false; reason: 'stale'; nextWatermark: number }
  | { apply: true; reason: 'first-contact' | 'fresher' | 'watermark-fresh'; nextWatermark: number };

/**
 * Decide whether a remote shelf snapshot should replace the local one.
 *
 * The naive `remote.updatedAt > local.updatedAt` check is unsafe in three
 * real cases:
 *
 *   1. Equal timestamps — strict `>` drops the snapshot, but the cloud is
 *      still the source of truth and the device's local `updatedAt` may
 *      simply be a stale write that never reached the cloud.
 *   2. Clock skew — device B's wall clock is slightly behind device A's.
 *      The cloud already arbitrated LWW by `localUpdatedAt`, so a remote
 *      snapshot that is "older by wall clock" is still the canonical
 *      state and must be applied on first contact.
 *   3. Replayed snapshots — the renderer may resend a remote we've already
 *      applied (e.g. across a restart, or when the SyncProvider refetches
 *      the same shelf). Applying again is wasteful but harmless, and we
 *      want it to be a true no-op so a later strictly-fresher snapshot
 *      still works.
 *
 * The decision is keyed on a per-shelf `lastSyncedRemoteUpdatedAt`
 * watermark. On first contact we always apply and remember the remote
 * timestamp; thereafter we apply when the incoming remote is strictly
 * fresher than the watermark. This is the "diff window" the caller asked
 * for: once we've accepted a remote version, we don't re-apply it unless
 * the cloud ships a newer one.
 *
 * `nextWatermark` is always `max(current, incoming)` so callers can
 * advance their book-keeping regardless of the apply decision.
 */
export function decideRemoteShelfApply(args: {
  remote: ShelfRecord;
  local: ShelfRecord | null;
  lastSyncedRemoteUpdatedAt: number | null;
}): RemoteShelfDecision {
  const remoteUpdatedAt = Date.parse(args.remote.updatedAt);
  // Date.parse returns NaN for missing/garbage timestamps. NaN compares
  // false to everything, so a NaN-bearing remote would be silently
  // dropped. Coerce to 0 so first-contact applies, then the watermark
  // advances to 0 and we still accept any later parseable timestamp.
  const safeRemoteUpdatedAt = Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : 0;
  const currentWatermark = args.lastSyncedRemoteUpdatedAt ?? 0;
  const nextWatermark = Math.max(currentWatermark, safeRemoteUpdatedAt);

  if (args.lastSyncedRemoteUpdatedAt === null) {
    return { apply: true, reason: 'first-contact', nextWatermark };
  }

  if (safeRemoteUpdatedAt > currentWatermark) {
    return { apply: true, reason: 'fresher', nextWatermark };
  }

  if (safeRemoteUpdatedAt === currentWatermark && currentWatermark === 0) {
    // Garbage-remote path: both sides parse to 0, watermark is 0. Allow
    // the apply so the local state can recover from a previously-bad
    // write; the watermark still doesn't advance past 0, so a later
    // parseable remote will re-apply.
    return { apply: true, reason: 'watermark-fresh', nextWatermark };
  }

  if (!args.local) {
    return { apply: false, reason: 'no-local', nextWatermark };
  }

  return { apply: false, reason: 'stale', nextWatermark };
}
