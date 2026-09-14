import { describe, expect, it } from 'vitest';
import {
  canStoreOtp,
  computeRefreshExpiry,
  evaluateOtpCandidate,
  InvalidEmailError,
  nextFailedAttempt,
  normalizeEmail,
  sessionDaysRemaining,
  type OtpRow,
} from '../src/auth';
import { generateOtpCode, otpCodeHash, randomToken, sha256 } from '../src/crypto';
import { extractBearerToken, isSessionActive, type SessionRow } from '../src/middleware';
import {
  MAX_ACTIVE_OTPS_PER_EMAIL,
  MAX_OTP_FAILED_ATTEMPTS,
  MIN_SESSION_REFRESH_GAP_MS,
  SESSION_MAX_LIFETIME_MS,
  SESSION_TTL_MS,
} from '../src/env';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function otp(overrides: Partial<OtpRow> = {}): OtpRow {
  return {
    id: 'otp-1',
    email: 'a@b.com',
    code_hash: 'hash',
    expires_at: 1_000_000,
    consumed_at: null,
    failed_attempts: 0,
    created_at: 0,
    ...overrides,
  };
}

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    user_id: 'u1',
    token_hash: 'h',
    expires_at: 1_000_000,
    revoked_at: null,
    created_at: 0,
    last_refreshed_at: null,
    ...overrides,
  };
}

describe('sha256', () => {
  it('matches the known SHA-256 digest of "abc"', async () => {
    // FIPS 180-2 test vector
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('otpCodeHash is sha256(`${email}:${code}`)', async () => {
    expect(await otpCodeHash('User@Example.com', '123456')).toBe(
      await sha256('User@Example.com:123456'),
    );
  });
});

describe('generateOtpCode', () => {
  it('always yields 6 digits in 000000–999999', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
      const n = Number(code);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1_000_000);
    }
  });
});

describe('randomToken', () => {
  it('produces unique UUIDs', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  it('rejects malformed addresses', () => {
    expect(() => normalizeEmail('not-an-email')).toThrow(InvalidEmailError);
    expect(() => normalizeEmail('a@b')).toThrow(InvalidEmailError);
    expect(() => normalizeEmail('a b@c.com')).toThrow(InvalidEmailError);
  });
});

describe('canStoreOtp / rate limit', () => {
  it('allows below the cap and refuses at the cap', () => {
    expect(canStoreOtp(0)).toBe(true);
    expect(canStoreOtp(MAX_ACTIVE_OTPS_PER_EMAIL - 1)).toBe(true);
    expect(canStoreOtp(MAX_ACTIVE_OTPS_PER_EMAIL)).toBe(false);
    expect(canStoreOtp(MAX_ACTIVE_OTPS_PER_EMAIL + 1)).toBe(false);
  });
});

describe('nextFailedAttempt', () => {
  it('increments without locking below threshold', () => {
    expect(nextFailedAttempt(0)).toEqual({ next: 1, shouldLock: false });
    expect(nextFailedAttempt(MAX_OTP_FAILED_ATTEMPTS - 2)).toEqual({
      next: MAX_OTP_FAILED_ATTEMPTS - 1,
      shouldLock: false,
    });
  });

  it('locks at the threshold', () => {
    expect(nextFailedAttempt(MAX_OTP_FAILED_ATTEMPTS - 1)).toEqual({
      next: MAX_OTP_FAILED_ATTEMPTS,
      shouldLock: true,
    });
  });
});

describe('evaluateOtpCandidate', () => {
  const at = 500;

  it('accepts an active unconsumed unexpired OTP', () => {
    expect(evaluateOtpCandidate(otp({ expires_at: at + 1 }), at)).toMatchObject({ ok: true });
  });

  it('rejects consumed, expired, and locked rows without further bumps', () => {
    expect(evaluateOtpCandidate(otp({ consumed_at: at - 1 }), at)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(evaluateOtpCandidate(otp({ expires_at: at }), at)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(
      evaluateOtpCandidate(otp({ failed_attempts: MAX_OTP_FAILED_ATTEMPTS }), at),
    ).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('sessionDaysRemaining', () => {
  it('floors partial days', () => {
    const at = 0;
    expect(sessionDaysRemaining(30 * DAY, at)).toBe(30);
    expect(sessionDaysRemaining(30 * DAY - 1, at)).toBe(29);
    expect(sessionDaysRemaining(at, at)).toBe(0);
  });
});

describe('computeRefreshExpiry', () => {
  const createdAt = 0;

  it('allows a first refresh after the min gap and extends by TTL', () => {
    const at = MIN_SESSION_REFRESH_GAP_MS;
    const currentExpiry = at + DAY; // still plenty of room
    const result = computeRefreshExpiry({
      createdAt,
      expiresAt: currentExpiry,
      lastRefreshedAt: null,
      at,
    });
    expect(result).toEqual({ ok: true, expiresAt: at + SESSION_TTL_MS });
  });

  it('refuses refresh inside the min gap', () => {
    const at = MIN_SESSION_REFRESH_GAP_MS - 1;
    const result = computeRefreshExpiry({
      createdAt,
      expiresAt: at + 10 * DAY,
      lastRefreshedAt: null,
      at,
    });
    expect(result).toEqual({ ok: false, reason: 'too_soon' });
  });

  it('uses lastRefreshedAt when present for the gap check', () => {
    const last = 10 * HOUR;
    const at = last + MIN_SESSION_REFRESH_GAP_MS - 1;
    const result = computeRefreshExpiry({
      createdAt,
      expiresAt: at + 10 * DAY,
      lastRefreshedAt: last,
      at,
    });
    expect(result).toEqual({ ok: false, reason: 'too_soon' });
  });

  it('caps expiry at createdAt + max lifetime', () => {
    const at = SESSION_MAX_LIFETIME_MS - 5 * DAY;
    const result = computeRefreshExpiry({
      createdAt,
      expiresAt: at + DAY,
      lastRefreshedAt: at - MIN_SESSION_REFRESH_GAP_MS,
      at,
    });
    expect(result).toEqual({ ok: true, expiresAt: SESSION_MAX_LIFETIME_MS });
  });

  it('refuses when the lifetime cap is already reached', () => {
    const at = SESSION_MAX_LIFETIME_MS + DAY;
    const result = computeRefreshExpiry({
      createdAt,
      expiresAt: SESSION_MAX_LIFETIME_MS,
      lastRefreshedAt: at - MIN_SESSION_REFRESH_GAP_MS,
      at,
    });
    expect(result).toEqual({ ok: false, reason: 'max_lifetime' });
  });
});

describe('isSessionActive / extractBearerToken', () => {
  it('accepts live sessions and rejects revoked/expired', () => {
    expect(isSessionActive(session({ expires_at: 2 }), 1)).toBe(true);
    expect(isSessionActive(session({ expires_at: 1 }), 1)).toBe(false);
    expect(isSessionActive(session({ revoked_at: 0 }), 1)).toBe(false);
  });

  it('parses Bearer headers', () => {
    expect(extractBearerToken('Bearer abc')).toBe('abc');
    expect(extractBearerToken('bearer   abc  ')).toBe('abc');
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});
