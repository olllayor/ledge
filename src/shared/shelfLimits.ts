/**
 * Hard ceilings for shelf contents, ported as ideas from
 * vorssaint-utils' shelf (see docs/vorssaint-shelf-plan.md Phase 3).
 * A shelf is a curated surface, not an archive: these bounds keep a
 * corrupted or hand-edited store from wedging startup or rendering.
 *
 * The constants are enforced at two doors:
 * - Ingest (`appendItems`) rejects overflow with `ShelfCapacityError`.
 * - Load (`migratePersistedState`) trims oldest-first via
 *   `sanitizeRawShelfForLimits` so an oversized on-disk store still
 *   launches instead of failing slice validation and resetting.
 */
export const MAX_ITEMS_PER_SHELF = 200;

export const MAX_TEXT_PAYLOAD_LENGTH = 200_000;

/**
 * Clipboard capture ceilings (ported from vorssaint-utils' clipboard
 * bounds). A single capture larger than the character cap is refused;
 * the whole history keeps a firm total-text byte budget so one huge
 * copy can never bloat the state file indefinitely.
 */
export const MAX_CLIPBOARD_TEXT_CHARS = 1_000_000;

export const MAX_CLIPBOARD_HISTORY_BYTES = 64 * 1024 * 1024;

/** Error thrown when appending would push a shelf past the item cap. */
export class ShelfCapacityError extends Error {
  readonly currentCount: number
  readonly attemptedCount: number
  readonly maxItems: number

  constructor(currentCount: number, attemptedCount: number, maxItems: number) {
    super(
      `Shelf is full (${currentCount}/${maxItems} items); dropping ${attemptedCount} more would exceed the limit.`,
    )
    this.name = 'ShelfCapacityError'
    this.currentCount = currentCount
    this.attemptedCount = attemptedCount
    this.maxItems = maxItems
  }
}

/**
 * Keep the first `max` items by array position (which mirrors append
 * order) and drop the rest. Pure so both the load sanitizer and tests
 * can use it without Electron.
 */
export function trimShelfItems<T>(items: T[], max: number): T[] {
  return items.length <= max ? items : items.slice(0, max);
}

interface RawTextLikeItem {
  kind?: unknown
  text?: unknown
}

/**
 * Truncate oversized text/code payload bodies in already-parsed JSON
 * shapes. Returns the input untouched when nothing exceeds the cap so
 * normal loads never rewrite the store.
 */
export function clampRawItemText<T>(item: T): { value: T; changed: boolean } {
  const candidate = item as RawTextLikeItem | null;
  if (!candidate || typeof candidate !== 'object') {
    return { value: item, changed: false };
  }

  if (
    (candidate.kind !== 'text' && candidate.kind !== 'code') ||
    typeof candidate.text !== 'string' ||
    candidate.text.length <= MAX_TEXT_PAYLOAD_LENGTH
  ) {
    return { value: item, changed: false };
  }

  return {
    value: {
      ...item,
      text: candidate.text.slice(0, MAX_TEXT_PAYLOAD_LENGTH),
    },
    changed: true,
  };
}

export interface RawShelfLike {
  items?: unknown
}

export interface RawShelfSanitizeResult<T> {
  value: T
  changed: boolean
}

/**
 * UTF-8 byte cost of a raw (unvalidated) clipboard entry's text body.
 * Only text/code payloads carry bytes; everything else counts as zero,
 * mirroring `estimateEntryBytes` in clipboardStore.
 */
function estimateRawClipboardEntryBytes(entry: unknown): number {
  const candidate = entry as { item?: { kind?: unknown; text?: unknown } } | null;
  const item = candidate?.item;
  if (
    !item ||
    typeof item !== 'object' ||
    (item.kind !== 'text' && item.kind !== 'code') ||
    typeof item.text !== 'string'
  ) {
    return 0;
  }
  return Buffer.byteLength(item.text, 'utf8');
}

/**
 * Load-time guard for the clipboard slice: drops oldest entries (array
 * tail) until the total text payload fits the byte budget. Pure, so it
 * runs on unvalidated JSON inside `migratePersistedState`.
 */
export function sanitizeRawClipboardHistoryForLimits<T extends unknown[]>(
  entries: T,
): RawShelfSanitizeResult<T> {
  let remainingBytes = MAX_CLIPBOARD_HISTORY_BYTES;
  const kept: unknown[] = [];
  let changed = false;

  for (const entry of entries) {
    const bytes = estimateRawClipboardEntryBytes(entry);
    if (bytes > remainingBytes) {
      changed = true;
      continue;
    }
    remainingBytes -= bytes;
    kept.push(entry);
  }

  return changed ? { value: kept as T, changed } : { value: entries, changed: false };
}

/**
 * Normalize one raw persisted shelf slice against the ceilings:
 * clamps oversized text payloads and trims the item list oldest-first
 * past the cap. Operates on unvalidated JSON so an overflowing store
 * passes slice validation afterwards instead of resetting to defaults.
 */
export function sanitizeRawShelfForLimits<T extends RawShelfLike>(
  shelf: T,
): RawShelfSanitizeResult<T> {
  if (!Array.isArray(shelf.items)) {
    return { value: shelf, changed: false };
  }

  let changed = false;
  const clamped = shelf.items.map((item) => {
    const result = clampRawItemText(item);
    changed = changed || result.changed;
    return result.value;
  });

  const trimmed = trimShelfItems(clamped, MAX_ITEMS_PER_SHELF);
  if (trimmed.length !== clamped.length) {
    changed = true;
  }

  return changed ? { value: { ...shelf, items: trimmed }, changed } : { value: shelf, changed: false };
}
