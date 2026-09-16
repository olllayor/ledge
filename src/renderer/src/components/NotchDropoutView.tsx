import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { ClipboardEntry, AppState, NotchGeometry } from '@shared/schema';
import { useLedgeState } from '../hooks/useLedgeState';
import { isSafeImageDataUri } from '@shared/fileUtils';
import { IconClose, IconCopy } from './Icons';

const MAX_ENTRIES = 20;
const COLLAPSED_THUMBS = 4;

const selectNotchEntries = (state: AppState) => state.clipboardHistory.slice(0, MAX_ENTRIES);

/**
 * Quick-access panel anchored to the notch.
 *
 * When the display actually has a notch, the collapsed state is laid out as a
 * band that *flanks* the cut-out: content sits left and right of a spacer whose
 * width equals the measured notch, so nothing is ever painted inside the
 * hardware cut-out (it cannot be — the notch is not part of the screen). The
 * expanded state drops the full card below that band.
 */
export function NotchDropoutView() {
  const { state } = useLedgeState(selectNotchEntries);
  const entries = state || [];
  const [expanded, setExpanded] = useState(false);
  const [geometry, setGeometry] = useState<NotchGeometry | null>(null);

  useEffect(() => {
    if (!window.ledge) return;
    let active = true;

    // Pull once: the panel mounts long before the first reveal, so waiting for
    // a push would leave the very first opening un-shaped.
    void window.ledge.notchDropoutGeometry().then((value) => {
      if (active && value) setGeometry(value);
    });
    const unsubscribeGeometry = window.ledge.onNotchDropoutGeometry((value) => {
      if (active) setGeometry(value);
    });

    const unsubscribeHint = window.ledge.onNotchDropoutStateChanged((hint) => {
      if (!active) return;
      if (hint.state === 'visible') {
        setExpanded(false);
      }
    });

    return () => {
      active = false;
      unsubscribeGeometry();
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
    // Main owns releasing the suppression (startDrag returns before the
    // drop, so "release right after" here would hide mid-drag). We only
    // send the release ourselves when the drag never started.
    window.ledge.notchDropoutDragState(true);
    let ok = false;
    try {
      ok = window.ledge.clipboardStartItemDrag({ entryId: entry.id });
    } catch {
      ok = false;
    }
    if (!ok) {
      window.ledge.notchDropoutDragState(false);
      window.ledge.showToast('This item type does not support drag-out', 'info');
    }
  }, []);

  const handleOpenFull = useCallback(() => {
    window.ledge?.notchDropoutHide();
    window.ledge?.clipboardWindowShow();
  }, []);

  const handleEnter = useCallback(() => setExpanded(true), []);
  const handleLeave = useCallback(() => setExpanded(false), []);

  const collapsedEntries = entries.slice(0, COLLAPSED_THUMBS);
  const bodyEntries = expanded ? entries : [];
  const isNotched = Boolean(geometry?.hasNotch);

  const renderThumb = (entry: ClipboardEntry) => (
    <button
      key={entry.id}
      type="button"
      className="notch-dropout-thumb"
      title={entry.item.title}
      draggable
      onDragStart={(event) => {
        // Suppress the HTML5 drag: it would run alongside the native
        // NSDragging session and break the drag-out.
        event.preventDefault();
        handleDragStart(entry);
      }}
      onClick={() => handleCopy(entry)}
    >
      <NotchThumbContent entry={entry} />
    </button>
  );

  const renderBodyRow = (entry: ClipboardEntry) => (
    <button
      key={entry.id}
      type="button"
      className="notch-dropout-row"
      title={entry.item.title}
      draggable
      onDragStart={(event) => {
        event.preventDefault();
        handleDragStart(entry);
      }}
      onClick={() => handleCopy(entry)}
    >
      <span className="notch-dropout-row-thumb">
        <NotchThumbContent entry={entry} />
      </span>
      <span className="notch-dropout-row-title">{entry.item.title}</span>
    </button>
  );

  const actions = (
    <div className="notch-dropout-actions">
      <button
        type="button"
        className="notch-dropout-action"
        onClick={handleOpenFull}
        title="Open clipboard history"
      >
        <IconCopy />
      </button>
      <button
        type="button"
        className="notch-dropout-action"
        onClick={() => window.ledge?.notchDropoutHide()}
        title="Close"
      >
        <IconClose />
      </button>
    </div>
  );

  const emptyLabel = <span className="notch-dropout-empty">No items</span>;

  return (
    <main
      className={`notch-dropout${expanded ? ' is-expanded' : ''}`}
      data-notch={isNotched ? 'true' : 'false'}
      style={geometryStyle(geometry)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      aria-label="Clipboard quick access"
    >
      {isNotched ? (
        <div className="notch-dropout-band">
          <div className="notch-dropout-band-side is-left">
            <span className="notch-dropout-icon">📋</span>
            {collapsedEntries.slice(0, 2).map(renderThumb)}
          </div>
          {/* Spacer over the hardware cut-out: content flanks the notch. */}
          <div className="notch-dropout-band-gap" aria-hidden="true" />
          <div className="notch-dropout-band-side is-right">
            {collapsedEntries.slice(2, COLLAPSED_THUMBS).map(renderThumb)}
            {collapsedEntries.length === 0 && emptyLabel}
            {actions}
          </div>
        </div>
      ) : (
        <div className="notch-dropout-header">
          <div className="notch-dropout-brand">
            <span className="notch-dropout-icon">📋</span>
            <span className="notch-dropout-title">Clipboard</span>
          </div>
          <div className="notch-dropout-thumbnails">
            {(expanded ? entries : collapsedEntries).map(renderThumb)}
            {collapsedEntries.length === 0 && emptyLabel}
          </div>
          {actions}
        </div>
      )}
      {expanded && (
        <div className="notch-dropout-body">
          {bodyEntries.length === 0 ? (
            emptyLabel
          ) : (
            <div className="notch-dropout-rows">{bodyEntries.map(renderBodyRow)}</div>
          )}
        </div>
      )}
    </main>
  );
}

/**
 * Feed the measured silhouette to CSS. Custom properties are the only way to
 * get AppKit-measured values into a stylesheet, and keeping them here means the
 * stylesheet carries no per-machine branching.
 */
function geometryStyle(geometry: NotchGeometry | null): CSSProperties | undefined {
  if (!geometry) return undefined;
  const variables: Record<string, string> = {
    '--notch-width': `${Math.round(geometry.notchWidth)}px`,
    '--notch-height': `${Math.round(geometry.notchHeight)}px`,
    '--notch-radius': `${Math.round(16 * geometry.scale)}px`,
  };
  return variables as CSSProperties;
}

function NotchThumbContent({ entry }: { entry: ClipboardEntry }) {
  const item = entry.item;
  if (item.kind === 'imageAsset' && entry.thumbnailDataUri && isSafeImageDataUri(entry.thumbnailDataUri)) {
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
