import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, isNetworkError } from '../lib/apiClient';
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

const TEAM_SHELF_POLL_MS = 30_000;

/**
 * Reconciles the active team's shelf between the main-process state
 * (UI source of truth) and the Cloudflare Worker (server source of truth).
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

  const [remoteDocs, setRemoteDocs] = useState<RemoteTeamItemDoc[] | null>(null);
  const [remoteTruncated, setRemoteTruncated] = useState(false);

  const serverInfoRef = useRef<SyncedMap>(new Map());
  const localBaselineRef = useRef<Map<string, string>>(new Map());
  const truncatedWarnedRef = useRef(false);
  const inFlightRef = useRef(0);
  // Push-failure bookkeeping: exponential backoff keeps an offline
  // backend from turning every syncTick into an instant retry storm.
  const pushFailuresRef = useRef(0);
  const pushBackoffUntilRef = useRef(0);
  const queueRef = useRef<MutationQueue | null>(null);
  // Bumped after a push settles so the effect re-runs and can retry or
  // pick up changes that arrived while the push was in flight.
  const [syncTick, setSyncTick] = useState(0);
  // Mirrors the current team so settled callbacks can detect that the
  // user switched teams while their push/mirror was in flight.
  const activeTeamIdRef = useRef<string | undefined>(activeTeamId);
  const pollInFlightRef = useRef(false);

  // Team context switches are a clean slate: ranks and versions belong
  // to one team's shelf.
  useEffect(() => {
    activeTeamIdRef.current = activeTeamId;
    serverInfoRef.current = new Map();
    localBaselineRef.current = new Map();
    truncatedWarnedRef.current = false;
    // The new team must not inherit the old team's failure backoff, or a
    // flaky sync on team A silences pushes for team B for up to 30s.
    pushFailuresRef.current = 0;
    pushBackoffUntilRef.current = 0;
    setRemoteDocs(null);
    setRemoteTruncated(false);
    setSyncTick((tick) => tick + 1);
  }, [activeTeamId]);

  // Poll the shared team shelf. Convex's reactive subscription is gone;
  // first-wave refresh is interval + focus + after local mutations.
  useEffect(() => {
    if (!sessionToken || !activeTeamId) {
      setRemoteDocs(null);
      return;
    }

    let cancelled = false;

    const pull = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const snapshot = await api.client.listTeamShelfItems(
          sessionToken,
          activeTeamId,
          TEAM_SHELF_ID,
        );
        if (cancelled || activeTeamIdRef.current !== activeTeamId) return;
        setRemoteDocs(snapshot.items as unknown as RemoteTeamItemDoc[]);
        setRemoteTruncated(snapshot.truncated ?? false);
      } catch (error) {
        if (isNetworkError(error)) {
          return;
        }
        console.error('[team-shelf] pull failed', error);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void pull();
    const timer = window.setInterval(() => {
      void pull();
    }, TEAM_SHELF_POLL_MS);
    const onFocus = () => {
      void pull();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [sessionToken, activeTeamId]);

  useEffect(() => {
    if (!sessionToken || !activeTeamId || remoteDocs === null) {
      return;
    }

    // A truncated server snapshot is not a safe reconcile input: mirroring
    // it down would drop the tail items locally, and delete bookkeeping
    // built on it could target live rows we never saw. Rank assignment is
    // unsafe too — fresh lexoranks could collide with unseen rows beyond
    // the cap. Block the whole reconcile and warn once; this needs a
    // server-side pagination design before very large team shelves work.
    if (remoteTruncated) {
      if (!truncatedWarnedRef.current) {
        truncatedWarnedRef.current = true;
        window.ledge.showToast(
          'This team shelf has too many items to sync reliably. Sync paused.',
          'error',
        );
      }
      return;
    }

    const localItems = activeShelf?.items ?? [];
    const localFps = new Map(localItems.map((item) => [item.id, itemFingerprint(item)]));
    const dirty = !mapsEqual(localFps, localBaselineRef.current);

    if (dirty) {
      if (inFlightRef.current > 0) {
        return; // retried on the next tick after the in-flight push settles
      }
      if (Date.now() < pushBackoffUntilRef.current) {
        return; // backing off after a failed push
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
            await api.client.deleteTeamShelfItem(sessionToken, activeTeamId, itemId, {
              version: info.version + 1,
              serverUpdatedAt: Date.now(),
            });
          }
          for (const upsert of plan.upserts) {
            await api.client.upsertTeamShelfItem(sessionToken, activeTeamId, upsert);
          }
        })
        .then(() => {
          // Team switched while this push was in flight: its results
          // belong to the old team's shelf. Writing old-team itemIds into
          // the fresh maps would make the next reconcile compute phantom
          // deletes against the new team.
          if (activeTeamIdRef.current !== activeTeamId) {
            return;
          }
          pushFailuresRef.current = 0;
          pushBackoffUntilRef.current = 0;
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
          // A failure from the old team's push must not start the new
          // team's backoff clock (the switch effect already reset it).
          if (activeTeamIdRef.current !== activeTeamId) {
            return;
          }
          // Bookkeeping is left untouched on failure, so the shelf stays
          // dirty and a retry happens — after a backoff window that grows
          // with consecutive failures.
          pushFailuresRef.current += 1;
          const failures = pushFailuresRef.current;
          const delay = Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5));
          pushBackoffUntilRef.current = Date.now() + delay;
          // Surface the first failure and then every doubling, not every try.
          if ((failures & (failures - 1)) === 0) {
            window.ledge.showToast('Team sync failed — retrying.', 'error');
          }
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
      // Baselines may only advance once the mirror actually landed:
      // advancing first and swallowing failures turned any mirror write
      // error into a silent edit-loss window.
      inFlightRef.current += 1;
      window.ledge
        .applyTeamShelfItems({ teamId: activeTeamId, items: remoteItems })
        .then(() => {
          if (activeTeamIdRef.current !== activeTeamId) {
            return;
          }
          localBaselineRef.current = remoteFps;
          serverInfoRef.current = syncedFromRemote(remoteDocs);
        })
        .catch(() => {
          pushFailuresRef.current += 1;
        })
        .finally(() => {
          inFlightRef.current -= 1;
          setSyncTick((tick) => tick + 1);
        });
      return;
    }
    localBaselineRef.current = remoteFps;
    serverInfoRef.current = syncedFromRemote(remoteDocs);
  }, [sessionToken, activeTeamId, activeShelf, remoteDocs, remoteTruncated, syncTick]);

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
