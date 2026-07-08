import { useCallback, useEffect, useState } from 'react';
import type { ClipboardEntry } from '@shared/schema';

const MAX_ENTRIES = 20;

export function NotchDropoutView() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!window.ledge) return;
    let active = true;

    const refresh = async () => {
      try {
        const next = await window.ledge.clipboardGetRecent(MAX_ENTRIES);
        if (active) setEntries(next);
      } catch {
        // ignore
      }
    };
    void refresh();

    const unsubscribeState = window.ledge.subscribeState((state) => {
      if (!active) return;
      setEntries(state.clipboardHistory.slice(0, MAX_ENTRIES));
    });

    const unsubscribeHint = window.ledge.onNotchDropoutStateChanged((hint) => {
      if (!active) return;
      if (hint.state === 'visible') {
        setExpanded(false);
      }
    });

    return () => {
      active = false;
      unsubscribeState();
      unsubscribeHint();
    };
  }, []);

  const handleCopy = useCallback((entry: ClipboardEntry) => {
    if (!window.ledge) return;
    void window.ledge.clipboardCopy({ entryId: entry.id }).then((ok) => {
      if (ok) window.ledge?.showToast('Copied to clipboard', 'success');
    });
  }, []);

  const handleDragStart = useCallback((entry: ClipboardEntry) => {
    if (!window.ledge) return;
    // Keep the panel alive for the duration of the native drag session.
    // clipboardStartItemDrag is a sync call that returns when the drag
    // ends, so the suppression is released in the same tick.
    window.ledge.notchDropoutDragState(true);
    let ok = false;
    try {
      ok = window.ledge.clipboardStartItemDrag({ entryId: entry.id });
    } finally {
      window.ledge.notchDropoutDragState(false);
    }
    if (!ok) {
      window.ledge.showToast('This item type does not support drag-out', 'info');
    }
  }, []);

  const handleOpenFull = useCallback(() => {
    window.ledge?.notchDropoutHide();
    // TODO: open full clipboard history window
  }, []);

  const handleEnter = useCallback(() => setExpanded(true), []);
  const handleLeave = useCallback(() => setExpanded(false), []);

  const previewEntries = expanded ? entries : entries.slice(0, 3);

  return (
    <main
      className={`notch-dropout${expanded ? ' is-expanded' : ''}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      aria-label="Clipboard quick access"
    >
      <div className="notch-dropout-header">
        <div className="notch-dropout-brand">
          <span className="notch-dropout-icon">📋</span>
          <span className="notch-dropout-title">Clipboard</span>
        </div>
        <div className="notch-dropout-thumbnails">
          {previewEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="notch-dropout-thumb"
              title={entry.item.title}
              draggable
              onDragStart={(event) => {
                // Suppress the HTML5 drag: it would run alongside the
                // native NSDragging session and break the drag-out.
                event.preventDefault();
                handleDragStart(entry);
              }}
              onClick={() => handleCopy(entry)}
            >
              <NotchThumbContent entry={entry} />
            </button>
          ))}
          {previewEntries.length === 0 && (
            <span className="notch-dropout-empty">No items</span>
          )}
        </div>
        <div className="notch-dropout-actions">
          <button
            type="button"
            className="notch-dropout-action"
            onClick={handleOpenFull}
            title="Open clipboard history"
          >
            ⎘
          </button>
          <button
            type="button"
            className="notch-dropout-action"
            onClick={() => window.ledge?.notchDropoutHide()}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>
    </main>
  );
}

function NotchThumbContent({ entry }: { entry: ClipboardEntry }) {
  const item = entry.item;
  if (item.kind === 'imageAsset' && entry.thumbnailDataUri) {
    return <img src={entry.thumbnailDataUri} alt="" draggable={false} />;
  }
  if (item.kind === 'color') {
    return <span style={{ background: item.hex, width: '100%', height: '100%', display: 'block' }} />;
  }
  if (item.kind === 'url') return <span>↗</span>;
  if (item.kind === 'file') return <span>📄</span>;
  if (item.kind === 'folder') return <span>📁</span>;
  if (item.kind === 'code') return <span>&lt;/&gt;</span>;
  return <span>Aa</span>;
}
