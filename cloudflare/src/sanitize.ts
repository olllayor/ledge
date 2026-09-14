/**
 * Shared HTTP errors + shelf-item path stripping.
 *
 * Cloud items never carry local filesystem paths. Clients may still send
 * them (same shape as the Electron local store); strip before persist.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ShelfItemPreview {
  summary: string;
  detail: string;
}

/** File-backed flags kept in the cloud — no paths, optional R2 key. */
export interface CloudFileFlags {
  isStale: boolean;
  isMissing: boolean;
  cloudStorageKey?: string;
}

export type SanitizedShelfItem =
  | {
      id: string;
      createdAt: string;
      order: number;
      title: string;
      subtitle: string;
      preview: ShelfItemPreview;
      kind: 'file';
      file: CloudFileFlags;
      mimeType: string;
    }
  | {
      id: string;
      createdAt: string;
      order: number;
      title: string;
      subtitle: string;
      preview: ShelfItemPreview;
      kind: 'folder';
      file: CloudFileFlags;
    }
  | {
      id: string;
      createdAt: string;
      order: number;
      title: string;
      subtitle: string;
      preview: ShelfItemPreview;
      kind: 'imageAsset';
      file: CloudFileFlags;
      mimeType: string;
    }
  | {
      id: string;
      createdAt: string;
      order: number;
      title: string;
      subtitle: string;
      preview: ShelfItemPreview;
      kind: 'text';
      text: string;
    }
  | {
      id: string;
      createdAt: string;
      order: number;
      title: string;
      subtitle: string;
      preview: ShelfItemPreview;
      kind: 'url';
      url: string;
    }
  | {
      id: string;
      createdAt: string;
      order: number;
      title: string;
      subtitle: string;
      preview: ShelfItemPreview;
      kind: 'color';
      hex: string;
      name?: string;
    }
  | {
      id: string;
      createdAt: string;
      order: number;
      title: string;
      subtitle: string;
      preview: ShelfItemPreview;
      kind: 'code';
      text: string;
      language?: string;
    };

const ITEM_KINDS = ['file', 'folder', 'imageAsset', 'text', 'url', 'color', 'code'] as const;
const ITEM_KIND_SET: ReadonlySet<string> = new Set(ITEM_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizePreview(raw: unknown): ShelfItemPreview {
  if (!isRecord(raw)) return { summary: '', detail: '' };
  return {
    summary: asString(raw.summary),
    detail: asString(raw.detail),
  };
}

/** Drop originalPath / resolvedPath / bookmarkBase64; keep flags + R2 key. */
export function sanitizeFileFlags(raw: unknown): CloudFileFlags {
  if (!isRecord(raw)) {
    return { isStale: false, isMissing: false };
  }
  const flags: CloudFileFlags = {
    isStale: asBoolean(raw.isStale),
    isMissing: asBoolean(raw.isMissing),
  };
  const key = asString(raw.cloudStorageKey);
  if (key) flags.cloudStorageKey = key;
  return flags;
}

/**
 * Returns a path-stripped item, or null when the payload is not a usable
 * shelf item (missing id / unknown kind).
 */
export function sanitizeShelfItem(raw: unknown): SanitizedShelfItem | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const kind = asString(raw.kind);
  if (!id || !ITEM_KIND_SET.has(kind)) {
    return null;
  }

  const base = {
    id,
    createdAt: asString(raw.createdAt, new Date().toISOString()),
    order: asNumber(raw.order),
    title: asString(raw.title),
    subtitle: asString(raw.subtitle),
    preview: sanitizePreview(raw.preview),
  };

  switch (kind) {
    case 'file':
      return {
        ...base,
        kind: 'file',
        file: sanitizeFileFlags(raw.file),
        mimeType: asString(raw.mimeType, 'application/octet-stream'),
      };
    case 'folder':
      return {
        ...base,
        kind: 'folder',
        file: sanitizeFileFlags(raw.file),
      };
    case 'imageAsset':
      return {
        ...base,
        kind: 'imageAsset',
        file: sanitizeFileFlags(raw.file),
        mimeType: asString(raw.mimeType, 'image/png'),
      };
    case 'text':
      // savedFilePath intentionally omitted
      return { ...base, kind: 'text', text: asString(raw.text) };
    case 'url':
      return { ...base, kind: 'url', url: asString(raw.url) };
    case 'color': {
      const item: SanitizedShelfItem = {
        ...base,
        kind: 'color',
        hex: asString(raw.hex),
      };
      if (typeof raw.name === 'string') item.name = raw.name;
      return item;
    }
    case 'code': {
      const item: SanitizedShelfItem = {
        ...base,
        kind: 'code',
        text: asString(raw.text),
      };
      if (typeof raw.language === 'string') item.language = raw.language;
      return item;
    }
    default:
      return null;
  }
}

export function sanitizeShelfItems(raw: unknown): SanitizedShelfItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SanitizedShelfItem[] = [];
  for (const entry of raw) {
    const item = sanitizeShelfItem(entry);
    if (item) out.push(item);
  }
  return out;
}

/** Parse a stored items_json blob, re-sanitizing as defense in depth. */
export function parseStoredItems(itemsJson: string): SanitizedShelfItem[] {
  try {
    return sanitizeShelfItems(JSON.parse(itemsJson) as unknown);
  } catch {
    return [];
  }
}
