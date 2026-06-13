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
