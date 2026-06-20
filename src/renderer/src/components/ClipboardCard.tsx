import { memo, useCallback } from 'react';
import type { ClipboardCategory, ClipboardEntry } from '@shared/schema';
import { CardLabel, CardPreview, CardSubtitle } from './ClipboardView/CardPreview';

interface ClipboardCardProps {
  entry: ClipboardEntry;
  categories: ClipboardCategory[];
  onCopy: (entry: ClipboardEntry) => void;
  onRemove: (entry: ClipboardEntry) => void;
  onAssign: (entry: ClipboardEntry, categoryId: string) => void;
  onUnassign: (entry: ClipboardEntry, categoryId: string) => void;
  onDragStart: (entry: ClipboardEntry) => void;
}

function CardImpl({
  entry,
  categories,
  onCopy,
  onRemove,
  onAssign,
  onUnassign,
  onDragStart,
}: ClipboardCardProps) {
  const handleCopy = useCallback(() => onCopy(entry), [entry, onCopy]);
  const handleRemove = useCallback(() => onRemove(entry), [entry, onRemove]);
  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      onDragStart(entry);
    },
    [entry, onDragStart],
  );

  return (
    <article className="clipboard-card" draggable onDragStart={handleDragStart}>
      <div className="clipboard-card-preview">
        <CardPreview entry={entry} />
      </div>
      <div className="clipboard-card-body">
        <CardLabel entry={entry} />
        <CardSubtitle entry={entry} />
        {categories.length > 0 ? (
          <div className="clipboard-card-tags">
            {entry.categoryIds.map((id) => {
              const cat = categories.find((c) => c.id === id);
              if (!cat) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className="clipboard-card-tag"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUnassign(entry, id);
                  }}
                  title={`Remove from ${cat.name}`}
                >
                  {cat.name}
                </button>
              );
            })}
            <select
              className="clipboard-card-tag-add"
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  onAssign(entry, event.target.value);
                  event.target.value = '';
                }
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <option value="">+ category</option>
              {categories
                .filter((c) => !entry.categoryIds.includes(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="clipboard-card-actions">
        <button
          type="button"
          className="clipboard-card-action"
          onClick={handleCopy}
          title="Copy to clipboard"
          aria-label="Copy to clipboard"
        >
          ⎘
        </button>
        <button
          type="button"
          className="clipboard-card-action"
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
