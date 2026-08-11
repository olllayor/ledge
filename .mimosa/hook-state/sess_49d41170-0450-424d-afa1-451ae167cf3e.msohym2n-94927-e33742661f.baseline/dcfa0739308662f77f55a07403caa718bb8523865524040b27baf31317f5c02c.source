import { describe, expect, it } from 'vitest'
import type { ClipboardEntry, ShelfItemRecord } from '@shared/schema'
import { fileRefSchema } from '@shared/commonSchemas'
import {
  distinctSourceApps,
  EMPTY_CLIPBOARD_FILTER,
  entryHaystack,
  entryMatchesType,
  filterEntries
} from './clipboardFilters'

function makeEntry(overrides: Partial<ClipboardEntry> = {}): ClipboardEntry {
  const item: ShelfItemRecord = {
    id: 'item-1',
    kind: 'text',
    createdAt: '2026-06-20T00:00:00Z',
    order: 0,
    title: 'snippet',
    subtitle: '',
    preview: { summary: 'snippet', detail: '' },
    text: 'hello world'
  }
  return {
    id: 'entry-1',
    capturedAt: '2026-06-20T00:00:00Z',
    sourceBundleId: 'com.apple.Safari',
    sourceAppName: 'Safari',
    item,
    categoryIds: [],
    ...overrides
  }
}

function makeColorEntry(hex: string): ClipboardEntry {
  return makeEntry({
    id: 'entry-color',
    item: {
      id: 'item-color',
      kind: 'color',
      createdAt: '2026-06-20T00:00:00Z',
      order: 0,
      title: hex,
      subtitle: 'Color',
      preview: { summary: hex, detail: '' },
      hex
    }
  })
}

function makeFileEntry(path: string): ClipboardEntry {
  const file = fileRefSchema.parse({
    originalPath: path,
    resolvedPath: path,
    bookmarkBase64: '',
    isStale: false,
    isMissing: false
  })
  return makeEntry({
    id: 'entry-file',
    item: {
      id: 'item-file',
      kind: 'file',
      createdAt: '2026-06-20T00:00:00Z',
      order: 0,
      title: 'doc.pdf',
      subtitle: '',
      preview: { summary: 'doc.pdf', detail: '' },
      file,
      mimeType: 'application/pdf'
    }
  })
}

describe('entryHaystack', () => {
  it('includes the source app and bundle id', () => {
    const haystack = entryHaystack(makeEntry())
    expect(haystack).toContain('safari')
    expect(haystack).toContain('com.apple.safari')
  })

  it('includes text and code text bodies', () => {
    const haystack = entryHaystack(makeEntry())
    expect(haystack).toContain('hello world')
  })

  it('includes the color hex and optional name', () => {
    const haystack = entryHaystack(makeColorEntry('#ff8800'))
    expect(haystack).toContain('#ff8800')
  })

  it('includes the file path for file/folder items', () => {
    const haystack = entryHaystack(makeFileEntry('/Users/me/Documents/doc.pdf'))
    expect(haystack).toContain('/users/me/documents/doc.pdf')
  })
})

describe('entryMatchesType', () => {
  it('returns true for the "all" filter', () => {
    expect(entryMatchesType(makeEntry(), 'all')).toBe(true)
  })

  it('matches a text entry to the text filter', () => {
    expect(entryMatchesType(makeEntry(), 'text')).toBe(true)
    expect(entryMatchesType(makeEntry(), 'image')).toBe(false)
  })

  it('matches a color entry to the color filter', () => {
    expect(entryMatchesType(makeColorEntry('#ff8800'), 'color')).toBe(true)
  })

  it('matches a file entry to the file filter', () => {
    expect(entryMatchesType(makeFileEntry('/a'), 'file')).toBe(true)
  })
})

describe('filterEntries', () => {
  const entries: ClipboardEntry[] = [
    makeEntry({ id: 'e1', sourceAppName: 'Safari' }),
    { ...makeColorEntry('#ff8800'), sourceAppName: 'Terminal' },
    { ...makeFileEntry('/Users/me/Documents/doc.pdf'), sourceAppName: 'Terminal' }
  ]

  it('returns every entry with the empty filter', () => {
    expect(filterEntries(entries, EMPTY_CLIPBOARD_FILTER)).toEqual(entries)
  })

  it('filters by type', () => {
    const filtered = filterEntries(entries, { ...EMPTY_CLIPBOARD_FILTER, type: 'color' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.item.kind).toBe('color')
  })

  it('filters by app', () => {
    const filtered = filterEntries(entries, { ...EMPTY_CLIPBOARD_FILTER, app: 'Safari' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe('e1')
  })

  it('filters by category', () => {
    const tagged: ClipboardEntry[] = [
      { ...makeEntry({ id: 'tagged' }), categoryIds: ['cat-1'] },
      makeEntry({ id: 'untagged' })
    ]
    const filtered = filterEntries(tagged, { ...EMPTY_CLIPBOARD_FILTER, category: 'cat-1' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe('tagged')
  })

  it('filters by search (case-insensitive)', () => {
    const filtered = filterEntries(entries, { ...EMPTY_CLIPBOARD_FILTER, search: 'hello world' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.sourceAppName).toBe('Safari')
  })
})

describe('distinctSourceApps', () => {
  it('returns a sorted, deduplicated list of source app names', () => {
    const apps = distinctSourceApps([
      makeEntry({ id: 'a', sourceAppName: 'Terminal' }),
      makeEntry({ id: 'b', sourceAppName: 'Safari' }),
      makeEntry({ id: 'c', sourceAppName: 'Safari' }),
      makeEntry({ id: 'd', sourceAppName: '' })
    ])
    expect(apps).toEqual(['Safari', 'Terminal'])
  })
})
