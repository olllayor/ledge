import { basename as posixBasename } from './posixPath';
import { type FileBackedShelfItem, type FileRef, type ShelfItemRecord } from './schema';

export function isFileBackedItem(item: ShelfItemRecord): item is FileBackedShelfItem {
  return item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset';
}

// Thumbnails are interpolated into CSS `url()` and `<img src>` by the
// renderer. History entries can arrive from a restore payload, so the
// value must be pinned to inline image data URLs — anything else (http(s)
// fetches, css-ish strings) is refused.
const SAFE_IMAGE_DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_THUMBNAIL_URI_CHARS = 512 * 1024;

export function isSafeImageDataUri(value: string): boolean {
  return value.length <= MAX_THUMBNAIL_URI_CHARS && SAFE_IMAGE_DATA_URI.test(value);
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

/**
 * For a path under `/Volumes/<name>/`, the volume root whose absence
 * means "the drive is not mounted yet", ported from vorssaint-utils
 * (see docs/vorssaint-shelf-plan.md Phase 2). Returns null for boot-
 * volume paths and for volume roots themselves. A missing file under a
 * still-unmounted volume must read as "wait", never "dead".
 */
export function unmountedVolumeRoot(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 3 || segments[0] !== 'Volumes') {
    return null;
  }

  return '/Volumes/' + segments[1];
}

/** Minimal POSIX basename so shared code stays free of node imports. */
export { posixBasename };

export interface BookmarkResolution {
  resolvedPath: string;
  isStale: boolean;
  isMissing: boolean;
}

export interface HealFileRefDeps {
  exists(path: string): Promise<boolean>;
  resolveBookmark(
    bookmarkBase64: string,
    originalPath: string,
  ): Promise<BookmarkResolution>;
}

export interface HealResult {
  fileRef: FileRef;
  healed: boolean;
  /** True when the file is gone but its volume has not mounted yet. */
  deferredForVolume: boolean;
}

/**
 * One heal attempt for a single file reference, mirroring the upstream
 * rule that a dead path gets exactly one chance to live again through
 * its bookmark (docs/vorssaint-shelf-plan.md Phase 1). Pure and async
 * via injected predicates, same testability pattern as payloads.ts.
 *
 * - Healthy path → untouched.
 * - Path gone, volume not mounted → deferred, untouched.
 * - Path gone, bookmark resolves → rewritten to the resolved path.
 * - Both fail → flagged missing, never deleted.
 */
export async function healFileRef(
  fileRef: FileRef,
  deps: HealFileRefDeps,
): Promise<HealResult> {
  const currentPath = fileRef.resolvedPath || fileRef.originalPath;

  if (await deps.exists(currentPath)) {
    return { fileRef, healed: false, deferredForVolume: false };
  }

  const volumeRoot = unmountedVolumeRoot(currentPath);
  if (volumeRoot && !(await deps.exists(volumeRoot))) {
    return { fileRef, healed: false, deferredForVolume: true };
  }

  if (!fileRef.bookmarkBase64) {
    return {
      fileRef: { ...fileRef, isMissing: true },
      healed: false,
      deferredForVolume: false,
    };
  }

  let resolution: BookmarkResolution;
  try {
    resolution = await deps.resolveBookmark(fileRef.bookmarkBase64, fileRef.originalPath);
  } catch {
    // Native helper timeout/crash degrades to "still missing" instead
    // of throwing; same policy as restore-time refresh in main.
    return {
      fileRef: { ...fileRef, isMissing: true },
      healed: false,
      deferredForVolume: false,
    };
  }

  if (resolution.isMissing || !resolution.resolvedPath) {
    return {
      fileRef: { ...fileRef, isMissing: true },
      healed: false,
      deferredForVolume: false,
    };
  }

  return {
    fileRef: {
      ...fileRef,
      resolvedPath: resolution.resolvedPath,
      isStale: resolution.isStale,
      isMissing: false,
    },
    healed: true,
    deferredForVolume: false,
  };
}

/**
 * Item-level wrapper around `healFileRef`: runs file-backed items
 * through one heal attempt and, when the bookmark finds the file at a
 * new path, retitles the entry so it reads as the file's current name
 * (upstream behavior). Non-file items pass through untouched.
 */
export async function healShelfItem(
  item: ShelfItemRecord,
  deps: HealFileRefDeps,
): Promise<{ item: ShelfItemRecord; healed: boolean; deferredForVolume: boolean }> {
  if (!isFileBackedItem(item)) {
    return { item, healed: false, deferredForVolume: false };
  }

  const result = await healFileRef(item.file, deps);
  if (!result.healed) {
    return { item: { ...item, file: result.fileRef }, healed: false, deferredForVolume: result.deferredForVolume };
  }

  return {
    item: {
      ...item,
      title: posixBasename(result.fileRef.resolvedPath),
      file: result.fileRef,
    },
    healed: true,
    deferredForVolume: false,
  };
}
