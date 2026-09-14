import { Hono } from 'hono';
import {
  generateOtpCode,
  otpCodeHash,
  randomToken,
  sha256,
} from './crypto';
import { insertIfUnderLimit, newId, now, queryAll, queryOne, run } from './db';
import { sendOtpEmail, EmailDeliveryError } from './emails';
import {
  MAX_ACTIVE_OTPS_PER_EMAIL,
  MAX_OTP_FAILED_ATTEMPTS,
  MIN_SESSION_REFRESH_GAP_MS,
  OTP_TTL_MS,
  SESSION_MAX_LIFETIME_MS,
  SESSION_TTL_MS,
  type Env,
} from './env';
import { requireAuth, type AppEnv, type SessionRow } from './middleware';

// ---------------------------------------------------------------------------
// Pure logic (unit-tested without D1)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) {
    throw new InvalidEmailError('Enter a valid email address.');
  }
  return normalized;
}

export class InvalidEmailError extends Error {}

export function canStoreOtp(activeCount: number, max: number = MAX_ACTIVE_OTPS_PER_EMAIL): boolean {
  return activeCount < max;
}

export interface FailedAttemptOutcome {
  next: number;
  shouldLock: boolean;
}

/** Increment lockout counter; lock (consume) once threshold is reached. */
export function nextFailedAttempt(
  current: number,
  max: number = MAX_OTP_FAILED_ATTEMPTS,
): FailedAttemptOutcome {
  const next = current + 1;
  return { next, shouldLock: next >= max };
}

export function sessionDaysRemaining(expiresAt: number, at: number): number {
  return Math.floor((expiresAt - at) / (24 * 60 * 60 * 1000));
}

export type RefreshDecision =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: 'too_soon' | 'max_lifetime' };

/**
 * Decide whether a session may be refreshed and what the new expiry is.
 * Pure so the gap / lifetime-cap rules are testable without D1.
 */
export function computeRefreshExpiry(input: {
  createdAt: number;
  expiresAt: number;
  lastRefreshedAt: number | null;
  at: number;
  ttlMs?: number;
  maxLifetimeMs?: number;
  minGapMs?: number;
}): RefreshDecision {
  const ttlMs = input.ttlMs ?? SESSION_TTL_MS;
  const maxLifetimeMs = input.maxLifetimeMs ?? SESSION_MAX_LIFETIME_MS;
  const minGapMs = input.minGapMs ?? MIN_SESSION_REFRESH_GAP_MS;

  const lastRefresh = input.lastRefreshedAt ?? input.createdAt;
  if (input.at - lastRefresh < minGapMs) {
    return { ok: false, reason: 'too_soon' };
  }

  const maxAllowedExpiry = input.createdAt + maxLifetimeMs;
  const newExpiresAt = Math.min(input.at + ttlMs, maxAllowedExpiry);
  if (newExpiresAt <= input.expiresAt) {
    return { ok: false, reason: 'max_lifetime' };
  }
  return { ok: true, expiresAt: newExpiresAt };
}

export interface OtpRow {
  id: string;
  email: string;
  code_hash: string;
  expires_at: number;
  consumed_at: number | null;
  failed_attempts: number;
  created_at: number;
}

export type VerifyOtpOutcome =
  | { ok: false; reason: 'invalid' }
  | { ok: true; otp: OtpRow };

/**
 * Pure verification decision for a candidate OTP row (already matched by
 * email+code_hash, unconsumed). Mirrors Convex verifyOtp terminal-state checks.
 */
export function evaluateOtpCandidate(otp: OtpRow, at: number): VerifyOtpOutcome {
  if (
    otp.consumed_at !== null ||
    otp.expires_at <= at ||
    otp.failed_attempts >= MAX_OTP_FAILED_ATTEMPTS
  ) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, otp };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

type DbOtp = {
  id: string;
  email: string;
  code_hash: string;
  expires_at: number;
  consumed_at: number | null;
  failed_attempts: number;
  created_at: number;
};

function daysPayload(expiresAt: number, at: number) {
  return {
    daysRemaining: sessionDaysRemaining(expiresAt, at),
    sessionExpiresAt: expiresAt,
  };
}

async function findUserByEmail(db: D1Database, email: string) {
  return queryOne<{ id: string; email: string }>(
    db,
    `SELECT id, email FROM users WHERE email = ?`,
    [email],
  );
}

async function ensureUser(db: D1Database, email: string, at: number) {
  const existing = await findUserByEmail(db, email);
  if (existing) return existing;

  // INSERT OR IGNORE keeps concurrent first-login races from unique-failing
  // on email; the follow-up SELECT always returns the winner row.
  await run(
    db,
    `INSERT OR IGNORE INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [newId(), email, at, at],
  );
  const user = await findUserByEmail(db, email);
  if (!user) {
    throw new Error('Unable to create user.');
  }
  await run(
    db,
    `INSERT OR IGNORE INTO entitlements (user_id, plan, status, updated_at) VALUES (?, 'free', 'active', ?)`,
    [user.id, at],
  );
  return user;
}

export const authRoutes = new Hono<AppEnv>();

/** POST /auth/otp — body `{ email }`. Rate-limit first, then email. */
authRoutes.post('/otp', async (c) => {
  let body: { email?: unknown };
  try {
    body = await c.req.json<{ email?: unknown }>();
  } catch {
    return c.json({ error: 'Enter a valid email address.' }, 400);
  }

  let email: string;
  try {
    if (typeof body.email !== 'string') throw new InvalidEmailError('Enter a valid email address.');
    email = normalizeEmail(body.email);
  } catch (err) {
    const message = err instanceof InvalidEmailError ? err.message : 'Enter a valid email address.';
    return c.json({ error: message }, 400);
  }

  const code = generateOtpCode();
  const codeHash = await otpCodeHash(email, code);
  const at = now();
  const expiresAt = at + OTP_TTL_MS;
  const otpId = newId();

  // Single-statement atomic count+insert. If the active OTP cap is already
  // reached, zero rows are written and we refuse before sending email.
  const inserted = await insertIfUnderLimit(
    c.env.DB,
    `INSERT INTO auth_otps (id, email, code_hash, expires_at, failed_attempts, created_at)
     SELECT ?1, ?2, ?3, ?4, 0, ?5
     WHERE (
       SELECT COUNT(*) FROM auth_otps
       WHERE email = ?2 AND consumed_at IS NULL AND expires_at > ?5
     ) < ?6`,
    [otpId, email, codeHash, expiresAt, at, MAX_ACTIVE_OTPS_PER_EMAIL],
  );

  if (!inserted) {
    return c.json(
      {
        error:
          'Too many sign-in codes requested. Please wait for one to expire and try again.',
      },
      429,
    );
  }

  try {
    await sendOtpEmail(c.env, email, code);
  } catch (err) {
    // Free the rate-limit slot so an email-service outage does not burn the user's
    // three active OTPs. Delete (not consume) so COUNT(*) drops immediately.
    await run(c.env.DB, `DELETE FROM auth_otps WHERE id = ?`, [otpId]);
    const message =
      err instanceof EmailDeliveryError
        ? err.message
        : 'Email delivery failed. Please try again.';
    return c.json({ error: message }, 502);
  }

  return c.json({ ok: true });
});

/** POST /auth/verify — body `{ email, code }` → session token. */
authRoutes.post('/verify', async (c) => {
  let body: { email?: unknown; code?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; code?: unknown }>();
  } catch {
    return c.json({ error: 'Enter a valid email address.' }, 400);
  }

  let email: string;
  try {
    if (typeof body.email !== 'string') throw new InvalidEmailError('Enter a valid email address.');
    email = normalizeEmail(body.email);
  } catch (err) {
    const message = err instanceof InvalidEmailError ? err.message : 'Enter a valid email address.';
    return c.json({ error: message }, 400);
  }

  if (typeof body.code !== 'string' || body.code.trim().length === 0) {
    return c.json({ error: 'Invalid or expired sign-in code.' }, 401);
  }

  const code = body.code.trim();
  const codeHash = await otpCodeHash(email, code);
  const at = now();

  const matches = await queryAll<DbOtp>(
    c.env.DB,
    `SELECT id, email, code_hash, expires_at, consumed_at, failed_attempts, created_at
     FROM auth_otps
     WHERE email = ? AND code_hash = ? AND consumed_at IS NULL
     ORDER BY created_at DESC`,
    [email, codeHash],
  );
  const candidate = matches[0] ?? null;
  const decision = candidate ? evaluateOtpCandidate(candidate, at) : null;

  if (!decision || !decision.ok) {
    // Wrong code: advance lockout on the newest *active* OTP for this email.
    // Walk a bounded set (not `.first()` of the email index) so a consumed/
    // expired newest row cannot pin the counter and allow infinite guesses.
    const recent = await queryAll<DbOtp>(
      c.env.DB,
      `SELECT id, email, code_hash, expires_at, consumed_at, failed_attempts, created_at
       FROM auth_otps
       WHERE email = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [email, MAX_ACTIVE_OTPS_PER_EMAIL],
    );
    const active = recent.find((row) => row.consumed_at === null && row.expires_at > at);
    if (active) {
      const { next, shouldLock } = nextFailedAttempt(active.failed_attempts);
      if (shouldLock) {
        await run(
          c.env.DB,
          `UPDATE auth_otps SET failed_attempts = ?, consumed_at = ? WHERE id = ?`,
          [next, at, active.id],
        );
      } else {
        await run(
          c.env.DB,
          `UPDATE auth_otps SET failed_attempts = ? WHERE id = ?`,
          [next, active.id],
        );
      }
    }
    return c.json({ error: 'Invalid or expired sign-in code.' }, 401);
  }

  // Atomic single-use claim: two concurrent verifies of the same code can
  // both pass evaluateOtpCandidate before either writes. Guard the consume
  // with `consumed_at IS NULL` so only one UPDATE lands; the loser is
  // treated as an invalid code.
  const claimed = await insertIfUnderLimit(
    c.env.DB,
    `UPDATE auth_otps SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
    [at, decision.otp.id],
  );
  if (!claimed) {
    return c.json({ error: 'Invalid or expired sign-in code.' }, 401);
  }

  const user = await ensureUser(c.env.DB, email, at);

  const sessionToken = randomToken();
  const tokenHash = await sha256(sessionToken);
  const expiresAt = at + SESSION_TTL_MS;
  await run(
    c.env.DB,
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [newId(), user.id, tokenHash, expiresAt, at],
  );

  return c.json({ sessionToken, email: user.email, ...daysPayload(expiresAt, at) });
});

/** GET /auth/me — current session user. */
authRoutes.get('/me', requireAuth, async (c) => {
  const user = c.get('authUser');
  const session = c.get('authSession');
  const at = now();
  return c.json({
    userId: user.id,
    email: user.email,
    ...daysPayload(session.expires_at, at),
  });
});

/** POST /auth/refresh — extend session; min gap + hard lifetime cap. */
authRoutes.post('/refresh', requireAuth, async (c) => {
  const session = c.get('authSession');
  const at = now();

  const decision = computeRefreshExpiry({
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    lastRefreshedAt: session.last_refreshed_at,
    at,
  });

  if (!decision.ok) {
    if (decision.reason === 'too_soon') {
      return c.json(
        { error: 'Session was refreshed too recently. Please try again later.' },
        429,
      );
    }
    return c.json(
      { error: 'Session has reached its maximum lifetime. Please sign in again.' },
      401,
    );
  }

  await run(
    c.env.DB,
    `UPDATE auth_sessions SET expires_at = ?, last_refreshed_at = ? WHERE id = ?`,
    [decision.expiresAt, at, session.id],
  );

  return c.json({
    ok: true,
    expiresAt: decision.expiresAt,
    ...daysPayload(decision.expiresAt, at),
  });
});

/**
 * POST /auth/signout — revoke by token hash.
 * Intentionally does NOT 401 on a dead token: local sign-out must succeed
 * even when the server session is already revoked/expired.
 */
authRoutes.post('/signout', async (c) => {
  const header = c.req.header('Authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  const token = match?.[1]?.trim();
  if (token) {
    const tokenHash = await sha256(token);
    await run(
      c.env.DB,
      `UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
      [now(), tokenHash],
    );
  }
  return c.json({ ok: true });
});

// Re-export for other modules that need the session type.
export type { SessionRow };
export type AuthEnv = Env;
