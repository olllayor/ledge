import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { useSync } from './SyncProvider';
import { useTeams } from './TeamsProvider';
import { selectActiveShelf } from '../hooks/selectors';
import { useLedgeState } from '../hooks/useLedgeState';
import {
  buildTeamPushPlan,
  itemFingerprint,
  MutationQueue,
  remoteToLocalItems,
  syncedFromRemote,
  TEAM_SHELF_ID,
  type RemoteTeamItemDoc,
  type SyncedMap,
} from './teamSync';

/**
 * Reconciles the active team's shelf between the main-process state
 * (UI source of truth) and Convex (server source of truth).
 *
 * Two bookkeeping maps break the sync loop:
 *  - `serverInfo`   — last-seen server rank/version per item (push inputs)
 *  - `localBaseline`— local content fingerprints at the last sync point
 *
 * Local is "dirty" when it no longer matches `localBaseline`; dirty
 * shelves PUSH. Clean shelves whose content differs from the server
 * MIRROR the server snapshot down. Remote state is only absorbed into
 * bookkeeping when the local shelf is clean, so a teammate's insert can
 * never be mistaken for a local delete.
 */
export function TeamShelfSyncProvider({ children }: { children: ReactNode }) {
  const { sessionToken } = useSync();
  const { activeTeamId } = useTeams();
  const { state: activeShelf } = useLedgeState(selectActiveShelf);

  const remoteDocs = useQuery(
    api.sync.getTeamShelfItems,
    sessionToken && activeTeamId
      ? { sessionToken, teamId: activeTeamId as Id<'teams'>, shelfId: TEAM_SHELF_ID }
      : 'skip',
  ) as RemoteTeamItemDoc[] | undefined;

  const upsertItem = useMutation(api.sync.upsertShelfItem);
  const deleteItem = useMutation(api.sync.deleteShelfItem);

  const serverInfoRef = useRef<SyncedMap>(new Map());
  const localBaselineRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef(0);
  const queueRef = useRef<MutationQueue | null>(null);
  // Bumped after a push settles so the effect re-runs and can retry or
  // pick up changes that arrived while the push was in flight.
  const [syncTick, setSyncTick] = useState(0);

  // Team context switches are a clean slate: ranks and versions belong
  // to one team's shelf.
  useEffect(() => {
    serverInfoRef.current = new Map();
    localBaselineRef.current = new Map();
    setSyncTick((tick) => tick + 1);
  }, [activeTeamId]);

  useEffect(() => {
    if (!sessionToken || !activeTeamId || remoteDocs === undefined) {
      return;
    }

    const localItems = activeShelf?.items ?? [];
    const localFps = new Map(localItems.map((item) => [item.id, itemFingerprint(item)]));
    const dirty = !mapsEqual(localFps, localBaselineRef.current);

    if (dirty) {
      if (inFlightRef.current > 0) {
        return; // retried on the next tick after the in-flight push settles
      }
      const plan = buildTeamPushPlan(localItems, remoteDocs, serverInfoRef.current);
      // Only delete what local actually removed — server rows the local
      // shelf never held (a teammate's insert) are not ours to delete.
      plan.deletes = plan.deletes.filter((id) => localBaselineRef.current.has(id));
      if (plan.upserts.length === 0 && plan.deletes.length === 0) {
        // Content matches but fingerprints drifted (e.g. mirror applied
        // while dirty); re-baseline without writing.
        localBaselineRef.current = localFps;
        return;
      }
      inFlightRef.current += 1;
      const queue = (queueRef.current ??= new MutationQueue());
      void queue
        .enqueue(async () => {
          for (const itemId of plan.deletes) {
            const info = serverInfoRef.current.get(itemId);
            if (!info) continue; // never made it to the server
            await deleteItem({
              sessionToken,
              teamId: activeTeamId,
              shelfId: TEAM_SHELF_ID,
              itemId,
              version: info.version + 1,
              serverUpdatedAt: Date.now(),
            });
          }
          for (const upsert of plan.upserts) {
            await upsertItem({
              sessionToken,
              teamId: activeTeamId,
              shelfId: TEAM_SHELF_ID,
              ...upsert,
            });
          }
        })
        .then(() => {
          for (const upsert of plan.upserts) {
            serverInfoRef.current.set(upsert.itemId, {
              rank: upsert.order,
              version: upsert.version,
              fingerprint: localFps.get(upsert.itemId) ?? '',
            });
            localBaselineRef.current.set(upsert.itemId, localFps.get(upsert.itemId) ?? '');
          }
          for (const itemId of plan.deletes) {
            serverInfoRef.current.delete(itemId);
            localBaselineRef.current.delete(itemId);
          }
        })
        .catch(() => {
          // Bookkeeping is left untouched on failure, so the shelf stays
          // dirty and the next snapshot/local change retries the push.
        })
        .finally(() => {
          inFlightRef.current -= 1;
          setSyncTick((tick) => tick + 1);
        });
      return;
    }

    // Clean local shelf: the server snapshot is authoritative.
    const remoteItems = remoteToLocalItems(remoteDocs);
    const remoteFps = new Map(remoteItems.map((item) => [item.id, itemFingerprint(item)]));
    if (!mapsEqual(localFps, remoteFps)) {
      void window.ledge
        .applyTeamShelfItems({ teamId: activeTeamId, items: remoteItems })
        .catch(() => undefined);
    }
    localBaselineRef.current = remoteFps;
    serverInfoRef.current = syncedFromRemote(remoteDocs);
  }, [sessionToken, activeTeamId, activeShelf, remoteDocs, syncTick, upsertItem, deleteItem]);

  return <>{children}</>;
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false;
    }
  }
  return true;
}
