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
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  const submitRename = useCallback(
    (id: string) => {
      const trimmed = editingName.trim()
      if (!trimmed) {
        setEditingId(null)
        setEditingName('')
        return
      }
      const dup = categories.some((c) => c.id !== id && c.name.trim().toLowerCase() === trimmed.toLowerCase())
      if (dup) {
        window.ledge?.showToast(`Category "${trimmed}" already exists`, 'error')
        return
      }
      onRename(id, trimmed)
      setEditingId(null)
      setEditingName('')
    },
    [categories, editingName, onRename],
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
        <li key={category.id} className="clipboard-category-row">
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
          ) : confirmingDeleteId === category.id ? (
            <div className="clipboard-category-confirm">
              <span className="clipboard-category-confirm-label">Delete?</span>
              <button type="button" className="ghost-button small" onClick={() => setConfirmingDeleteId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ghost-button small is-danger"
                onClick={() => {
                  onRemove(category.id)
                  setConfirmingDeleteId(null)
                }}
              >
                Delete
              </button>
            </div>
          ) : (
            <div className="clipboard-category-item">
              <button
                type="button"
                className={`clipboard-category${selected === category.id ? ' is-active' : ''}`}
                onClick={() => onSelect(category.id)}
                onDoubleClick={() => {
                  setEditingId(category.id)
                  setEditingName(category.name)
                }}
                title="Click to filter · Double-click to rename"
                style={{ flex: 1 }}
              >
                <span
                  className="clipboard-category-swatch"
                  style={{ background: colorCssVar(category.color) }}
                />
                <span className="clipboard-category-name">{category.name}</span>
              </button>
              <div className="clipboard-category-actions">
                <button
                  type="button"
                  className="clipboard-category-action"
                  aria-label={`Rename ${category.name}`}
                  title="Rename"
                  onClick={() => {
                    setEditingId(category.id)
                    setEditingName(category.name)
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="clipboard-category-action is-danger"
                  aria-label={`Delete ${category.name}`}
                  title="Delete category"
                  onClick={() => setConfirmingDeleteId(category.id)}
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export const CategoryList = memo(CategoryListImpl)
