import { memo, useCallback, useState } from 'react';
import type { ClipboardCategory, ShelfColor } from '@shared/schema';

interface ClipboardCategoriesProps {
  categories: ClipboardCategory[];
  selected: string | 'all';
  onSelect: (id: string | 'all') => void;
  onCreate: (name: string, color: ShelfColor) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

const COLORS: ShelfColor[] = ['ember', 'wave', 'forest', 'sand'];

function colorCssVar(color: ShelfColor): string {
  return `var(--shelf-color-${color}, var(--ink-soft))`;
}

function CategoriesImpl({
  categories,
  selected,
  onSelect,
  onCreate,
  onRename,
  onRemove,
}: ClipboardCategoriesProps) {
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<ShelfColor>('ember');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const submitCreate = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = draftName.trim();
      if (!trimmed) return;
      onCreate(trimmed, draftColor);
      setDraftName('');
      setDraftColor('ember');
    },
    [draftName, draftColor, onCreate],
  );

  const submitRename = useCallback(
    (id: string) => {
      const trimmed = editingName.trim();
      if (trimmed) onRename(id, trimmed);
      setEditingId(null);
      setEditingName('');
    },
    [editingName, onRename],
  );

  return (
    <aside className="clipboard-categories" aria-label="Categories">
      <ul className="clipboard-categories-list">
        <li>
          <button
            type="button"
            className={`clipboard-category${selected === 'all' ? ' is-active' : ''}`}
            onClick={() => onSelect('all')}
          >
            <span className="clipboard-category-swatch" style={{ background: 'var(--ink-soft)' }} />
            All
          </button>
        </li>
        {categories.map((category) => (
          <li key={category.id}>
            {editingId === category.id ? (
              <input
                className="clipboard-category-input"
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onBlur={() => submitRename(category.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitRename(category.id);
                  if (event.key === 'Escape') {
                    setEditingId(null);
                    setEditingName('');
                  }
                }}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className={`clipboard-category${selected === category.id ? ' is-active' : ''}`}
                onClick={() => onSelect(category.id)}
                onDoubleClick={() => {
                  setEditingId(category.id);
                  setEditingName(category.name);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onRemove(category.id);
                }}
                title="Double-click to rename · right-click to delete"
              >
                <span
                  className="clipboard-category-swatch"
                  style={{ background: colorCssVar(category.color) }}
                />
                {category.name}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="clipboard-category-add" onSubmit={submitCreate}>
        <input
          type="text"
          placeholder="New category"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          maxLength={40}
        />
        <select
          value={draftColor}
          onChange={(event) => setDraftColor(event.target.value as ShelfColor)}
          aria-label="Category color"
        >
          {COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit" className="chrome-button" disabled={!draftName.trim()}>
          +
        </button>
      </form>
    </aside>
  );
}

export const ClipboardCategories = memo(CategoriesImpl);
