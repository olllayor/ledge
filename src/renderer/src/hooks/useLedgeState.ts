import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '@shared/schema';
import { shallowEqual } from './shallowEqual';
import { projectAppState } from './projectAppState';

export interface UseLedgeStateResult<T> {
  state: T | null;
  error: string;
  fullState: AppState | null;
}

export function useLedgeState<T = AppState>(
  selector?: (state: AppState) => T,
  equalityFn: (a: T, b: T) => boolean = shallowEqual,
): UseLedgeStateResult<T> {
  const [fullState, setFullState] = useState<AppState | null>(null);
  const [error, setError] = useState<string>('');
  // Keep the most recently projected slice in a ref so we can
  // return it synchronously during render. The previous
  // implementation drove the slice from a useEffect, which made
  // `state` lag one render behind `fullState` — every push
  // produced a transient render with the old (or null) slice, which
  // surfaced as a brief "loading" flash in the UI.
  const sliceRef = useRef<T | null>(null);
  const [state, setState] = useState<T | null>(null);
  // Synchronize the ref with state immediately so consumers reading
  // `sliceRef.current` from inside the projection see the latest
  // value (e.g. event handlers that close over it).
  sliceRef.current = state;

  // Derive the projected slice during render, not in an effect. When
  // `fullState` changes, the consumer receives the new slice in the
  // same render — there's no intermediate render with the stale
  // value. We compare against the previous slice via the equality
  // function so React bails out of re-rendering the consumer when
  // nothing actually changed. Returning `projected` (not `state`)
  // is the key to closing the one-render lag: `setState` would only
  // take effect on the next render, so to deliver the fresh slice
  // in *this* render we have to hand the value back directly.
  const projected = useMemo(
    () => projectAppState(state, fullState, selector, equalityFn),
    [fullState, selector, equalityFn],
  );
  if (projected !== state) {
    sliceRef.current = projected;
    setState(projected);
  }

  // Fetch the initial state once and subscribe to subsequent updates.
  // The mount-only effect uses a clean-up `active` flag so a re-render
  // in StrictMode (or any future double-invoke) cannot double-listen.
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
          setFullState(nextState);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : 'Failed to fetch app state from the main process.',
          );
        }
      });

    const unsubscribe = window.ledge.subscribeState((nextState) => {
      if (active) {
        setFullState(nextState);
        setError('');
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);


  return { state: projected, error, fullState };
}
