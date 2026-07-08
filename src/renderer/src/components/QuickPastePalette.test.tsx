// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QuickPastePalette } from './QuickPastePalette';
import type { ClipboardEntry, AppState } from '@shared/schema';

function buildEntry(overrides: Partial<ClipboardEntry> = {}): ClipboardEntry {
  return {
    id: 'e1',
    capturedAt: '2026-06-22T00:00:00.000Z',
    sourceBundleId: 'com.test.app',
    sourceAppName: 'TestApp',
    item: {
      id: 'i1',
      kind: 'text',
      createdAt: '2026-06-22T00:00:00.000Z',
      order: 0,
      title: 'hello',
      subtitle: '',
      preview: { summary: 'hello', detail: '' },
      text: 'hello world',
    },
    categoryIds: [],
    ...overrides,
  };
}

function buildState(): AppState {
  return {
    liveShelf: null,
    recentShelves: [],
    preferences: {
      launchAtLogin: false,
      shakeEnabled: true,
      shakeSensitivity: 'balanced',
      excludedBundleIds: [],
      globalShortcut: 'CommandOrControl+Shift+Space',
      hasCompletedOnboarding: true,
      hasSeenShelfLimitMigration: false,
      shelfInteraction: { doubleClickAction: 'open', autoCloseShelf: false, autoRetract: false }
    },
    permissionStatus: {
      nativeHelperAvailable: true,
      accessibilityTrusted: true,
      shakeReady: true,
      lastError: '',
      shortcutRegistered: true,
      shortcutError: ''
    },
    sync: {
      enabled: false,
      status: 'signedOut',
      deviceId: '',
      plan: 'free',
      syncedShelfCount: 0,
      deviceCount: 0,
      storageBytesUsed: 0,
      lastError: ''
    },
    clipboardHistory: [buildEntry()],
    clipboardCategories: [],
    clipboardSettings: {
      enabled: true,
      historyLimit: 200,
      ignoreConcealedItems: true,
      ignoreBundleIds: [],
      quickPasteHotkey: 'CommandOrControl+Shift+V',
      peekHotkey: '',
      syntheticPasteEnabled: false
    }
  };
}

let hintListeners: Array<(hint: { hint: string; previousBundleId?: string; index?: number }) => void> = [];
let stateListeners: Array<(state: AppState) => void> = [];

function setupLedgeBridge() {
  hintListeners = [];
  stateListeners = [];
  (window as unknown as {
    ledge: Record<string, ReturnType<typeof vi.fn>>
  }).ledge = {
    clipboardGetRecent: vi.fn(async (limit: number) => buildState().clipboardHistory.slice(0, limit)),
    subscribeState: vi.fn((cb: (state: AppState) => void) => {
      stateListeners.push(cb);
      return () => {
        stateListeners = stateListeners.filter((l) => l !== cb);
      };
    }),
    onClipboardQuickPasteHint: vi.fn((cb: (hint: { hint: string; previousBundleId?: string; index?: number }) => void) => {
      hintListeners.push(cb);
      return () => {
        hintListeners = hintListeners.filter((l) => l !== cb);
      };
    }),
    clipboardQuickPastePaste: vi.fn(async () => undefined),
    clipboardQuickPasteHide: vi.fn(),
    clipboardEntryClearAll: vi.fn(async () => undefined),
    showToast: vi.fn(),
  };
}

beforeEach(() => {
  setupLedgeBridge();
});

afterEach(() => {
  cleanup();
});

describe('QuickPastePalette (user stories 7.1-7.13)', () => {
  it('7.1/7.2 renders "Pasting to <App>" when previousBundleId is set', async () => {
    render(<QuickPastePalette />);
    hintListeners.forEach((cb) => cb({ hint: 'shown', previousBundleId: 'com.figma.Desktop' }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Pasting to');
    });
  });

  it('7.3 falls back to "Press Cmd+V" hint when no previousBundleId', async () => {
    render(<QuickPastePalette />);
    hintListeners.forEach((cb) => cb({ hint: 'shown' }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Press ⌘V');
    });
  });

  it('7.4 ArrowDown moves focus to next entry', async () => {
    const state = buildState();
    state.clipboardHistory = [buildEntry({ id: 'e1' }), buildEntry({ id: 'e2' }), buildEntry({ id: 'e3' })];
    (window as unknown as { ledge: { clipboardGetRecent: ReturnType<typeof vi.fn> } }).ledge.clipboardGetRecent =
      vi.fn(async () => state.clipboardHistory);
    render(<QuickPastePalette />);
    stateListeners.forEach((cb) => cb(state));
    await waitFor(() => {
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
    });
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    fireEvent(window, event);
    const items = document.querySelectorAll('[role="option"]');
    expect(items[0]?.getAttribute('aria-selected')).toBe('false');
    expect(items[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('7.5 Enter triggers paste of the focused entry', async () => {
    const state = buildState();
    state.clipboardHistory = [buildEntry({ id: 'e1' }), buildEntry({ id: 'e2' })];
    (window as unknown as { ledge: { clipboardGetRecent: ReturnType<typeof vi.fn> } }).ledge.clipboardGetRecent =
      vi.fn(async () => state.clipboardHistory);
    render(<QuickPastePalette />);
    stateListeners.forEach((cb) => cb(state));
    await waitFor(() => {
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    });
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(window, event);
    const bridge = (window as unknown as { ledge: { clipboardQuickPastePaste: ReturnType<typeof vi.fn> } }).ledge;
    expect(bridge.clipboardQuickPastePaste).toHaveBeenCalledWith({ entryId: 'e1', previousBundleId: '' });
  });

  it('7.6 digit 1-9 pastes the matching index', async () => {
    const state = buildState();
    state.clipboardHistory = [buildEntry({ id: 'e1' }), buildEntry({ id: 'e2' }), buildEntry({ id: 'e3' })];
    (window as unknown as { ledge: { clipboardGetRecent: ReturnType<typeof vi.fn> } }).ledge.clipboardGetRecent =
      vi.fn(async () => state.clipboardHistory);
    render(<QuickPastePalette />);
    stateListeners.forEach((cb) => cb(state));
    await waitFor(() => {
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
    });
    const event = new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true });
    fireEvent(window, event);
    const bridge = (window as unknown as { ledge: { clipboardQuickPastePaste: ReturnType<typeof vi.fn> } }).ledge;
    expect(bridge.clipboardQuickPastePaste).toHaveBeenCalledWith({ entryId: 'e2', previousBundleId: '' });
  });

  it('7.7 mouseenter on a list item sets focus to that item', async () => {
    const state = buildState();
    state.clipboardHistory = [buildEntry({ id: 'e1' }), buildEntry({ id: 'e2' })];
    (window as unknown as { ledge: { clipboardGetRecent: ReturnType<typeof vi.fn> } }).ledge.clipboardGetRecent =
      vi.fn(async () => state.clipboardHistory);
    render(<QuickPastePalette />);
    stateListeners.forEach((cb) => cb(state));
    await waitFor(() => {
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    });
    const items = document.querySelectorAll('[role="option"]');
    fireEvent.mouseEnter(items[1] as HTMLElement);
    expect(items[0]?.getAttribute('aria-selected')).toBe('false');
    expect(items[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('7.8 click on a list item pastes that item', async () => {
    const state = buildState();
    state.clipboardHistory = [buildEntry({ id: 'e1' }), buildEntry({ id: 'e2' })];
    (window as unknown as { ledge: { clipboardGetRecent: ReturnType<typeof vi.fn> } }).ledge.clipboardGetRecent =
      vi.fn(async () => state.clipboardHistory);
    render(<QuickPastePalette />);
    stateListeners.forEach((cb) => cb(state));
    await waitFor(() => {
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    });
    const items = document.querySelectorAll('[role="option"]');
    fireEvent.click(items[1] as HTMLElement);
    const bridge = (window as unknown as { ledge: { clipboardQuickPastePaste: ReturnType<typeof vi.fn> } }).ledge;
    expect(bridge.clipboardQuickPastePaste).toHaveBeenCalledWith({ entryId: 'e2', previousBundleId: '' });
  });

  it('7.12 Escape hides the palette', () => {
    render(<QuickPastePalette />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(window, event);
    const bridge = (window as unknown as { ledge: { clipboardQuickPasteHide: ReturnType<typeof vi.fn> } }).ledge;
    expect(bridge.clipboardQuickPasteHide).toHaveBeenCalled();
  });

  it('7.13 Clear button calls clipboardEntryClearAll', async () => {
    const state = buildState();
    state.clipboardHistory = [buildEntry({ id: 'e1' })];
    (window as unknown as { ledge: { clipboardGetRecent: ReturnType<typeof vi.fn> } }).ledge.clipboardGetRecent =
      vi.fn(async () => state.clipboardHistory);
    render(<QuickPastePalette />);
    stateListeners.forEach((cb) => cb(state));
    await waitFor(() => {
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    });
    const clearButton = document.querySelector('button.quick-paste-action') as HTMLButtonElement;
    clearButton.click();
    const bridge = (window as unknown as { ledge: { clipboardEntryClearAll: ReturnType<typeof vi.fn> } }).ledge;
    expect(bridge.clipboardEntryClearAll).toHaveBeenCalled();
  });
});
