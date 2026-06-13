import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectPayloadFromText, ImportedImageTooLargeError, payloadToItems, refreshFileRef } from './payloads'
import { getFileBackedPath, isFileBackedItem } from '@shared/fileUtils'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('payloadToItems', () => {
  it('creates file-backed items from dropped paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-payload-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'sample.txt')
    await writeFile(filePath, 'hello')

    const items = await payloadToItems(
      {
        kind: 'fileDrop',
        paths: [filePath]
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('file')
    expect(isFileBackedItem(items[0]!)).toBe(true)
    if (!isFileBackedItem(items[0]!)) {
      throw new Error('Expected file-backed item')
    }
    expect(getFileBackedPath(items[0])).toBe(filePath)
    expect(items[0]?.kind === 'file' ? items[0].mimeType : '').toBe('text/plain')
  })

  it('imports pathless images into app storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-image-'))
    tempDirs.push(dir)

    const items = await payloadToItems(
      {
        kind: 'image',
        mimeType: 'image/png',
        base64: Buffer.from('png-data').toString('base64'),
        filenameHint: 'dragged-image'
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    expect(items[0]?.kind).toBe('imageAsset')
    if (!isFileBackedItem(items[0]!)) {
      throw new Error('Expected imported image asset to be file-backed')
    }
    expect(getFileBackedPath(items[0])).toContain(dir)
    expect(items[0]?.title).toBe('dragged-image.png')
  })

  it('keeps the original filename for imported images when one exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-image-name-'))
    tempDirs.push(dir)

    const items = await payloadToItems(
      {
        kind: 'image',
        mimeType: 'image/jpeg',
        base64: Buffer.from('jpg-data').toString('base64'),
        filenameHint: 'screenshot-2026-03-31.jpg'
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    expect(items[0]?.kind).toBe('imageAsset')
    expect(items[0]?.title).toBe('screenshot-2026-03-31.jpg')
  })

  it('skips invalid dropped paths without failing valid ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-partial-drop-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'sample.txt')
    await writeFile(filePath, 'hello')

    const items = await payloadToItems(
      {
        kind: 'fileDrop',
        paths: [filePath, join(dir, 'missing.txt')]
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('file')
  })

  it('uses known MIME types and falls back safely for unknown extensions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-mime-'))
    tempDirs.push(dir)
    const pdfPath = join(dir, 'sample.PDF')
    const unknownPath = join(dir, 'archive.weirdext')
    await writeFile(pdfPath, 'pdf')
    await writeFile(unknownPath, 'unknown')

    const items = await payloadToItems(
      {
        kind: 'fileDrop',
        paths: [pdfPath, unknownPath]
      },
      {
        assetsDir: dir,
        createBookmark: async (path) => `bookmark:${path}`,
        resolveBookmark: async (bookmarkBase64) => ({
          resolvedPath: bookmarkBase64.replace('bookmark:', ''),
          isStale: false,
          isMissing: false
        })
      }
    )

    const fileItems = items.filter((item): item is Extract<(typeof items)[number], { kind: 'file' }> => item.kind === 'file')
    expect(fileItems.map((item) => item.mimeType)).toEqual(['application/pdf', 'application/octet-stream'])
  })
})

describe('detectPayloadFromText', () => {
  it('upgrades urls to url payloads', () => {
    expect(detectPayloadFromText('https://example.com/test').kind).toBe('url')
  })

  it('keeps regular text as text payloads', () => {
    expect(detectPayloadFromText('just a note').kind).toBe('text')
  })
})

describe('refreshFileRef', () => {
  it('marks missing non-bookmarked files as unavailable', async () => {
    const refreshed = await refreshFileRef(
      {
        originalPath: '/tmp/ledge-missing-item.txt',
        resolvedPath: '/tmp/ledge-missing-item.txt',
        bookmarkBase64: '',
        isStale: false,
        isMissing: false
      },
      {
        resolveBookmark: async () => ({
          resolvedPath: '',
          isStale: false,
          isMissing: true
        })
      }
    )

    expect(refreshed.isMissing).toBe(true)
    expect(refreshed.resolvedPath).toBe('')
  })

  it('keeps a non-bookmarked present file available without calling resolveBookmark', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-present-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'present.txt')
    await writeFile(filePath, 'present')

    let resolveCalled = false
    const refreshed = await refreshFileRef(
      {
        originalPath: filePath,
        resolvedPath: filePath,
        bookmarkBase64: '',
        isStale: false,
        isMissing: false
      },
      {
        resolveBookmark: async () => {
          resolveCalled = true
          return { resolvedPath: '', isStale: false, isMissing: true }
        }
      }
    )

    expect(resolveCalled).toBe(false)
    expect(refreshed.isMissing).toBe(false)
    expect(refreshed.resolvedPath).toBe(filePath)
  })

  it('passes bookmark data through to resolveBookmark and merges the result', async () => {
    let received: { bookmarkBase64: string; originalPath: string } | null = null
    const refreshed = await refreshFileRef(
      {
        originalPath: '/tmp/ledge-moved.txt',
        resolvedPath: '',
        bookmarkBase64: 'base64-data',
        isStale: false,
        isMissing: true
      },
      {
        resolveBookmark: async (bookmarkBase64, originalPath) => {
          received = { bookmarkBase64, originalPath }
          return { resolvedPath: '/new/location.txt', isStale: true, isMissing: false }
        }
      }
    )

    expect(received).toEqual({ bookmarkBase64: 'base64-data', originalPath: '/tmp/ledge-moved.txt' })
    expect(refreshed.resolvedPath).toBe('/new/location.txt')
    expect(refreshed.isStale).toBe(true)
    expect(refreshed.isMissing).toBe(false)
  })
})

describe('detectPayloadFromText', () => {
  it('treats mailto: and file:// URLs as plain text', () => {
    expect(detectPayloadFromText('mailto:user@example.com').kind).toBe('text')
    expect(detectPayloadFromText('file:///etc/hosts').kind).toBe('text')
  })
})

describe('payloadToItems image size cap', () => {
  it('rejects imported image payloads over the local cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dropshelf-bigimg-'))
    tempDirs.push(dir)
    // Build a base64 payload that decodes to ~26MB, over the 25MB cap.
    const oversized = Buffer.alloc(26 * 1024 * 1024, 0xff).toString('base64')

    await expect(
      payloadToItems(
        { kind: 'image', mimeType: 'image/png', base64: oversized, filenameHint: 'huge' },
        {
          assetsDir: dir,
          async createBookmark() {
            return ''
          },
          async resolveBookmark() {
            return { resolvedPath: '', isStale: false, isMissing: true }
          },
        },
      ),
    ).rejects.toBeInstanceOf(ImportedImageTooLargeError)
  })
})
