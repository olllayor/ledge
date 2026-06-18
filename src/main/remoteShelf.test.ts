import { describe, it, expect } from 'vitest';
import { sanitizeRemoteFileRefs } from './remoteShelf';
import type { ShelfRecord } from '@shared/schema';

function makeFileShelf(originalPath: string, resolvedPath: string): ShelfRecord {
  return {
    id: 'shelf-1',
    name: 'Remote',
    color: 'ember',
    origin: 'restore',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    items: [
      {
        id: 'item-1',
        kind: 'file',
        createdAt: '2025-01-01T00:00:00.000Z',
        order: 0,
        title: 'malicious.png',
        subtitle: '1 KB',
        preview: { summary: 'PNG', detail: '/etc/passwd' },
        file: {
          originalPath,
          resolvedPath,
          bookmarkBase64: 'BASE64-BOOKMARK',
          isStale: false,
          isMissing: false,
        },
        mimeType: 'image/png',
      },
    ],
  };
}

describe('sanitizeRemoteFileRefs', () => {
  it('strips originalPath so the asset protocol cannot be tricked', () => {
    const shelf = makeFileShelf('/etc/passwd', '/etc/passwd');
    const sanitized = sanitizeRemoteFileRefs(shelf);
    const item = sanitized.items[0]!;
    if (item.kind !== 'file') throw new Error('expected file');
    expect(item.file.originalPath).toBe('');
    expect(item.file.resolvedPath).toBe('');
    expect(item.file.bookmarkBase64).toBe('');
    expect(item.file.isMissing).toBe(true);
    expect(item.file.isStale).toBe(true);
  });

  it('preserves non-file-backed item fields unchanged', () => {
    const shelf: ShelfRecord = {
      id: 'shelf-2',
      name: 'Remote text',
      color: 'wave',
      origin: 'restore',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      items: [
        {
          id: 'text-1',
          kind: 'text',
          createdAt: '2025-01-01T00:00:00.000Z',
          order: 0,
          title: 'hello',
          subtitle: '5 characters',
          preview: { summary: 'hello', detail: '' },
          text: 'hello',
        },
      ],
    };
    const sanitized = sanitizeRemoteFileRefs(shelf);
    expect(sanitized.items[0]).toEqual(shelf.items[0]);
  });

  it('strips paths on imageAsset items too', () => {
    const shelf: ShelfRecord = {
      id: 'shelf-3',
      name: 'Remote images',
      color: 'forest',
      origin: 'restore',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      items: [
        {
          id: 'img-1',
          kind: 'imageAsset',
          createdAt: '2025-01-01T00:00:00.000Z',
          order: 0,
          title: 'photo.png',
          subtitle: '1 KB',
          preview: { summary: 'image/png', detail: 'Imported image asset' },
          mimeType: 'image/png',
          file: {
            originalPath: '/Users/victim/secret.png',
            resolvedPath: '/Users/victim/secret.png',
            bookmarkBase64: 'x',
            isStale: false,
            isMissing: false,
          },
        },
      ],
    };
    const sanitized = sanitizeRemoteFileRefs(shelf);
    const item = sanitized.items[0]!;
    if (item.kind !== 'imageAsset') throw new Error('expected imageAsset');
    expect(item.file.originalPath).toBe('');
    expect(item.file.resolvedPath).toBe('');
    expect(item.file.isMissing).toBe(true);
  });

  it('strips paths on folder items', () => {
    const shelf: ShelfRecord = {
      id: 'shelf-4',
      name: 'Remote folder',
      color: 'sand',
      origin: 'restore',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      items: [
        {
          id: 'folder-1',
          kind: 'folder',
          createdAt: '2025-01-01T00:00:00.000Z',
          order: 0,
          title: 'Secret',
          subtitle: 'Folder',
          preview: { summary: 'Folder reference', detail: '/Users/victim/secret' },
          file: {
            originalPath: '/Users/victim/secret',
            resolvedPath: '/Users/victim/secret',
            bookmarkBase64: 'x',
            isStale: false,
            isMissing: false,
          },
        },
      ],
    };
    const sanitized = sanitizeRemoteFileRefs(shelf);
    const item = sanitized.items[0]!;
    if (item.kind !== 'folder') throw new Error('expected folder');
    expect(item.file.originalPath).toBe('');
    expect(item.file.resolvedPath).toBe('');
  });
});

import { decideRemoteShelfApply } from './remoteShelf';

function makeShelf(updatedAt: string, id = 'shelf-1'): ShelfRecord {
  return {
    id,
    name: 'Shelf',
    color: 'ember',
    origin: 'restore',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt,
    items: [],
  };
}

describe('decideRemoteShelfApply', () => {
  it('applies on first contact even when local is newer (clock skew)', () => {
    const decision = decideRemoteShelfApply({
      remote: makeShelf('2025-01-01T00:00:00.000Z'),
      local: makeShelf('2025-01-01T00:00:10.000Z'),
      lastSyncedRemoteUpdatedAt: null
    });
    expect(decision.apply).toBe(true);
    expect(decision.reason).toBe('first-contact');
    expect(decision.nextWatermark).toBe(Date.parse('2025-01-01T00:00:00.000Z'));
  });

  it('applies on first contact with no local shelf', () => {
    const decision = decideRemoteShelfApply({
      remote: makeShelf('2025-01-01T00:00:00.000Z'),
      local: null,
      lastSyncedRemoteUpdatedAt: null
    });
    expect(decision.apply).toBe(true);
    expect(decision.reason).toBe('first-contact');
  });

  it('treats equal timestamps as a no-op once the watermark is set', () => {
    // First contact applies and advances the watermark.
    const ts = '2025-01-01T00:00:00.000Z';
    const first = decideRemoteShelfApply({
      remote: makeShelf(ts),
      local: makeShelf(ts),
      lastSyncedRemoteUpdatedAt: null
    });
    expect(first.apply).toBe(true);
    expect(first.nextWatermark).toBe(Date.parse(ts));

    // Replay of the same remote: stale.
    const replay = decideRemoteShelfApply({
      remote: makeShelf(ts),
      local: makeShelf(ts),
      lastSyncedRemoteUpdatedAt: first.nextWatermark
    });
    expect(replay.apply).toBe(false);
    expect(replay.reason).toBe('stale');
    expect(replay.nextWatermark).toBe(first.nextWatermark);
  });

  it('drops a remote that is older than the watermark', () => {
    const newer = '2025-01-01T00:00:10.000Z';
    const older = '2025-01-01T00:00:00.000Z';
    const first = decideRemoteShelfApply({
      remote: makeShelf(newer),
      local: null,
      lastSyncedRemoteUpdatedAt: null
    });
    expect(first.nextWatermark).toBe(Date.parse(newer));

    const stale = decideRemoteShelfApply({
      remote: makeShelf(older),
      local: makeShelf(newer),
      lastSyncedRemoteUpdatedAt: first.nextWatermark
    });
    expect(stale.apply).toBe(false);
    expect(stale.reason).toBe('stale');
    expect(stale.nextWatermark).toBe(first.nextWatermark);
  });

  it('applies a remote that is strictly fresher than the watermark', () => {
    const t0 = '2025-01-01T00:00:00.000Z';
    const t1 = '2025-01-01T00:00:10.000Z';
    const first = decideRemoteShelfApply({
      remote: makeShelf(t0),
      local: null,
      lastSyncedRemoteUpdatedAt: null
    });

    const fresher = decideRemoteShelfApply({
      remote: makeShelf(t1),
      local: makeShelf(t0),
      lastSyncedRemoteUpdatedAt: first.nextWatermark
    });
    expect(fresher.apply).toBe(true);
    expect(fresher.reason).toBe('fresher');
    expect(fresher.nextWatermark).toBe(Date.parse(t1));
  });

  it('coerces unparseable remote timestamps to 0 and still applies on first contact', () => {
    const decision = decideRemoteShelfApply({
      remote: makeShelf('not-a-date'),
      local: null,
      lastSyncedRemoteUpdatedAt: null
    });
    expect(decision.apply).toBe(true);
    expect(decision.reason).toBe('first-contact');
    expect(decision.nextWatermark).toBe(0);
  });

  it('drops a re-issued unparseable remote once a real watermark exists', () => {
    const real = '2025-01-01T00:00:00.000Z';
    const seeded = decideRemoteShelfApply({
      remote: makeShelf(real),
      local: null,
      lastSyncedRemoteUpdatedAt: null
    });

    const replay = decideRemoteShelfApply({
      remote: makeShelf('not-a-date'),
      local: makeShelf(real),
      lastSyncedRemoteUpdatedAt: seeded.nextWatermark
    });
    expect(replay.apply).toBe(false);
    expect(replay.reason).toBe('stale');
  });
});
