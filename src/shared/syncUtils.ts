import { type BillingPlan, type ShelfColor } from './schema';

export const FREE_SYNC_SHELF_LIMIT = 100;
export const FREE_SYNC_DEVICE_LIMIT = 1;
export const PRO_SYNC_SHELF_LIMIT = 500;
export const PRO_SYNC_DEVICE_LIMIT = 3;
export const PRO_IMAGE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

export const FREE_RECENT_SHELVES_LIMIT = 3;
export const PRO_RECENT_SHELVES_LIMIT = 10;

export const FREE_SHELF_COLORS: readonly ShelfColor[] = ['ember', 'wave'];
export const PRO_SHELF_COLORS: readonly ShelfColor[] = ['ember', 'wave', 'forest', 'sand'];

export function syncShelfLimitForPlan(plan: BillingPlan): number {
  return plan === 'pro' ? PRO_SYNC_SHELF_LIMIT : FREE_SYNC_SHELF_LIMIT;
}

export function syncDeviceLimitForPlan(plan: BillingPlan): number {
  return plan === 'pro' ? PRO_SYNC_DEVICE_LIMIT : FREE_SYNC_DEVICE_LIMIT;
}

export function recentShelvesLimitForPlan(plan: BillingPlan): number {
  return plan === 'pro' ? PRO_RECENT_SHELVES_LIMIT : FREE_RECENT_SHELVES_LIMIT;
}

export function shelfColorsForPlan(plan: BillingPlan): readonly ShelfColor[] {
  return plan === 'pro' ? PRO_SHELF_COLORS : FREE_SHELF_COLORS;
}

export function isShelfColorAllowed(color: ShelfColor, plan: BillingPlan): boolean {
  return plan === 'pro' ? PRO_SHELF_COLORS.includes(color) : FREE_SHELF_COLORS.includes(color);
}
