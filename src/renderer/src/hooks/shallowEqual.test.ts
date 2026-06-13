import { describe, expect, it } from 'vitest';
import { shallowEqual } from './shallowEqual';

describe('shallowEqual', () => {
  it('returns true for reference-equal arguments', () => {
    const obj = { a: 1 };
    expect(shallowEqual(obj, obj)).toBe(true);
  });

  it('returns true for two objects with the same keys and values', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it('returns false when a value differs', () => {
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('returns false when keys differ', () => {
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('returns false when key count differs', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('treats both null as equal', () => {
    expect(shallowEqual(null, null)).toBe(true);
  });

  it('treats null vs object as unequal', () => {
    expect(shallowEqual(null, { a: 1 })).toBe(false);
    expect(shallowEqual({ a: 1 }, null)).toBe(false);
  });

  it('uses Object.is for value comparison (NaN equals NaN)', () => {
    expect(shallowEqual({ a: NaN }, { a: NaN })).toBe(true);
  });

  it('uses Object.is for value comparison (0 vs -0 is false)', () => {
    // Object.is(0, -0) is false; we preserve that.
    expect(shallowEqual({ a: 0 }, { a: -0 })).toBe(false);
  });

  it('returns false for non-object primitives', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual('a', 'b')).toBe(false);
  });
});
