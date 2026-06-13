import { useEffect, useState } from 'react';
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
  const [state, setState] = useState<T | null>(null);

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

  // Derive the selected slice from `fullState`. A separate effect keeps
  // the projection logic out of the render path, so a render that
  // doesn't change `fullState` won't redo the projection. The actual
  // projection + reference-preservation lives in `projectAppState` and
  // is unit-tested independently of React.
  useEffect(() => {
    setState((current) => projectAppState(current, fullState, selector, equalityFn));
  }, [fullState, selector, equalityFn]);

  return { state, error, fullState };
}
