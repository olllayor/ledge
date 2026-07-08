import { describe, expect, it } from 'vitest';
import type { AppState } from '@shared/schema';
import { projectAppState } from './projectAppState';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    liveShelf: null,
    recentShelves: [],
    preferences: {} as AppState['preferences'],
    sync: {} as AppState['sync'],
    permissionStatus: {} as AppState['permissionStatus'],
    ...overrides,
  } as AppState;
}

describe('projectAppState', () => {
  it('returns the previous slice when fullState is null', () => {
    const previous = { a: 1 } as const;
    expect(projectAppState(previous, null, undefined)).toBe(previous);
  });

  it('returns the projected slice on first non-null fullState', () => {
    const fullState = makeState({ liveShelf: { id: 'a' } as AppState['liveShelf'] });
    const result = projectAppState(null, fullState, undefined);
    expect(result).toBe(fullState);
  });

  it('uses the selector when one is provided', () => {
    const fullState = makeState({ liveShelf: { id: 'a' } as AppState['liveShelf'] });
    const selector = (s: AppState) => s.liveShelf;
    expect(projectAppState(null, fullState, selector)).toBe(fullState.liveShelf);
  });

  it('returns the previous slice when shallow-equal to the next', () => {
    const sliceA = { count: 1 };
    const sliceB = { count: 1 }; // different reference, same shape
    const result = projectAppState(sliceA, makeState(), () => sliceB);
    expect(result).toBe(sliceA);
  });

  it('returns the next slice when it differs from the previous', () => {
    const sliceA = { count: 1 };
    const sliceB = { count: 2 };
    const result = projectAppState(sliceA, makeState(), () => sliceB);
    expect(result).toBe(sliceB);
  });

  it('honors a custom equality function (equal timestamps → keep previous)', () => {
    const sliceA = { timestamp: 100 };
    const sliceB = { timestamp: 100 }; // same value, different reference
    const eq = (a: typeof sliceA, b: typeof sliceA) => a.timestamp === b.timestamp;
    // Custom eq treats them as equal, so the previous reference is preserved.
    expect(projectAppState(sliceA, makeState(), () => sliceB, eq)).toBe(sliceA);
  });

  it('honors a custom equality function (different timestamps → return next)', () => {
    const sliceA = { timestamp: 100 };
    const sliceB = { timestamp: 200 };
    const eq = (a: typeof sliceA, b: typeof sliceA) => a.timestamp === b.timestamp;
    expect(projectAppState(sliceA, makeState(), () => sliceB, eq)).toBe(sliceB);
  });
});
