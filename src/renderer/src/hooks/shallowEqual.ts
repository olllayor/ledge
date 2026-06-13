/**
 * Shallow object equality. Returns `true` when both arguments are
 * reference-equal, both `null`, or are plain objects with the same
 * enumerable keys and `Object.is`-equal values.
 *
 * Used by `useLedgeState` to bail out of re-renders when a selected
 * state slice hasn't actually changed.
 */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}
