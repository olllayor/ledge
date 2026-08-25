import { memo, useCallback, useState } from 'react';
import type { ClipboardCategory, ClipboardEntry } from '@shared/schema';
import { CardLabel, CardPreview, CardSubtitle } from './CardPreview';
import { IconClose, IconCopy, IconPin } from '../Icons';
import { isFileBackedItem, getFileBackedPath } from '@shared/fileUtils';

interface ClipboardCardProps {
  entry: ClipboardEntry;
  categories?: ClipboardCategory[];
  isSelected: boolean;
  onSelect: (id: string | null) => void;
  onCopy: (entry: ClipboardEntry) => void;
  onRemove: (entry: ClipboardEntry) => void;
  onTogglePin: (entry: ClipboardEntry) => void;
  onDragStart: (entry: ClipboardEntry) => void;
}

function CardImpl({
  entry,
  categories = [],
  isSelected,
  onSelect,
  onCopy,
  onRemove,
  onTogglePin,
  onDragStart,
}: ClipboardCardProps) {
  const [copied, setCopied] = useState(false);
  const isPinned = Boolean(entry.pinnedAt);
  const isDraggable = isFileBackedItem(entry.item) && Boolean(getFileBackedPath(entry.item as never));
  const handleClick = useCallback(() => {
    onSelect(isSelected ? null : entry.id);
  }, [entry.id, isSelected, onSelect]);

  const handleDoubleClick = useCallback(() => {
    onCopy(entry);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [entry, onCopy]);

  const handleCopy = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onCopy(entry);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [entry, onCopy]);

  const handleRemove = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onRemove(entry);
  }, [entry, onRemove]);

  const handleTogglePin = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onTogglePin(entry);
  }, [entry, onTogglePin]);

  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      onDragStart(entry);
    },
    [entry, onDragStart],
  );

  const categoryDots = entry.categoryIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is ClipboardCategory => Boolean(c));

  return (
    <article
      className={`clipboard-row${isSelected ? ' is-selected' : ''}${copied ? ' is-copied' : ''}${isPinned ? ' is-pinned' : ''}`}
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={isDraggable ? 'Drag to Finder' : entry.sourceBundleId ? `${entry.sourceAppName} · ${entry.sourceBundleId}` : undefined}
    >
      <div className="clipboard-row-content">
        <div className="clipboard-row-icon">
          <CardPreview entry={entry} />
        </div>
        <div className="clipboard-row-text">
          <CardLabel entry={entry} />
          <div className="clipboard-row-meta">
            <CardSubtitle entry={entry} />
            {entry.sourceBundleId && (
              <span className="clipboard-row-bundle" title={entry.sourceBundleId}>
                {entry.sourceBundleId}
              </span>
            )}
            {categoryDots.length > 0 && (
              <span className="clipboard-row-dots" aria-label="Categories">
                {categoryDots.map((cat) => (
                  <span
                    key={cat.id}
                    className="clipboard-category-dot"
                    style={{ background: `var(--shelf-color-${cat.color}, var(--ink-faint))` }}
                    title={cat.name}
                  />
                ))}
              </span>
            )}
            {copied && <span className="clipboard-row-copied">Copied</span>}
          </div>
        </div>
      </div>
      <div className="clipboard-row-source">
        {entry.sourceAppName || '—'}
      </div>
      <div className="clipboard-row-actions">
        <button
          type="button"
          className={`clipboard-row-action${isPinned ? ' is-active' : ''}`}
          onClick={handleTogglePin}
          title={isPinned ? 'Unpin from history' : 'Pin to history (survives pruning)'}
          aria-label={isPinned ? 'Unpin from history' : 'Pin to history'}
          aria-pressed={isPinned}
        >
          <IconPin filled={isPinned} />
        </button>
        <button
          type="button"
          className="clipboard-row-action"
          onClick={handleCopy}
          title="Copy to clipboard"
          aria-label="Copy to clipboard"
        >
          <IconCopy />
        </button>
        <button
          type="button"
          className="clipboard-row-action"
          onClick={handleRemove}
          title="Remove from history"
          aria-label="Remove from history"
        >
          <IconClose />
        </button>
      </div>
    </article>
  );
}

export const ClipboardCard = memo(CardImpl);
