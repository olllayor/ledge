import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEntry, ShelfItemRecord, AppState } from '@shared/schema';
import { useLedgeState } from '../hooks/useLedgeState';
import { isFileBackedItem, getFileBackedPath, isSafeImageDataUri } from '@shared/fileUtils';

const PEEK_MAX_THUMBS = 12;

type Item = ShelfItemRecord;

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

function entryLabel(entry: ClipboardEntry): string {
  const item = entry.item;
  if (item.kind === 'text' || item.kind === 'code') {
    return item.text.split('\n', 1)[0]?.slice(0, 40) ?? item.title;
  }
  if (item.kind === 'url') {
    return item.title || item.url;
  }
  if (item.kind === 'color') {
    return item.name ? `${item.name} · ${item.hex}` : item.hex;
  }
  return item.title;
}

const selectPeekEntries = (state: AppState) => state.clipboardHistory.slice(0, PEEK_MAX_THUMBS);

export function PeekWindowView() {
  const { state } = useLedgeState(selectPeekEntries);
  const entries = state || [];
  const [expanded, setExpanded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!window.ledge) return;
    let active = true;
    const unsubscribeHint = window.ledge.onClipboardPeekHint((hint) => {
      if (!active) return;
      if (hint.hint === 'visible') {
        setExpanded(false);
        if (hideTimer.current) {
          window.clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
      } else if (hint.hint === 'hidden') {
        if (hideTimer.current) {
          window.clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
      }
    });
    return () => {
      active = false;
      unsubscribeHint();
    };
  }, []);

  const beginDrag = useCallback((entry: ClipboardEntry) => {
    if (!window.ledge) return;
    const ok = window.ledge.clipboardStartItemDrag({ entryId: entry.id });
    if (!ok) {
      window.ledge.showToast('This item type does not support drag-out', 'info');
    }
  }, []);

  const handleCopy = useCallback((entry: ClipboardEntry) => {
    if (!window.ledge) return;
    void window.ledge.clipboardCopy({ entryId: entry.id }).then((ok) => {
      if (ok) window.ledge.showToast('Copied to clipboard', 'success');
      else window.ledge.showToast('Failed to copy', 'error');
    });
  }, []);

  const handleEnter = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setExpanded(true);
  }, []);

  const handleLeave = useCallback(() => {
    setExpanded(false);
    setFocusedIndex(null);
  }, []);

  const handleFocus = useCallback(() => setExpanded(true), []);
  const handleBlur = useCallback(() => setExpanded(false), []);

  const visibleEntries = entries.slice(0, PEEK_MAX_THUMBS);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (visibleEntries.length === 0) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev === null ? 0 : Math.min(prev + 1, visibleEntries.length - 1);
          return next;
        });
        setExpanded(true);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev === null ? visibleEntries.length - 1 : Math.max(prev - 1, 0);
          return next;
        });
        setExpanded(true);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const idx = focusedIndex ?? 0;
        const entry = visibleEntries[idx];
        if (entry) handleCopy(entry);
      } else if (event.key === 'Escape') {
        setExpanded(false);
        setFocusedIndex(null);
        window.ledge?.clipboardPeekHide();
      }
    },
    [focusedIndex, handleCopy, visibleEntries],
  );

  return (
    <main
      className={`peek${expanded ? ' is-expanded' : ''}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label="Clipboard peek"
    >
      <ul className="peek-strip" role="listbox" aria-label="Recent clips">
        {visibleEntries.length === 0 ? (
          <li className="peek-empty">Empty</li>
        ) : (
          visibleEntries.map((entry, idx) => {
            const swatch = entrySwatch(entry);
            const isFileBacked = isFileBackedItem(entry.item) && Boolean(getFileBackedPath(entry.item as never));
            const isFocused = focusedIndex === idx;
            return (
              <li
                key={entry.id}
                className={`peek-thumb${isFocused ? ' is-focused' : ''}${isFileBacked ? ' is-draggable' : ''}`}
                title={`${entryLabel(entry)} — ${isFileBacked ? 'drag to Finder or click to copy' : 'click to copy'}`}
                role="option"
                aria-selected={isFocused}
                tabIndex={-1}
                draggable={isFileBacked}
                onDragStart={
                  isFileBacked
                    ? (event) => {
                        event.preventDefault();
                        beginDrag(entry);
                      }
                    : undefined
                }
                onClick={() => handleCopy(entry)}
                onMouseEnter={() => setFocusedIndex(idx)}
                onFocus={() => setFocusedIndex(idx)}
              >
                <span
                  className="peek-swatch"
                  style={{ background: swatch.background }}
                  aria-hidden="true"
                >
                  {swatch.letter}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </main>
  );
}
