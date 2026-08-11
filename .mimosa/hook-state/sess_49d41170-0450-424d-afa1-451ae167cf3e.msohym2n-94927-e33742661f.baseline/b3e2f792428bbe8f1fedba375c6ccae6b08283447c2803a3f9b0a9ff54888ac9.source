import { useMemo } from 'react';
import type { AppState } from '@shared/schema';
import { selectPlan, type PlanInfo } from './selectors';

/**
 * Memoized plan/limit projection. The result is recomputed only when
 * `state.sync.plan` or `state.recentShelves.length` changes; the
 * `isColorAllowed` callback is a fresh function each render but it's
 * a pure pass-through so its identity churn doesn't affect any
 * consumer (no consumer uses it in a dep array).
 */
export function usePlan(state: AppState): PlanInfo {
  return useMemo(() => selectPlan(state), [state.sync.plan, state.recentShelves.length]);
}
