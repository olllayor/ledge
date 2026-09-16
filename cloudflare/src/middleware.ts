import type { Context, MiddlewareHandler } from 'hono';
import type { Env, AuthUser } from './env';
import { newId, nowMs, queryOne } from './db';
import { sha256 } from './crypto';

export { newId, nowMs };

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
  last_refreshed_at: number | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    authUser: AuthUser;
    authSession: SessionRow;
    /** Alias for routes that expect the shorter key. */
    user: AuthUser;
  };
};

/** Parse `Authorization: Bearer <token>`. Returns null when absent/malformed. */
export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S.*?)\s*$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export function isSessionActive(session: SessionRow, at: number): boolean {
  // Null-check (not truthiness): revoked_at may be 0 in fixtures.
  return session.revoked_at == null && session.expires_at > at;
}

/** Authenticated user; only call after `requireAuth`. */
export function user(c: Context<AppEnv>): AuthUser {
  return c.get('authUser');
}

/** Alias of `user` for callers written against `getUser`. */
export const getUser = user;

/**
 * Bearer session auth. Looks up `auth_sessions.token_hash` (SHA-256 of the
 * raw token) and rejects revoked / expired sessions.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractBearerToken(c.req.header('Authorization'));
  if (!token) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  const tokenHash = await sha256(token);
  const session = await queryOne<SessionRow>(
    c.env.DB,
    `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at, last_refreshed_at
     FROM auth_sessions
     WHERE token_hash = ?
     LIMIT 1`,
    [tokenHash],
  );

  const at = nowMs();
  if (!session || !isSessionActive(session, at)) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  const userRow = await queryOne<{ id: string; email: string }>(
    c.env.DB,
    `SELECT id, email FROM users WHERE id = ?`,
    [session.user_id],
  );
  if (!userRow) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  const authUser: AuthUser = {
    id: userRow.id,
    email: userRow.email,
    sessionExpiresAt: session.expires_at,
  };
  c.set('authUser', authUser);
  c.set('user', authUser);
  c.set('authSession', session);
  await next();
};
