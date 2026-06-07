import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '@shared/schema';

function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

export function useLedgeState<T = AppState>(
  selector?: (state: AppState) => T,
  equalityFn: (a: T, b: T) => boolean = shallowEqual
): { state: T | null; error: string; fullState: AppState | null } {
  const [fullState, setFullState] = useState<AppState | null>(null);
  const [error, setError] = useState<string>('');
  const prevSelectedRef = useRef<T | null>(null);
  const selectedRef = useRef<T | null>(null);

  useEffect(() => {
    if (!window.ledge) {
      setError('The Electron preload bridge did not load. Restart the app after rebuilding the preload script.');
      return;
    }

    let active = true;

    void window.ledge
      .getState()
      .then((nextState) => {
        if (active) {
          startTransition(() => {
            setFullState(nextState);
            setError('');
          });
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Failed to fetch app state from the main process.');
        }
      });

    const unsubscribe = window.ledge.subscribeState((nextState) => {
      if (!active) return;
      startTransition(() => {
        setFullState(nextState);
        setError('');
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const selected = useMemo(() => {
    if (!fullState) return null;
    return selector ? selector(fullState) : (fullState as T);
  }, [fullState, selector]);

  selectedRef.current = selected;

  const shouldUpdate = useMemo(() => {
    if (prevSelectedRef.current === null && selected === null) return false;
    if (prevSelectedRef.current === null || selected === null) return true;
    return !equalityFn(prevSelectedRef.current, selected);
  }, [selected, equalityFn]);

  useEffect(() => {
    if (shouldUpdate) {
      prevSelectedRef.current = selected;
    }
  }, [shouldUpdate, selected]);

  return {
    state: prevSelectedRef.current,
    error,
    fullState,
  };
}
