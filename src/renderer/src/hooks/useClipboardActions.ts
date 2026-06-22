import { useCallback, useMemo } from 'react'
import type { ClipboardEntry, ShelfColor } from '@shared/schema'

/**
 * Thin domain hook that wraps every `window.ledge.clipboardXxx` call
 * the renderer makes for clipboard management. Components consume
 * these named functions instead of touching the bridge directly, so
 * the wire format is encapsulated in one place.
 *
 * All callbacks are stable across renders (closed over nothing) so
 * the bundle below is `useMemo`d once and reused — the dependency
 * array only contains the stable callbacks, so the memo only
 * recomputes if a callback reference ever changes (never, in
 * practice). Components consuming this hook can therefore put any
 * of these callbacks in their own effect deps without re-firing.
 */
export interface ClipboardActions {
  copyEntry(entry: ClipboardEntry): Promise<boolean>
  removeEntry(entry: ClipboardEntry): Promise<void>
  assignEntry(entry: ClipboardEntry, categoryId: string): Promise<void>
  unassignEntry(entry: ClipboardEntry, categoryId: string): Promise<void>
  startItemDrag(entry: ClipboardEntry): boolean
  createCategory(name: string, color: ShelfColor): Promise<void>
  renameCategory(id: string, name: string): Promise<void>
  removeCategory(id: string): Promise<void>
  clearAllEntries(): Promise<void>
  pruneNow(): Promise<void>
}

export function useClipboardActions(): ClipboardActions {
  const copyEntry = useCallback(async (entry: ClipboardEntry) => {
    if (!window.ledge) return false
    try {
      return await window.ledge.clipboardCopy({ entryId: entry.id })
    } catch {
      return false
    }
  }, [])

  const removeEntry = useCallback(async (entry: ClipboardEntry) => {
    await window.ledge?.clipboardEntryRemove({ entryId: entry.id })
  }, [])

  const assignEntry = useCallback(async (entry: ClipboardEntry, categoryId: string) => {
    await window.ledge?.clipboardEntryAssign({ entryId: entry.id, categoryId })
  }, [])

  const unassignEntry = useCallback(async (entry: ClipboardEntry, categoryId: string) => {
    await window.ledge?.clipboardEntryUnassign({ entryId: entry.id, categoryId })
  }, [])

  const startItemDrag = useCallback((entry: ClipboardEntry) => {
    return window.ledge?.clipboardStartItemDrag({ entryId: entry.id }) ?? false
  }, [])

  const createCategory = useCallback(async (name: string, color: ShelfColor) => {
    await window.ledge?.clipboardCategoryCreate({ name, color })
  }, [])

  const renameCategory = useCallback(async (id: string, name: string) => {
    await window.ledge?.clipboardCategoryRename({ id, name })
  }, [])

  const removeCategory = useCallback(async (id: string) => {
    await window.ledge?.clipboardCategoryRemove({ id })
  }, [])

  const clearAllEntries = useCallback(async () => {
    await window.ledge?.clipboardEntryClearAll()
  }, [])

  const pruneNow = useCallback(async () => {
    await window.ledge?.clipboardPruneNow()
  }, [])

  // All deps are stable, so this memo runs exactly once per
  // component lifetime. Keeping the wrapper memoized preserves
  // `result.current` identity across renders — see the test.
  return useMemo(
    () => ({
      copyEntry,
      removeEntry,
      assignEntry,
      unassignEntry,
      startItemDrag,
      createCategory,
      renameCategory,
      removeCategory,
      clearAllEntries,
      pruneNow,
    }),
    [
      copyEntry,
      removeEntry,
      assignEntry,
      unassignEntry,
      startItemDrag,
      createCategory,
      renameCategory,
      removeCategory,
      clearAllEntries,
      pruneNow,
    ],
  )
}
