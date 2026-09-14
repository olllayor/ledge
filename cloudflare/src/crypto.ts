/**
 * Web Crypto helpers shared by auth routes and middleware.
 * Workers and Node 18+ both expose `crypto.subtle` / `crypto.getRandomValues`.
 */

/** SHA-256 hex digest of a UTF-8 string. Matches Convex `sha256()`. */
export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Opaque session/row token. Same shape Convex used (`crypto.randomUUID`). */
export function randomToken(): string {
  return crypto.randomUUID();
}

/**
 * Unbiased 6-digit OTP via rejection sampling.
 * A 32-bit draw has 4_294_967_296 values; the largest multiple of 1_000_000
 * that fits is 4_000_000_000. Draws at or above that bound are re-rolled so
 * `draw % 1_000_000` is exactly uniform.
 */
export function generateOtpCode(): string {
  const MAX_UNBIASED = 4_000_000_000;
  let draw: number;
  do {
    draw = crypto.getRandomValues(new Uint32Array(1))[0]!;
  } while (draw >= MAX_UNBIASED);
  return String(1_000_000 + (draw % 1_000_000)).slice(1);
}

/** OTP storage key: sha256(`${email}:${code}`). Matches Convex. */
export async function otpCodeHash(email: string, code: string): Promise<string> {
  return sha256(`${email}:${code}`);
}
