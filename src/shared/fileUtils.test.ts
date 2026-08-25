import { describe, expect, it } from 'vitest';
import {
  healFileRef,
  healShelfItem,
  isSafeImageDataUri,
  unmountedVolumeRoot,
} from './fileUtils';
import type { ShelfItemRecord } from './schema';

describe('unmountedVolumeRoot', () => {
  it('returns null for boot-volume paths', () => {
    expect(unmountedVolumeRoot('/Users/alice/notes.txt')).toBeNull();
    expect(unmountedVolumeRoot('/tmp/file.dat')).toBeNull();
    expect(unmountedVolumeRoot('/')).toBeNull();
  });

  it('returns null for the /Volumes root itself', () => {
    expect(unmountedVolumeRoot('/Volumes')).toBeNull();
    expect(unmountedVolumeRoot('/Volumes/')).toBeNull();
  });

  it('returns null for a volume root path', () => {
    expect(unmountedVolumeRoot('/Volumes/USB')).toBeNull();
  });

  it('returns the volume root for files on a volume', () => {
    expect(unmountedVolumeRoot('/Volumes/USB/file.txt')).toBe('/Volumes/USB');
    expect(unmountedVolumeRoot('/Volumes/Backup/deep/nested/file.md')).toBe('/Volumes/Backup');
  });

  it('ignores trailing slashes and empty segments', () => {
    expect(unmountedVolumeRoot('/Volumes/USB/')).toBeNull();
    expect(unmountedVolumeRoot('//Volumes//USB//file.txt')).toBe('/Volumes/USB');
  });
});

function fileRef(overrides: Partial<Parameters<typeof healFileRef>[0]> = {}) {
  return {
    originalPath: '/Users/alice/report.pdf',
    bookmarkBase64: 'Qk9PSw==',
    resolvedPath: '/Users/alice/report.pdf',
    isStale: false,
    isMissing: false,
    ...overrides,
  };
}

function makeDeps(overrides: {
  exists?: (path: string) => Promise<boolean>;
  resolveBookmark?: (bookmark: string, originalPath: string) => Promise<{
    resolvedPath: string;
    isStale: boolean;
    isMissing: boolean;
  }>;
} = {}) {
  return {
    exists: overrides.exists ?? (async () => true),
    resolveBookmark:
      overrides.resolveBookmark ??
      (async () => ({ resolvedPath: '', isStale: false, isMissing: true })),
  };
}

describe('healFileRef', () => {
  it('leaves healthy items alone', async () => {
    const ref = fileRef();
    const result = await healFileRef(ref, makeDeps());
    expect(result).toEqual({ fileRef: ref, healed: false, deferredForVolume: false });
  });

  it('heals a rename via bookmark', async () => {
    const result = await healFileRef(
      fileRef({ resolvedPath: '' }),
      makeDeps({
        exists: async (path) => path === '/Volumes/X',
        resolveBookmark: async () => ({
          resolvedPath: '/Users/alice/report-final.pdf',
          isStale: false,
          isMissing: false,
        }),
      }),
    );
    expect(result.healed).toBe(true);
    expect(result.fileRef.resolvedPath).toBe('/Users/alice/report-final.pdf');
    expect(result.fileRef.isMissing).toBe(false);
    expect(result.fileRef.originalPath).toBe('/Users/alice/report.pdf');
  });

  it('defers when the underlying volume is not mounted', async () => {
    let bookmarkCalls = 0;
    const result = await healFileRef(
      fileRef({ originalPath: '/Volumes/USB/file.txt', resolvedPath: '/Volumes/USB/file.txt' }),
      makeDeps({
        exists: async () => false,
        resolveBookmark: async () => {
          bookmarkCalls += 1;
          return { resolvedPath: '/somewhere', isStale: false, isMissing: false };
        },
      }),
    );
    expect(result.deferredForVolume).toBe(true);
    expect(result.healed).toBe(false);
    expect(bookmarkCalls).toBe(0);
  });

  it('marks missing when the bookmark is dead', async () => {
    const result = await healFileRef(
      fileRef({ resolvedPath: '' }),
      makeDeps({ exists: async () => false }),
    );
    expect(result.healed).toBe(false);
    expect(result.fileRef.isMissing).toBe(true);
  });

  it('marks missing when no bookmark exists', async () => {
    const result = await healFileRef(
      fileRef({ bookmarkBase64: '', resolvedPath: '' }),
      makeDeps({ exists: async () => false }),
    );
    expect(result.healed).toBe(false);
    expect(result.fileRef.isMissing).toBe(true);
  });

  it('degrades to missing when bookmark resolution throws', async () => {
    const result = await healFileRef(
      fileRef({ resolvedPath: '' }),
      makeDeps({
        exists: async () => false,
        resolveBookmark: async () => {
          throw new Error('native helper timeout');
        },
      }),
    );
    expect(result.healed).toBe(false);
    expect(result.fileRef.isMissing).toBe(true);
  });
});

function fileItem(path: string, overrides: Record<string, unknown> = {}): ShelfItemRecord {
  return {
    id: 'item-1',
    kind: 'file',
    createdAt: '2026-01-01T00:00:00.000Z',
    order: 0,
    title: 'report.pdf',
    subtitle: '',
    preview: { summary: 'PDF', detail: path },
    mimeType: 'application/pdf',
    file: fileRef({ originalPath: path, resolvedPath: path }),
    ...overrides,
  } as ShelfItemRecord;
}

describe('healShelfItem', () => {
  it('retitles healed items to the new basename', async () => {
    const result = await healShelfItem(
      fileItem('/Users/alice/old-name.pdf', { file: fileRef({ resolvedPath: '' }) }),
      makeDeps({
        exists: async () => false,
        resolveBookmark: async () => ({
          resolvedPath: '/Users/alice/new-name.pdf',
          isStale: false,
          isMissing: false,
        }),
      }),
    );
    expect(result.healed).toBe(true);
    if (result.item.kind === 'file') {
      expect(result.item.title).toBe('new-name.pdf');
      expect(result.item.file.resolvedPath).toBe('/Users/alice/new-name.pdf');
    } else {
      throw new Error('expected file item');
    }
  });

  it('passes non-file items through untouched', async () => {
    const textItem: ShelfItemRecord = {
      id: 't1',
      kind: 'text',
      createdAt: '2026-01-01T00:00:00.000Z',
      order: 0,
      title: 'note',
      subtitle: '',
      preview: { summary: 'note', detail: '' },
      text: 'hello',
    };
    const result = await healShelfItem(textItem, makeDeps());
    expect(result.item).toBe(textItem);
    expect(result.healed).toBe(false);
  });
});

describe('isSafeImageDataUri', () => {
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('accepts inline png/jpeg/webp data URLs', () => {
    expect(isSafeImageDataUri(tinyPng)).toBe(true);
    expect(isSafeImageDataUri('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    expect(isSafeImageDataUri('data:image/webp;base64,UklGRh4A')).toBe(true);
  });

  it('rejects remote and non-image schemes', () => {
    expect(isSafeImageDataUri('https://evil.example/track.png')).toBe(false);
    expect(isSafeImageDataUri('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeImageDataUri('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafeImageDataUri('')).toBe(false);
  });

  it('rejects oversized payloads', () => {
    const big = `data:image/png;base64,${'A'.repeat(512 * 1024)}`;
    expect(isSafeImageDataUri(big)).toBe(false);
  });
});
