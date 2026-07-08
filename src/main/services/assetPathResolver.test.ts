import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPathInside, resolveAllowedAssetPath } from './assetPathResolver';
import type { ShelfItemRecord } from '@shared/schema';
import { randomUUID } from 'node:crypto';

function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-asset-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeImageAssetItem(resolvedPath: string): ShelfItemRecord {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    order: 0,
    title: 'sample',
    subtitle: 'image',
    preview: { summary: 'PNG', detail: '' },
    kind: 'imageAsset',
    mimeType: 'image/png',
    file: {
      originalPath: resolvedPath,
      resolvedPath,
      bookmarkBase64: '',
      isStale: false,
      isMissing: false,
    },
  };
}

describe('isPathInside', () => {
  it('returns true for a direct child of the parent', () => {
    expect(isPathInside('/a/b', '/a/b/c.png')).toBe(true);
  });

  it('returns true for a deeply nested descendant', () => {
    expect(isPathInside('/a/b', '/a/b/c/d/e.png')).toBe(true);
  });

  it('returns true for the parent itself', () => {
    expect(isPathInside('/a/b', '/a/b')).toBe(true);
  });

  it('returns false for a sibling', () => {
    expect(isPathInside('/a/b', '/a/c.png')).toBe(false);
  });

  it('returns false for a path that just shares a prefix', () => {
    // `/a/b-other` starts with `/a/b` as a string but isn't inside it.
    expect(isPathInside('/a/b', '/a/b-other/x.png')).toBe(false);
  });
});

describe('resolveAllowedAssetPath', () => {
  it('rejects a relative path', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const result = resolveAllowedAssetPath('relative/path.png', {
        assetsDir: dir,
        liveItems: [],
      });
      expect(result).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('rejects a path that is neither in assetsDir nor a live item', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const other = join(dir, '..', 'sibling.png');
      const result = resolveAllowedAssetPath(other, {
        assetsDir: dir,
        liveItems: [],
      });
      expect(result).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('accepts a path inside assetsDir', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const file = join(dir, 'pic.png');
      writeFileSync(file, 'fake');
      const result = resolveAllowedAssetPath(file, {
        assetsDir: dir,
        liveItems: [],
      });
      expect(result).toBe(file);
    } finally {
      cleanup();
    }
  });

  it('accepts a path that matches a live imageAsset item', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const assetsDir = join(dir, 'assets');
      const outsideFile = join(dir, 'outside.png');
      writeFileSync(outsideFile, 'fake');
      const item = makeImageAssetItem(outsideFile);
      const result = resolveAllowedAssetPath(outsideFile, {
        assetsDir,
        liveItems: [item],
      });
      expect(result).toBe(outsideFile);
    } finally {
      cleanup();
    }
  });

  it('accepts a path that matches a live file item with an image mime type', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const assetsDir = join(dir, 'assets');
      const outsideFile = join(dir, 'photo.jpg');
      writeFileSync(outsideFile, 'fake');
      const item: ShelfItemRecord = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'photo',
        subtitle: 'image',
        preview: { summary: 'JPG', detail: '' },
        kind: 'file',
        mimeType: 'image/jpeg',
        file: {
          originalPath: outsideFile,
          resolvedPath: outsideFile,
          bookmarkBase64: '',
          isStale: false,
          isMissing: false,
        },
      };
      const result = resolveAllowedAssetPath(outsideFile, {
        assetsDir,
        liveItems: [item],
      });
      expect(result).toBe(outsideFile);
    } finally {
      cleanup();
    }
  });

  it('rejects a path that matches a live non-image file item', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const assetsDir = join(dir, 'assets');
      const outsideFile = join(dir, 'document.pdf');
      writeFileSync(outsideFile, 'fake');
      const item: ShelfItemRecord = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        order: 0,
        title: 'document',
        subtitle: 'PDF',
        preview: { summary: 'PDF', detail: '' },
        kind: 'file',
        mimeType: 'application/pdf',
        file: {
          originalPath: outsideFile,
          resolvedPath: outsideFile,
          bookmarkBase64: '',
          isStale: false,
          isMissing: false,
        },
      };
      const result = resolveAllowedAssetPath(outsideFile, {
        assetsDir,
        liveItems: [item],
      });
      expect(result).toBeNull();
    } finally {
      cleanup();
    }
  });
});
