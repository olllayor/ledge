// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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

  it('8.3 mouseenter expands the strip (height changes from 48 to 168)', () => {
    const { container } = render(<PeekWindowView />);
    const main = container.querySelector('main.peek') as HTMLElement;
    expect(main.style.height).toBe('48px');
    fireEvent.mouseEnter(main);
    expect(main.style.height).toBe('168px');
  });

  it('8.4 mouseleave collapses the strip back to 48', () => {
    const { container } = render(<PeekWindowView />);
    const main = container.querySelector('main.peek') as HTMLElement;
    fireEvent.mouseEnter(main);
    expect(main.style.height).toBe('168px');
    fireEvent.mouseLeave(main);
    expect(main.style.height).toBe('48px');
  });

  it('8.5/8.6 shows up to 12 thumbnails; drag starts clipboardStartItemDrag', async () => {
    const history = Array.from({ length: 15 }, (_, i) => buildEntry(`e${i}`));
    setupLedgeBridge(history);
    const { container } = render(<PeekWindowView />);
    stateListeners.forEach((cb) => cb({
      clipboardHistory: history,
    } as unknown as AppState));
    await waitFor(() => {
      expect(container.querySelectorAll('.peek-thumb').length).toBe(12);
    });
    const firstThumb = container.querySelector('.peek-thumb') as HTMLElement;
    const dragEvent = new Event('dragstart', { bubbles: true, cancelable: true });
    firstThumb.dispatchEvent(dragEvent);
    const bridge = (window as unknown as { ledge: { clipboardStartItemDrag: ReturnType<typeof vi.fn> } }).ledge;
    expect(bridge.clipboardStartItemDrag).toHaveBeenCalledWith({ entryId: 'e0' });
  });

  it('8.7 shows "Empty" when there are no entries', () => {
    const { container } = render(<PeekWindowView />);
    expect(container.textContent).toContain('Empty');
  });

  it('8.6 drag-out for non-file item returns false and triggers toast', () => {
    setupLedgeBridge([buildEntry('e1')]);
    const { container } = render(<PeekWindowView />);
    stateListeners.forEach((cb) => cb({
      clipboardHistory: [buildEntry('e1')],
    } as unknown as AppState));
    return waitFor(() => {
      expect(container.querySelectorAll('.peek-thumb').length).toBe(1);
    }).then(() => {
      // Override the mock to return false (simulating a non-file entry that can't be dragged)
      (window as unknown as { ledge: { clipboardStartItemDrag: ReturnType<typeof vi.fn> } }).ledge.clipboardStartItemDrag =
        vi.fn(() => false);
      const firstThumb = container.querySelector('.peek-thumb') as HTMLElement;
      const dragEvent = new Event('dragstart', { bubbles: true, cancelable: true });
      firstThumb.dispatchEvent(dragEvent);
      const bridge = (window as unknown as { ledge: { showToast: ReturnType<typeof vi.fn> } }).ledge;
      expect(bridge.showToast).toHaveBeenCalledWith('This item type does not support drag-out', 'info');
    });
  });
});
