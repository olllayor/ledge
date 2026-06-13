import { type FileBackedShelfItem, type ShelfItemRecord } from './schema';

export function isFileBackedItem(item: ShelfItemRecord): item is FileBackedShelfItem {
  return item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset';
}

export function getFileBackedPath(item: FileBackedShelfItem): string | null {
  if (!isFileBackedItem(item)) {
    return null;
  }

  if (item.file.isMissing) {
    return null;
  }

  return item.file.resolvedPath || item.file.originalPath || null;
}
