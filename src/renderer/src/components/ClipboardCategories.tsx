import { memo } from 'react'
import type { ClipboardCategory, ShelfColor } from '@shared/schema'
import { CategoryList } from './ClipboardView/CategoryList'
import { CategoryForm } from './ClipboardView/CategoryForm'

interface ClipboardCategoriesProps {
  categories: ClipboardCategory[]
  selected: string | 'all'
  onSelect: (id: string | 'all') => void
  onCreate: (name: string, color: ShelfColor) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}

/**
 * Thin shell that composes the category list and the new-category
 * form. The two siblings used to be one file with 3 useState hooks
 * and 136 lines; splitting them keeps each focused and makes the
 * rename + create state independent.
 */
function CategoriesImpl({
  categories,
  selected,
  onSelect,
  onCreate,
  onRename,
  onRemove,
}: ClipboardCategoriesProps) {
  return (
    <aside className="clipboard-categories" aria-label="Categories">
      <CategoryList
        categories={categories}
        selected={selected}
        onSelect={onSelect}
        onRename={onRename}
        onRemove={onRemove}
      />
      <CategoryForm onCreate={onCreate} />
    </aside>
  )
}

export const ClipboardCategories = memo(CategoriesImpl)
