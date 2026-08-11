import { describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import { pathsExist, startNativeDrag } from './dragController';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-drag-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('pathsExist', () => {
  it('returns false for an empty path list', () => {
    expect(pathsExist([])).toBe(false);
  });

  it('returns true when every path exists', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const a = join(dir, 'a.txt');
      const b = join(dir, 'b.txt');
      writeFileSync(a, 'a');
      writeFileSync(b, 'b');
      expect(pathsExist([a, b])).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('returns false when any path is missing', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const a = join(dir, 'a.txt');
      writeFileSync(a, 'a');
      expect(pathsExist([a, join(dir, 'missing.txt')])).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('returns false when the only path is missing', () => {
    expect(pathsExist(['/this/path/does/not/exist'])).toBe(false);
  });
});

describe('startNativeDrag', () => {
  // Stub icon resolver so we never touch Electron's `app.getAppPath()`,
  // which is `undefined` under vitest.
  const fakeIcon = { isEmpty: () => false } as unknown as NativeImage;
  const resolveIcon = () => fakeIcon;

  it('does nothing when no path is provided', () => {
    const startDrag = vi.fn();
    const fakeWebContents = { startDrag } as unknown as Parameters<typeof startNativeDrag>[0];
    startNativeDrag(fakeWebContents, [], { resolveIcon });
    expect(startDrag).not.toHaveBeenCalled();
  });

  it('does nothing when the first path is missing', () => {
    const startDrag = vi.fn();
    const fakeWebContents = { startDrag } as unknown as Parameters<typeof startNativeDrag>[0];
    startNativeDrag(fakeWebContents, ['/this/path/does/not/exist'], { resolveIcon });
    expect(startDrag).not.toHaveBeenCalled();
  });

  it('passes a single-path payload when only one path is supplied', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const file = join(dir, 'x.png');
      writeFileSync(file, 'fake');
      const startDrag = vi.fn();
      const fakeWebContents = { startDrag } as unknown as Parameters<typeof startNativeDrag>[0];
      startNativeDrag(fakeWebContents, [file], { resolveIcon });
      expect(startDrag).toHaveBeenCalledTimes(1);
      const payload = startDrag.mock.calls[0][0] as { file?: string; files?: string[]; icon: NativeImage };
      expect(payload.file).toBe(file);
      expect(payload.files).toBeUndefined();
      expect(payload.icon).toBe(fakeIcon);
    } finally {
      cleanup();
    }
  });

  it('passes a multi-path payload when more than one path is supplied', () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const a = join(dir, 'a.png');
      const b = join(dir, 'b.png');
      writeFileSync(a, 'a');
      writeFileSync(b, 'b');
      const startDrag = vi.fn();
      const fakeWebContents = { startDrag } as unknown as Parameters<typeof startNativeDrag>[0];
      startNativeDrag(fakeWebContents, [a, b], { resolveIcon });
      expect(startDrag).toHaveBeenCalledTimes(1);
      const payload = startDrag.mock.calls[0][0] as { file?: string; files?: string[]; icon: NativeImage };
      expect(payload.file).toBe(a);
      expect(payload.files).toEqual([a, b]);
      expect(payload.icon).toBe(fakeIcon);
    } finally {
      cleanup();
    }
  });

  it('falls back to the default icon resolver when none is supplied', () => {
    // We only assert that it doesn't throw without the override; the
    // default resolver accesses Electron's `app.getAppPath()` which is
    // undefined under vitest, but the outer `pathsExist` short-circuits
    // before that for a missing path.
    const startDrag = vi.fn();
    const fakeWebContents = { startDrag } as unknown as Parameters<typeof startNativeDrag>[0];
    expect(() => startNativeDrag(fakeWebContents, ['/missing'])).not.toThrow();
    expect(startDrag).not.toHaveBeenCalled();
  });
});
