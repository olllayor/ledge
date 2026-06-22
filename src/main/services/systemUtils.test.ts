import { describe, expect, it } from 'vitest'
import { isOpenPathSuccess, normalizeGlobalShortcut, urlToWebloc, validateGlobalShortcut } from './systemUtils'

describe('urlToWebloc', () => {
  it('escapes XML-sensitive URL characters', () => {
    const contents = urlToWebloc('https://example.com?q=a&b=<test>')

    expect(contents).toContain('https://example.com?q=a&amp;b=&lt;test&gt;')
  })
})

describe('validateGlobalShortcut', () => {
  it('accepts an empty shortcut to disable registration', () => {
    expect(validateGlobalShortcut('')).toBe('')
  })

  it('accepts a valid accelerator', () => {
    expect(validateGlobalShortcut(' CommandOrControl + Shift + Space ')).toBe('')
    expect(normalizeGlobalShortcut(' CommandOrControl + Shift + Space ')).toBe('CommandOrControl+Shift+Space')
  })

  it('collapses duplicate modifiers during normalization', () => {
    expect(normalizeGlobalShortcut('Command+Command+Space')).toBe('Command+Space')
    expect(validateGlobalShortcut('Command+Command+Space')).toBe('')
  })

  it('rejects missing non-modifier keys', () => {
    expect(validateGlobalShortcut('Command+Shift')).toBe('Shortcut needs a non-modifier key.')
  })
})

describe('isOpenPathSuccess', () => {
  it('treats non-empty shell errors as failures', () => {
    expect(isOpenPathSuccess('')).toBe(true)
    expect(isOpenPathSuccess('The file could not be opened')).toBe(false)
  })
})

describe('validateGlobalShortcut (additional cases)', () => {
  it('rejects completely empty input', () => {
    expect(validateGlobalShortcut('   ')).toBe('')
  })

  it('rejects unknown keys', () => {
    expect(validateGlobalShortcut('Command+NotAKey')).toBe('Shortcut key "NotAKey" is not supported.')
  })

  it('rejects a bare modifier with no key', () => {
    expect(validateGlobalShortcut('Command')).toBe('Shortcut needs a non-modifier key.')
  })
})

describe('normalizeGlobalShortcut (modifier alias collapse)', () => {
  it('rewrites lowercase modifier aliases to canonical Electron names', () => {
    expect(normalizeGlobalShortcut('cmd+shift+z')).toBe('Command+Shift+z')
    expect(normalizeGlobalShortcut('option+space')).toBe('Option+space')
  })

  it('collapses synonyms that map to the same canonical modifier', () => {
    expect(normalizeGlobalShortcut('Option+Alt+V')).toBe('Option+V')
    expect(normalizeGlobalShortcut('cmd+command+space')).toBe('Command+space')
  })

  it('keeps valid accelerators unchanged after canonicalization', () => {
    expect(normalizeGlobalShortcut('CommandOrControl+Shift+Space')).toBe(
      'CommandOrControl+Shift+Space',
    )
  })

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeGlobalShortcut('   ')).toBe('')
  })
})
