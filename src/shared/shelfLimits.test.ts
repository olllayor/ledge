import { describe, expect, it } from 'vitest';
import {
  MAX_CLIPBOARD_HISTORY_BYTES,
  MAX_ITEMS_PER_SHELF,
  MAX_TEXT_PAYLOAD_LENGTH,
  ShelfCapacityError,
  clampRawItemText,
  sanitizeRawClipboardHistoryForLimits,
  sanitizeRawShelfForLimits,
  trimShelfItems,
} from './shelfLimits';

function rawItem(index: number, kind = 'file') {
  return { id: `i${index}`, kind, order: index };
}

describe('trimShelfItems', () => {
  it('keeps everything under the cap', () => {
    const items = [1, 2, 3];
    expect(trimShelfItems(items, 5)).toEqual([1, 2, 3]);
  });

  it('drops oldest-first beyond the cap', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(trimShelfItems(items, 4)).toEqual([0, 1, 2, 3]);
  });
});

describe('clampRawItemText', () => {
  it('leaves short text items untouched', () => {
    const item = rawItem(0, 'text');
    (item as { text?: string }).text = 'hello';
    expect(clampRawItemText(item)).toEqual({ value: item, changed: false });
  });

  it('truncates oversized text payloads', () => {
    const item: Record<string, unknown> = { ...rawItem(0, 'text'), text: 'x'.repeat(MAX_TEXT_PAYLOAD_LENGTH + 10) };
    const result = clampRawItemText(item);
    expect(result.changed).toBe(true);
    expect((result.value as { text: string }).text.length).toBe(MAX_TEXT_PAYLOAD_LENGTH);
  });

  it('truncates oversized code payloads', () => {
    const item: Record<string, unknown> = { ...rawItem(0, 'code'), text: 'y'.repeat(MAX_TEXT_PAYLOAD_LENGTH * 2) };
    const result = clampRawItemText(item);
    expect(result.changed).toBe(true);
  });

  it('ignores non-text kinds with long fields', () => {
    const item: Record<string, unknown> = { ...rawItem(0, 'url'), url: 'z'.repeat(MAX_TEXT_PAYLOAD_LENGTH + 1) };
    expect(clampRawItemText(item).changed).toBe(false);
  });
});

describe('sanitizeRawShelfForLimits', () => {
  it('returns input unchanged when within limits', () => {
    const shelf = { id: 's1', items: Array.from({ length: 3 }, (_, i) => rawItem(i)) };
    expect(sanitizeRawShelfForLimits(shelf)).toEqual({ value: shelf, changed: false });
  });

  it('trims past the item cap and reports change', () => {
    const shelf = { id: 's1', items: Array.from({ length: MAX_ITEMS_PER_SHELF + 50 }, (_, i) => rawItem(i)) };
    const result = sanitizeRawShelfForLimits(shelf);
    expect(result.changed).toBe(true);
    expect(result.value.items).toHaveLength(MAX_ITEMS_PER_SHELF);
    expect((result.value.items as unknown[])[0]).toMatchObject({ id: 'i0' } as Record<string, unknown>);
  });

  it('clamps oversized text and keeps valid siblings', () => {
    const big: Record<string, unknown> = { ...rawItem(0, 'text'), text: 'a'.repeat(MAX_TEXT_PAYLOAD_LENGTH + 1) };
    const shelf = { id: 's1', items: [big, rawItem(1)] };
    const result = sanitizeRawShelfForLimits(shelf);
    expect(result.changed).toBe(true);
    expect((result.value.items?.[0] as { text: string }).text.length).toBe(MAX_TEXT_PAYLOAD_LENGTH);
    expect(result.value.items).toHaveLength(2);
  });

  it('handles shelves without item arrays', () => {
    const shelf: { id: string; items?: unknown } = { id: 's1' };
    expect(sanitizeRawShelfForLimits(shelf)).toEqual({
      value: shelf,
      changed: false,
    });
  });
});

describe('ShelfCapacityError', () => {
  it('carries counts for callers that surface a message', () => {
    const error = new ShelfCapacityError(200, 3, 200);
    expect(error.name).toBe('ShelfCapacityError');
    expect(error.currentCount).toBe(200);
    expect(error.attemptedCount).toBe(3);
    expect(error.message).toContain('200');
  });
});

describe('sanitizeRawClipboardHistoryForLimits', () => {
  function rawTextEntry(index: number, chars: number) {
    return { id: `e${index}`, item: { kind: 'text', text: 'x'.repeat(chars) } };
  }

  it('keeps a history within the byte budget untouched', () => {
    const entries = [rawTextEntry(0, 100), rawTextEntry(1, 50)];
    expect(sanitizeRawClipboardHistoryForLimits(entries)).toEqual({
      value: entries,
      changed: false,
    });
  });

  it('drops oldest (tail) entries past the budget', () => {
    const big = MAX_CLIPBOARD_HISTORY_BYTES / 2;
    const entries = [rawTextEntry(0, big), rawTextEntry(1, big), rawTextEntry(2, big)];
    const result = sanitizeRawClipboardHistoryForLimits(entries);
    expect(result.changed).toBe(true);
    // Newest-first walk keeps the first two; the tail entry is dropped.
    expect(result.value).toHaveLength(2);
  });

  it('ignores non-text entries against the budget', () => {
    const entries = [
      rawTextEntry(0, MAX_CLIPBOARD_HISTORY_BYTES),
      { id: 'img', item: { kind: 'imageAsset', file: {} } },
    ];
    expect(sanitizeRawClipboardHistoryForLimits(entries)).toEqual({
      value: entries,
      changed: false,
    });
  });
});
