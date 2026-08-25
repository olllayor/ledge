// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { PeekWindowView } from './PeekWindowView';
import type { ClipboardEntry, AppState } from '@shared/schema';

function buildEntry(id: string, overrides: Partial<ClipboardEntry> = {}): ClipboardEntry {
  return {
    id,
    capturedAt: '2026-06-22T00:00:00.000Z',
    sourceBundleId: 'com.test',
    sourceAppName: 'Test',
    item: {
      id: `i-${id}`,
      kind: 'text',
      createdAt: '2026-06-22T00:00:00.000Z',
      order: 0,
      title: id,
      subtitle: '',
      preview: { summary: id, detail: '' },
      text: `text ${id}`,
    },
    categoryIds: [],
    ...overrides,
  };
}

let stateListeners: Array<(state: AppState) => void> = [];
let hintListeners: Array<(hint: { hint: string }) => void> = [];

function setupLedgeBridge(history: ClipboardEntry[] = []) {
  stateListeners = [];
  hintListeners = [];
  (window as unknown as {
    ledge: Record<string, ReturnType<typeof vi.fn>>
  }).ledge = {
    clipboardGetRecent: vi.fn(async (limit: number) => history.slice(0, limit)),
    subscribeState: vi.fn((cb: (state: AppState) => void) => {
      stateListeners.push(cb);
      return () => {
        stateListeners = stateListeners.filter((l) => l !== cb);
      };
    }),
    onClipboardPeekHint: vi.fn((cb: (hint: { hint: string }) => void) => {
      hintListeners.push(cb);
      return () => {
        hintListeners = hintListeners.filter((l) => l !== cb);
      };
    }),
    clipboardStartItemDrag: vi.fn(() => true),
    showToast: vi.fn(),
  };
}

beforeEach(() => {
  setupLedgeBridge();
});

afterEach(() => {
  cleanup();
});

describe('PeekWindowView (user stories 8.1-8.7)', () => {
  it('8.1/8.2 hint "visible" / "hidden" accepted without error', () => {
    render(<PeekWindowView />);
    expect(() => hintListeners.forEach((cb) => cb({ hint: 'visible' }))).not.toThrow();
    expect(() => hintListeners.forEach((cb) => cb({ hint: 'hidden' }))).not.toThrow();
  });

  it('8.5/8.6 shows up to 12 thumbnails; drag starts clipboardStartItemDrag for file-backed entries', async () => {
    const fileEntry = (id: string): ClipboardEntry => ({
      id,
      capturedAt: '2026-06-22T00:00:00.000Z',
      sourceBundleId: 'com.test',
      sourceAppName: 'Test',
      item: {
        id: `i-${id}`,
        kind: 'file',
        createdAt: '2026-06-22T00:00:00.000Z',
        order: 0,
        title: id,
        subtitle: '',
        preview: { summary: id, detail: '' },
        file: {
          originalPath: `/tmp/${id}.pdf`,
          resolvedPath: `/tmp/${id}.pdf`,
          bookmarkBase64: '',
          isStale: false,
          isMissing: false,
        },
        mimeType: 'application/pdf',
      } as unknown as ClipboardEntry['item'],
      categoryIds: [],
    });
    const history = Array.from({ length: 15 }, (_, i) => fileEntry(`e${i}`));
    setupLedgeBridge(history);
    const { container } = render(<PeekWindowView />);
    stateListeners.forEach((cb) => cb({
      clipboardHistory: history,
    } as unknown as AppState));
    await waitFor(() => {
      expect(container.querySelectorAll('.peek-thumb').length).toBe(12);
    });
    const firstThumb = container.querySelector('.peek-thumb') as HTMLElement;
    expect(firstThumb.getAttribute('draggable')).toBe('true');
    const dragEvent = new Event('dragstart', { bubbles: true, cancelable: true });
    firstThumb.dispatchEvent(dragEvent);
    const bridge = (window as unknown as { ledge: { clipboardStartItemDrag: ReturnType<typeof vi.fn> } }).ledge;
    expect(bridge.clipboardStartItemDrag).toHaveBeenCalledWith({ entryId: 'e0' });
  });

  it('8.7 shows "Empty" when there are no entries', () => {
    const { container } = render(<PeekWindowView />);
    expect(container.textContent).toContain('Empty');
  });

  it('8.6 non-file item is not draggable and click copies instead', async () => {
    setupLedgeBridge([buildEntry('e1')]);
    const { container } = render(<PeekWindowView />);
    // Provide clipboardCopy mock for click path
    (window as unknown as { ledge: Record<string, ReturnType<typeof vi.fn>> }).ledge.clipboardCopy = vi.fn(async () => true);
    stateListeners.forEach((cb) => cb({
      clipboardHistory: [buildEntry('e1')],
    } as unknown as AppState));
    await waitFor(() => {
      expect(container.querySelectorAll('.peek-thumb').length).toBe(1);
    });
    const firstThumb = container.querySelector('.peek-thumb') as HTMLElement;
    // Text entries should not be draggable — prevents the confusing
    // "drag then toast" path; click copies instead.
    expect(firstThumb.getAttribute('draggable')).toBe('false');
    // Drag should not trigger the bridge
    const dragEvent = new Event('dragstart', { bubbles: true, cancelable: true });
    firstThumb.dispatchEvent(dragEvent);
    const bridge = (window as unknown as { ledge: { clipboardStartItemDrag: ReturnType<typeof vi.fn> } }).ledge;
    expect(bridge.clipboardStartItemDrag).not.toHaveBeenCalled();
    // Click should trigger copy
    firstThumb.click();
    await waitFor(() => {
      const b = (window as unknown as { ledge: { clipboardCopy: ReturnType<typeof vi.fn> } }).ledge;
      expect(b.clipboardCopy).toHaveBeenCalledWith({ entryId: 'e1' });
    });
  });
});
