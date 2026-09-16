import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ShelfRecord, SyncState } from '@shared/schema';
import {
  coerceCloudItemsToLocal,
  estimateImportedImageStorageBytes,
  serializeShelfForCloud,
} from '@shared/sync';
import {
  api,
  isAuthError,
  isCloudConfigured,
  isNetworkError,
  type RemoteShelfDto,
  type SyncOverviewResponse,
} from '../lib/apiClient';

export interface SyncOverview extends SyncOverviewResponse {}

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
  /** Re-pull overview + shelves (focus/online/mutation). */
  refreshCloudState(): Promise<void>;
}

const SESSION_KEY = 'ledge.sync.sessionToken';
const EMAIL_KEY = 'ledge.sync.email';
const DEBOUNCE_MS = 500;
const SYNC_STATE_DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 30_000;

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
  refreshCloudState: noop,
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
  // rather than in renderer localStorage. It loads asynchronously on mount.
  const [sessionToken, setSessionToken] = useState('');
  const [email, setEmail] = useState('');
  // False until the mount-time keychain load (and its validation) has
  // finished; gates effects that would otherwise broadcast a spurious
  // signed-out state while the real session is still being adopted.
  const [sessionResolved, setSessionResolved] = useState(false);
  const [sessionDaysRemaining, setSessionDaysRemaining] = useState<number | null>(null);
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const [remoteShelves, setRemoteShelves] = useState<RemoteShelfDto[] | null>(null);
  const [localState, setLocalState] = useState<Awaited<ReturnType<typeof window.ledge.getState>> | null>(null);
  // Map of remote shelfId -> last applied localUpdatedAt, so we apply each
  // remote shelf exactly once per change rather than only ever syncing the
  // first entry returned by the poll.
  const [lastAppliedRemoteByShelf, setLastAppliedRemoteByShelf] = useState<Record<string, string>>({});
  const lastPushedShelfUpdatedAt = useRef('');
  const lastPushedPreferences = useRef('');
  const queueRef = useRef(new MutationQueue());
  const shelfDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncStateRef = useRef('');
  const pendingShelfRef = useRef<{ shelf: NonNullable<NonNullable<typeof localState>['liveShelf']>; updatedAt: string } | null>(null);
  // Server `updatedAt` cursor for GET /sync/shelves?since=
  const shelvesSinceRef = useRef(0);
  // Guards concurrent refreshCloudState calls (focus + interval + mutation).
  const refreshingRef = useRef(false);

  const configured = isCloudConfigured();

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
  // saw it. Network failures must NOT clear the session — the device may
  // simply be offline. Only an explicit 401/403 (or a heal that also
  // fails auth) drops to signed-out.
  const adoptingRef = useRef(false);

  const clearSessionLocal = useCallback(async () => {
    setSessionToken('');
    setEmail('');
    setSessionDaysRemaining(null);
    setOverview(null);
    setRemoteShelves(null);
    shelvesSinceRef.current = 0;
    await window.ledge.clearSyncSession();
    await window.ledge.setSyncState({
      enabled: false,
      status: 'signedOut',
      signedInEmail: undefined,
    });
  }, []);

  const adoptSession = useCallback(
    async (token: string, tokenEmail: string) => {
      if (adoptingRef.current) return;
      adoptingRef.current = true;
      try {
        try {
          const me = await api.client.me(token);
          setSessionToken(token);
          setEmail(me.email || tokenEmail);
          setSessionDaysRemaining(me.daysRemaining);
          return;
        } catch (error) {
          if (isNetworkError(error)) {
            // Offline: keep the token, stay quiet about signed-out.
            setSessionToken(token);
            setEmail(tokenEmail);
            debouncedSetSyncState({
              enabled: true,
              status: 'offline',
              signedInEmail: tokenEmail,
              lastError: error instanceof Error ? error.message : 'Offline',
            });
            return;
          }
          if (!isAuthError(error)) {
            // Unexpected 5xx / other HTTP noise — keep the session.
            setSessionToken(token);
            setEmail(tokenEmail);
            return;
          }
        }

        // Heal: the keychain may hold a fresher token written by another
        // window that signed in after this copy went stale.
        const stored = await window.ledge.getSyncSession();
        if (stored.sessionToken && stored.sessionToken !== token) {
          try {
            const me = await api.client.me(stored.sessionToken);
            setSessionToken(stored.sessionToken);
            setEmail(me.email || stored.email);
            setSessionDaysRemaining(me.daysRemaining);
            return;
          } catch (healError) {
            if (isNetworkError(healError)) {
              setSessionToken(stored.sessionToken);
              setEmail(stored.email);
              return;
            }
            // The keychain copy is dead too — fall through to sign-out.
          }
        }
        await clearSessionLocal();
        window.ledge.showToast('Session expired — please sign in again.', 'info');
      } finally {
        adoptingRef.current = false;
      }
    },
    [clearSessionLocal, debouncedSetSyncState],
  );

  // Load the encrypted session from the main process on mount, migrating
  // any legacy plaintext token that older builds wrote to localStorage.
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

  // Revalidate whenever the window regains focus or comes back online.
  useEffect(() => {
    const onFocus = () => {
      if (sessionToken) void adoptSession(sessionToken, email);
    };
    const onOnline = () => {
      if (sessionToken) void adoptSession(sessionToken, email);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [sessionToken, email, adoptSession]);

  // Converge across windows: the main-process state broadcast reports
  // sign-ins/sign-outs performed in other windows.
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
        setOverview(null);
        setRemoteShelves(null);
      }
    })();
  }, [localState?.sync, email, sessionToken, sessionResolved, adoptSession]);

  // ── Cloud poll (overview + shelves with since cursor) ──
  const refreshCloudState = useCallback(async () => {
    if (!sessionToken || refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const nextOverview = await api.client.overview(sessionToken);
      setOverview(nextOverview);

      const since = shelvesSinceRef.current;
      const shelves = await api.client.listShelves(sessionToken, since);
      if (shelves.length > 0) {
        // Merge: a since-filtered poll only returns rows that changed.
        setRemoteShelves((prev) => {
          const byId = new Map((prev ?? []).map((shelf) => [shelf.shelfId, shelf]));
          for (const shelf of shelves) {
            byId.set(shelf.shelfId, shelf);
          }
          return [...byId.values()];
        });
        const maxUpdatedAt = shelves.reduce((max, shelf) => Math.max(max, shelf.updatedAt), since);
        shelvesSinceRef.current = maxUpdatedAt;
      } else if (since === 0) {
        setRemoteShelves([]);
      }
    } catch (error) {
      if (isAuthError(error)) {
        await clearSessionLocal();
        window.ledge.showToast('Session expired — please sign in again.', 'info');
        return;
      }
      if (isNetworkError(error)) {
        debouncedSetSyncState({
          status: 'offline',
          lastError: error instanceof Error ? error.message : 'Offline',
        });
        return;
      }
      debouncedSetSyncState({
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Cloud sync failed.',
      });
    } finally {
      refreshingRef.current = false;
    }
  }, [sessionToken, clearSessionLocal, debouncedSetSyncState]);

  useEffect(() => {
    if (!sessionToken) return;
    void refreshCloudState();
    const timer = window.setInterval(() => {
      void refreshCloudState();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [sessionToken, refreshCloudState]);

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
      api.client
        .registerDevice(sessionToken, {
          deviceId: localState.sync.deviceId,
          name: navigator.userAgent.includes('Mac') ? 'Mac' : 'Desktop',
          platform: navigator.platform || 'desktop',
        })
        .catch((error: unknown) => {
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
  }, [localState?.sync.deviceId, sessionToken, debouncedSetSyncState]);

  // Session renewal heartbeat.
  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    const DAY_MS = 24 * 60 * 60 * 1000;
    const timer = window.setInterval(() => {
      api.client.refreshSession(sessionToken).catch(() => undefined);
    }, DAY_MS);
    return () => window.clearInterval(timer);
  }, [sessionToken]);

  // NOTE: Recents eviction must NEVER delete the cloud row. `deleteShelf`
  // is only for an explicit user discard of a synced shelf. Leaving the
  // local recents list is not a delete intent — the shelf may still be
  // live on another device.

  const pushPendingShelf = useCallback(() => {
    const pending = pendingShelfRef.current;
    if (!pending || !sessionToken) {
      return;
    }

    pendingShelfRef.current = null;
    lastPushedShelfUpdatedAt.current = pending.updatedAt;

    const cloudShelf = serializeShelfForCloud(pending.shelf);
    queueRef.current.enqueue(() =>
      api.client
        .upsertShelf(sessionToken, {
          shelfId: cloudShelf.id,
          name: cloudShelf.name,
          color: cloudShelf.color,
          origin: cloudShelf.origin,
          items: cloudShelf.items,
          localCreatedAt: cloudShelf.createdAt,
          localUpdatedAt: cloudShelf.updatedAt,
          imageStorageBytes: estimateImportedImageStorageBytes([pending.shelf]),
        })
        .then(() => {
          void refreshCloudState();
        })
        .catch((error: unknown) => {
          lastPushedShelfUpdatedAt.current = '';
          debouncedSetSyncState({
            status: 'error',
            lastError: error instanceof Error ? error.message : 'Failed to sync shelf changes.',
          });
        }),
    );
  }, [sessionToken, debouncedSetSyncState, refreshCloudState]);

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
      api.client.putPreferences(sessionToken, localState.preferences!).catch((error: unknown) => {
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
  }, [localState?.preferences, overview?.plan, sessionToken]);

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

  // Pull: apply remotes SERIALLY (never Promise.all last-write-wins).
  useEffect(() => {
    if (!sessionToken || !remoteShelves || remoteShelves.length === 0) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        let updated: Record<string, string> | null = null;
        for (const remote of remoteShelves) {
          if (cancelled) return;

          const seen = lastAppliedRemoteByShelf[remote.shelfId];
          if (seen === remote.localUpdatedAt) {
            continue;
          }
          if (remote.deletedAt && seen === tombstoneKey(remote.deletedAt)) {
            continue;
          }

          if (remote.deletedAt) {
            const deletedAt = remote.deletedAt;
            try {
              await window.ledge.removeSyncedShelf(remote.shelfId);
              updated ??= { ...lastAppliedRemoteByShelf };
              updated[remote.shelfId] = tombstoneKey(deletedAt);
            } catch (error) {
              console.error('[sync] failed to remove synced shelf', remote.shelfId, error);
            }
            continue;
          }

          // A local push for this shelf is debounced/in-flight. Applying an
          // older snapshot now could clobber the unpushed local edit.
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
            // Worker strips path fields; rebuild the full FileRef so
            // shelfRecordSchema accepts file-backed shelves (and the UI
            // can offer Relink instead of failing the whole apply).
            items: coerceCloudItemsToLocal(remote.items),
          };
          try {
            await window.ledge.applyRemoteShelf(payload);
            updated ??= { ...lastAppliedRemoteByShelf };
            updated[remote.shelfId] = remote.localUpdatedAt;
          } catch (error) {
            console.error('[sync] failed to apply remote shelf', remote.shelfId, error);
          }
        }
        if (!cancelled && updated) {
          setLastAppliedRemoteByShelf(updated);
        }
      })();
    }, SYNC_STATE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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

  const requestOtp = useCallback(async (nextEmail: string) => {
    await api.client.requestOtp(nextEmail);
  }, []);

  const verifyOtp = useCallback(
    async (nextEmail: string, code: string) => {
      const result = await api.client.verifyOtp(nextEmail, code);
      await window.ledge.setSyncSession({
        sessionToken: result.sessionToken,
        email: result.email,
      });
      // The token was just minted by the backend, so no validation
      // round-trip is needed — adopt it directly.
      setSessionToken(result.sessionToken);
      setEmail(result.email);
      setSessionDaysRemaining(result.daysRemaining);
      setSessionResolved(true);
      shelvesSinceRef.current = 0;
      setRemoteShelves(null);
    },
    [],
  );

  const signOut = useCallback(async () => {
    // Clear local state BEFORE revoking server-side so a dead token
    // still leaves the UI clean.
    const token = sessionToken;
    await clearSessionLocal();
    if (token) {
      try {
        await api.client.signOut(token);
      } catch {
        // Token already revoked/expired — nothing to do.
      }
    }
  }, [sessionToken, clearSessionLocal]);

  const refreshSession = useCallback(async () => {
    if (!sessionToken) return;
    await api.client.refreshSession(sessionToken);
  }, [sessionToken]);

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
              return api.client.upsertShelf(sessionToken, {
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

        // Preferences sync is a pro feature server-side.
        if (localState && localState.sync.plan === 'pro') {
          await api.client.putPreferences(sessionToken, localState.preferences);
        }
        await window.ledge.setSyncState({ status: 'synced', lastSyncedAt: new Date().toISOString() });
        await refreshCloudState();
      } catch (error) {
        // Always settle the status; a mid-batch failure used to leave
        // the UI stuck on "syncing" forever.
        await window.ledge.setSyncState({
          status: 'error',
          lastError: error instanceof Error ? error.message : 'Failed to sync shelves.',
        });
      }
    },
    [localState, sessionToken, refreshCloudState],
  );

  const refreshEntitlements = useCallback(
    async (input: { licenseKey?: string; orderId?: string }) => {
      if (!sessionToken) {
        return;
      }
      await api.client.refreshEntitlements(sessionToken, input);
      await refreshCloudState();
    },
    [sessionToken, refreshCloudState],
  );

  const value = useMemo(
    () => ({
      configured,
      sessionToken,
      email,
      overview,
      sessionDaysRemaining,
      requestOtp,
      verifyOtp,
      signOut,
      refreshSession,
      loadBackfillCandidates,
      syncSelectedShelves,
      refreshEntitlements,
      refreshCloudState,
    }),
    [
      configured,
      email,
      loadBackfillCandidates,
      overview,
      refreshCloudState,
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
