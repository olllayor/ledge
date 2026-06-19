import { describe, expect, it } from 'vitest';
import { hexFromText, looksLikeCode } from './clipboardHistory';

describe('hexFromText', () => {
  it('matches a 6-digit hex color with leading #', () => {
    expect(hexFromText('#FF8800')).toBe('#ff8800');
  });

  it('matches a 6-digit hex color without leading #', () => {
    expect(hexFromText('AABBCC')).toBe('#aabbcc');
  });

  it('matches an 8-digit hex color with alpha', () => {
    expect(hexFromText('#11223344')).toBe('#11223344');
  });

  it('rejects hex with the wrong number of digits', () => {
    expect(hexFromText('#FFF')).toBeNull();
    expect(hexFromText('#FFFFF')).toBeNull();
    expect(hexFromText('#FFFFFFF')).toBeNull();
  });

  it('rejects non-hex characters', () => {
    expect(hexFromText('GGGGGG')).toBeNull();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(hexFromText('  #FF8800  ')).toBe('#ff8800');
  });

  it('returns null for empty / whitespace-only text', () => {
    expect(hexFromText('')).toBeNull();
    expect(hexFromText('   ')).toBeNull();
  });
});

describe('looksLikeCode', () => {
  it('returns false for short text', () => {
    expect(looksLikeCode('const x = 1')).toBe(false);
  });

  it('detects text with two-space indented lines', () => {
    expect(looksLikeCode('function foo() {\n  return 1\n}')).toBe(true);
  });

  it('detects text containing JS/TS keywords', () => {
    expect(looksLikeCode('const greeting = function() { return 1 }')).toBe(true);
  });

  it('detects text containing Python def/class', () => {
    expect(looksLikeCode('class Foo:\n    def bar(self):\n        return 1')).toBe(true);
  });

  it('detects text with braces and newlines', () => {
    expect(looksLikeCode('a = {b: 1}\nc = 2')).toBe(true);
  });

  it('returns false for plain prose', () => {
    expect(looksLikeCode(
      'This is a long enough paragraph of plain text that should not be mistaken for code. It has no keywords or indentation.',
    )).toBe(false);
  });
});
