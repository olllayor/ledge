import type { AppState, BillingPlan, ShelfColor } from '@shared/schema';
import {
  FREE_RECENT_SHELVES_LIMIT,
  FREE_SHELF_COLORS,
  PRO_RECENT_SHELVES_LIMIT,
  PRO_SHELF_COLORS,
  isShelfColorAllowed,
  recentShelvesLimitForPlan,
} from '@shared/sync';

/**
 * Stable, reusable state projections. Each selector is a pure function
 * `(AppState) => T`; pass it directly to `useLedgeState(selector)` and
 * React will bail out of re-rendering when the projected slice is
 * shallow-equal to the previous one.
 *
 * Centralizing them here means a new view can opt into the same
 * re-render discipline the existing views already have, and changes
 * to the projection (e.g. "the shelf view now also needs
 * `permissionStatus`") happen in one place.
 */

export const selectShelfView = (state: AppState) => ({
  liveShelf: state.liveShelf,
  preferences: {
    shelfInteraction: state.preferences.shelfInteraction,
    shakeEnabled: state.preferences.shakeEnabled
  },
  permissionStatus: state.permissionStatus,
  sync: { plan: state.sync.plan }
});

export const selectOnboarding = (state: AppState) => ({
  preferences: { hasCompletedOnboarding: state.preferences.hasCompletedOnboarding }
});

export interface PlanInfo {
  plan: BillingPlan
  isPro: boolean
  recentShelvesLimit: number
  recentShelvesUsed: number
  availableColors: readonly ShelfColor[]
  isColorAllowed(color: ShelfColor): boolean
}

export const selectPlan = (state: AppState): PlanInfo => {
  const plan: BillingPlan = state.sync.plan
  const isPro = plan === 'pro'
  return {
    plan,
    isPro,
    recentShelvesLimit: recentShelvesLimitForPlan(plan),
    recentShelvesUsed: state.recentShelves.length,
    availableColors: isPro ? PRO_SHELF_COLORS : FREE_SHELF_COLORS,
    isColorAllowed: (color) => isShelfColorAllowed(color, plan)
  }
}

// Re-exports so existing call sites can keep importing plan constants
// and helpers from one place.
export { FREE_RECENT_SHELVES_LIMIT, FREE_SHELF_COLORS, PRO_RECENT_SHELVES_LIMIT, PRO_SHELF_COLORS }
