import { describe, expect, it } from 'vitest';
import { looksSensitive } from './sensitiveText';

describe('looksSensitive', () => {
  it('flags obvious secret words regardless of case', () => {
    expect(looksSensitive('hunter2 password')).toBe(true);
    expect(looksSensitive('Bearer eyJhbGciOi. authorization header')).toBe(true);
    expect(looksSensitive('APIKEY=abcd1234')).toBe(true);
    expect(looksWithToken()).toBe(true);
  });

  it('flags secret-shaped strings: long, unbroken, mixed classes', () => {
    expect(looksSensitive('aB3$xY9#kL2mN5pQ7rS1')).toBe(true);
  });

  it('never flags URLs', () => {
    expect(looksSensitive('https://example.com/token/abc123def456')).toBe(false);
  });

  it('never flags identifier codes (UUID shape)', () => {
    expect(looksSensitive('123e4567-e89b-12d3-a456-426614174000')).toBe(false);
    expect(looksSensitive('{123E4567-E89B-12D3-A456-426614174000}')).toBe(false);
  });

  it('rejects near-miss UUID shapes strictly', () => {
    // Wrong group lengths — no pass.
    expect(looksSensitive('123e4567-e89b-12d3-a456-42661417400')).toBe(true);
    // Non-hex digit in a group.
    expect(looksSensitive('123e456z-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('does not flag short strings', () => {
    expect(looksSensitive('short1!x')).toBe(false);
  });

  it('does not flag whitespace-separated text', () => {
    expect(looksSensitive('correct horse battery staple 123')).toBe(false);
  });

  it('does not flag single-class strings', () => {
    expect(looksSensitive('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(looksSensitive('123456789012345678901234567890123456')).toBe(false);
  });
});

function looksWithToken(): boolean {
  return looksSensitive('ghp_9xT0kenValueAbCdEf123456');
}
