import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { AppState } from '@shared/schema';
import { shallowEqual } from './shallowEqual';

export interface UseLedgeStateResult<T> {
  state: T | null;
  error: string;
  fullState: AppState | null;
}

interface StoreSnapshot {
  fullState: AppState | null;
  error: string;
}

class LedgeStateStore {
  private snapshot: StoreSnapshot = { fullState: null, error: '' };
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private initialized = false;
  private lastLedge: any = null;

  private init() {
    if (this.initialized && window.ledge === this.lastLedge) return;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.initialized = true;
    this.lastLedge = window.ledge;
    if (!this.snapshot.fullState) {
      this.snapshot = { fullState: null, error: '' };
    }

    if (!window.ledge) {
      this.snapshot = {
        fullState: null,
        error: 'The Electron preload bridge did not load. Restart the app after rebuilding the preload script.',
      };
      this.emit();
      return;
    }

    if (typeof window.ledge.getState === 'function') {
      window.ledge
        .getState()
        .then((nextState) => {
          this.snapshot = { fullState: nextState, error: '' };
          this.emit();
        })
        .catch((reason: unknown) => {
          this.snapshot = {
            fullState: null,
            error: reason instanceof Error ? reason.message : 'Failed to fetch app state from the main process.',
          };
          this.emit();
        });
    } else {
      this.snapshot = {
        fullState: {
          liveShelf: null,
          recentShelves: [],
          preferences: {
            hasCompletedOnboarding: true,
            shelfInteraction: { autoCloseShelf: false, doubleClickAction: 'open' },
            shakeEnabled: false,
          },
          sync: { plan: 'free', signedInEmail: null },
          permissionStatus: { nativeHelperAvailable: false, accessibilityTrusted: false, lastError: null },
          clipboardHistory: [],
          clipboardCategories: [],
          clipboardSettings: { enabled: true },
        } as unknown as AppState,
        error: '',
      };
      this.emit();
    }

    this.unsubscribe = window.ledge.subscribeState((nextState) => {
      this.snapshot = { fullState: nextState, error: '' };
      this.emit();
    });
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe = (listener: () => void) => {
    this.init();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        if (this.unsubscribe) {
          this.unsubscribe();
          this.unsubscribe = null;
        }
        this.initialized = false;
      }
    };
  };

  getSnapshot = () => {
    return this.snapshot;
  };
}

const store = new LedgeStateStore();

export function useLedgeState<T = AppState>(
  selector?: (state: AppState) => T,
  equalityFn: (a: T, b: T) => boolean = shallowEqual,
): UseLedgeStateResult<T> {
  const readFullStateRef = useRef(false);
  const accessedFullStateRef = useRef(false);
  const lastCombinedRef = useRef<UseLedgeStateResult<T> | null>(null);
  const lastFullStateRef = useRef<AppState | null>(null);
  const lastErrorRef = useRef<string>('');

  const getSelectionCombined = useCallback(() => {
    const { fullState, error } = store.getSnapshot();

    const prev = lastCombinedRef.current;
    if (prev) {
      if (lastFullStateRef.current === fullState && lastErrorRef.current === error) {
        return prev;
      }

      const nextState = fullState ? (selector ? selector(fullState) : (fullState as unknown as T)) : null;
      const stateEqual = prev.state === nextState || (prev.state !== null && nextState !== null && equalityFn(prev.state, nextState));
      const errorEqual = prev.error === error;
      const fullStateEqual = !readFullStateRef.current || lastFullStateRef.current === fullState;

      if (stateEqual && errorEqual && fullStateEqual) {
        lastFullStateRef.current = fullState;
        lastErrorRef.current = error;
        return prev;
      }
    }

    const nextState = fullState ? (selector ? selector(fullState) : (fullState as unknown as T)) : null;
    const nextCombined = {
      state: nextState,
      error,
      get fullState() {
        accessedFullStateRef.current = true;
        return fullState;
      }
    };
    lastCombinedRef.current = nextCombined;
    lastFullStateRef.current = fullState;
    lastErrorRef.current = error;
    return nextCombined;
  }, [selector, equalityFn]);

  // Update the read ref for this render pass (based on previous render's access)
  readFullStateRef.current = accessedFullStateRef.current;
  // Reset accessed flag for the current render pass
  accessedFullStateRef.current = false;

  return useSyncExternalStore(store.subscribe, getSelectionCombined);
}
