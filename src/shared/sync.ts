import { type ShelfItemRecord, type ShelfRecord, type FileRef } from './schema';
import {
  syncShelfLimitForPlan,
  syncDeviceLimitForPlan,
  recentShelvesLimitForPlan,
  shelfColorsForPlan,
  isShelfColorAllowed,
  FREE_RECENT_SHELVES_LIMIT,
  PRO_RECENT_SHELVES_LIMIT,
  FREE_SHELF_COLORS,
  PRO_SHELF_COLORS,
} from './syncUtils';

// Re-export the plan utilities and constants so existing call sites
// (notably src/renderer/src/hooks/usePlan.ts) can keep importing from '@shared/sync'.
export {
  syncShelfLimitForPlan,
  syncDeviceLimitForPlan,
  recentShelvesLimitForPlan,
  shelfColorsForPlan,
  isShelfColorAllowed,
  FREE_RECENT_SHELVES_LIMIT,
  PRO_RECENT_SHELVES_LIMIT,
  FREE_SHELF_COLORS,
  PRO_SHELF_COLORS,
};

/**
 * Cloud representation of a file-backed item. The native macOS bookmark
 * is a local-only secret and must never be serialized off the device.
 */
export type CloudFileRef = Omit<FileRef, 'bookmarkBase64'>;

export type CloudShelfItem =
  | (Omit<Extract<ShelfItemRecord, { kind: 'file' }>, 'file'> & { file: CloudFileRef })
  | (Omit<Extract<ShelfItemRecord, { kind: 'folder' }>, 'file'> & { file: CloudFileRef })
  | (Omit<Extract<ShelfItemRecord, { kind: 'imageAsset' }>, 'file'> & { file: CloudFileRef })
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
