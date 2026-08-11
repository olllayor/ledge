import { execFile as execFileCb } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';

// Callback-form execFile returns a ChildProcess, not a Promise — awaiting
// it resolves on the next microtask, before osascript has actually
// delivered the ⌘V keystroke. Promisify so `await` waits for the child
// process to exit and a real failure is observable in the catch below.
const execFile = promisify(execFileCb);
import type { ClipboardEntry } from '@shared/schema';
import { getFileBackedPath, isFileBackedItem } from '@shared/fileUtils';
import { writeShelfItemToClipboard } from './clipboard/writer';

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
  ledgeBundleId: string,
  writer?: import('./clipboard/writer').ClipboardWriter,
): Promise<void> {
  const entry = getEntry(entryId);
  if (!entry) return;
  if (previousBundleId === ledgeBundleId) return; // Don't paste back into Ledge.
  if (previousBundleId && settings.ignoreBundleIds.includes(previousBundleId)) return;

  writeShelfItemToClipboard(entry.item, writer);

  if (settings.syntheticPasteEnabled) {
    try {
      await execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    } catch {
      // Synthetic paste is best-effort. The clipboard is already written;
      // the renderer should surface a "Press ⌘V" hint regardless.
    }
  }
}

/**
 * Copy a single clipboard entry to the system pasteboard without
 * triggering the synthetic paste keystroke. Used by the "Copy" action
 * on a clipboard history card.
 */
export function copyEntryToPasteboard(
  entryId: string,
  getEntry: (id: string) => ClipboardEntry | undefined,
  writer?: import('./clipboard/writer').ClipboardWriter,
): boolean {
  const entry = getEntry(entryId);
  if (!entry) return false;
  writeShelfItemToClipboard(entry.item, writer);
  return true;
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
