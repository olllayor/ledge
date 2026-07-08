import { memo, useCallback } from 'react';
import type { ClipboardEntry } from '@shared/schema';
import { CardLabel, CardPreview, CardSubtitle } from './ClipboardView/CardPreview';

interface ClipboardCardProps {
  entry: ClipboardEntry;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
  onCopy: (entry: ClipboardEntry) => void;
  onRemove: (entry: ClipboardEntry) => void;
  onDragStart: (entry: ClipboardEntry) => void;
}

function CardImpl({
  entry,
  isSelected,
  onSelect,
  onCopy,
  onRemove,
  onDragStart,
}: ClipboardCardProps) {
  const handleClick = useCallback(() => {
    onSelect(isSelected ? null : entry.id);
  }, [entry.id, isSelected, onSelect]);

  const handleDoubleClick = useCallback(() => {
    onCopy(entry);
  }, [entry, onCopy]);

  const handleCopy = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onCopy(entry);
  }, [entry, onCopy]);

  const handleRemove = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onRemove(entry);
  }, [entry, onRemove]);

  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      onDragStart(entry);
    },
    [entry, onDragStart],
  );

  return (
    <article
      className={`clipboard-row${isSelected ? ' is-selected' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className="clipboard-row-content">
        <div className="clipboard-row-icon">
          <CardPreview entry={entry} />
        </div>
        <div className="clipboard-row-text">
          <CardLabel entry={entry} />
          <CardSubtitle entry={entry} />
        </div>
      </div>
      <div className="clipboard-row-source">
        {entry.sourceAppName || '—'}
      </div>
      <div className="clipboard-row-actions">
        <button
          type="button"
          className="clipboard-row-action"
          onClick={handleCopy}
          title="Copy to clipboard"
          aria-label="Copy to clipboard"
        >
          ⎘
        </button>
        <button
          type="button"
          className="clipboard-row-action"
          onClick={handleRemove}
          title="Remove from history"
          aria-label="Remove from history"
        >
          ×
        </button>
      </div>
    </article>
  );
}

export const ClipboardCard = memo(CardImpl);
