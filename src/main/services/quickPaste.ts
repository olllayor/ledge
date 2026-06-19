import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { clipboard, nativeImage } from 'electron';
import type { ClipboardEntry, ShelfItemRecord } from '@shared/schema';
import { getFileBackedPath, isFileBackedItem } from '@shared/fileUtils';

/**
 * Writes the entry's payload to the system clipboard and (opt-in) sends a
 * synthetic ⌘V keystroke to the previously-focused app. The default path
 * is the write-only path + on-screen hint; synthetic paste is fragile
 * across Terminal, apps with remapped Cmd+V, and some Electron apps.
 */
export async function quickPastePasteEntry(
  entryId: string,
  previousBundleId: string,
  getEntry: (id: string) => ClipboardEntry | undefined,
  settings: { syntheticPasteEnabled: boolean; ignoreBundleIds: string[] },
  ledeBundleId: string,
): Promise<void> {
  const entry = getEntry(entryId);
  if (!entry) return;
  if (previousBundleId === ledeBundleId) return; // Don't paste back into Ledge.
  if (previousBundleId && settings.ignoreBundleIds.includes(previousBundleId)) return;

  writeEntryToClipboard(entry.item);

  if (settings.syntheticPasteEnabled) {
    try {
      await execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    } catch {
      // Synthetic paste is best-effort. The clipboard is already written;
      // the renderer should surface a "Press ⌘V" hint regardless.
    }
  }
}

function writeEntryToClipboard(item: ShelfItemRecord): void {
  switch (item.kind) {
    case 'text':
      clipboard.writeText(item.text);
      return;
    case 'url':
      clipboard.writeText(item.url);
      return;
    case 'code':
      clipboard.writeText(item.text);
      return;
    case 'color':
      clipboard.writeText(item.hex);
      return;
    case 'imageAsset':
      writeImageAssetToClipboard(item);
      return;
    case 'file':
    case 'folder':
      writeFileBackedToClipboard(item);
      return;
  }
}

function writeImageAssetToClipboard(item: ShelfItemRecord): void {
  if (!('file' in item)) return;
  const imagePath = getFileBackedPath(item);
  if (!imagePath) return;
  try {
    const image = nativeImage.createFromPath(imagePath);
    if (!image.isEmpty()) {
      clipboard.writeImage(image);
    }
  } catch {
    // Best-effort.
  }
}

function writeFileBackedToClipboard(item: ShelfItemRecord): void {
  if (!isFileBackedItem(item)) return;
  const path = getFileBackedPath(item);
  if (!path) return;
  clipboard.clear();
  clipboard.writeText(path);
  clipboard.writeBuffer('public.file-url', Buffer.from(`file://${path}`, 'utf8'));
}

export function fileBackedPathsFromEntry(entry: ClipboardEntry): string[] {
  const item = entry.item;
  if (!isFileBackedItem(item)) return [];
  const path = getFileBackedPath(item);
  if (!path) return [];
  return [path];
}

/**
 * Used by the renderer for hint text after a paste: returns the file size
 * of an image asset so the renderer can decide whether to show a "large
 * image" hint. Returns null for non-file-backed entries.
 */
export async function describeEntryForHint(entry: ClipboardEntry): Promise<string | null> {
  if (!isFileBackedItem(entry.item)) return null;
  const path = getFileBackedPath(entry.item);
  if (!path) return null;
  try {
    const stat = await fs.stat(path);
    return `${Math.round(stat.size / 1024)} KB`;
  } catch {
    return null;
  }
}
