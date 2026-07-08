import { describe, expect, it } from 'vitest'
import {
  filePathsFromUriList,
  heroStackClassName,
  urlPayloadFromUriList,
} from './shelfDrop'

describe('filePathsFromUriList', () => {
  it('parses file:// URIs and decodes percent-encoded paths', () => {
    const list = [
      'file:///Users/alice/Documents/notes.md',
      'file:///Users/alice/Pictures/photo%20with%20spaces.png',
    ].join('\r\n')
    expect(filePathsFromUriList(list)).toEqual([
      '/Users/alice/Documents/notes.md',
      '/Users/alice/Pictures/photo with spaces.png',
    ])
  })

  it('skips non-file URIs and comments', () => {
    const list = [
      '# this is a comment',
      'file:///a.md',
      'https://example.com',
      '',
    ].join('\r\n')
    expect(filePathsFromUriList(list)).toEqual(['/a.md'])
  })

  it('returns an empty array for malformed input', () => {
    expect(filePathsFromUriList('not a uri list at all')).toEqual([])
    expect(filePathsFromUriList('')).toEqual([])
  })
})

describe('urlPayloadFromUriList', () => {
  it('returns the first http(s) URL with a hostname label', () => {
    const list = 'https://example.com/path\r\nhttps://other.example'
    expect(urlPayloadFromUriList(list)).toEqual({
      url: 'https://example.com/path',
      label: 'example.com',
    })
  })

  it('rejects non-http(s) schemes', () => {
    expect(urlPayloadFromUriList('file:///tmp/x')).toBeNull()
    expect(urlPayloadFromUriList('javascript:alert(1)')).toBeNull()
  })

  it('skips comment lines', () => {
    const list = '# a comment\r\nhttps://example.com'
    expect(urlPayloadFromUriList(list)?.url).toBe('https://example.com/')
  })
})

describe('heroStackClassName', () => {
  it('handles 1-card layout', () => {
    expect(heroStackClassName(0, 1)).toBe('hero-stack-card-front')
  })

  it('handles 2-card layout (front + back-left)', () => {
    expect(heroStackClassName(0, 2)).toBe('hero-stack-card-front')
    expect(heroStackClassName(1, 2)).toBe('hero-stack-card-back-left')
  })

  it('handles 3-card layout (front + back-left + back-right)', () => {
    expect(heroStackClassName(0, 3)).toBe('hero-stack-card-front')
    expect(heroStackClassName(1, 3)).toBe('hero-stack-card-back-left')
    expect(heroStackClassName(2, 3)).toBe('hero-stack-card-back-right')
  })
})
