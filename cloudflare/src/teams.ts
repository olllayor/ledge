/**
 * Teams, invitations, and the shared team shelf.
 *
 * Security rules that must not regress:
 * - Invite accept/reject require session email === invitation.email.
 * - GET /invites/pending never returns the raw token (id/team/role/email only).
 * - Only sha256(token) is stored; the raw 32-byte hex token is never persisted.
 * - deleteTeam wipes team_members, team_invitations, and shelf_items for the team.
 * - Item payloads strip local paths (same rule as personal sync).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { sha256 } from './crypto';
import { queryAll, queryOne } from './db';
import { sendTeamInviteEmail } from './emails';
import { getUser, newId, nowMs, requireAuth } from './middleware';
import type { AppEnv } from './middleware';
import { sanitizeFileFlags } from './sanitize';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SHELF_ID = 'default';
const TEAM_ITEMS_READ_CAP = 500;

const ITEM_KINDS = new Set([
  'file',
  'folder',
  'imageAsset',
  'text',
  'url',
  'color',
  'code',
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

type ErrorStatus = 400 | 403 | 404 | 409 | 410 | 422;

class AppError extends Error {
  constructor(
    message: string,
    readonly status: ErrorStatus,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function fail(c: Context<AppEnv>, err: unknown): Response {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.status);
  }
  console.error('[teams]', err);
  return c.json({ error: 'Internal error.' }, 500);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 32 random bytes as hex. Stored only as sha256 hash. */
export function randomInviteToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function normalizeInviteEmail(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new AppError('Enter a valid email address.', 400);
  }
  const email = raw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AppError('Enter a valid email address.', 400);
  }
  return email;
}

export function parseRole(raw: unknown): 'admin' | 'member' {
  if (raw === 'admin' || raw === 'member') return raw;
  throw new AppError('Role must be "admin" or "member".', 400);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

type TeamRole = 'admin' | 'member';

async function requireTeamMember(
  env: AppEnv['Bindings'],
  teamId: string,
  userId: string,
  requiredRole?: TeamRole,
): Promise<{ role: TeamRole }> {
  const membership = await queryOne<{ role: TeamRole }>(
    env.DB,
    `SELECT role FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1`,
    [teamId, userId],
  );

  if (!membership) {
    throw new AppError('You are not a member of this team.', 403);
  }
  if (requiredRole === 'admin' && membership.role !== 'admin') {
    throw new AppError('Admin permission required.', 403);
  }
  return membership;
}

function shelfIdFromQuery(c: Context<AppEnv>): string {
  return c.req.query('shelfId') || DEFAULT_SHELF_ID;
}

/**
 * Path-stripped team item fields. Same local-path rule as personal sync:
 * savedFilePath / originalPath / resolvedPath / bookmarkBase64 never persist.
 * Order may be a lexorank string (team mutations) or a number (stringified).
 */
export function sanitizeTeamItem(rawBody: Record<string, unknown>): {
  itemId: string;
  kind: string;
  title: string;
  subtitle: string;
  preview: { summary: string; detail: string };
  order: string;
  payload: Record<string, unknown>;
} {
  const itemId =
    typeof rawBody.itemId === 'string' && rawBody.itemId
      ? rawBody.itemId
      : typeof rawBody.id === 'string'
        ? rawBody.id
        : '';
  if (!itemId) {
    throw new AppError('itemId is required.', 400);
  }

  const kind = typeof rawBody.kind === 'string' ? rawBody.kind : '';
  if (!ITEM_KINDS.has(kind)) {
    throw new AppError(
      `kind must be one of: ${[...ITEM_KINDS].join(', ')}.`,
      400,
    );
  }

  const orderRaw = rawBody.order;
  let order: string;
  if (typeof orderRaw === 'string' && orderRaw.length > 0) {
    order = orderRaw;
  } else if (typeof orderRaw === 'number' && Number.isFinite(orderRaw)) {
    order = String(orderRaw);
  } else {
    throw new AppError('order is required (lexorank string or number).', 400);
  }

  const previewRaw = asRecord(rawBody.preview);
  const preview = {
    summary: typeof previewRaw?.summary === 'string' ? previewRaw.summary : '',
    detail: typeof previewRaw?.detail === 'string' ? previewRaw.detail : '',
  };

  const title = typeof rawBody.title === 'string' ? rawBody.title : '';
  const subtitle = typeof rawBody.subtitle === 'string' ? rawBody.subtitle : '';

  // Kind-specific payload; local paths dropped.
  const payload: Record<string, unknown> = {};
  if (kind === 'file' || kind === 'folder' || kind === 'imageAsset') {
    payload.file = sanitizeFileFlags(rawBody.file);
  }
  if (kind === 'file' || kind === 'imageAsset') {
    payload.mimeType =
      typeof rawBody.mimeType === 'string' ? rawBody.mimeType : 'application/octet-stream';
  }
  if (kind === 'text' || kind === 'code') {
    payload.text = typeof rawBody.text === 'string' ? rawBody.text : '';
  }
  if (kind === 'url') {
    payload.url = typeof rawBody.url === 'string' ? rawBody.url : '';
  }
  if (kind === 'color') {
    payload.hex = typeof rawBody.hex === 'string' ? rawBody.hex : '';
    if (typeof rawBody.name === 'string') payload.name = rawBody.name;
  }
  if (kind === 'code' && typeof rawBody.language === 'string') {
    payload.language = rawBody.language;
  }
  if (typeof rawBody.cloudStorageKey === 'string' && rawBody.cloudStorageKey) {
    payload.cloudStorageKey = rawBody.cloudStorageKey;
  }
  if (
    typeof rawBody.cloudStorageBytes === 'number' &&
    Number.isFinite(rawBody.cloudStorageBytes)
  ) {
    payload.cloudStorageBytes = Math.max(0, Math.floor(rawBody.cloudStorageBytes));
  }

  return { itemId, kind, title, subtitle, preview, order, payload };
}

interface ShelfItemRow {
  item_id: string;
  kind: string;
  title: string;
  subtitle: string;
  preview_json: string;
  order_key: string;
  payload_json: string;
  version: number;
  server_updated_at: number;
  created_by: string;
  updated_by: string | null;
  creator_email: string | null;
}

function parseJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function rowToItem(row: ShelfItemRow): Record<string, unknown> {
  const payload = parseJson(row.payload_json, {});
  return {
    itemId: row.item_id,
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle,
    preview: parseJson(row.preview_json, { summary: '', detail: '' }),
    order: row.order_key,
    version: row.version,
    serverUpdatedAt: row.server_updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    ...(row.creator_email ? { createdByEmail: row.creator_email } : {}),
    ...(asRecord(payload) ?? {}),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const teamsRoutes = new Hono<AppEnv>();

teamsRoutes.use('*', requireAuth);

// ---- Teams ----

teamsRoutes.get('/teams', async (c) => {
  try {
    const user = getUser(c);
    const results = await queryAll<{
      id: string;
      name: string;
      created_by: string;
      created_at: number;
      updated_at: number;
      my_role: TeamRole;
    }>(
      c.env.DB,
      `SELECT t.id, t.name, t.created_by, t.created_at, t.updated_at, m.role AS my_role
       FROM team_members m
       JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = ?
       ORDER BY t.created_at ASC`,
      [user.id],
    );

    return c.json({
      teams: results.map((t) => ({
        id: t.id,
        name: t.name,
        createdBy: t.created_by,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        myRole: t.my_role,
      })),
    });
  } catch (err) {
    return fail(c, err);
  }
});

teamsRoutes.post('/teams', async (c) => {
  try {
    const user = getUser(c);
    const body = asRecord(await c.req.json().catch(() => null));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      throw new AppError('Team name is required.', 400);
    }

    const teamId = newId();
    const now = nowMs();

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO teams (id, name, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(teamId, name, user.id, now, now),
      c.env.DB.prepare(
        `INSERT INTO team_members (team_id, user_id, role, joined_at)
         VALUES (?1, ?2, 'admin', ?3)`,
      ).bind(teamId, user.id, now),
    ]);

    return c.json(
      {
        id: teamId,
        name,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
        myRole: 'admin' as const,
      },
      201,
    );
  } catch (err) {
    return fail(c, err);
  }
});

teamsRoutes.get('/teams/:teamId', async (c) => {
  try {
    const user = getUser(c);
    const teamId = c.req.param('teamId');
    await requireTeamMember(c.env, teamId, user.id);

    const team = await queryOne<{
      id: string;
      name: string;
      created_by: string;
      created_at: number;
      updated_at: number;
    }>(
      c.env.DB,
      `SELECT id, name, created_by, created_at, updated_at FROM teams WHERE id = ? LIMIT 1`,
      [teamId],
    );
    if (!team) {
      throw new AppError('Team not found.', 404);
    }

    const members = await queryAll<{
      user_id: string;
      role: TeamRole;
      joined_at: number;
      email: string;
    }>(
      c.env.DB,
      `SELECT m.user_id, m.role, m.joined_at, u.email
       FROM team_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ?
       ORDER BY m.joined_at ASC`,
      [teamId],
    );

    return c.json({
      team: {
        id: team.id,
        name: team.name,
        createdBy: team.created_by,
        createdAt: team.created_at,
        updatedAt: team.updated_at,
      },
      members: members.map((m) => ({
        userId: m.user_id,
        role: m.role,
        joinedAt: m.joined_at,
        email: m.email,
      })),
    });
  } catch (err) {
    return fail(c, err);
  }
});

teamsRoutes.patch('/teams/:teamId', async (c) => {
  try {
    const user = getUser(c);
    const teamId = c.req.param('teamId');
    await requireTeamMember(c.env, teamId, user.id, 'admin');

    const body = asRecord(await c.req.json().catch(() => null));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      throw new AppError('Team name is required.', 400);
    }

    const result = await c.env.DB.prepare(
      `UPDATE teams SET name = ?1, updated_at = ?2 WHERE id = ?3`,
    )
      .bind(name, nowMs(), teamId)
      .run();
    if ((result.meta.changes ?? 0) === 0) {
      throw new AppError('Team not found.', 404);
    }

    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

teamsRoutes.delete('/teams/:teamId', async (c) => {
  try {
    const user = getUser(c);
    const teamId = c.req.param('teamId');
    await requireTeamMember(c.env, teamId, user.id, 'admin');

    // shelf_items has no FK cascade from teams. Wipe the full team graph
    // in one batch so a partial delete cannot leave orphan rows.
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM shelf_items WHERE team_id = ?1`).bind(teamId),
      c.env.DB.prepare(`DELETE FROM team_invitations WHERE team_id = ?1`).bind(teamId),
      c.env.DB.prepare(`DELETE FROM team_members WHERE team_id = ?1`).bind(teamId),
      c.env.DB.prepare(`DELETE FROM teams WHERE id = ?1`).bind(teamId),
    ]);

    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

// ---- Members ----

teamsRoutes.post('/teams/:teamId/members/:userId', async (c) => {
  try {
    const actor = getUser(c);
    const teamId = c.req.param('teamId');
    const targetUserId = c.req.param('userId');
    await requireTeamMember(c.env, teamId, actor.id, 'admin');

    if (targetUserId === actor.id) {
      throw new AppError('Cannot change your own role.', 400);
    }

    const body = asRecord(await c.req.json().catch(() => null));
    const role = parseRole(body?.role);

    const result = await c.env.DB.prepare(
      `UPDATE team_members SET role = ?1 WHERE team_id = ?2 AND user_id = ?3`,
    )
      .bind(role, teamId, targetUserId)
      .run();
    if ((result.meta.changes ?? 0) === 0) {
      throw new AppError('User is not a member of this team.', 404);
    }

    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

teamsRoutes.delete('/teams/:teamId/members/:userId', async (c) => {
  try {
    const actor = getUser(c);
    const teamId = c.req.param('teamId');
    const targetUserId = c.req.param('userId');
    await requireTeamMember(c.env, teamId, actor.id, 'admin');

    if (targetUserId === actor.id) {
      throw new AppError('Cannot remove yourself. Delete the team instead.', 400);
    }

    const result = await c.env.DB.prepare(
      `DELETE FROM team_members WHERE team_id = ?1 AND user_id = ?2`,
    )
      .bind(teamId, targetUserId)
      .run();
    if ((result.meta.changes ?? 0) === 0) {
      throw new AppError('User is not a member of this team.', 404);
    }

    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

// ---- Invitations ----

teamsRoutes.post('/teams/:teamId/invites', async (c) => {
  try {
    const inviter = getUser(c);
    const teamId = c.req.param('teamId');
    await requireTeamMember(c.env, teamId, inviter.id, 'admin');

    const body = asRecord(await c.req.json().catch(() => null));
    const email = normalizeInviteEmail(body?.email);
    const role = parseRole(body?.role);

    const team = await c.env.DB.prepare(`SELECT name FROM teams WHERE id = ?1 LIMIT 1`)
      .bind(teamId)
      .first<{ name: string }>();
    if (!team) {
      throw new AppError('Team not found.', 404);
    }

    // Email is best-effort after the row commits (matches Convex scheduler).
    const emailJob = sendTeamInviteEmail(c.env, email, {
      teamName: team.name,
      inviterEmail: inviter.email,
    }).catch((err) => {
      console.error('[teams] invite email failed', err);
    });

    // Re-invite = resend. Row already exists; the email may not have arrived.
    const existing = await c.env.DB.prepare(
      `SELECT id FROM team_invitations
       WHERE team_id = ?1 AND email = ?2 AND status = 'pending'
       LIMIT 1`,
    )
      .bind(teamId, email)
      .first<{ id: string }>();
    if (existing) {
      c.executionCtx.waitUntil(emailJob);
      return c.json({ id: existing.id, resent: true });
    }

    // Raw token is only used for the sha256 hash. Never stored, never returned.
    const tokenHash = await sha256(randomInviteToken());
    const inviteId = newId();
    const now = nowMs();

    await c.env.DB.prepare(
      `INSERT INTO team_invitations
         (id, team_id, email, invited_by, role, token_hash, status, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8)`,
    )
      .bind(
        inviteId,
        teamId,
        email,
        inviter.id,
        role,
        tokenHash,
        now + INVITATION_TTL_MS,
        now,
      )
      .run();

    c.executionCtx.waitUntil(emailJob);
    return c.json({ id: inviteId, resent: false }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

teamsRoutes.delete('/teams/:teamId/invites/:inviteId', async (c) => {
  try {
    const user = getUser(c);
    const teamId = c.req.param('teamId');
    const inviteId = c.req.param('inviteId');
    await requireTeamMember(c.env, teamId, user.id, 'admin');

    const invite = await c.env.DB.prepare(
      `SELECT id, team_id, status FROM team_invitations WHERE id = ?1 LIMIT 1`,
    )
      .bind(inviteId)
      .first<{ id: string; team_id: string; status: string }>();
    if (!invite || invite.team_id !== teamId) {
      throw new AppError('Invitation not found.', 404);
    }

    if (invite.status === 'pending') {
      await c.env.DB.prepare(
        `UPDATE team_invitations SET status = 'revoked', responded_at = ?1 WHERE id = ?2`,
      )
        .bind(nowMs(), inviteId)
        .run();
    }

    return c.json({ ok: true, alreadyResponded: invite.status !== 'pending' });
  } catch (err) {
    return fail(c, err);
  }
});

/**
 * Pending invites for the session email only.
 * Never includes token or token_hash.
 */
teamsRoutes.get('/invites/pending', async (c) => {
  try {
    const user = getUser(c);
    const email = user.email.trim().toLowerCase();

    const { results } = await c.env.DB.prepare(
      `SELECT i.id, i.team_id, i.email, i.role, i.status, i.expires_at, i.created_at,
              t.name AS team_name
       FROM team_invitations i
       JOIN teams t ON t.id = i.team_id
       WHERE i.email = ?1 AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
    )
      .bind(email)
      .all<{
        id: string;
        team_id: string;
        email: string;
        role: TeamRole;
        status: string;
        expires_at: number;
        created_at: number;
        team_name: string;
      }>();

    return c.json({
      invitations: results.map((i) => ({
        id: i.id,
        teamId: i.team_id,
        teamName: i.team_name,
        email: i.email,
        role: i.role,
        status: i.status,
        expiresAt: i.expires_at,
        createdAt: i.created_at,
      })),
    });
  } catch (err) {
    return fail(c, err);
  }
});

/**
 * Accept requires session email === invitation.email.
 * Closes the known bug where any authenticated user who knew an invite
 * id/token could join an arbitrary team.
 */
teamsRoutes.post('/invites/:inviteId/accept', async (c) => {
  try {
    const user = getUser(c);
    const inviteId = c.req.param('inviteId');

    const invite = await c.env.DB.prepare(
      `SELECT id, team_id, email, role, status, expires_at
       FROM team_invitations WHERE id = ?1 LIMIT 1`,
    )
      .bind(inviteId)
      .first<{
        id: string;
        team_id: string;
        email: string;
        role: TeamRole;
        status: string;
        expires_at: number;
      }>();
    if (!invite || invite.status !== 'pending') {
      throw new AppError('Invitation not found or already responded to.', 404);
    }

    if (invite.email !== user.email.trim().toLowerCase()) {
      throw new AppError('This invitation was sent to a different email address.', 403);
    }

    const now = nowMs();
    if (invite.expires_at <= now) {
      await c.env.DB.prepare(
        `UPDATE team_invitations SET status = 'revoked', responded_at = ?1 WHERE id = ?2`,
      )
        .bind(now, inviteId)
        .run();
      throw new AppError('Invitation has expired.', 410);
    }

    const existing = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM team_members WHERE team_id = ?1 AND user_id = ?2 LIMIT 1`,
    )
      .bind(invite.team_id, user.id)
      .first<{ ok: number }>();

    if (existing) {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE team_invitations SET status = 'accepted', responded_at = ?1 WHERE id = ?2`,
        ).bind(now, inviteId),
        c.env.DB.prepare(`UPDATE teams SET updated_at = ?1 WHERE id = ?2`).bind(
          now,
          invite.team_id,
        ),
      ]);
      return c.json({ ok: true, alreadyMember: true });
    }

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO team_members (team_id, user_id, role, joined_at)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(invite.team_id, user.id, invite.role, now),
      c.env.DB.prepare(
        `UPDATE team_invitations SET status = 'accepted', responded_at = ?1 WHERE id = ?2`,
      ).bind(now, inviteId),
      c.env.DB.prepare(`UPDATE teams SET updated_at = ?1 WHERE id = ?2`).bind(
        now,
        invite.team_id,
      ),
    ]);

    return c.json({ ok: true, alreadyMember: false });
  } catch (err) {
    return fail(c, err);
  }
});

/** Reject is invitee-only: same email bind as accept. */
teamsRoutes.post('/invites/:inviteId/reject', async (c) => {
  try {
    const user = getUser(c);
    const inviteId = c.req.param('inviteId');

    const invite = await c.env.DB.prepare(
      `SELECT id, email, status, expires_at FROM team_invitations WHERE id = ?1 LIMIT 1`,
    )
      .bind(inviteId)
      .first<{ id: string; email: string; status: string; expires_at: number }>();
    if (!invite || invite.status !== 'pending') {
      throw new AppError('Invitation not found or already responded to.', 404);
    }

    if (invite.email !== user.email.trim().toLowerCase()) {
      throw new AppError('This invitation was sent to a different email address.', 403);
    }

    const now = nowMs();
    if (invite.expires_at <= now) {
      await c.env.DB.prepare(
        `UPDATE team_invitations SET status = 'revoked', responded_at = ?1 WHERE id = ?2`,
      )
        .bind(now, inviteId)
        .run();
      throw new AppError('Invitation has expired.', 410);
    }

    await c.env.DB.prepare(
      `UPDATE team_invitations SET status = 'rejected', responded_at = ?1 WHERE id = ?2`,
    )
      .bind(now, inviteId)
      .run();

    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

// ---- Team shelf ----

teamsRoutes.get('/teams/:teamId/shelf/items', async (c) => {
  try {
    const user = getUser(c);
    const teamId = c.req.param('teamId');
    await requireTeamMember(c.env, teamId, user.id);

    const shelfId = shelfIdFromQuery(c);

    const { results } = await c.env.DB.prepare(
      `SELECT i.item_id, i.kind, i.title, i.subtitle, i.preview_json, i.order_key,
              i.payload_json, i.version, i.server_updated_at, i.created_by, i.updated_by,
              u.email AS creator_email
       FROM shelf_items i
       LEFT JOIN users u ON u.id = i.created_by
       WHERE i.team_id = ?1 AND i.shelf_id = ?2 AND i.deleted_at IS NULL
       ORDER BY i.order_key ASC
       LIMIT ?3`,
    )
      .bind(teamId, shelfId, TEAM_ITEMS_READ_CAP + 1)
      .all<ShelfItemRow>();

    const truncated = results.length > TEAM_ITEMS_READ_CAP;
    const capped = truncated ? results.slice(0, TEAM_ITEMS_READ_CAP) : results;

    return c.json({
      items: capped.map(rowToItem),
      truncated,
    });
  } catch (err) {
    return fail(c, err);
  }
});

teamsRoutes.post('/teams/:teamId/shelf/items', async (c) => {
  try {
    const user = getUser(c);
    const teamId = c.req.param('teamId');
    await requireTeamMember(c.env, teamId, user.id);

    const shelfId = shelfIdFromQuery(c);
    const body = asRecord(await c.req.json().catch(() => null));
    if (!body) {
      throw new AppError('Item body is required.', 400);
    }

    const item = sanitizeTeamItem(body);

    const versionRaw = body.version;
    if (typeof versionRaw !== 'number' || !Number.isFinite(versionRaw) || versionRaw < 1) {
      throw new AppError('version must be a positive number.', 400);
    }
    const version = Math.floor(versionRaw);

    const now = nowMs();

    const existing = await c.env.DB.prepare(
      `SELECT version FROM shelf_items
       WHERE team_id = ?1 AND shelf_id = ?2 AND item_id = ?3 LIMIT 1`,
    )
      .bind(teamId, shelfId, item.itemId)
      .first<{ version: number }>();

    const previewJson = JSON.stringify(item.preview);
    const payloadJson = JSON.stringify(item.payload);

    if (existing) {
      if (version < existing.version) {
        return c.json({ applied: false, reason: 'stale_version' });
      }
      await c.env.DB.prepare(
        `UPDATE shelf_items SET
           kind = ?1, title = ?2, subtitle = ?3, preview_json = ?4, order_key = ?5,
           payload_json = ?6, version = ?7, server_updated_at = ?8, updated_by = ?9,
           deleted_at = NULL
         WHERE team_id = ?10 AND shelf_id = ?11 AND item_id = ?12`,
      )
        .bind(
          item.kind,
          item.title,
          item.subtitle,
          previewJson,
          item.order,
          payloadJson,
          version,
          now,
          user.id,
          teamId,
          shelfId,
          item.itemId,
        )
        .run();
      return c.json({ applied: true, reason: 'updated' });
    }

    await c.env.DB.prepare(
      `INSERT INTO shelf_items
         (team_id, shelf_id, item_id, created_by, updated_by, kind, title, subtitle,
          preview_json, order_key, payload_json, version, server_updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL)`,
    )
      .bind(
        teamId,
        shelfId,
        item.itemId,
        user.id,
        item.kind,
        item.title,
        item.subtitle,
        previewJson,
        item.order,
        payloadJson,
        version,
        now,
      )
      .run();

    return c.json({ applied: true, reason: 'inserted' }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

teamsRoutes.delete('/teams/:teamId/shelf/items/:itemId', async (c) => {
  try {
    const user = getUser(c);
    const teamId = c.req.param('teamId');
    const itemId = c.req.param('itemId');
    await requireTeamMember(c.env, teamId, user.id);

    const shelfId = shelfIdFromQuery(c);
    const body = asRecord(await c.req.json().catch(() => null));
    const versionRaw = body?.version;
    const version =
      typeof versionRaw === 'number' && Number.isFinite(versionRaw)
        ? Math.floor(versionRaw)
        : undefined;

    const existing = await c.env.DB.prepare(
      `SELECT version FROM shelf_items
       WHERE team_id = ?1 AND shelf_id = ?2 AND item_id = ?3 LIMIT 1`,
    )
      .bind(teamId, shelfId, itemId)
      .first<{ version: number }>();

    if (!existing) {
      return c.json({ applied: false, reason: 'not_found' });
    }
    if (version !== undefined && version < existing.version) {
      return c.json({ applied: false, reason: 'stale_version' });
    }

    const nextVersion = version ?? existing.version + 1;
    const now = nowMs();
    await c.env.DB.prepare(
      `UPDATE shelf_items SET
         deleted_at = ?1, updated_by = ?2, version = ?3, server_updated_at = ?4
       WHERE team_id = ?5 AND shelf_id = ?6 AND item_id = ?7`,
    )
      .bind(now, user.id, nextVersion, now, teamId, shelfId, itemId)
      .run();

    return c.json({ applied: true, reason: 'deleted' });
  } catch (err) {
    return fail(c, err);
  }
});
