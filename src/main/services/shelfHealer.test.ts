import { describe, expect, it } from 'vitest';
import { ShelfHealer, type ShelfHealerDeps } from './shelfHealer';
import type { ShelfItemRecord, ShelfRecord } from '@shared/schema';

function fileItem(id: string, path: string): ShelfItemRecord {
  return {
    id,
    kind: 'file',
    createdAt: '2026-01-01T00:00:00.000Z',
    order: 0,
    title: `${id}.pdf`,
    subtitle: '',
    preview: { summary: 'PDF', detail: path },
    mimeType: 'application/pdf',
    file: {
      originalPath: path,
      resolvedPath: path,
      bookmarkBase64: 'Qk9PSw==',
      isStale: false,
      isMissing: false,
    },
  };
}

function textItem(id: string): ShelfItemRecord {
  return {
    id,
    kind: 'text',
    createdAt: '2026-01-01T00:00:00.000Z',
    order: 1,
    title: id,
    subtitle: '',
    preview: { summary: id, detail: '' },
    text: 'hello',
  };
}

interface HarnessOptions {
  items: ShelfItemRecord[];
  /** Path that "exists" on disk; null means nothing resolves. */
  existingPath?: string | null;
}

interface Harness {
  healer: ShelfHealer;
  saved: ShelfRecord[];
  resolveCalls(): number;
}

function makeHarness(options: HarnessOptions): Harness {
  const { items } = options;
  const existingPath = options.existingPath === undefined ? '/Users/alice/here.pdf' : options.existingPath;
  const saved: ShelfRecord[] = [];
  let resolveCallCount = 0;

  const liveShelf: ShelfRecord = {
    id: 'shelf-1',
    name: 'Live',
    color: 'ember',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    origin: 'manual',
    items,
  };

  const deps: ShelfHealerDeps = {
    stateStore: {
      getPersonalLiveShelf: () => liveShelf,
      replacePersonalLiveShelf: (shelf: ShelfRecord) => {
        saved.push(shelf);
      },
    } as unknown as ShelfHealerDeps['stateStore'],
    exists: async (path) => path === existingPath,
    resolveBookmark: async () => {
      resolveCallCount += 1;
      if (existingPath === null) {
        return { resolvedPath: '', isStale: false, isMissing: true };
      }
      return { resolvedPath: existingPath, isStale: false, isMissing: false };
    },
  };

  return {
    healer: new ShelfHealer(deps),
    saved,
    resolveCalls: () => resolveCallCount,
  };
}

describe('ShelfHealer', () => {
  it('heals moved files, retitles, and persists once', async () => {
    const item = fileItem('a', '/Users/alice/old.pdf');
    const harness = makeHarness({ items: [item], existingPath: '/Users/alice/new.pdf' });

    const healed = await harness.healer.healPersonalLiveShelf();

    expect(healed).toBe(true);
    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]?.items[0]).toMatchObject({
      title: 'new.pdf',
      file: { resolvedPath: '/Users/alice/new.pdf', isMissing: false },
    });
  });

  it('does not persist or call bookmarks when everything is healthy', async () => {
    const harness = makeHarness({
      items: [fileItem('a', '/Users/alice/here.pdf'), textItem('t')],
      existingPath: '/Users/alice/here.pdf',
    });

    const healed = await harness.healer.healPersonalLiveShelf();

    expect(healed).toBe(false);
    expect(harness.saved).toHaveLength(0);
    expect(harness.resolveCalls()).toBe(0);
  });

  it('defers items on unmounted volumes without marking them missing', async () => {
    // Nothing exists on disk, including the /Volumes root → defer.
    const harness = makeHarness({ items: [fileItem('a', '/Volumes/USB/doc.pdf')], existingPath: null });

    const healed = await harness.healer.healPersonalLiveShelf();

    expect(healed).toBe(false);
    expect(harness.saved).toHaveLength(0);
    // Deferred before any bookmark use: resolution would find the file
    // in our fake (null → dead), proving the volume guard short-circuits.
  });

  it('keeps dead items instead of deleting them and skips persistence', async () => {
    const harness = makeHarness({ items: [fileItem('a', '/Users/alice/gone.pdf')], existingPath: null });

    const healed = await harness.healer.healPersonalLiveShelf();

    expect(harness.resolveCalls()).toBeGreaterThan(0);
    // Missing-flag flip alone is not a heal: on-disk ref already
    // carries the same state, so no rewrite happens.
    expect(healed).toBe(false);
    expect(harness.saved).toHaveLength(0);
  });

  it('returns false when there is no live shelf', async () => {
    const saved: ShelfRecord[] = [];
    const healer = new ShelfHealer({
      stateStore: {
        getPersonalLiveShelf: () => null,
        replacePersonalLiveShelf: (shelf: ShelfRecord) => {
          saved.push(shelf);
        },
      } as unknown as ShelfHealerDeps['stateStore'],
      exists: async () => true,
      resolveBookmark: async () => ({ resolvedPath: '', isStale: false, isMissing: true }),
    });

    await expect(healer.healPersonalLiveShelf()).resolves.toBe(false);
    expect(saved).toHaveLength(0);
  });
});
