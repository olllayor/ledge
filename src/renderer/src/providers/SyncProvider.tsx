import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAction, useMutation, useQuery, useConvex } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { ShelfRecord, SyncState } from '@shared/schema';
import { estimateImportedImageStorageBytes, serializeShelfForCloud } from '@shared/sync';

interface SyncContextValue {
  configured: boolean;
  sessionToken: string;
  email: string;
  overview: SyncOverview | null;
  sessionDaysRemaining: number | null;
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  refreshSession(): Promise<void>;
  loadBackfillCandidates(): Promise<ShelfRecord[]>;
  syncSelectedShelves(shelfIds: string[]): Promise<void>;
  refreshEntitlements(input: { licenseKey?: string; orderId?: string }): Promise<void>;
}

interface SyncOverview {
  plan: 'free' | 'pro';
  deviceCount: number;
  deviceLimit: number;
  syncedShelfCount: number;
  shelfLimit: number;
  storageBytesUsed: number;
  storageBytesLimit: number;
}

interface RemoteShelf {
  shelfId: string;
  name: string;
  color: ShelfRecord['color'];
  origin: ShelfRecord['origin'];
  items: ShelfRecord['items'];
  localCreatedAt: string;
  localUpdatedAt: string;
  /** Set when the shelf was deleted (possibly on another device). */
  deletedAt?: number;
}

const SESSION_KEY = 'ledge.sync.sessionToken';
const EMAIL_KEY = 'ledge.sync.email';
const DEBOUNCE_MS = 500;
const SYNC_STATE_DEBOUNCE_MS = 300;

const noop = async () => {};

/** Marks a remembered tombstone in the last-applied bookkeeping map. */
const tombstoneKey = (deletedAt: number) => `deleted:${deletedAt}`;

const SyncContext = createContext<SyncContextValue>({
  configured: false,
  sessionToken: '',
  email: '',
  overview: null,
  sessionDaysRemaining: null,
  requestOtp: noop,
  verifyOtp: noop,
  signOut: noop,
  refreshSession: noop,
  loadBackfillCandidates: async () => [],
  syncSelectedShelves: noop,
  refreshEntitlements: noop,
});

export function useSync() {
  return useContext(SyncContext);
}

class MutationQueue {
  private chain = Promise.resolve();

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.chain = this.chain.then(
      () => fn().then(resolve, reject),
      () => fn().then(resolve, reject),
    );

    return promise;
  }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  // The session token is a long-lived bearer credential, so it is held in
  // the main process encrypted via the OS keychain (see SecureSessionStore)
  // rather than in renderer localStorage. It loads asynchronously on mount,
  // so both start empty and Convex queries stay 'skip' until it arrives.
  const [sessionToken, setSessionToken] = useState('');
  const [email, setEmail] = useState('');
  // False until the mount-time keychain load (and its validation) has
  // finished; gates effects that would otherwise broadcast a spurious
  // signed-out state while the real session is still being adopted.
  const [sessionResolved, setSessionResolved] = useState(false);
  const [localState, setLocalState] = useState<Awaited<ReturnType<typeof window.ledge.getState>> | null>(null);
  // Map of remote shelfId -> last applied localUpdatedAt, so we apply each
  // remote shelf exactly once per change rather than only ever syncing the
  // first entry returned by the query.
  const [lastAppliedRemoteByShelf, setLastAppliedRemoteByShelf] = useState<Record<string, string>>({});
  const lastPushedShelfUpdatedAt = useRef('');
  const lastPushedPreferences = useRef('');
  const queueRef = useRef(new MutationQueue());
  const shelfDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncStateRef = useRef('');
  const pendingShelfRef = useRef<{ shelf: NonNullable<NonNullable<typeof localState>['liveShelf']>; updatedAt: string } | null>(null);
  // Snapshot of shelf ids present locally, so we can detect when a shelf is
  // permanently discarded on this device (evicted from Recents or cleared)
  // and reclaim its cloud row. `null` until the first observation so a
  // fresh launch never mistakes "not loaded yet" for "deleted".
  const knownLocalShelfIdsRef = useRef<Set<string> | null>(null);

  const overview = useQuery(api.sync.overview, sessionToken ? { sessionToken } : 'skip') as SyncOverview | undefined;
  const remoteShelves = useQuery(api.sync.listShelves, sessionToken ? { sessionToken } : 'skip') as
    | RemoteShelf[]
    | undefined;
  const sessionInfo = useQuery(api.auth.me, sessionToken ? { sessionToken } : 'skip') as
    | { sessionDaysRemaining: number }
    | undefined
    | null;
  const requestOtpAction = useAction(api.auth.requestOtp);
  const verifyOtpMutation = useMutation(api.auth.verifyOtp);
  const signOutMutation = useMutation(api.auth.signOut);
  const refreshSessionMutation = useMutation(api.auth.refreshSession);
  const registerDeviceMutation = useMutation(api.sync.registerDevice);
  const upsertShelfMutation = useMutation(api.sync.upsertShelf);
  const deleteShelfMutation = useMutation(api.sync.deleteShelf);
  const patchPreferencesMutation = useMutation(api.sync.patchPreferences);
  const refreshEntitlementsAction = useAction(api.billing.refreshEntitlements);

  const sessionDaysRemaining = sessionInfo ? sessionInfo.sessionDaysRemaining : null;

  // Debounced setSyncState: avoids flooding the main process with
  // identical patches on every localState tick (which fires on every
  // broadcastState). The JSON fingerprint skips the IPC when nothing
  // changed.
  const debouncedSetSyncState = useCallback((patch: Record<string, unknown>) => {
    const fingerprint = JSON.stringify(patch);
    if (lastSyncStateRef.current === fingerprint) return;
    lastSyncStateRef.current = fingerprint;
    if (syncStateTimerRef.current) clearTimeout(syncStateTimerRef.current);
    syncStateTimerRef.current = setTimeout(() => {
      syncStateTimerRef.current = null;
      void window.ledge.setSyncState(patch);
    }, SYNC_STATE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    void window.ledge.getState().then(setLocalState);
    return window.ledge.subscribeState(setLocalState);
  }, []);

  // ── Session adoption & watchdog ──
  // A keychain token can be rejected by the backend long after the UI last
  // saw it (revoked by a sign-out in another window or a packaged build
  // sharing the credential store, expired, or replaced). A session-scoped
  // `useQuery` THROWS that rejection into render, and the providers render
  // above every view-level ErrorBoundary — so an unverified token can
  // blank the whole window. Tokens therefore only reach `useQuery` after a
  // promise-based validation round-trip; a rejected token heals from the
  // keychain (another process may hold a fresher one) or drops to the
  // honest signed-out state.
  const convexClient = useConvex();
  const adoptingRef = useRef(false);

  const adoptSession = useCallback(
    async (token: string, tokenEmail: string) => {
      if (adoptingRef.current) return;
      adoptingRef.current = true;
      try {
        await convexClient.query(api.auth.me, { sessionToken: token });
        setSessionToken(token);
        setEmail(tokenEmail);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!message.includes('Authentication required')) {
          // Network/redeploy noise — keep whatever session we already hold.
          return;
        }
        // Heal: the keychain may hold a fresher token written by another
        // window (or a packaged build) that signed in after this copy
        // went stale.
        const stored = await window.ledge.getSyncSession();
        if (stored.sessionToken && stored.sessionToken !== token) {
          try {
            await convexClient.query(api.auth.me, { sessionToken: stored.sessionToken });
            setSessionToken(stored.sessionToken);
            setEmail(stored.email);
            return;
          } catch {
            // The keychain copy is dead too — fall through to sign-out.
          }
        }
        await window.ledge.clearSyncSession();
        setSessionToken('');
        setEmail('');
        await window.ledge.setSyncState({
          enabled: false,
          status: 'signedOut',
          signedInEmail: undefined,
        });
        window.ledge.showToast('Session expired — please sign in again.', 'info');
      } finally {
        adoptingRef.current = false;
      }
    },
    [convexClient],
  );

  // Load the encrypted session from the main process on mount, migrating
  // any legacy plaintext token that older builds wrote to localStorage.
  // `sessionResolved` stays false until the load (and its validation)
  // finishes so a cold boot never broadcasts a spurious signed-out state
  // to the other windows.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await window.ledge.getSyncSession();
      let { sessionToken: token, email: storedEmail } = stored;

      const legacyToken = localStorage.getItem(SESSION_KEY);
      const legacyEmail = localStorage.getItem(EMAIL_KEY);
      if (!token && legacyToken) {
        token = legacyToken;
        storedEmail = legacyEmail ?? '';
        await window.ledge.setSyncSession({ sessionToken: token, email: storedEmail });
      }
      // Always purge the plaintext copy once migration is handled.
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(EMAIL_KEY);

      if (!cancelled && token) {
        await adoptSession(token, storedEmail);
      }
      if (!cancelled) {
        setSessionResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adoptSession]);

  // Revalidate whenever the window regains focus — catches tokens revoked
  // or replaced while this window was in the background.
  useEffect(() => {
    const onFocus = () => {
      if (sessionToken) void adoptSession(sessionToken, email);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [sessionToken, email, adoptSession]);

  // Converge across windows: the main-process state broadcast reports
  // sign-ins/sign-outs performed in other windows. When it disagrees with
  // the locally held session, re-read the keychain and adopt the newer
  // credential — or drop a token that another window just revoked, before
  // the backend refetch throws into render.
  useEffect(() => {
    if (!sessionResolved || !localState?.sync) return;
    const mainEmail = localState.sync.signedInEmail;
    if (mainEmail === email) return;
    if (!mainEmail && !sessionToken) return;
    void (async () => {
      const stored = await window.ledge.getSyncSession();
      if (stored.sessionToken && stored.sessionToken !== sessionToken) {
        await adoptSession(stored.sessionToken, stored.email);
      } else if (!mainEmail) {
        setSessionToken('');
        setEmail('');
      }
    })();
  }, [localState?.sync, email, sessionToken, sessionResolved, adoptSession]);

  useEffect(() => {
    if (!sessionResolved) return;
    if (!sessionToken) {
      void window.ledge.setSyncState({ enabled: false, status: 'signedOut', signedInEmail: undefined });
      return;
    }

    if (!overview) {
      debouncedSetSyncState({ enabled: true, status: 'syncing', signedInEmail: email });
      return;
    }

    const patch: Partial<SyncState> = {
      enabled: true,
      status: 'synced',
      signedInEmail: email,
      plan: overview.plan,
      deviceCount: overview.deviceCount,
      syncedShelfCount: overview.syncedShelfCount,
      storageBytesUsed: overview.storageBytesUsed,
      lastSyncedAt: new Date().toISOString(),
      lastError: '',
    };
    debouncedSetSyncState(patch);
  }, [email, overview, sessionToken, sessionResolved, debouncedSetSyncState]);

  useEffect(() => {
    if (!sessionToken || !localState?.sync.deviceId) {
      return;
    }

    queueRef.current.enqueue(() =>
      registerDeviceMutation({
        sessionToken,
        deviceId: localState.sync.deviceId,
        name: navigator.userAgent.includes('Mac') ? 'Mac' : 'Desktop',
        platform: navigator.platform || 'desktop',
      }).catch((error: unknown) => {
        // Only a genuine quota response is a quota state. Mapping every
        // failure here made plain outages look like "upgrade your plan".
        const message = error instanceof Error ? error.message : String(error);
        const isQuota = /device.*limit|limit reached/i.test(message);
        debouncedSetSyncState({
          status: isQuota ? 'quotaReached' : 'error',
          lastError: message || (isQuota ? 'Device sync limit reached.' : 'Device registration failed.'),
        });
      }),
    );
  }, [localState?.sync.deviceId, registerDeviceMutation, sessionToken, debouncedSetSyncState]);

  // Session renewal heartbeat. Without this, sessions hard-expire after
  // 90 days and every device signs out at once. The server enforces its
  // own minimum refresh interval and maximum lifetime by throwing; those
  // failures are expected control flow, not errors — the overview query
  // keeps the UI honest about actual expiry.
  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    const DAY_MS = 24 * 60 * 60 * 1000;
    const timer = window.setInterval(() => {
      refreshSessionMutation({ sessionToken }).catch(() => undefined);
    }, DAY_MS);
    return () => window.clearInterval(timer);
  }, [sessionToken, refreshSessionMutation]);

  // Reclaim cloud storage for shelves discarded on this device. A shelf
  // that leaves the local set (Recents eviction, clear, or close) is
  // deleted from Convex; if another device still has it, that device's
  // next upsert re-creates it, so the delete only sticks when nothing
  // references the shelf anymore.
  useEffect(() => {
    if (!localState) {
      return;
    }
    const currentIds = new Set<string>();
    if (localState.liveShelf) {
      currentIds.add(localState.liveShelf.id);
    }
    for (const shelf of localState.recentShelves) {
      currentIds.add(shelf.id);
    }

    const previousIds = knownLocalShelfIdsRef.current;
    knownLocalShelfIdsRef.current = currentIds;
    if (!previousIds || !sessionToken) {
      return;
    }

    for (const id of previousIds) {
      if (!currentIds.has(id)) {
        queueRef.current.enqueue(() =>
          deleteShelfMutation({ sessionToken, shelfId: id }).catch(() => {
            // Best-effort reclamation; a failed delete simply leaves the
            // row to be retried on a future discard or reconciliation.
          }),
        );
      }
    }
  }, [localState, sessionToken, deleteShelfMutation]);

  const pushPendingShelf = useCallback(() => {
    const pending = pendingShelfRef.current;
    if (!pending || !sessionToken) {
      return;
    }

    pendingShelfRef.current = null;
    lastPushedShelfUpdatedAt.current = pending.updatedAt;

    const cloudShelf = serializeShelfForCloud(pending.shelf);
    queueRef.current.enqueue(() =>
      upsertShelfMutation({
        sessionToken,
        shelfId: cloudShelf.id,
        name: cloudShelf.name,
        color: cloudShelf.color,
        origin: cloudShelf.origin,
        items: cloudShelf.items,
        localCreatedAt: cloudShelf.createdAt,
        localUpdatedAt: cloudShelf.updatedAt,
        imageStorageBytes: estimateImportedImageStorageBytes([pending.shelf]),
      }).catch((error: unknown) => {
        lastPushedShelfUpdatedAt.current = '';
        debouncedSetSyncState({
          status: 'error',
          lastError: error instanceof Error ? error.message : 'Failed to sync shelf changes.',
        });
      }),
    );
  }, [sessionToken, upsertShelfMutation, debouncedSetSyncState]);

  const pushPreferences = useCallback(() => {
    if (!localState?.preferences || !sessionToken) {
      return;
    }

    if (overview?.plan !== 'pro') {
      return;
    }

    const serialized = JSON.stringify(localState.preferences);
    if (lastPushedPreferences.current === serialized) {
      return;
    }

    lastPushedPreferences.current = serialized;
    queueRef.current.enqueue(() =>
      patchPreferencesMutation({ sessionToken, values: localState.preferences! }).catch((error: unknown) => {
        lastPushedPreferences.current = '';
        const message = error instanceof Error ? error.message : '';
        if (message.includes('Pro')) {
          window.ledge.showToast(
            'Preferences sync is a Pro feature. Upgrade in Preferences → Ledge Pro.',
            'info',
          );
        }
      }),
    );
  }, [localState?.preferences, overview?.plan, patchPreferencesMutation, sessionToken]);

  useEffect(() => {
    if (!sessionToken || !localState?.liveShelf || !remoteShelves) {
      return;
    }

    const remote = remoteShelves.find((shelf) => shelf.shelfId === localState.liveShelf?.id);
    if (!remote || Date.parse(localState.liveShelf.updatedAt) <= Date.parse(remote.localUpdatedAt)) {
      return;
    }

    if (lastPushedShelfUpdatedAt.current === localState.liveShelf.updatedAt) {
      return;
    }

    if (shelfDebounceTimerRef.current) {
      clearTimeout(shelfDebounceTimerRef.current);
    }

    pendingShelfRef.current = { shelf: localState.liveShelf, updatedAt: localState.liveShelf.updatedAt };
    shelfDebounceTimerRef.current = setTimeout(() => {
      shelfDebounceTimerRef.current = null;
      pushPendingShelf();
    }, DEBOUNCE_MS);
  }, [localState?.liveShelf, remoteShelves, sessionToken, pushPendingShelf]);

  useEffect(() => {
    if (!sessionToken || !remoteShelves || remoteShelves.length === 0) {
      return;
    }

    // Debounce reconciliation to avoid firing on every Convex subscription
    // tick — remoteShelves can update frequently when other devices push.
    const timer = setTimeout(() => {
      void (async () => {
        let updated: Record<string, string> | null = null;
        // Watermarks must only advance after the IPC call actually
        // resolves — a failed apply (e.g. Zod reject on malformed remote
        // items) would otherwise mark the snapshot as seen forever and
        // it would never be re-applied.
        const jobs: Array<Promise<void>> = [];
        for (const remote of remoteShelves) {
          // Tombstones are remembered under a sentinel so the deletion is
          // processed exactly once per timestamp.
          const seen = lastAppliedRemoteByShelf[remote.shelfId];
          if (seen === remote.localUpdatedAt) {
            continue;
          }
          if (remote.deletedAt && seen === tombstoneKey(remote.deletedAt)) {
            continue;
          }

          if (remote.deletedAt) {
            const deletedAt = remote.deletedAt;
            // Tombstone: the shelf was deleted (possibly on another device).
            // Drop every local copy instead of applying the snapshot.
            jobs.push(
              window.ledge
                .removeSyncedShelf(remote.shelfId)
                .then(() => {
                  updated ??= { ...lastAppliedRemoteByShelf };
                  updated[remote.shelfId] = tombstoneKey(deletedAt);
                })
                .catch((error: unknown) => {
                  console.error('[sync] failed to remove synced shelf', remote.shelfId, error);
                }),
            );
            continue;
          }

          // A local push for this shelf is debounced/in-flight. Applying an
          // older snapshot now could clobber the unpushed local edit; skip
          // and let the next subscription tick (which fires after the push)
          // re-evaluate. Not marking as seen keeps the retry alive.
          const pending = pendingShelfRef.current;
          if (pending && pending.shelf.id === remote.shelfId) {
            continue;
          }

          const payload = {
            id: remote.shelfId,
            name: remote.name,
            color: remote.color,
            createdAt: remote.localCreatedAt,
            updatedAt: remote.localUpdatedAt,
            origin: remote.origin,
            items: remote.items,
          };
          jobs.push(
            window.ledge
              .applyRemoteShelf(payload)
              .then(() => {
                updated ??= { ...lastAppliedRemoteByShelf };
                updated[remote.shelfId] = remote.localUpdatedAt;
              })
              .catch((error: unknown) => {
                console.error('[sync] failed to apply remote shelf', remote.shelfId, error);
              }),
          );
        }
        await Promise.all(jobs);
        if (updated) {
          setLastAppliedRemoteByShelf(updated);
        }
      })();
    }, SYNC_STATE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [lastAppliedRemoteByShelf, remoteShelves, sessionToken]);

  useEffect(() => {
    if (!sessionToken || !localState?.preferences) {
      return;
    }

    const serialized = JSON.stringify(localState.preferences);
    if (lastPushedPreferences.current === serialized) {
      return;
    }

    if (prefDebounceTimerRef.current) {
      clearTimeout(prefDebounceTimerRef.current);
    }

    prefDebounceTimerRef.current = setTimeout(() => {
      prefDebounceTimerRef.current = null;
      pushPreferences();
    }, DEBOUNCE_MS);
  }, [localState?.preferences, sessionToken, pushPreferences]);

  useEffect(() => {
    return () => {
      if (syncStateTimerRef.current) {
        clearTimeout(syncStateTimerRef.current);
      }
      if (shelfDebounceTimerRef.current) {
        clearTimeout(shelfDebounceTimerRef.current);
        pushPendingShelf();
      }
      if (prefDebounceTimerRef.current) {
        clearTimeout(prefDebounceTimerRef.current);
        pushPreferences();
      }
    };
  }, [pushPendingShelf, pushPreferences]);

  const hasSeenShelfLimitMigration = localState?.preferences?.hasSeenShelfLimitMigration ?? true;

  useEffect(() => {
    if (!sessionToken || !overview) {
      return;
    }

    if (overview.plan !== 'free') {
      return;
    }

    if (hasSeenShelfLimitMigration) {
      return;
    }

    window.ledge.showToast(
      "We've increased your free limit to 100 shelves.",
      'info',
    );
    void window.ledge.setPreferences({ hasSeenShelfLimitMigration: true });
  }, [overview, hasSeenShelfLimitMigration, sessionToken]);

  const requestOtp = useCallback(
    async (nextEmail: string) => {
      await requestOtpAction({ email: nextEmail });
    },
    [requestOtpAction],
  );

  const verifyOtp = useCallback(
    async (nextEmail: string, code: string) => {
      const result = await verifyOtpMutation({ email: nextEmail, code });
      // verifyOtp returns `{ ok: false, reason: ... }` for failed
      // attempts (wrong / expired / locked code) and the success
      // shape `{ sessionToken, email }` on a valid code. Match the
      // previous `ConvexError` user-facing message.
      if (!("sessionToken" in result)) {
        throw new Error("Invalid or expired sign-in code.");
      }
      const success = result as { sessionToken: string; email: string };
      await window.ledge.setSyncSession({ sessionToken: success.sessionToken, email: success.email });
      // The token was just minted by the backend, so no validation
      // round-trip is needed — adopt it directly.
      setSessionToken(success.sessionToken);
      setEmail(success.email);
      setSessionResolved(true);
    },
    [verifyOtpMutation],
  );

  const signOut = useCallback(async () => {
    // Clear local state BEFORE revoking server-side: the revoke
    // invalidates `overview`-style subscriptions, and Convex refetches
    // them with the now-dead token — throwing into render if this
    // window is still subscribed. Dropping the token first also makes
    // sign-out work when the token is already dead (the revoke throws,
    // but the keychain and UI still end up clean).
    const token = sessionToken;
    setSessionToken('');
    setEmail('');
    await window.ledge.clearSyncSession();
    await window.ledge.setSyncState({ enabled: false, status: 'signedOut', signedInEmail: undefined });
    if (token) {
      try {
        await signOutMutation({ sessionToken: token });
      } catch {
        // Token already revoked/expired — nothing to do.
      }
    }
  }, [sessionToken, signOutMutation]);

  const refreshSession = useCallback(async () => {
    if (!sessionToken) return;
    await refreshSessionMutation({ sessionToken });
  }, [sessionToken, refreshSessionMutation]);

  const loadBackfillCandidates = useCallback(async () => {
    return await window.ledge.getSyncBackfillCandidates();
  }, []);

  const syncSelectedShelves = useCallback(
    async (shelfIds: string[]) => {
      if (!sessionToken) {
        return;
      }

      const candidates = await window.ledge.getSyncBackfillCandidates();
      const selected = candidates.filter((shelf) => shelfIds.includes(shelf.id));
      await window.ledge.setSyncState({ status: 'syncing', lastError: '' });

      try {
        for (let index = 0; index < selected.length; index += 5) {
          const batch = selected.slice(index, index + 5);
          await Promise.all(
            batch.map((shelf) => {
              const cloudShelf = serializeShelfForCloud(shelf);
              return upsertShelfMutation({
                sessionToken,
                shelfId: cloudShelf.id,
                name: cloudShelf.name,
                color: cloudShelf.color,
                origin: cloudShelf.origin,
                items: cloudShelf.items,
                localCreatedAt: cloudShelf.createdAt,
                localUpdatedAt: cloudShelf.updatedAt,
                imageStorageBytes: estimateImportedImageStorageBytes([shelf]),
              });
            }),
          );
        }

        // Preferences sync is a pro feature server-side; patching as a
        // free user throws after the shelves already synced and (before
        // this guard) reported the whole backfill as failed.
        if (localState && localState.sync.plan === 'pro') {
          await patchPreferencesMutation({ sessionToken, values: localState.preferences });
        }
        await window.ledge.setSyncState({ status: 'synced', lastSyncedAt: new Date().toISOString() });
      } catch (error) {
        // Always settle the status; a mid-batch failure used to leave
        // the UI stuck on "syncing" forever.
        await window.ledge.setSyncState({
          status: 'error',
          lastError: error instanceof Error ? error.message : 'Failed to sync shelves.',
        });
      }
    },
    [localState, patchPreferencesMutation, sessionToken, upsertShelfMutation],
  );

  const refreshEntitlements = useCallback(
    async (input: { licenseKey?: string; orderId?: string }) => {
      if (!sessionToken) {
        return;
      }
      await refreshEntitlementsAction({ sessionToken, ...input });
    },
    [refreshEntitlementsAction, sessionToken],
  );

  const value = useMemo(
    () => ({
      configured: true,
      sessionToken,
      email,
      overview: overview ?? null,
      sessionDaysRemaining,
      requestOtp,
      verifyOtp,
      signOut,
      refreshSession,
      loadBackfillCandidates,
      syncSelectedShelves,
      refreshEntitlements,
    }),
    [
      email,
      loadBackfillCandidates,
      overview,
      refreshEntitlements,
      refreshSession,
      requestOtp,
      sessionDaysRemaining,
      sessionToken,
      signOut,
      syncSelectedShelves,
      verifyOtp,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
