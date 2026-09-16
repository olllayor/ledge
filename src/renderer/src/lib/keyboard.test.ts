import { describe, expect, it } from 'vitest';
import { isBareEscape } from './keyboard';

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'Escape',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('isBareEscape', () => {
  it('accepts a bare Escape', () => {
    expect(isBareEscape(keyEvent())).toBe(true);
  });

  it('rejects other keys', () => {
    expect(isBareEscape(keyEvent({ key: 'Enter' }))).toBe(false);
  });

  it('rejects Escape with any modifier', () => {
    expect(isBareEscape(keyEvent({ metaKey: true }))).toBe(false);
    expect(isBareEscape(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(isBareEscape(keyEvent({ altKey: true }))).toBe(false);
    expect(isBareEscape(keyEvent({ shiftKey: true }))).toBe(false);
  });
});
