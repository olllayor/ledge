import { memo, useCallback, useState } from 'react'
import type { ShelfColor } from '@shared/schema'

const COLORS: ShelfColor[] = ['ember', 'wave', 'forest', 'sand']

interface CategoryFormProps {
  onCreate: (name: string, color: ShelfColor) => void
}

/**
 * The "new category" form rendered at the bottom of the category
 * sidebar. Owns its own draft state so the parent doesn't have to
 * plumb a 6th prop pair through.
 */
function CategoryFormImpl({ onCreate }: CategoryFormProps) {
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState<ShelfColor>('ember')

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      const trimmed = draftName.trim()
      if (!trimmed) return
      onCreate(trimmed, draftColor)
      setDraftName('')
      setDraftColor('ember')
    },
    [draftName, draftColor, onCreate],
  )

  return (
    <form className="clipboard-category-add" onSubmit={submit}>
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
  )
}

export const CategoryForm = memo(CategoryFormImpl)
