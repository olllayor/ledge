import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEntry, ShelfItemRecord, AppState } from '@shared/schema';
import { useLedgeState } from '../hooks/useLedgeState';

const PEEK_MAX_THUMBS = 12;

type Item = ShelfItemRecord;

function entrySwatch(entry: ClipboardEntry): { background: string; letter: string } {
  const item = entry.item;
  if (item.kind === 'color') {
    return { background: item.hex, letter: '' };
  }
  if (item.kind === 'imageAsset' && entry.thumbnailDataUri) {
    return { background: `url(${entry.thumbnailDataUri}) center/cover no-repeat`, letter: '' };
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

  const handleEnter = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setExpanded(true);
  }, []);

  const handleLeave = useCallback(() => {
    setExpanded(false);
  }, []);

  const visibleEntries = entries.slice(0, PEEK_MAX_THUMBS);

  return (
    <main
      className={`peek${expanded ? ' is-expanded' : ''}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      aria-label="Clipboard peek"
    >
      <ul className="peek-strip">
        {visibleEntries.length === 0 ? (
          <li className="peek-empty">Empty</li>
        ) : (
          visibleEntries.map((entry) => {
            const swatch = entrySwatch(entry);
            return (
              <li
                key={entry.id}
                className="peek-thumb"
                title={entryLabel(entry)}
                draggable
                onDragStart={(event) => {
                  event.preventDefault();
                  beginDrag(entry);
                }}
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
