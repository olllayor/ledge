import { memo, useCallback } from 'react';
import type { ClipboardCategory, ClipboardEntry, ShelfItemRecord } from '@shared/schema';

type Item = ShelfItemRecord;

interface ClipboardCardProps {
  entry: ClipboardEntry;
  categories: ClipboardCategory[];
  onCopy: (entry: ClipboardEntry) => void;
  onRemove: (entry: ClipboardEntry) => void;
  onAssign: (entry: ClipboardEntry, categoryId: string) => void;
  onUnassign: (entry: ClipboardEntry, categoryId: string) => void;
  onDragStart: (entry: ClipboardEntry) => void;
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

function fileExtensionOf(item: Item): string {
  if (item.kind !== 'file' && item.kind !== 'imageAsset') return '';
  const path = item.file.resolvedPath || item.file.originalPath;
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const filename = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  return filename.slice(dot + 1).toUpperCase();
}

function CardPreview({ entry }: { entry: ClipboardEntry }) {
  const item = entry.item;
  if (item.kind === 'imageAsset') {
    if (entry.thumbnailDataUri) {
      return <img src={entry.thumbnailDataUri} alt="" draggable={false} />;
    }
    return <span>🖼</span>;
  }
  if (item.kind === 'color') {
    return <span style={{ background: item.hex, width: '100%', height: '100%' }} />;
  }
  if (item.kind === 'url') return <span>↗</span>;
  if (item.kind === 'file') return <span>📄</span>;
  if (item.kind === 'folder') return <span>📁</span>;
  if (item.kind === 'code') return <span>&lt;/&gt;</span>;
  return <span>Aa</span>;
}

function CardLabel({ entry }: { entry: ClipboardEntry }) {
  const item = entry.item;
  if (item.kind === 'text') {
    const preview = item.text.replace(/\s+/g, ' ').slice(0, 80);
    return <span className="clipboard-card-label">{preview}</span>;
  }
  if (item.kind === 'code') {
    const preview = item.text.split('\n', 1)[0]?.slice(0, 80) ?? '';
    return <span className="clipboard-card-label is-code">{preview}</span>;
  }
  if (item.kind === 'url') {
    return <span className="clipboard-card-label">{item.title || item.url}</span>;
  }
  if (item.kind === 'color') {
    return (
      <span className="clipboard-card-label is-color">
        <span style={{ background: item.hex, width: 10, height: 10, borderRadius: 5, display: 'inline-block' }} />
        {item.name ? `${item.name} · ${item.hex}` : item.hex}
      </span>
    );
  }
  return <span className="clipboard-card-label">{item.title}</span>;
}

function CardSubtitle({ entry }: { entry: ClipboardEntry }) {
  const parts: string[] = [];
  if (entry.sourceAppName) parts.push(entry.sourceAppName);
  parts.push(formatRelativeTime(entry.capturedAt));
  const ext = fileExtensionOf(entry.item);
  if (ext) parts.push(ext);
  return (
    <span className="clipboard-card-subtitle">
      {parts.filter(Boolean).map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </span>
  );
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
