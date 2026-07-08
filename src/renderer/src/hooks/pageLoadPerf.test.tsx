// @vitest-environment happy-dom
/**
 * Page-load performance harness for the renderer.
 *
 * For every "page" in the renderer (shelf, preferences, clipboard,
 * quick-paste, peek), this test:
 *
 *   1. Sets up a fake preload bridge with a pre-resolved `getState()`.
 *   2. Renders the page's top-level component via @testing-library/react.
 *   3. Measures the time from the first `render()` call to the first
 *      DOM commit. This is the part of page-load the renderer actually
 *      controls — bundle parse + V8 startup are environment-level costs
 *      we can't reduce, but the React tree, hooks, and component body
 *      we can.
 *   4. Runs many iterations and reports min / median / p95.
 *
 * Lazy-loaded pages (preferences, clipboard) are warmed up *outside*
 * the timed region by pre-resolving the dynamic import. In production
 * the chunk is a tiny local file:// fetch, and once cached by the
 * module loader, subsequent navigations pay nothing. We mirror that
 * here so the measurement reflects the React render cost, not the
 * one-time chunk-load cost.
 *
 * Run with: pnpm vitest run src/renderer/src/hooks/pageLoadPerf.test.tsx
 *
 * Threshold: every page must render in < 50 ms (median). The repo is
 * judged against the median (not the min) because cold-start variance
 * is real on a Mac and the median is the most stable signal.
 *
 * (The onboarding view is intentionally not included — `App.tsx` uses
 * a `useState` lazy initializer to derive `showOnboarding` from the
 * initial `fullState`, which is always `null` on first render, so the
 * onboarding shell never appears in a normal session. That's a
 * pre-existing bug tracked separately from this perf budget.)
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor, act } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import type { AppState, ClipboardCategory, ClipboardEntry, ShelfItemRecord, ShelfRecord } from '@shared/schema';
import type { LedgeAPI } from '@shared/ipc';

const THRESHOLD_MS = 50;
const ITERATIONS = 30;

type StateListener = (state: AppState) => void;

function makeShelfItem(overrides: Partial<ShelfItemRecord> = {}): ShelfItemRecord {
  return {
    id: 'item-1',
    kind: 'file',
    title: 'Hello.pdf',
    subtitle: 'File',
    order: 0,
    preview: { summary: 'Hello.pdf', detail: '' },
    file: {
      originalPath: '/Users/ollayor/Desktop/Hello.pdf',
      resolvedPath: '/Users/ollayor/Desktop/Hello.pdf',
      isStale: false,
      isMissing: false,
    },
    mimeType: 'application/pdf',
    ...overrides,
  } as ShelfItemRecord;
}

function makeShelfRecord(itemCount: number): ShelfRecord {
  return {
    id: 'shelf-1',
    name: 'Main',
    color: 'ember',
    createdAt: '2026-06-20T10:00:00.000Z',
    updatedAt: '2026-06-20T10:01:00.000Z',
    origin: 'manual',
    items: Array.from({ length: itemCount }, (_, i) => makeShelfItem({ id: `item-${i}`, order: i })),
  };
}

function makeClipboardEntry(overrides: Partial<ClipboardEntry> = {}): ClipboardEntry {
  return {
    id: `cb-${Math.random().toString(36).slice(2)}`,
    capturedAt: new Date().toISOString(),
    sourceBundleId: 'com.test.app',
    sourceAppName: 'Test App',
    item: makeShelfItem({ title: 'Copied text' }),
    categoryIds: [],
    ...overrides,
  } as ClipboardEntry;
}

function makeAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    liveShelf: null,
    recentShelves: [],
    preferences: {
      launchAtLogin: false,
      shakeEnabled: true,
      shakeSensitivity: 'balanced',
      excludedBundleIds: [],
      globalShortcut: 'CommandOrControl+Shift+Space',
      hasCompletedOnboarding: true, // skip onboarding in perf test
      hasSeenShelfLimitMigration: false,
      shelfInteraction: { doubleClickAction: 'open', autoCloseShelf: false, autoRetract: false },
    },
    permissionStatus: {
      nativeHelperAvailable: true,
      accessibilityTrusted: true,
      shakeReady: true,
      lastError: '',
      shortcutRegistered: true,
      shortcutError: '',
    },
    sync: {
      enabled: false,
      status: 'signedOut',
      deviceId: '',
      plan: 'free',
      syncedShelfCount: 0,
      deviceCount: 0,
      storageBytesUsed: 0,
      lastError: '',
    },
    clipboardHistory: [],
    clipboardCategories: [],
    clipboardSettings: {
      enabled: false,
      historyLimit: 200,
      ignoreConcealedItems: true,
      ignoreBundleIds: [],
      quickPasteHotkey: 'CommandOrControl+Shift+V',
      peekHotkey: '',
      syntheticPasteEnabled: false,
    },
    ...overrides,
  } as AppState;
}

/**
 * Build a complete stub of the LedgeAPI preload bridge. Anything not
 * explicitly overridden returns a benign default — we don't want the
 * stub to dictate behavior the real preload would otherwise provide.
 *
 * `subscribeState` fires the current state synchronously, mirroring the
 * main-process preload which pushes the latest snapshot to a fresh
 * subscriber on the next tick. We do it sync inside `subscribeState`
 * so the consumer renders the page in the very next React commit —
 * the test's `waitFor` then has the real DOM, not a "loading…"
 * placeholder, to check against.
 */
function buildFakeLedge(state: AppState): LedgeAPI {
  const noop = () => undefined;
  const returnTrue = () => true;
  const noopAsync = () => Promise.resolve();

  return new Proxy({} as LedgeAPI, {
    get(_target, prop: string) {
      if (prop === 'getState') {
        return () => Promise.resolve(state);
      }
      if (prop === 'subscribeState') {
        return (listener: StateListener) => {
          // Fire the initial state synchronously so the page can render
          // in the same commit as the subscriber registers.
          listener(state);
          return noop;
        };
      }
      if (prop === 'onToast' || prop === 'onClipboardPeekHint' || prop === 'onClipboardQuickPasteHint') {
        return (_listener: unknown) => noop;
      }
      if (prop === 'clipboardGetRecent') {
        return () => Promise.resolve(state.clipboardHistory);
      }
      if (prop === 'clipboardSettingsGet') {
        return () => Promise.resolve(state.clipboardSettings);
      }
      if (prop === 'getPreferences') {
        return () => Promise.resolve(state.preferences);
      }
      if (prop === 'getPermissionStatus') {
        return () => Promise.resolve(state.permissionStatus);
      }
      if (prop === 'getRecentShelves') {
        return () => Promise.resolve(state.recentShelves);
      }
      if (prop === 'getSyncBackfillCandidates') {
        return () => Promise.resolve([] as ShelfRecord[]);
      }
      if (prop === 'getAppVersion') {
        return () => Promise.resolve('0.1.9');
      }
      if (prop === 'getFilePath') {
        return () => '';
      }
      if (prop === 'createShelf' || prop === 'restoreShelf' || prop === 'addPayload' || prop === 'addPayloads' || prop === 'setSyncState' || prop === 'applyRemoteShelf' || prop === 'relinkItem' || prop === 'closeShelf' || prop === 'removeItem' || prop === 'renameShelf' || prop === 'clearShelf' || prop === 'reorderItems') {
        return () => Promise.resolve(state);
      }
      if (prop === 'setPreferences') {
        return (_patch: unknown) => Promise.resolve(state.preferences);
      }
      if (prop === 'previewItem' || prop === 'revealItem' || prop === 'openItem' || prop === 'copyItem' || prop === 'saveItem' || prop === 'shareShelfItems' || prop === 'showItemContextMenu' || prop === 'showShelfContextMenu' || prop === 'openPermissionSettings' || prop === 'clipboardCopy') {
        return () => Promise.resolve(true);
      }
      if (prop === 'startItemDrag' || prop === 'startItemsDrag' || prop === 'clipboardStartItemDrag') {
        return returnTrue;
      }
      if (prop === 'clipboardQuickPasteShow' || prop === 'clipboardQuickPasteHide' || prop === 'clipboardQuickPasteFocusIndex' || prop === 'clipboardPeekShow' || prop === 'clipboardPeekHide' || prop === 'showToast' || prop === 'shelfInteractionPing') {
        return noop;
      }
      if (prop === 'clipboardQuickPastePaste') {
        return noopAsync;
      }
      if (prop === 'clipboardSettingsUpdate') {
        return (_patch: unknown) => Promise.resolve(state.clipboardSettings);
      }
      if (prop === 'clipboardCategoryCreate') {
        return () => Promise.resolve({ id: 'cat-1', name: 'New', color: 'ember', createdAt: '2026-06-20T10:00:00.000Z' } as ClipboardCategory);
      }
      if (prop === 'clipboardCategoryRename' || prop === 'clipboardCategoryRemove' || prop === 'clipboardEntryAssign' || prop === 'clipboardEntryUnassign' || prop === 'clipboardEntryRemove' || prop === 'clipboardEntryClearAll' || prop === 'clipboardPruneNow') {
        return noopAsync;
      }
      return noop;
    },
  });
}

function installFakeLedge(state: AppState): void {
  const api = buildFakeLedge(state);
  (window as unknown as { ledge: LedgeAPI }).ledge = api;
}

interface PageResult {
  page: string;
  min: number;
  median: number;
  p95: number;
}

function percentile(sortedSamples: number[], p: number): number {
  const idx = Math.min(sortedSamples.length - 1, Math.floor((p / 100) * sortedSamples.length));
  return sortedSamples[idx]!;
}

function summarize(page: string, samples: number[]): PageResult {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    page,
    min: sorted[0]!,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

async function measurePage(
  page: string,
  factory: () => ReactElement,
  stateFor: () => AppState,
  isReady: (container: HTMLElement) => boolean,
): Promise<PageResult> {
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    cleanup();
    installFakeLedge(stateFor());
    const container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    const t0 = performance.now();
    await act(async () => {
      render(factory(), { container });
    });
    await waitFor(() => {
      if (!isReady(container)) throw new Error('not ready');
    });
    const t1 = performance.now();
    samples.push(t1 - t0);
    document.body.removeChild(container);
  }
  return summarize(page, samples);
}

beforeAll(() => {
  if (!('URLSearchParams' in window)) {
    (window as unknown as { URLSearchParams: typeof URLSearchParams }).URLSearchParams = URLSearchParams;
  }
});

afterEach(() => {
  cleanup();
});

describe('page-load perf budget (< 50 ms median per page)', () => {
  it('measures every page and prints a table', async () => {
    const { App } = await import('../App');
    const { QuickPastePalette } = await import('../components/QuickPastePalette');
    const { PeekWindowView } = await import('../components/PeekWindowView');
    // Pre-resolve the lazy chunks the same way Vite's module loader
    // does on second navigation. In production the file:// fetch is
    // cached by the renderer, so the import is effectively free on
    // subsequent visits — we mirror that here.
    await Promise.all([
      import('../components/PreferencesView'),
      import('../components/ClipboardView'),
    ]);

    type PageSetup = {
      page: string;
      factory: () => ReactElement;
      stateFor: () => AppState;
      isReady: (container: HTMLElement) => boolean;
    };

    const setQuery = (q: string) => {
      window.history.replaceState(null, '', q ? `?${q}` : '/');
    };

    const pages: PageSetup[] = [
      {
        page: 'shelf',
        factory: () => {
          setQuery('view=shelf');
          return <App />;
        },
        stateFor: () => makeAppState({ liveShelf: makeShelfRecord(1) }),
        isReady: (c) => c.querySelector('.shelf-shell') !== null,
      },
      {
        page: 'shelf (with items)',
        factory: () => {
          setQuery('view=shelf');
          return <App />;
        },
        stateFor: () => makeAppState({ liveShelf: makeShelfRecord(6) }),
        isReady: (c) => c.querySelector('.shelf-shell') !== null,
      },
      {
        page: 'preferences',
        factory: () => {
          setQuery('view=preferences');
          return <App />;
        },
        stateFor: () => makeAppState(),
        isReady: (c) => c.querySelector('.preferences-shell') !== null,
      },
      {
        page: 'clipboard',
        factory: () => {
          setQuery('view=clipboard');
          return <App />;
        },
        stateFor: () =>
          makeAppState({
            clipboardHistory: Array.from({ length: 12 }, (_, i) =>
              makeClipboardEntry({ id: `cb-${i}` }),
            ),
            clipboardCategories: [
              { id: 'cat-1', name: 'Work', color: 'ember', createdAt: '2026-06-20T10:00:00.000Z' },
              { id: 'cat-2', name: 'Personal', color: 'wave', createdAt: '2026-06-20T10:00:00.000Z' },
            ],
          }),
        isReady: (c) => c.querySelector('.clipboard-shell') !== null,
      },
      {
        page: 'quickPaste',
        factory: () => (
          <Suspense fallback={null}>
            <QuickPastePalette />
          </Suspense>
        ),
        stateFor: () =>
          makeAppState({
            clipboardHistory: Array.from({ length: 9 }, (_, i) =>
              makeClipboardEntry({ id: `qp-${i}` }),
            ),
          }),
        isReady: (c) => c.querySelector('.quick-paste') !== null,
      },
      {
        page: 'peekWindow',
        factory: () => (
          <Suspense fallback={null}>
            <PeekWindowView />
          </Suspense>
        ),
        stateFor: () =>
          makeAppState({
            clipboardHistory: Array.from({ length: 8 }, (_, i) =>
              makeClipboardEntry({ id: `pk-${i}` }),
            ),
          }),
        isReady: (c) => c.querySelector('.peek') !== null,
      },
    ];

    const results: PageResult[] = [];
    for (const page of pages) {
      // Warm up the JIT for this page (first render of a fresh code path
      // is much slower; we don't want to count it).
      cleanup();
      installFakeLedge(page.stateFor());
      const warmContainer = document.createElement('div');
      document.body.appendChild(warmContainer);
      await act(async () => {
        render(page.factory(), { container: warmContainer });
      });
      document.body.removeChild(warmContainer);
      cleanup();

      const result = await measurePage(page.page, page.factory, page.stateFor, page.isReady);
      results.push(result);
    }

    // eslint-disable-next-line no-console
    console.log(
      '\n[page-load perf]\n' +
        ['page                | min ms | median ms | p95 ms', '--------------------|--------|-----------|------']
          .concat(
            results.map((r) => {
              const pad = (s: string, n: number) => s.padEnd(n, ' ');
              return `${pad(r.page, 20)}| ${pad(r.min.toFixed(2), 7)}| ${pad(r.median.toFixed(2), 10)}| ${r.p95.toFixed(2)}`;
            }),
          )
          .join('\n'),
    );

    for (const r of results) {
      expect(r.median).toBeLessThan(THRESHOLD_MS);
    }
  }, 120_000);
});
