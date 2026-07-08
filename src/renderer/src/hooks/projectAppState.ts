import type { AppState } from '@shared/schema';
import { shallowEqual } from './shallowEqual';

/**
 * Pure projection of a `fullState` snapshot into the selected slice,
 * preserving reference equality across calls when the slice hasn't
 * changed. Extracted from `useLedgeState` so the projection logic can
 * be unit-tested without a React renderer.
 *
 * - Returns the previous slice unchanged when `next` is `null` (the
 *   "no state yet" case).
 * - Returns the previous slice unchanged when it is `null` (the
 *   "first non-null projection" case just falls through to `next`).
 * - Returns the previous slice unchanged when shallow-equal to `next`
 *   (so React can bail out of re-rendering the consumer).
 */
export function projectAppState<T>(
  previous: T | null,
  fullState: AppState | null,
  selector: ((state: AppState) => T) | undefined,
  equalityFn: (a: T, b: T) => boolean = shallowEqual,
): T | null {
  if (!fullState) {
    return previous;
  }
  const next = selector ? selector(fullState) : (fullState as T);
  if (previous !== null && equalityFn(previous, next)) {
    return previous;
  }
  return next;
}
