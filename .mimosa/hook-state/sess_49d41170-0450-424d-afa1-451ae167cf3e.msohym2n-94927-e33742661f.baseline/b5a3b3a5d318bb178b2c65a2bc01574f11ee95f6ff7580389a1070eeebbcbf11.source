import type { ClipboardEntry, ShelfItemRecord } from '@shared/schema'

/**
 * Renderer-side clipboard filtering primitives. Pure, dependency-free,
 * exported so they can be unit-tested without React or the IPC bridge.
 */
export type TypeFilter = 'all' | 'text' | 'image' | 'url' | 'file' | 'color' | 'code'

export interface ClipboardFilterState {
  type: TypeFilter
  app: string | 'all'
  category: string | 'all'
  search: string
}

export const EMPTY_CLIPBOARD_FILTER: ClipboardFilterState = {
  type: 'all',
  app: 'all',
  category: 'all',
  search: ''
}

type Item = ShelfItemRecord

/**
 * A lowercased haystack of every searchable field for a single entry.
 * Used for the `search` filter.
 */
export function entryHaystack(entry: ClipboardEntry): string {
  const parts: string[] = []
  parts.push(entry.sourceAppName)
  parts.push(entry.sourceBundleId)
  const item = entry.item
  switch (item.kind) {
    case 'text':
    case 'code':
      parts.push(item.text)
      break
    case 'url':
      parts.push(item.url)
      parts.push(item.title)
      break
    case 'imageAsset':
    case 'file':
    case 'folder':
      parts.push(item.title)
      parts.push(item.file.originalPath)
      parts.push(item.file.resolvedPath)
      break
    case 'color':
      parts.push(item.hex)
      parts.push(item.name ?? '')
      break
  }
  return parts.join(' ').toLowerCase()
}

export function entryMatchesType(entry: ClipboardEntry, type: TypeFilter): boolean {
  if (type === 'all') return true
  const item: Item = entry.item
  switch (type) {
    case 'text':
      return item.kind === 'text'
    case 'image':
      return item.kind === 'imageAsset'
    case 'url':
      return item.kind === 'url'
    case 'file':
      return item.kind === 'file' || item.kind === 'folder'
    case 'color':
      return item.kind === 'color'
    case 'code':
      return item.kind === 'code'
    default:
      return false
  }
}

export function filterEntries(
  entries: ClipboardEntry[],
  filter: ClipboardFilterState,
): ClipboardEntry[] {
  const search = filter.search.trim().toLowerCase()
  return entries.filter((entry) => {
    if (!entryMatchesType(entry, filter.type)) return false
    if (filter.app !== 'all' && entry.sourceAppName !== filter.app) return false
    if (filter.category !== 'all' && !entry.categoryIds.includes(filter.category)) return false
    if (search && !entryHaystack(entry).includes(search)) return false
    return true
  })
}

/** Distinct sorted list of source apps in the current entry set. */
export function distinctSourceApps(entries: ClipboardEntry[]): string[] {
  const set = new Set<string>()
  for (const entry of entries) {
    if (entry.sourceAppName) set.add(entry.sourceAppName)
  }
  return Array.from(set).sort()
}
