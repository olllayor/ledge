import { describe, expect, it } from 'vitest'
import {
  classifyPasteboard,
  classifyText,
  hexFromText,
  imagePayloadFromPng,
  looksLikeCode,
  makeCodeItem,
  makeColorItem,
  pathsFromFileUrlBuffer,
} from './payloads'

describe('classifyPasteboard', () => {
  it('prefers image over file-url and text', () => {
    expect(classifyPasteboard(['public.png', 'public.file-url', 'public.utf8-plain-text'])).toEqual({
      kind: 'image'
    })
  })

  it('detects TIFF and PDF as image formats', () => {
    expect(classifyPasteboard(['public.tiff'])).toEqual({ kind: 'image' })
    expect(classifyPasteboard(['com.adobe.pdf'])).toEqual({ kind: 'image' })
  })

  it('detects any image/* UTI', () => {
    expect(classifyPasteboard(['image/jpeg'])).toEqual({ kind: 'image' })
  })

  it('returns file-url when no image is present', () => {
    expect(classifyPasteboard(['public.file-url', 'public.utf8-plain-text'])).toEqual({
      kind: 'file-url'
    })
  })

  it('recognizes NSFilenamesPboardType and text/uri-list as file-url', () => {
    expect(classifyPasteboard(['NSFilenamesPboardType'])).toEqual({ kind: 'file-url' })
    expect(classifyPasteboard(['text/uri-list'])).toEqual({ kind: 'file-url' })
  })

  it('falls back to text for plain text pasteboards', () => {
    expect(classifyPasteboard(['public.utf8-plain-text'])).toEqual({ kind: 'text' })
    expect(classifyPasteboard([])).toEqual({ kind: 'text' })
  })
})

describe('hexFromText', () => {
  it('matches a 6-digit hex color with leading #', () => {
    expect(hexFromText('#FF8800')).toBe('#ff8800')
  })

  it('matches a 6-digit hex color without leading #', () => {
    expect(hexFromText('AABBCC')).toBe('#aabbcc')
  })

  it('matches an 8-digit hex color with alpha', () => {
    expect(hexFromText('#11223344')).toBe('#11223344')
  })

  it('rejects hex with the wrong number of digits', () => {
    expect(hexFromText('#FFF')).toBeNull()
    expect(hexFromText('#FFFFF')).toBeNull()
    expect(hexFromText('#FFFFFFF')).toBeNull()
  })

  it('rejects non-hex characters', () => {
    expect(hexFromText('GGGGGG')).toBeNull()
  })

  it('trims surrounding whitespace before matching', () => {
    expect(hexFromText('  #FF8800  ')).toBe('#ff8800')
  })

  it('returns null for empty / whitespace-only text', () => {
    expect(hexFromText('')).toBeNull()
    expect(hexFromText('   ')).toBeNull()
  })
})

describe('looksLikeCode', () => {
  it('returns false for short text', () => {
    expect(looksLikeCode('const x = 1')).toBe(false)
  })

  it('detects text with two-space indented lines', () => {
    expect(looksLikeCode('function foo() {\n  return 1\n}')).toBe(true)
  })

  it('detects text containing JS/TS keywords', () => {
    expect(looksLikeCode('const greeting = function() { return 1 }')).toBe(true)
  })

  it('detects text containing Python def/class', () => {
    expect(looksLikeCode('class Foo:\n    def bar(self):\n        return 1')).toBe(true)
  })

  it('detects text with braces and newlines', () => {
    expect(looksLikeCode('a = {b: 1}\nc = 2')).toBe(true)
  })

  it('returns false for plain prose', () => {
    expect(looksLikeCode(
      'This is a long enough paragraph of plain text that should not be mistaken for code. It has no keywords or indentation.',
    )).toBe(false)
  })
})

describe('classifyText', () => {
  it('returns null for empty or whitespace text', () => {
    expect(classifyText('')).toBeNull()
    expect(classifyText('   \n  ')).toBeNull()
  })

  it('classifies a hex string as color', () => {
    expect(classifyText('#FF8800')).toBe('color')
  })

  it('classifies indented text as code', () => {
    expect(classifyText('function foo() {\n  return 1\n}')).toBe('code')
  })

  it('classifies http(s) URLs as url', () => {
    expect(classifyText('https://example.com/path')).toBe('url')
    expect(classifyText('http://example.com')).toBe('url')
  })

  it('rejects non-http(s) schemes', () => {
    expect(classifyText('ftp://example.com')).toBe('text')
    expect(classifyText('javascript:alert(1)')).toBe('text')
  })

  it('falls back to text for everything else', () => {
    expect(classifyText('hello world')).toBe('text')
  })

  it('prioritizes color over code', () => {
    // 6 hex digits is short, so it should hit color before code.
    expect(classifyText('abcdef')).toBe('color')
  })
})

describe('makeColorItem', () => {
  it('produces a valid color shelf item with normalized hex', () => {
    const item = makeColorItem('#ff8800')
    expect(item.kind).toBe('color')
    if (item.kind === 'color') {
      expect(item.hex).toBe('#ff8800')
      expect(item.title).toBe('#ff8800')
      expect(item.subtitle).toBe('Color')
    }
  })
})

describe('makeCodeItem', () => {
  it('truncates the title to the first line, capped at 60 chars', () => {
    const text = 'function veryLongName() {\n  return 42\n}'
    const item = makeCodeItem(text)
    expect(item.kind).toBe('code')
    if (item.kind === 'code') {
      expect(item.title.length).toBeLessThanOrEqual(60)
      expect(item.text).toBe(text)
    }
  })

  it('falls back to a default title for empty text', () => {
    const item = makeCodeItem('')
    expect(item.kind).toBe('code')
    if (item.kind === 'code') {
      expect(item.title).toBe('Code snippet')
    }
  })
})

describe('pathsFromFileUrlBuffer', () => {
  it('strips the file:// scheme from a single path', () => {
    expect(pathsFromFileUrlBuffer('file:///Users/me/Documents')).toEqual(['/Users/me/Documents'])
  })

  it('splits a multi-line buffer on newlines', () => {
    const input = ['file:///Users/me/a', 'file:///Users/me/b'].join('\n')
    expect(pathsFromFileUrlBuffer(input)).toEqual(['/Users/me/a', '/Users/me/b'])
  })

  it('drops empty lines and trims whitespace', () => {
    const input = '  file:///a  \n\n  file:///b  \n'
    expect(pathsFromFileUrlBuffer(input)).toEqual(['/a', '/b'])
  })

  it('returns an empty array for empty input', () => {
    expect(pathsFromFileUrlBuffer('')).toEqual([])
    expect(pathsFromFileUrlBuffer('\n\n')).toEqual([])
  })
})

describe('imagePayloadFromPng', () => {
  it('produces an image ingest payload with base64-encoded buffer', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const payload = imagePayloadFromPng(png, 'screenshot')
    expect(payload.kind).toBe('image')
    expect(payload.mimeType).toBe('image/png')
    expect(payload.filenameHint).toBe('screenshot')
    expect(Buffer.from(payload.base64, 'base64').equals(png)).toBe(true)
  })

  it('uses a sensible default filename hint', () => {
    const payload = imagePayloadFromPng(Buffer.alloc(0))
    expect(payload.filenameHint).toBe('clipboard-image')
  })
})
