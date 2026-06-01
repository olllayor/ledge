import { type BillingPlan, type ShelfColor, type ShelfItemRecord, type ShelfRecord } from './schema';

export const FREE_SYNC_SHELF_LIMIT = 100;
export const FREE_SYNC_DEVICE_LIMIT = 1;
export const PRO_SYNC_SHELF_LIMIT = 500;
export const PRO_SYNC_DEVICE_LIMIT = 3;
export const PRO_IMAGE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

export const FREE_RECENT_SHELVES_LIMIT = 3;
export const PRO_RECENT_SHELVES_LIMIT = 10;

export const FREE_SHELF_COLORS: readonly ShelfColor[] = ['ember', 'wave'];
export const PRO_SHELF_COLORS: readonly ShelfColor[] = ['ember', 'wave', 'forest', 'sand'];

export interface CloudFileRef {
  originalPath: string;
  resolvedPath: string;
  isStale: boolean;
  isMissing: boolean;
}

export type CloudShelfItem =
  | Omit<Extract<ShelfItemRecord, { kind: 'file' }>, 'file'> & { file: CloudFileRef }
  | Omit<Extract<ShelfItemRecord, { kind: 'folder' }>, 'file'> & { file: CloudFileRef }
  | Omit<Extract<ShelfItemRecord, { kind: 'imageAsset' }>, 'file'> & { file: CloudFileRef }
  | Extract<ShelfItemRecord, { kind: 'text' }>
  | (Extract<ShelfItemRecord, { kind: 'url' }> & { cloudStorageId?: string; cloudStorageBytes?: number });

export interface CloudShelfRecord {
  id: string;
  name: string;
  color: ShelfRecord['color'];
  createdAt: string;
  updatedAt: string;
  origin: ShelfRecord['origin'];
  items: CloudShelfItem[];
}

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

export function serializeShelfForCloud(shelf: ShelfRecord): CloudShelfRecord {
  return {
    id: shelf.id,
    name: shelf.name,
    color: shelf.color,
    createdAt: shelf.createdAt,
    updatedAt: shelf.updatedAt,
    origin: shelf.origin,
    items: shelf.items.map((item) => {
      if (!('file' in item)) {
        return item;
      }

      const { bookmarkBase64: _bookmarkBase64, ...cloudFile } = item.file;
      return {
        ...item,
        file: cloudFile,
      };
    }),
  };
}

export function estimateImportedImageStorageBytes(shelves: ShelfRecord[]): number {
  return shelves.reduce((total, shelf) => {
    return (
      total +
      shelf.items.reduce((itemTotal, item) => {
        if (item.kind !== 'imageAsset') {
          return itemTotal;
        }

        return itemTotal + Math.max(0, item.preview.detail.length);
      }, 0)
    );
  }, 0);
}
