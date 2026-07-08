import { memo, useCallback, useState } from 'react'
import type { ClipboardCategory, ShelfColor } from '@shared/schema'

interface CategoryListProps {
  categories: ClipboardCategory[]
  selected: string | 'all'
  onSelect: (id: string | 'all') => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}

function colorCssVar(color: ShelfColor): string {
  return `var(--shelf-color-${color}, var(--ink-soft))`
}

function CategoryListImpl({
  categories,
  selected,
  onSelect,
  onRename,
  onRemove,
}: CategoryListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const submitRename = useCallback(
    (id: string) => {
      const trimmed = editingName.trim()
      if (trimmed) onRename(id, trimmed)
      setEditingId(null)
      setEditingName('')
    },
    [editingName, onRename],
  )

  return (
    <ul className="clipboard-categories-list">
      <li>
        <button
          type="button"
          className={`clipboard-category${selected === 'all' ? ' is-active' : ''}`}
          onClick={() => onSelect('all')}
        >
          <span className="clipboard-category-swatch" style={{ background: 'var(--ink-faint)' }} />
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
                if (event.key === 'Enter') submitRename(category.id)
                if (event.key === 'Escape') {
                  setEditingId(null)
                  setEditingName('')
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
                setEditingId(category.id)
                setEditingName(category.name)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                onRemove(category.id)
              }}
              title="Double-click to rename · Right-click to delete"
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
  )
}

export const CategoryList = memo(CategoryListImpl)
