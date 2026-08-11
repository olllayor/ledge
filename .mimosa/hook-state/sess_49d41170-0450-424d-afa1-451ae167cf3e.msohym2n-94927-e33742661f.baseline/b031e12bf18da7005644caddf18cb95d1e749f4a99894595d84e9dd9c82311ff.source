/**
 * Pure helpers for the OTP (one-time password) input widget. Extracted so
 * the security-sensitive parts — what counts as a digit, how the visible
 * digits react to a paste, when `onComplete` fires — can be unit-tested
 * without a DOM.
 */

/**
 * Normalize a raw user input (key press, paste) to a single digit string.
 * Returns `''` for any input that contains no digits, including a raw
 * `''` (no input at all).
 */
export function sanitizeOtpDigit(raw: string): string {
  if (typeof raw !== 'string') {
    return '';
  }
  const digit = raw.replace(/\D/g, '')[0];
  return digit ?? '';
}

/**
 * Strip non-digit characters from a pasted string and cap it at `length`
 * characters. This is the paste-path normalization; the result is what
 * we splat into individual digit boxes.
 */
export function sanitizeOtpPaste(raw: string, length: number): string {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.replace(/\D/g, '').slice(0, length);
}

/**
 * Build the dynamic group-level aria label for the OTP field. Announces
 * the current fill count so a screen reader user knows how many digits
 * remain.
 */
export function otpGroupLabel(filled: number, total: number): string {
  if (filled <= 0) {
    return `Enter your ${total}-digit sign-in code`;
  }
  return `Entered ${filled} of ${total} digits`;
}

/**
 * Splat a pasted digit string into the existing digits array, starting
 * at index 0. Returns the new digits array and the index that should
 * receive focus next (caller is responsible for moving the focus).
 *
 * If the paste is shorter than `length`, focus advances to the next
 * empty slot. If the paste fills the array, focus lands on the last
 * digit. If the paste is empty, no change.
 */
export function applyOtpPaste(
  digits: string[],
  pasted: string,
  length: number,
): { digits: string[]; focusIndex: number; isComplete: boolean } {
  if (!pasted) {
    return { digits, focusIndex: digits.findIndex((d) => d === '') === -1 ? length - 1 : digits.findIndex((d) => d === ''), isComplete: false };
  }
  const next = digits.slice();
  for (let i = 0; i < pasted.length; i += 1) {
    next[i] = pasted[i]!;
  }
  const focusIndex = Math.min(pasted.length, length - 1);
  const isComplete = next.length === length && !next.includes('');
  return { digits: next, focusIndex, isComplete };
}
