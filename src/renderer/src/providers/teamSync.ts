import type { ShelfItemRecord } from '@shared/schema';
import { shelfItemSchema } from '@shared/schema';
import { compareRanks, ranksBetween, type Rank } from '@shared/lexorank';

/**
 * Pure helpers for team shelf sync. The provider (React) is a thin shell
 * around these so every decision — mapping, diffing, rank assignment —
 * is unit-testable without Convex or IPC.
 *
 * Model: the local team shelf keeps Ledge's numeric `order` (0..n-1).
 * The server stores fractional string ranks. `buildTeamPushPlan`
 * translates a local sequence into per-item upserts/deletes, assigning
 * ranks between neighbors so two members inserting at the same spot
 * never collide or renumber each other.
 */

/** v1 teams share exactly one shelf per team under this canonical id. */
export const TEAM_SHELF_ID = 'default';

/** Shape returned by `api.sync.getTeamShelfItems` (a `shelfItems` doc). */
export interface RemoteTeamItemDoc {
  _id: string;
  _creationTime: number;
  itemId: string;
  kind: ShelfItemRecord['kind'];
  title: string;
  subtitle: string;
  preview: { summary: string; detail: string };
  order: string;
  file?: { originalPath: string; resolvedPath: string; isStale: boolean; isMissing: boolean };
  mimeType?: string;
  text?: string;
  savedFilePath?: string;
  url?: string;
  cloudStorageId?: string;
  cloudStorageBytes?: number;
  hex?: string;
  name?: string;
  codeText?: string;
  language?: string;
  version: number;
  serverUpdatedAt: number;
  createdByUser?: { email: string };
}

/** What the reconciler remembers about each item it has seen on the server. */
export interface SyncedItemInfo {
  rank: Rank;
  version: number;
  fingerprint: string;
}

export type SyncedMap = Map<string, SyncedItemInfo>;

export interface TeamItemUpsert {
  itemId: string;
  kind: ShelfItemRecord['kind'];
  title: string;
  subtitle: string;
  preview: { summary: string; detail: string };
  order: Rank;
  version: number;
  serverUpdatedAt: number;
  file?: RemoteTeamItemDoc['file'];
  mimeType?: string;
  text?: string;
  savedFilePath?: string;
  url?: string;
  hex?: string;
  name?: string;
  codeText?: string;
  language?: string;
  cloudStorageId?: string;
  cloudStorageBytes?: number;
}

export interface TeamPushPlan {
  upserts: TeamItemUpsert[];
  deletes: string[];
}

/** Stable content signature — everything except `order`, which is rank state. */
export function itemFingerprint(item: ShelfItemRecord): string {
  const { order: _order, ...rest } = item;
  return JSON.stringify(rest);
}

/** Sort server docs by rank (code-unit), the same comparison the server uses. */
export function sortRemoteDocs(docs: RemoteTeamItemDoc[]): RemoteTeamItemDoc[] {
  return [...docs].sort((a, b) => compareRanks(a.order, b.order));
}

/**
 * Convert server docs to local items (order 0..n-1).
 *
 * File-backed items arrive metadata-only: paths from another member's
 * machine are meaningless (and unsafe to trust) here, so they are
 * stripped and flagged missing — the same rule `sanitizeRemoteFileRefs`
 * applies to personal cloud shelves. Docs whose payload cannot produce a
 * valid local item (e.g. malformed URL) are dropped rather than failing
 * the whole shelf.
 */
export function remoteToLocalItems(docs: RemoteTeamItemDoc[]): ShelfItemRecord[] {
  const items: ShelfItemRecord[] = [];
  for (const doc of sortRemoteDocs(docs)) {
    const base = {
      id: doc.itemId,
      createdAt: new Date(doc._creationTime).toISOString(),
      order: items.length,
      title: doc.title,
      subtitle: doc.subtitle,
      preview: doc.preview,
      createdByUser: doc.createdByUser,
    };
    const candidate = ((): ShelfItemRecord | null => {
      const missingFile = {
        originalPath: '',
        resolvedPath: '',
        bookmarkBase64: '',
        isStale: true,
        isMissing: true,
      };
      switch (doc.kind) {
        case 'text':
          return { ...base, kind: 'text', text: doc.text ?? '' };
        case 'url':
          return { ...base, kind: 'url', url: doc.url ?? '' };
        case 'color':
          return { ...base, kind: 'color', hex: doc.hex ?? '#000000' };
        case 'code':
          return { ...base, kind: 'code', text: doc.codeText ?? '', language: doc.language };
        case 'file':
          return {
            ...base,
            kind: 'file',
            file: missingFile,
            mimeType: doc.mimeType ?? 'application/octet-stream',
          };
        case 'folder':
          return { ...base, kind: 'folder', file: missingFile };
        case 'imageAsset':
          return {
            ...base,
            kind: 'imageAsset',
            file: missingFile,
            mimeType: doc.mimeType ?? 'image/png',
          };
      }
    })();

    // The local schema validates URL format and color shape; a malformed
    // server row must not take down the whole mirror write.
    const parsed = shelfItemSchema.safeParse(candidate);
    if (parsed.success) {
      items.push(parsed.data);
    }
  }
  return items;
}

/** Remembered state after seeing a server snapshot (echo suppression). */
export function syncedFromRemote(docs: RemoteTeamItemDoc[]): SyncedMap {
  const synced = new Map<string, SyncedItemInfo>();
  for (const doc of docs) {
    const local = remoteToLocalItems([doc]);
    if (local.length === 0) {
      continue;
    }
    synced.set(doc.itemId, {
      rank: doc.order,
      version: doc.version,
      fingerprint: itemFingerprint(local[0]),
    });
  }
  return synced;
}

/**
 * Decide what to push for a local sequence, given the server snapshot and
 * what we last knew about it.
 *
 * Rank assignment is two-pass:
 *  1. Greedily KEEP unchanged items whose existing rank still fits the
 *     ascending sequence (their position hasn't moved).
 *  2. Every kept item is an anchor; changed/new items get fresh ranks
 *     distributed between the surrounding anchors via fractional keys.
 * By construction the final rank sequence is strictly increasing, so a
 * local reorder re-ranks only the moved items plus those squeezed
 * between anchors — concurrent remote inserts elsewhere are untouched.
 */
export function buildTeamPushPlan(
  localItems: ShelfItemRecord[],
  remoteDocs: RemoteTeamItemDoc[],
  lastSynced: SyncedMap,
): TeamPushPlan {
  const remoteByItemId = new Map(remoteDocs.map((doc) => [doc.itemId, doc]));

  // Pass 1: items whose server state matches local content are KEEP
  // candidates. Only the longest ascending candidate subsequence is kept
  // (LIS by rank), so a moved item costs one re-rank instead of
  // re-ranking everything after it.
  const candidateRanks: Array<Rank | null> = localItems.map((item) => {
    const remote = remoteByItemId.get(item.id);
    const last = lastSynced.get(item.id);
    if (!remote || !last) {
      return null;
    }
    const unchanged =
      last.version === remote.version &&
      last.rank === remote.order &&
      last.fingerprint === itemFingerprint(item);
    return unchanged ? remote.order : null;
  });
  const keptRanks = keepLongestAscending(candidateRanks);

  // Pass 2: distribute fresh ranks between anchors for everything else.
  const nextAnchorAfter = (end: number): Rank | null => {
    for (let i = end; i < localItems.length; i++) {
      const rank = keptRanks[i];
      if (rank !== null) {
        return rank;
      }
    }
    return null;
  };

  const upserts: TeamItemUpsert[] = [];
  let prevRank: Rank | null = null;
  let i = 0;
  while (i < localItems.length) {
    if (keptRanks[i] !== null) {
      prevRank = keptRanks[i];
      i++;
      continue;
    }
    // Collect the whole run of consecutive non-anchor items.
    let runEnd = i;
    while (runEnd < localItems.length && keptRanks[runEnd] === null) {
      runEnd++;
    }
    const nextAnchor = nextAnchorAfter(runEnd);
    const runRanks = ranksBetween(prevRank, nextAnchor, runEnd - i);
    for (let j = i; j < runEnd; j++) {
      upserts.push(toUpsert(localItems[j], runRanks[j - i], remoteByItemId.get(localItems[j].id)));
    }
    prevRank = runRanks[runRanks.length - 1] ?? prevRank;
    i = runEnd;
  }

  const localIds = new Set(localItems.map((item) => item.id));
  const deletes = [...lastSynced.keys()].filter((id) => !localIds.has(id));

  return { upserts, deletes };
}

/**
 * Longest strictly-ascending subsequence of `ranks` (null entries are
 * never keepable). Returns, per index, the rank to keep or null.
 * Patience-sorting LIS, O(n log n).
 */
function keepLongestAscending(ranks: Array<Rank | null>): Array<Rank | null> {
  const keepIndex = new Array<boolean>(ranks.length).fill(false);
  const tails: number[] = [];
  const prev = new Array<number>(ranks.length).fill(-1);

  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i];
    if (rank === null) {
      continue;
    }
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareRanks(ranks[tails[mid]]!, rank) < 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      prev[i] = tails[lo - 1];
    }
    if (lo === tails.length) {
      tails.push(i);
    } else {
      tails[lo] = i;
    }
  }

  let idx = tails[tails.length - 1];
  while (idx !== undefined && idx !== -1) {
    keepIndex[idx] = true;
    idx = prev[idx];
  }

  return ranks.map((rank, i) => (keepIndex[i] ? rank : null));
}

function toUpsert(
  item: ShelfItemRecord,
  order: Rank,
  remote: RemoteTeamItemDoc | undefined,
): TeamItemUpsert {
  const upsert: TeamItemUpsert = {
    itemId: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    preview: item.preview,
    order,
    version: (remote?.version ?? 0) + 1,
    serverUpdatedAt: Date.now(),
  };

  switch (item.kind) {
    case 'text':
      upsert.text = item.text;
      upsert.savedFilePath = item.savedFilePath;
      break;
    case 'url':
      upsert.url = item.url;
      upsert.savedFilePath = item.savedFilePath;
      break;
    case 'color':
      upsert.hex = item.hex;
      upsert.name = item.name;
      break;
    case 'code':
      upsert.codeText = item.text;
      upsert.language = item.language;
      break;
    case 'file':
    case 'folder':
    case 'imageAsset':
      // The macOS bookmark is a local-only secret — never leaves the device.
      upsert.file = {
        originalPath: item.file.originalPath,
        resolvedPath: item.file.resolvedPath,
        isStale: item.file.isStale,
        isMissing: item.file.isMissing,
      };
      if (item.kind !== 'folder') {
        upsert.mimeType = item.mimeType;
      }
      break;
  }
  return upsert;
}

/** Serializes mutations so server-side LWW sees a consistent local order. */
export class MutationQueue {
  private chain = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
