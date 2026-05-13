import { type BillingPlan, type ShelfItemRecord, type ShelfRecord } from './schema';

export const FREE_SYNC_SHELF_LIMIT = 10;
export const FREE_SYNC_DEVICE_LIMIT = 1;
export const PRO_SYNC_SHELF_LIMIT = 500;
export const PRO_SYNC_DEVICE_LIMIT = 3;
export const PRO_IMAGE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

export interface CloudFileRef {
  originalPath: string;
  resolvedPath: string;
  isStale: boolean;
  isMissing: boolean;
}

export type CloudShelfItem = Omit<ShelfItemRecord, 'file'> & {
  file?: CloudFileRef;
  cloudStorageId?: string;
  cloudStorageBytes?: number;
};

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
