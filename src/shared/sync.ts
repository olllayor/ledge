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
  | (Extract<ShelfItemRecord, { kind: 'url' }> & { cloudStorageId?: string; cloudStorageBytes?: number })
  | Extract<ShelfItemRecord, { kind: 'color' }>
  | Extract<ShelfItemRecord, { kind: 'code' }>;

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

/**
 * File flags as the Worker actually returns them: paths and bookmarks are
 * stripped on store, so only the safety flags (and optional R2 key) survive.
 * Local `FileRef` still requires `originalPath`, so a raw wire payload
 * cannot be fed to `shelfRecordSchema` without reconstruction.
 */
type CloudFileFlagsWire = {
  isStale?: boolean;
  isMissing?: boolean;
  originalPath?: string;
  resolvedPath?: string;
  cloudStorageKey?: string;
};

type CloudItemWire = Omit<CloudShelfItem, 'file'> & { file?: CloudFileFlagsWire };

/**
 * Rebuild local shelf items from a cloud wire payload.
 *
 * The Worker strips path fields on store, so file-backed items arrive as
 * flags only. Fill the full `FileRef` shape with empty paths and
 * `isMissing: true` — the same invariant `sanitizeRemoteItem` enforces —
 * so the local schema accepts the snapshot and the UI offers Relink.
 */
export function coerceCloudItemsToLocal(items: CloudItemWire[]): ShelfItemRecord[] {
  return items.map((item): ShelfItemRecord => {
    if (!('file' in item) || item.file === undefined) {
      return item as ShelfItemRecord;
    }

    return {
      ...item,
      // Paths from another device are meaningless (and unsafe to trust)
      // here. Always force missing so the UI offers Relink — same
      // invariant as teamSync.remoteToLocalItems and sanitizeRemoteItem.
      file: {
        originalPath: '',
        resolvedPath: '',
        bookmarkBase64: '',
        isStale: true,
        isMissing: true,
      },
    } as ShelfItemRecord;
  });
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
