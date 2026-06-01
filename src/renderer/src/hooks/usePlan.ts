import { useMemo } from 'react';
import type { AppState, BillingPlan, ShelfColor } from '@shared/schema';
import {
  FREE_RECENT_SHELVES_LIMIT,
  FREE_SHELF_COLORS,
  PRO_RECENT_SHELVES_LIMIT,
  PRO_SHELF_COLORS,
  isShelfColorAllowed,
  recentShelvesLimitForPlan,
} from '@shared/sync';

export interface PlanLimits {
  plan: BillingPlan;
  isPro: boolean;
  recentShelvesLimit: number;
  recentShelvesUsed: number;
  availableColors: readonly ShelfColor[];
  isColorAllowed(color: ShelfColor): boolean;
}

export function usePlan(state: AppState): PlanLimits {
  return useMemo(() => {
    const plan: BillingPlan = state.sync.plan;
    const isPro = plan === 'pro';
    return {
      plan,
      isPro,
      recentShelvesLimit: recentShelvesLimitForPlan(plan),
      recentShelvesUsed: state.recentShelves.length,
      availableColors: isPro ? PRO_SHELF_COLORS : FREE_SHELF_COLORS,
      isColorAllowed: (color) => isShelfColorAllowed(color, plan),
    };
  }, [state.sync.plan, state.recentShelves.length]);
}

export { FREE_RECENT_SHELVES_LIMIT, FREE_SHELF_COLORS, PRO_RECENT_SHELVES_LIMIT, PRO_SHELF_COLORS };
