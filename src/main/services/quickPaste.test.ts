import { describe, expect, it } from 'vitest'
import { copyEntryToPasteboard, fileBackedPathsFromEntry, quickPastePasteEntry } from './quickPaste'
import type { ClipboardEntry, ShelfItemRecord } from '@shared/schema'
import { fileRefSchema } from '@shared/commonSchemas'
import type { ClipboardWriter } from './clipboard/writer'

function makeTextEntry(text: string): ClipboardEntry {
  const item: ShelfItemRecord = {
    id: 'item-1',
    kind: 'text',
    createdAt: '2026-06-20T00:00:00Z',
    order: 0,
    title: 'snippet',
    subtitle: '',
    preview: { summary: text, detail: '' },
    text
  }
  return {
    id: 'entry-1',
    capturedAt: '2026-06-20T00:00:00Z',
    sourceBundleId: '',
    sourceAppName: '',
    item,
    categoryIds: []
  }
}

function makeFileEntry(path: string): ClipboardEntry {
  const file = fileRefSchema.parse({
    originalPath: path,
    resolvedPath: path,
    bookmarkBase64: '',
    isStale: false,
    isMissing: false
  })
  const item: ShelfItemRecord = {
    id: 'item-2',
    kind: 'file',
    createdAt: '2026-06-20T00:00:00Z',
    order: 0,
    title: 'doc.pdf',
    subtitle: '',
    preview: { summary: 'doc.pdf', detail: '' },
    file,
    mimeType: 'application/pdf'
  }
  return {
    id: 'entry-2',
    capturedAt: '2026-06-20T00:00:00Z',
    sourceBundleId: '',
    sourceAppName: '',
    item,
    categoryIds: []
  }
}

function makeFakeWriter(): ClipboardWriter & {
  texts: string[]
  buffers: Array<{ format: string; data: string }>
  cleared: number
  images: number
} {
  const texts: string[] = []
  const buffers: Array<{ format: string; data: string }> = []
  let cleared = 0
  let images = 0
  return {
    texts,
    buffers,
    get cleared() {
      return cleared
    },
    images: 0,
    writeText(text: string) {
      texts.push(text)
    },
    writeBuffer(format: string, buffer: Buffer) {
      buffers.push({ format, data: buffer.toString('utf8') })
    },
    writeImage() {
      images += 1
    },
    clear() {
      cleared += 1
    }
  }
}

describe('copyEntryToPasteboard', () => {
  it('returns false for an unknown entry id', () => {
    expect(copyEntryToPasteboard('missing', () => undefined)).toBe(false)
  })

  it('writes a text entry to the clipboard and returns true', () => {
    const writer = makeFakeWriter()
    const entry = makeTextEntry('hello')
    expect(copyEntryToPasteboard(entry.id, () => entry, writer)).toBe(true)
    expect(writer.texts).toEqual(['hello'])
  })

  it('writes a hex color entry to the clipboard', () => {
    const writer = makeFakeWriter()
    const entry: ClipboardEntry = {
      ...makeTextEntry(''),
      item: {
        id: 'c1',
        kind: 'color',
        createdAt: '2026-06-20T00:00:00Z',
        order: 0,
        title: '#ff8800',
        subtitle: 'Color',
        preview: { summary: '#ff8800', detail: '' },
        hex: '#ff8800'
      }
    }
    expect(copyEntryToPasteboard(entry.id, () => entry, writer)).toBe(true)
    expect(writer.texts).toEqual(['#ff8800'])
  })
})

describe('quickPastePasteEntry', () => {
  it('returns immediately for an unknown entry id', async () => {
    const writer = makeFakeWriter()
    await quickPastePasteEntry(
      'missing',
      'com.other.app',
      () => undefined,
      { syntheticPasteEnabled: true, ignoreBundleIds: [] },
      'com.ollayor.ledge',
      writer,
    )
    expect(writer.texts).toEqual([])
  })

  it('refuses to paste back into Ledge itself', async () => {
    const writer = makeFakeWriter()
    const entry = makeTextEntry('hello')
    await quickPastePasteEntry(
      entry.id,
      'com.ollayor.ledge',
      () => entry,
      { syntheticPasteEnabled: true, ignoreBundleIds: [] },
      'com.ollayor.ledge',
      writer,
    )
    expect(writer.texts).toEqual([])
  })

  it('respects the ignoreBundleIds list', async () => {
    const writer = makeFakeWriter()
    const entry = makeTextEntry('hello')
    await quickPastePasteEntry(
      entry.id,
      'com.blocked.app',
      () => entry,
      { syntheticPasteEnabled: true, ignoreBundleIds: ['com.blocked.app'] },
      'com.ollayor.ledge',
      writer,
    )
    expect(writer.texts).toEqual([])
  })

  it('writes the entry to the clipboard for a non-Ledge app', async () => {
    const writer = makeFakeWriter()
    const entry = makeTextEntry('hello world')
    await quickPastePasteEntry(
      entry.id,
      'com.other.app',
      () => entry,
      { syntheticPasteEnabled: false, ignoreBundleIds: [] },
      'com.ollayor.ledge',
      writer,
    )
    expect(writer.texts).toEqual(['hello world'])
  })
})

describe('fileBackedPathsFromEntry', () => {
  it('returns the resolved path for file-backed items', () => {
    const entry = makeFileEntry('/Users/me/Documents/doc.pdf')
    expect(fileBackedPathsFromEntry(entry)).toEqual(['/Users/me/Documents/doc.pdf'])
  })

  it('returns an empty array for text entries', () => {
    const entry = makeTextEntry('hello')
    expect(fileBackedPathsFromEntry(entry)).toEqual([])
  })
})
