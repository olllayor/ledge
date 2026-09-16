import { describe, expect, it } from 'vitest';
import {
  normalizeInviteEmail,
  parseRole,
  randomInviteToken,
  sanitizeTeamItem,
} from '../src/teams';
import { sha256 } from '../src/crypto';

describe('randomInviteToken', () => {
  it('is 32 bytes hex-encoded (64 chars)', () => {
    const token = randomInviteToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces distinct tokens', () => {
    const a = randomInviteToken();
    const b = randomInviteToken();
    expect(a).not.toBe(b);
  });
});

describe('normalizeInviteEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeInviteEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  it('rejects invalid addresses', () => {
    expect(() => normalizeInviteEmail('nope')).toThrow();
    expect(() => normalizeInviteEmail(42)).toThrow();
  });
});

describe('parseRole', () => {
  it('accepts admin/member only', () => {
    expect(parseRole('admin')).toBe('admin');
    expect(parseRole('member')).toBe('member');
    expect(() => parseRole('owner')).toThrow();
  });
});

describe('sanitizeTeamItem', () => {
  it('strips local file paths from file items', () => {
    const item = sanitizeTeamItem({
      itemId: 'item-1',
      kind: 'file',
      title: 'Report.pdf',
      subtitle: 'PDF',
      preview: { summary: 'Report', detail: '/Users/me/secret' },
      order: 'a1',
      version: 1,
      file: {
        originalPath: '/Users/me/Desktop/Report.pdf',
        resolvedPath: '/Users/me/Desktop/Report.pdf',
        isStale: true,
        isMissing: true,
        bookmarkBase64: 'AAAA',
      },
      mimeType: 'application/pdf',
    });

    expect(item.itemId).toBe('item-1');
    expect(item.payload.file).toEqual({
      isStale: true,
      isMissing: true,
    });
    expect(JSON.stringify(item.payload)).not.toContain('/Users/me');
    expect(JSON.stringify(item.payload)).not.toContain('bookmarkBase64');
  });

  it('omits savedFilePath on text items', () => {
    const item = sanitizeTeamItem({
      id: 'item-2',
      kind: 'text',
      title: 'note',
      subtitle: '',
      preview: { summary: '', detail: '' },
      order: 3,
      version: 2,
      text: 'hello',
      savedFilePath: '/tmp/note.txt',
    });

    expect(item.order).toBe('3');
    expect(item.payload.text).toBe('hello');
    expect(item.payload.savedFilePath).toBeUndefined();
    expect(JSON.stringify(item.payload)).not.toContain('/tmp/note.txt');
  });

  it('keeps cloudStorageKey for R2-backed images', () => {
    const item = sanitizeTeamItem({
      itemId: 'img-1',
      kind: 'imageAsset',
      title: 'shot',
      subtitle: '',
      preview: { summary: '', detail: '' },
      order: 'a0',
      version: 1,
      file: {
        originalPath: '/tmp/x.png',
        resolvedPath: '/tmp/x.png',
        isStale: false,
        isMissing: false,
      },
      cloudStorageKey: 'users/u1/shelves/s1/items/img-1',
      cloudStorageBytes: 1024,
      mimeType: 'image/png',
    });

    expect(item.payload.cloudStorageKey).toBe('users/u1/shelves/s1/items/img-1');
    expect(item.payload.cloudStorageBytes).toBe(1024);
    expect(JSON.stringify(item.payload)).not.toContain('/tmp/x.png');
  });

  it('rejects missing id or unknown kind', () => {
    expect(() =>
      sanitizeTeamItem({ kind: 'text', title: 'x', order: 'a', version: 1 }),
    ).toThrow();
    expect(() =>
      sanitizeTeamItem({ itemId: 'i', kind: 'nope', title: 'x', order: 'a', version: 1 }),
    ).toThrow();
  });
});

describe('invite token storage', () => {
  it('hash is not reversible to the raw token and differs per invite', async () => {
    const t1 = randomInviteToken();
    const t2 = randomInviteToken();
    const h1 = await sha256(t1);
    const h2 = await sha256(t2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(t1);
    expect(h1).not.toBe(h2);
  });
});
