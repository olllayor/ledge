import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEntry, ShelfItemRecord, AppState } from '@shared/schema';
import { isSafeImageDataUri } from '@shared/fileUtils';
import { useLedgeState } from '../hooks/useLedgeState';

const MAX_ENTRIES = 9;

type Item = ShelfItemRecord;

function filePathOf(item: Item): string {
  if (item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset') {
    return item.file.resolvedPath || item.file.originalPath;
  }
  return '';
}

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function entryLabel(entry: ClipboardEntry): string {
  const item = entry.item;
  if (item.kind === 'text' || item.kind === 'code') {
    const raw = item.text.split('\n', 1)[0] ?? item.title;
    const sliced = raw.slice(0, 80);
    return raw.length > 80 ? `${sliced}…` : sliced;
  }
  if (item.kind === 'url') {
    return item.title || item.url;
  }
  if (item.kind === 'color') {
    return item.name ? `${item.name} · ${item.hex}` : item.hex;
  }
  return item.title;
}

function entrySubtitle(entry: ClipboardEntry): string {
  const parts: string[] = [];
  if (entry.sourceAppName) parts.push(entry.sourceAppName);
  const item = entry.item;
  switch (item.kind) {
    case 'folder':
      parts.push('Folder');
      break;
    case 'file':
      parts.push('File');
      break;
    case 'imageAsset':
      parts.push('Image');
      break;
    case 'color':
      parts.push('Color');
      break;
    case 'code':
      parts.push(item.language ?? 'Code');
      break;
    case 'url':
      parts.push('Link');
      break;
    default:
      parts.push('Text');
  }
  const rel = formatRelativeTime(entry.capturedAt);
  if (rel) parts.push(rel);
  return parts.join(' · ');
}

function entrySwatch(entry: ClipboardEntry): { background: string; letter: string } {
  const item = entry.item;
  if (item.kind === 'color') {
    return { background: item.hex, letter: '' };
  }
  if (
    item.kind === 'imageAsset' &&
    entry.thumbnailDataUri &&
    isSafeImageDataUri(entry.thumbnailDataUri)
  ) {
    return { background: `url("${entry.thumbnailDataUri}") center/cover no-repeat`, letter: '' };
  }
  const fallbackLetter: Record<Item['kind'], string> = {
    imageAsset: '🖼',
    file: '📄',
    folder: '📁',
    color: '■',
    code: '<>',
    url: '↗',
    text: 'Aa',
  };
  return { background: 'var(--surface-strong)', letter: fallbackLetter[item.kind] };
}

// Keep the path helper available for any future need (e.g. image previews
// pulled from the resolved path on disk).
void filePathOf;

const selectQuickPasteEntries = (state: AppState) => state.clipboardHistory.slice(0, MAX_ENTRIES);

export function QuickPastePalette() {
  const { state } = useLedgeState(selectQuickPasteEntries);
  const entries = state || [];
  const { state: clipboardSettings } = useLedgeState((s) => s.clipboardSettings);
  const syntheticEnabled = clipboardSettings?.syntheticPasteEnabled ?? false;
  const [focusIndex, setFocusIndex] = useState(0);
  const [previousAppName, setPreviousAppName] = useState('');
  // The main-process guards (paste-into-self, ignoreBundleIds) compare
  // reverse-DNS bundle ids. Keep the raw id separate from the display
  // name so the guards actually match; sending the app name here made
  // both checks dead code.
  const [previousBundleId, setPreviousBundleId] = useState('');
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!window.ledge) return;
    let active = true;
    const unsubscribeHint = window.ledge.onClipboardQuickPasteHint((hint) => {
      if (!active) return;
      if (hint.hint === 'shown') {
        setFocusIndex(0);
        setPreviousAppName(hint.previousAppName || hint.previousBundleId || '');
        setPreviousBundleId(hint.previousBundleId || '');
      } else if (hint.hint === 'focus' && typeof hint.index === 'number') {
        setFocusIndex(hint.index);
      }
    });
    return () => {
      active = false;
      unsubscribeHint();
    };
  }, []);

  const triggerPaste = useCallback(
    (entry: ClipboardEntry) => {
      if (!window.ledge) return;
      // Hide first so the previous app regains focus before the
      // synthetic ⌘V is dispatched. Paste is best-effort; the
      // clipboard is already written, so we show a hint regardless.
      window.ledge.clipboardQuickPasteHide();
      void window.ledge.clipboardQuickPastePaste({
        entryId: entry.id,
        previousBundleId,
      });
    },
    [previousBundleId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.ledge?.clipboardQuickPasteHide();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusIndex((prev) => Math.min(prev + 1, Math.max(entries.length - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const entry = entries[focusIndex];
        if (entry) triggerPaste(entry);
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const idx = Number.parseInt(event.key, 10) - 1;
        const entry = entries[idx];
        if (entry) triggerPaste(entry);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries, focusIndex, triggerPaste]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const child = list.children.item(focusIndex) as HTMLElement | null;
    child?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const visibleEntries = entries.slice(0, MAX_ENTRIES);

  const headerTarget = (() => {
    if (previousAppName) {
      return syntheticEnabled ? `Pasting to ${previousAppName}` : `Copy for ${previousAppName} — press ⌘V`;
    }
    return syntheticEnabled ? 'Auto-paste enabled — press ⌘V if blocked' : 'Press ⌘V to paste';
  })();

  return (
    <main className="quick-paste" aria-label="Quick paste palette">
      <header className="quick-paste-header">
        <span className="quick-paste-eyebrow">Quick paste</span>
        <span className="quick-paste-target">{headerTarget}</span>
      </header>
      {visibleEntries.length === 0 ? (
        <p className="quick-paste-empty">No recent items — copy something to get started.</p>
      ) : (
        <ul ref={listRef} className="quick-paste-list" role="listbox">
          {visibleEntries.map((entry, idx) => {
            const swatch = entrySwatch(entry);
            const isFocused = idx === focusIndex;
            return (
              <li
                key={entry.id}
                className={`quick-paste-item${isFocused ? ' is-focused' : ''}`}
                role="option"
                aria-selected={isFocused}
                onMouseEnter={() => setFocusIndex(idx)}
                onClick={() => triggerPaste(entry)}
              >
                <span className="quick-paste-digit">{idx + 1}</span>
                <span
                  className="quick-paste-swatch"
                  style={{ background: swatch.background }}
                  aria-hidden="true"
                >
                  {swatch.letter}
                </span>
                <span className="quick-paste-text">
                  <span className="quick-paste-label">{entryLabel(entry)}</span>
                  <span className="quick-paste-subtitle">{entrySubtitle(entry)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="quick-paste-footer">
        <div className="quick-paste-footer-hints" aria-label="Keyboard shortcuts">
          <span><kbd className="quick-paste-kbd">↑</kbd><kbd className="quick-paste-kbd">↓</kbd> navigate</span>
          <span><kbd className="quick-paste-kbd">1</kbd>–<kbd className="quick-paste-kbd">9</kbd> paste</span>
          <span><kbd className="quick-paste-kbd">⏎</kbd> paste</span>
        </div>
        <div className="quick-paste-footer-actions">
          <button
            type="button"
            className="quick-paste-action"
            onClick={() => void window.ledge?.clipboardEntryClearAll()}
            disabled={visibleEntries.length === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="quick-paste-action quick-paste-action-primary"
            onClick={() => window.ledge?.clipboardQuickPasteHide()}
          >
            Close
          </button>
        </div>
      </footer>
    </main>
  );
}
