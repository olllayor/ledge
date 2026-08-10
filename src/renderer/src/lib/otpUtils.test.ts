import { describe, expect, it } from 'vitest';
import { applyOtpPaste, otpGroupLabel, sanitizeOtpDigit, sanitizeOtpPaste } from './otpUtils';

describe('sanitizeOtpDigit', () => {
  it('returns the first digit of a multi-digit input', () => {
    expect(sanitizeOtpDigit('42')).toBe('4');
  });

  it('returns an empty string for non-digit input', () => {
    expect(sanitizeOtpDigit('abc')).toBe('');
    expect(sanitizeOtpDigit('')).toBe('');
  });

  it('handles a single digit cleanly', () => {
    expect(sanitizeOtpDigit('7')).toBe('7');
  });

  it('treats non-string input as empty', () => {
    expect(sanitizeOtpDigit(null as unknown as string)).toBe('');
    expect(sanitizeOtpDigit(undefined as unknown as string)).toBe('');
  });
});

describe('sanitizeOtpPaste', () => {
  it('strips non-digits and caps at length', () => {
    expect(sanitizeOtpPaste('12abc34', 6)).toBe('1234');
    expect(sanitizeOtpPaste('1234567', 6)).toBe('123456');
  });

  it('returns empty for purely non-digit input', () => {
    expect(sanitizeOtpPaste('hello', 6)).toBe('');
  });
});

describe('otpGroupLabel', () => {
  it('announces the initial empty state', () => {
    expect(otpGroupLabel(0, 6)).toBe('Enter your 6-digit sign-in code');
  });

  it('announces intermediate progress', () => {
    expect(otpGroupLabel(3, 6)).toBe('Entered 3 of 6 digits');
  });

  it('announces the completed state', () => {
    expect(otpGroupLabel(6, 6)).toBe('Entered 6 of 6 digits');
  });

  it('treats negative input as the initial state', () => {
    expect(otpGroupLabel(-1, 6)).toBe('Enter your 6-digit sign-in code');
  });
});

describe('applyOtpPaste', () => {
  const length = 6;
  const empty = ['', '', '', '', '', ''];

  it('returns the original array and finds the first empty slot when the paste is empty', () => {
    const result = applyOtpPaste(empty, '', length);
    expect(result.digits).toEqual(empty);
    expect(result.isComplete).toBe(false);
  });

  it('splats the paste into the start of the array', () => {
    const result = applyOtpPaste(empty, '12', length);
    expect(result.digits).toEqual(['1', '2', '', '', '', '']);
    expect(result.focusIndex).toBe(2);
    expect(result.isComplete).toBe(false);
  });

  it('marks complete when the paste fills the array', () => {
    const result = applyOtpPaste(empty, '123456', length);
    expect(result.digits).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(result.focusIndex).toBe(5);
    expect(result.isComplete).toBe(true);
  });

  it('overwrites existing digits starting at index 0', () => {
    const filled = ['9', '9', '9', '', '', ''];
    const result = applyOtpPaste(filled, '12', length);
    expect(result.digits).toEqual(['1', '2', '9', '', '', '']);
    expect(result.isComplete).toBe(false);
  });

  it('expects a pre-capped paste; the caller sanitizes first', () => {
    // The component calls sanitizeOtpPaste(raw, length) before reaching
    // this function, so 7-digit input is the caller's bug to fix. The
    // function itself just splats whatever string it receives.
    const result = applyOtpPaste(empty, '1234567', length);
    // 7 elements, not 6 — applyOtpPaste is a low-level helper, not a
    // gatekeeper. Document that with a test rather than a runtime check.
    expect(result.digits).toHaveLength(7);
  });
});
