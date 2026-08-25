export interface ModifierState {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * True for a bare Escape press (no modifiers). Guarding dismissal on
 * this keeps future Cmd+Shift-Escape style shortcuts from being
 * swallowed by the shelf's clear-selection handler
 * (docs/vorssaint-shelf-plan.md Phase 4).
 */
export function isBareEscape(event: Pick<
  KeyboardEvent,
  keyof ModifierState
> & { key: string }): boolean {
  if (event.key !== 'Escape') {
    return false;
  }

  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
