import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { ShelfRecord, SyncState } from '@shared/schema';
import { estimateImportedImageStorageBytes, serializeShelfForCloud } from '@shared/sync';

interface SyncContextValue {
  configured: boolean;
  sessionToken: string;
  email: string;
  overview: SyncOverview | null;
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
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
}

const SESSION_KEY = 'ledge.sync.sessionToken';
const EMAIL_KEY = 'ledge.sync.email';
const DEBOUNCE_MS = 500;

const noop = async () => {};

const SyncContext = createContext<SyncContextValue>({
  configured: false,
  sessionToken: '',
  email: '',
  overview: null,
  requestOtp: noop,
  verifyOtp: noop,
  signOut: noop,
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
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem(SESSION_KEY) ?? '');
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_KEY) ?? '');
  const [localState, setLocalState] = useState<Awaited<ReturnType<typeof window.ledge.getState>> | null>(null);
  const [lastAppliedRemoteUpdatedAt, setLastAppliedRemoteUpdatedAt] = useState('');
  const lastPushedShelfUpdatedAt = useRef('');
  const lastPushedPreferences = useRef('');
  const queueRef = useRef(new MutationQueue());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingShelfRef = useRef<{ shelf: NonNullable<NonNullable<typeof localState>['liveShelf']>; updatedAt: string } | null>(null);

  const overview = useQuery(api.sync.overview, sessionToken ? { sessionToken } : 'skip') as SyncOverview | undefined;
  const remoteShelves = useQuery(api.sync.listShelves, sessionToken ? { sessionToken } : 'skip') as
    | RemoteShelf[]
    | undefined;
  const requestOtpAction = useAction(api.auth.requestOtp);
  const verifyOtpMutation = useMutation(api.auth.verifyOtp);
  const signOutMutation = useMutation(api.auth.signOut);
  const registerDeviceMutation = useMutation(api.sync.registerDevice);
  const upsertShelfMutation = useMutation(api.sync.upsertShelf);
  const patchPreferencesMutation = useMutation(api.sync.patchPreferences);
  const refreshEntitlementsAction = useAction(api.billing.refreshEntitlements);

  useEffect(() => {
    void window.ledge.getState().then(setLocalState);
    return window.ledge.subscribeState(setLocalState);
  }, []);

  useEffect(() => {
    if (!sessionToken) {
      void window.ledge.setSyncState({ enabled: false, status: 'signedOut', signedInEmail: undefined });
      return;
    }

    if (!overview) {
      void window.ledge.setSyncState({ enabled: true, status: 'syncing', signedInEmail: email });
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
    void window.ledge.setSyncState(patch);
  }, [email, overview, sessionToken]);

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
        void window.ledge.setSyncState({
          status: 'quotaReached',
          lastError: error instanceof Error ? error.message : 'Device sync limit reached.',
        });
      }),
    );
  }, [localState?.sync.deviceId, registerDeviceMutation, sessionToken]);

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
        void window.ledge.setSyncState({
          status: 'error',
          lastError: error instanceof Error ? error.message : 'Failed to sync shelf changes.',
        });
      }),
    );
  }, [sessionToken, upsertShelfMutation]);

  const pushPreferences = useCallback(() => {
    if (!localState?.preferences || !sessionToken) {
      return;
    }

    const serialized = JSON.stringify(localState.preferences);
    if (lastPushedPreferences.current === serialized) {
      return;
    }

    lastPushedPreferences.current = serialized;
    queueRef.current.enqueue(() =>
      patchPreferencesMutation({ sessionToken, values: localState.preferences! }).catch(() => {
        lastPushedPreferences.current = '';
      }),
    );
  }, [localState?.preferences, patchPreferencesMutation, sessionToken]);

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

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    pendingShelfRef.current = { shelf: localState.liveShelf, updatedAt: localState.liveShelf.updatedAt };
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      pushPendingShelf();
    }, DEBOUNCE_MS);
  }, [localState?.liveShelf, remoteShelves, sessionToken, pushPendingShelf]);

  useEffect(() => {
    if (!sessionToken || !remoteShelves || remoteShelves.length === 0) {
      return;
    }

    const [remote] = remoteShelves;
    if (!remote || remote.localUpdatedAt === lastAppliedRemoteUpdatedAt) {
      return;
    }

    setLastAppliedRemoteUpdatedAt(remote.localUpdatedAt);
    void window.ledge.applyRemoteShelf({
      id: remote.shelfId,
      name: remote.name,
      color: remote.color,
      createdAt: remote.localCreatedAt,
      updatedAt: remote.localUpdatedAt,
      origin: remote.origin,
      items: remote.items,
    });
  }, [lastAppliedRemoteUpdatedAt, remoteShelves, sessionToken]);

  useEffect(() => {
    if (!sessionToken || !localState?.preferences) {
      return;
    }

    const serialized = JSON.stringify(localState.preferences);
    if (lastPushedPreferences.current === serialized) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      pushPreferences();
    }, DEBOUNCE_MS);
  }, [localState?.preferences, sessionToken, pushPreferences]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        pushPendingShelf();
        pushPreferences();
      }
    };
  }, [pushPendingShelf, pushPreferences]);

  const requestOtp = useCallback(
    async (nextEmail: string) => {
      await requestOtpAction({ email: nextEmail });
    },
    [requestOtpAction],
  );

  const verifyOtp = useCallback(
    async (nextEmail: string, code: string) => {
      const result = await verifyOtpMutation({ email: nextEmail, code });
      localStorage.setItem(SESSION_KEY, result.sessionToken);
      localStorage.setItem(EMAIL_KEY, result.email);
      setSessionToken(result.sessionToken);
      setEmail(result.email);
    },
    [verifyOtpMutation],
  );

  const signOut = useCallback(async () => {
    if (sessionToken) {
      await signOutMutation({ sessionToken });
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setSessionToken('');
    setEmail('');
    await window.ledge.setSyncState({ enabled: false, status: 'signedOut', signedInEmail: undefined });
  }, [sessionToken, signOutMutation]);

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

      if (localState) {
        await patchPreferencesMutation({ sessionToken, values: localState.preferences });
      }
      await window.ledge.setSyncState({ status: 'synced', lastSyncedAt: new Date().toISOString() });
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
      requestOtp,
      verifyOtp,
      signOut,
      loadBackfillCandidates,
      syncSelectedShelves,
      refreshEntitlements,
    }),
    [
      email,
      loadBackfillCandidates,
      overview,
      refreshEntitlements,
      requestOtp,
      sessionToken,
      signOut,
      syncSelectedShelves,
      verifyOtp,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
