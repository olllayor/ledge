import { describe, expect, it } from 'vitest'
import type { ShelfItemRecord } from '@shared/schema'
import { getExportableItems, getHeroCountLabel, getHeroMode } from './shelfFlow'

function baseItem(id: string, title: string) {
  return {
    id,
    createdAt: '2026-03-31T00:00:00.000Z',
    order: 0,
    title,
    subtitle: '',
    preview: {
      summary: title,
      detail: ''
    }
  }
}

function fileRef(path: string, isMissing = false) {
  return {
    originalPath: path,
    bookmarkBase64: '',
    resolvedPath: path,
    isStale: false,
    isMissing
  }
}

function imageItem(id: string): ShelfItemRecord {
  return {
    ...baseItem(id, `Image ${id}`),
    kind: 'imageAsset',
    file: fileRef(`/tmp/${id}.png`),
    mimeType: 'image/png'
  }
}

function fileItem(id: string, mimeType = 'application/pdf', isMissing = false): ShelfItemRecord {
  return {
    ...baseItem(id, `File ${id}`),
    kind: 'file',
    file: fileRef(`/tmp/${id}.dat`, isMissing),
    mimeType
  }
}

function textItem(id: string): ShelfItemRecord {
  return {
    ...baseItem(id, `Text ${id}`),
    kind: 'text',
    text: `Text ${id}`
  }
}

describe('getHeroMode', () => {
  it('uses single mode for one item', () => {
    expect(getHeroMode([imageItem('a')])).toBe('single')
  })

  it('uses collage mode for two or three previewable images', () => {
    expect(getHeroMode([imageItem('a'), imageItem('b')])).toBe('collage')
    expect(getHeroMode([imageItem('a'), imageItem('b'), imageItem('c')])).toBe('collage')
  })

  it('uses stack mode for mixed content or four-plus items', () => {
    expect(getHeroMode([imageItem('a'), fileItem('b')])).toBe('stack')
    expect(getHeroMode([imageItem('a'), imageItem('b'), imageItem('c'), imageItem('d')])).toBe('stack')
  })
})

describe('getExportableItems', () => {
  it('excludes non-file-backed and missing items from export', () => {
    const items = [fileItem('keep'), textItem('skip'), fileItem('missing', 'image/png', true)]

    expect(getExportableItems(items).map((item) => item.id)).toEqual(['keep'])
  })
})

describe('getHeroCountLabel', () => {
  it('matches the compact hero copy', () => {
    expect(getHeroCountLabel([imageItem('a')], 'single')).toBe('1 Image')
    expect(getHeroCountLabel([textItem('a')], 'single')).toBe('1 Item')
    expect(getHeroCountLabel([imageItem('a'), imageItem('b')], 'collage')).toBe('2 Images')
    expect(getHeroCountLabel([imageItem('a'), fileItem('b')], 'stack')).toBe('2 Items')
  })
})
