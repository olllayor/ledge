import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  countActiveShelves,
  countDevices,
  deviceLimitForPlan,
  getPlan,
  newId,
  nowMs,
  personalShelfExists,
  queryAll,
  queryOne,
  run,
  shelfLimitForPlan,
  storageBytesUsed,
  storageLimitForPlan,
} from './db';
import {
  LIST_ITEMS_LIMIT,
  LIST_SHELVES_LIMIT,
  MAX_FUTURE_SKEW_MS,
  PRO_IMAGE_STORAGE_LIMIT_BYTES,
  PRO_REQUIRED_FOR_PREFERENCES_MESSAGE,
} from './env';
import { requireAuth, user, type AppEnv } from './middleware';
import {
  parseStoredItems,
  sanitizeShelfItem,
  sanitizeShelfItems,
  type SanitizedShelfItem,
} from './sanitize';

const PERSONAL_TEAM_ID = '';
const SHELF_COLORS = new Set(['ember', 'wave', 'forest', 'sand']);
const SHELF_ORIGINS = new Set(['shake', 'tray', 'shortcut', 'manual', 'restore']);

interface ShelfRow {
  user_id: string;
  shelf_id: string;
  name: string;
  color: string;
  origin: string;
  items_json: string;
  local_created_at: string;
  local_updated_at: string;
  item_count: number;
  image_storage_bytes: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
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
  deleted_at: number | null;
}

function shelfToJson(row: ShelfRow) {
  return {
    shelfId: row.shelf_id,
    name: row.name,
    color: row.color,
    origin: row.origin,
    items: parseStoredItems(row.items_json),
    localCreatedAt: row.local_created_at,
    localUpdatedAt: row.local_updated_at,
    itemCount: row.item_count,
    imageStorageBytes: row.image_storage_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function itemRowToJson(row: ShelfItemRow) {
  let payload: unknown = {};
  try {
    payload = JSON.parse(row.payload_json) as unknown;
  } catch {
    payload = {};
  }
  // Re-sanitize on read as defense in depth against legacy rows.
  const sanitized = sanitizeShelfItem(payload);
  const base = sanitized ?? {
    id: row.item_id,
    createdAt: new Date(row.server_updated_at).toISOString(),
    order: Number(row.order_key) || 0,
    title: row.title,
    subtitle: row.subtitle,
    preview: safePreview(row.preview_json),
    kind: row.kind as SanitizedShelfItem['kind'],
  };
  return {
    ...base,
    version: row.version,
    serverUpdatedAt: row.server_updated_at,
    deletedAt: row.deleted_at,
  };
}

function safePreview(json: string) {
  try {
    const parsed = JSON.parse(json) as { summary?: unknown; detail?: unknown };
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      detail: typeof parsed.detail === 'string' ? parsed.detail : '',
    };
  } catch {
    return { summary: '', detail: '' };
  }
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && SHELF_COLORS.has(value);
}

function isOrigin(value: unknown): value is string {
  return typeof value === 'string' && SHELF_ORIGINS.has(value);
}

/**
 * Dual-write personal items into shelf_items without ghost deletes.
 * Items missing from the payload are hard-deleted; present rows are upserted.
 */
async function replacePersonalShelfItems(
  db: D1Database,
  userId: string,
  shelfId: string,
  items: SanitizedShelfItem[],
  serverNow: number,
): Promise<void> {
  const existing = await queryAll<{ item_id: string }>(
    db,
    `SELECT item_id FROM shelf_items WHERE team_id = ? AND shelf_id = ?`,
    [PERSONAL_TEAM_ID, shelfId],
  );
  const keep = new Set(items.map((item) => item.id));
  const statements = [];

  for (const row of existing) {
    if (!keep.has(row.item_id)) {
      statements.push(
        db
          .prepare(
            `DELETE FROM shelf_items WHERE team_id = ? AND shelf_id = ? AND item_id = ?`,
          )
          .bind(PERSONAL_TEAM_ID, shelfId, row.item_id),
      );
    }
  }

  for (const item of items) {
    statements.push(personalItemUpsert(db, userId, shelfId, item, 1, serverNow));
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

function personalItemUpsert(
  db: D1Database,
  userId: string,
  shelfId: string,
  item: SanitizedShelfItem,
  version: number,
  serverUpdatedAt: number,
) {
  return db
    .prepare(
      `INSERT INTO shelf_items (
         team_id, shelf_id, item_id, created_by, updated_by,
         kind, title, subtitle, preview_json, order_key, payload_json,
         version, server_updated_at, deleted_at
       ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL)
       ON CONFLICT(team_id, shelf_id, item_id) DO UPDATE SET
         updated_by = excluded.updated_by,
         kind = excluded.kind,
         title = excluded.title,
         subtitle = excluded.subtitle,
         preview_json = excluded.preview_json,
         order_key = excluded.order_key,
         payload_json = excluded.payload_json,
         version = excluded.version,
         server_updated_at = excluded.server_updated_at,
         deleted_at = NULL`,
    )
    .bind(
      PERSONAL_TEAM_ID,
      shelfId,
      item.id,
      userId,
      item.kind,
      item.title,
      item.subtitle,
      JSON.stringify(item.preview),
      String(item.order),
      JSON.stringify(item),
      version,
      serverUpdatedAt,
    );
}

async function requirePersonalShelf(db: D1Database, userId: string, shelfId: string) {
  const ok = await personalShelfExists(db, userId, shelfId);
  if (!ok) {
    return { error: 'Shelf not found.', status: 404 as const };
  }
  return null;
}

export const syncRoutes = new Hono<AppEnv>();

/** GET /sync/overview — plan + caps for the signed-in user. */
syncRoutes.get('/sync/overview', requireAuth, async (c) => {
  const auth = user(c);
  const db = c.env.DB;
  const plan = await getPlan(db, auth.id);
  const [deviceCount, shelfCount, used] = await Promise.all([
    countDevices(db, auth.id),
    countActiveShelves(db, auth.id),
    storageBytesUsed(db, auth.id),
  ]);
  return c.json({
    plan,
    deviceCount,
    deviceLimit: deviceLimitForPlan(plan),
    syncedShelfCount: shelfCount,
    shelfLimit: shelfLimitForPlan(plan),
    storageBytesUsed: used,
    storageBytesLimit: storageLimitForPlan(plan),
    proImageStorageLimitBytes: PRO_IMAGE_STORAGE_LIMIT_BYTES,
  });
});

/**
 * GET /sync/shelves?since=
 * Without `since`: active shelves only. With `since`: also tombstones
 * updated after the cursor so other devices can drop local copies.
 */
syncRoutes.get('/sync/shelves', requireAuth, async (c) => {
  const auth = user(c);
  const sinceRaw = c.req.query('since');
  const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : null;

  let rows: ShelfRow[];
  if (since != null && Number.isFinite(since)) {
    rows = await queryAll<ShelfRow>(
      c.env.DB,
      `SELECT * FROM shelves
       WHERE user_id = ? AND updated_at > ?
       ORDER BY updated_at DESC
       LIMIT ?`,
      [auth.id, since, LIST_SHELVES_LIMIT],
    );
  } else {
    rows = await queryAll<ShelfRow>(
      c.env.DB,
      `SELECT * FROM shelves
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`,
      [auth.id, LIST_SHELVES_LIMIT],
    );
  }

  return c.json({ shelves: rows.map(shelfToJson) });
});

/** POST /sync/devices — `{ deviceId, name, platform }`. */
syncRoutes.post('/sync/devices', requireAuth, async (c) => {
  const auth = user(c);
  let body: { deviceId?: unknown; name?: unknown; platform?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim() : '';
  if (!deviceId || !name || !platform) {
    return c.json({ error: 'deviceId, name, and platform are required.' }, 400);
  }

  const db = c.env.DB;
  const at = nowMs();
  const existing = await queryOne<{ device_id: string }>(
    db,
    `SELECT device_id FROM devices WHERE user_id = ? AND device_id = ?`,
    [auth.id, deviceId],
  );

  if (existing) {
    await run(
      db,
      `UPDATE devices SET name = ?, platform = ?, last_seen_at = ?
       WHERE user_id = ? AND device_id = ?`,
      [name, platform, at, auth.id, deviceId],
    );
    return c.json({ ok: true, deviceId, updated: true });
  }

  const plan = await getPlan(db, auth.id);
  const limit = deviceLimitForPlan(plan);
  const count = await countDevices(db, auth.id);
  if (count >= limit) {
    return c.json({ error: 'Device sync limit reached for this plan.' }, 403);
  }

  await run(
    db,
    `INSERT INTO devices (user_id, device_id, name, platform, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [auth.id, deviceId, name, platform, at, at],
  );
  return c.json({ ok: true, deviceId, updated: false });
});

/** POST /sync/shelves — whole-shelf upsert (backfill / client push). */
syncRoutes.post('/sync/shelves', requireAuth, async (c) => {
  const auth = user(c);
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }

  const shelfId = typeof body.shelfId === 'string' ? body.shelfId.trim() : '';
  const name = typeof body.name === 'string' ? body.name : '';
  const color = body.color;
  const origin = body.origin;
  const localCreatedAt =
    typeof body.localCreatedAt === 'string' ? body.localCreatedAt : '';
  const localUpdatedAtRaw =
    typeof body.localUpdatedAt === 'string' ? body.localUpdatedAt : '';

  if (!shelfId || !name || !isColor(color) || !isOrigin(origin)) {
    return c.json(
      { error: 'shelfId, name, color, and origin are required.' },
      400,
    );
  }

  const items = sanitizeShelfItems(body.items);
  const incoming = Date.parse(localUpdatedAtRaw);
  if (!Number.isFinite(incoming)) {
    return c.json({ error: 'Shelf localUpdatedAt is not a valid timestamp.' }, 400);
  }

  const serverNow = nowMs();
  if (incoming - serverNow > MAX_FUTURE_SKEW_MS) {
    return c.json({ error: 'Shelf localUpdatedAt is too far in the future.' }, 400);
  }
  const clampedLocalUpdatedAt = new Date(Math.min(incoming, serverNow)).toISOString();
  const imageStorageBytes =
    typeof body.imageStorageBytes === 'number' && Number.isFinite(body.imageStorageBytes)
      ? Math.max(0, body.imageStorageBytes)
      : 0;

  const db = c.env.DB;
  const existing = await queryOne<ShelfRow>(
    db,
    `SELECT * FROM shelves WHERE user_id = ? AND shelf_id = ?`,
    [auth.id, shelfId],
  );

  if (existing) {
    if (existing.deleted_at) {
      // Tombstone guard: only an edit stamped after the deletion clears it.
      if (!Number.isFinite(incoming) || incoming <= existing.deleted_at) {
        return c.json({ ok: true, shelfId, applied: false, reason: 'tombstoned' });
      }
      await run(db, `UPDATE shelves SET deleted_at = NULL WHERE user_id = ? AND shelf_id = ?`, [
        auth.id,
        shelfId,
      ]);
    }

    const existingAt = Date.parse(existing.local_updated_at);
    if (Number.isFinite(existingAt) && incoming < existingAt) {
      return c.json({ ok: true, shelfId, applied: false, reason: 'stale' });
    }

    await run(
      db,
      `UPDATE shelves
       SET name = ?, color = ?, origin = ?, items_json = ?,
           local_created_at = ?, local_updated_at = ?, item_count = ?,
           image_storage_bytes = ?, updated_at = ?, deleted_at = NULL
       WHERE user_id = ? AND shelf_id = ?`,
      [
        name,
        color,
        origin,
        JSON.stringify(items),
        localCreatedAt || existing.local_created_at,
        clampedLocalUpdatedAt,
        items.length,
        imageStorageBytes,
        serverNow,
        auth.id,
        shelfId,
      ],
    );
    await replacePersonalShelfItems(db, auth.id, shelfId, items, serverNow);
    return c.json({ ok: true, shelfId, applied: true, reason: 'updated' });
  }

  const plan = await getPlan(db, auth.id);
  const limit = shelfLimitForPlan(plan);
  const activeCount = await countActiveShelves(db, auth.id);
  if (activeCount >= limit) {
    return c.json({ error: 'Cloud shelf limit reached for this plan.' }, 403);
  }

  await run(
    db,
    `INSERT INTO shelves (
       user_id, shelf_id, name, color, origin, items_json,
       local_created_at, local_updated_at, item_count, image_storage_bytes,
       created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      auth.id,
      shelfId,
      name,
      color,
      origin,
      JSON.stringify(items),
      localCreatedAt || new Date(serverNow).toISOString(),
      clampedLocalUpdatedAt,
      items.length,
      imageStorageBytes,
      serverNow,
      serverNow,
    ],
  );
  await replacePersonalShelfItems(db, auth.id, shelfId, items, serverNow);
  return c.json({ ok: true, shelfId, applied: true, reason: 'inserted' });
});

/**
 * DELETE /sync/shelves/:shelfId — explicit tombstone only.
 * Never call this from recents eviction; only user discard.
 */
syncRoutes.delete('/sync/shelves/:shelfId', requireAuth, async (c) => {
  const auth = user(c);
  const shelfId = c.req.param('shelfId');
  const db = c.env.DB;
  const serverNow = nowMs();

  const shelf = await queryOne<ShelfRow>(
    db,
    `SELECT * FROM shelves WHERE user_id = ? AND shelf_id = ?`,
    [auth.id, shelfId],
  );

  let deleted = false;
  if (shelf && !shelf.deleted_at) {
    await run(
      db,
      `UPDATE shelves SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND shelf_id = ?`,
      [serverNow, serverNow, auth.id, shelfId],
    );
    deleted = true;
  }

  // Reclaim R2 objects + asset rows so the storage cap is real.
  const assets = await queryAll<{ id: string; r2_key: string }>(
    db,
    `SELECT id, r2_key FROM image_assets WHERE user_id = ? AND shelf_id = ?`,
    [auth.id, shelfId],
  );
  let assetsDeleted = 0;
  for (const asset of assets) {
    try {
      await c.env.ASSETS.delete(asset.r2_key);
      assetsDeleted += 1;
    } catch {
      // Best-effort; row still deleted below.
    }
    await run(db, `DELETE FROM image_assets WHERE id = ?`, [asset.id]);
  }

  // Drop per-item rows for the personal copy (team_id='').
  await run(db, `DELETE FROM shelf_items WHERE team_id = ? AND shelf_id = ?`, [
    PERSONAL_TEAM_ID,
    shelfId,
  ]);

  return c.json({ ok: true, deleted, assetsDeleted });
});

/** PUT /sync/preferences — Pro only. */
syncRoutes.put('/sync/preferences', requireAuth, async (c) => {
  const auth = user(c);
  const db = c.env.DB;
  const plan = await getPlan(db, auth.id);
  if (plan !== 'pro') {
    return c.json({ error: PRO_REQUIRED_FOR_PREFERENCES_MESSAGE }, 403);
  }

  let body: { values?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    return c.json({ error: 'values must be an object.' }, 400);
  }

  const at = nowMs();
  const valuesJson = JSON.stringify(body.values);
  const existing = await queryOne<{ user_id: string }>(
    db,
    `SELECT user_id FROM preferences WHERE user_id = ?`,
    [auth.id],
  );
  if (existing) {
    await run(db, `UPDATE preferences SET values_json = ?, updated_at = ? WHERE user_id = ?`, [
      valuesJson,
      at,
      auth.id,
    ]);
  } else {
    await run(
      db,
      `INSERT INTO preferences (user_id, values_json, updated_at) VALUES (?, ?, ?)`,
      [auth.id, valuesJson, at],
    );
  }
  return c.json({ ok: true });
});

/** GET /sync/preferences — Pro only (read path for multi-device). */
syncRoutes.get('/sync/preferences', requireAuth, async (c) => {
  const auth = user(c);
  const db = c.env.DB;
  const plan = await getPlan(db, auth.id);
  if (plan !== 'pro') {
    return c.json({ error: PRO_REQUIRED_FOR_PREFERENCES_MESSAGE }, 403);
  }
  const row = await queryOne<{ values_json: string; updated_at: number }>(
    db,
    `SELECT values_json, updated_at FROM preferences WHERE user_id = ?`,
    [auth.id],
  );
  if (!row) {
    return c.json({ values: null, updatedAt: null });
  }
  let values: unknown = null;
  try {
    values = JSON.parse(row.values_json) as unknown;
  } catch {
    values = null;
  }
  return c.json({ values, updatedAt: row.updated_at });
});

/** POST /sync/shelves/:shelfId/items — upsert one personal item. */
syncRoutes.post('/sync/shelves/:shelfId/items', requireAuth, async (c) => {
  const auth = user(c);
  const shelfId = c.req.param('shelfId');
  const ownership = await requirePersonalShelf(c.env.DB, auth.id, shelfId);
  if (ownership) return c.json({ error: ownership.error }, ownership.status);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }

  const item = sanitizeShelfItem(raw);
  if (!item) {
    return c.json({ error: 'Invalid shelf item payload.' }, 400);
  }

  const body = (raw ?? {}) as Record<string, unknown>;
  const version =
    typeof body.version === 'number' && Number.isFinite(body.version) ? body.version : 1;
  const serverUpdatedAt =
    typeof body.serverUpdatedAt === 'number' && Number.isFinite(body.serverUpdatedAt)
      ? body.serverUpdatedAt
      : nowMs();

  const db = c.env.DB;
  const existing = await queryOne<{ version: number; server_updated_at: number; deleted_at: number | null }>(
    db,
    `SELECT version, server_updated_at, deleted_at FROM shelf_items
     WHERE team_id = ? AND shelf_id = ? AND item_id = ?`,
    [PERSONAL_TEAM_ID, shelfId, item.id],
  );

  if (existing) {
    if (version < existing.version) {
      return c.json({ ok: true, applied: false, reason: 'stale_version' });
    }
    if (version === existing.version && serverUpdatedAt <= existing.server_updated_at) {
      return c.json({ ok: true, applied: false, reason: 'stale_timestamp' });
    }
  }

  await personalItemUpsert(db, auth.id, shelfId, item, version, serverUpdatedAt).run();
  return c.json({ ok: true, applied: true, reason: existing ? 'updated' : 'inserted' });
});

/** DELETE /sync/shelves/:shelfId/items/:itemId — soft-delete (tombstone). */
syncRoutes.delete('/sync/shelves/:shelfId/items/:itemId', requireAuth, async (c) => {
  const auth = user(c);
  const shelfId = c.req.param('shelfId');
  const itemId = c.req.param('itemId');
  const ownership = await requirePersonalShelf(c.env.DB, auth.id, shelfId);
  if (ownership) return c.json({ error: ownership.error }, ownership.status);

  let body: { version?: unknown; serverUpdatedAt?: unknown };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const version =
    typeof body.version === 'number' && Number.isFinite(body.version) ? body.version : 1;
  const serverUpdatedAt =
    typeof body.serverUpdatedAt === 'number' && Number.isFinite(body.serverUpdatedAt)
      ? body.serverUpdatedAt
      : nowMs();

  const db = c.env.DB;
  const existing = await queryOne<{ version: number; server_updated_at: number }>(
    db,
    `SELECT version, server_updated_at FROM shelf_items
     WHERE team_id = ? AND shelf_id = ? AND item_id = ?`,
    [PERSONAL_TEAM_ID, shelfId, itemId],
  );
  if (!existing) {
    return c.json({ ok: true, applied: false, reason: 'not_found' });
  }
  if (version < existing.version) {
    return c.json({ ok: true, applied: false, reason: 'stale_version' });
  }
  if (version === existing.version && serverUpdatedAt <= existing.server_updated_at) {
    return c.json({ ok: true, applied: false, reason: 'stale_timestamp' });
  }

  await run(
    db,
    `UPDATE shelf_items
     SET deleted_at = ?, updated_by = ?, version = ?, server_updated_at = ?
     WHERE team_id = ? AND shelf_id = ? AND item_id = ?`,
    [nowMs(), auth.id, version, serverUpdatedAt, PERSONAL_TEAM_ID, shelfId, itemId],
  );
  return c.json({ ok: true, applied: true, reason: 'deleted' });
});

/** GET /sync/shelves/:shelfId/items?since=&limit= — items + tombstones. */
syncRoutes.get('/sync/shelves/:shelfId/items', requireAuth, async (c) => {
  const auth = user(c);
  const shelfId = c.req.param('shelfId');
  const ownership = await requirePersonalShelf(c.env.DB, auth.id, shelfId);
  if (ownership) return c.json({ error: ownership.error }, ownership.status);

  const sinceRaw = c.req.query('since');
  const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : 0;
  const limitRaw = c.req.query('limit');
  const limitParsed = limitRaw != null && limitRaw !== '' ? Number(limitRaw) : LIST_ITEMS_LIMIT;
  const limit = Number.isFinite(limitParsed)
    ? Math.min(Math.max(1, Math.trunc(limitParsed)), LIST_ITEMS_LIMIT)
    : LIST_ITEMS_LIMIT;

  const rows = await queryAll<ShelfItemRow>(
    c.env.DB,
    `SELECT item_id, kind, title, subtitle, preview_json, order_key, payload_json,
            version, server_updated_at, deleted_at
     FROM shelf_items
     WHERE team_id = ? AND shelf_id = ? AND server_updated_at > ?
     ORDER BY server_updated_at ASC
     LIMIT ?`,
    [PERSONAL_TEAM_ID, shelfId, Number.isFinite(since) ? since : 0, limit],
  );

  const items = rows.filter((row) => row.deleted_at === null).map(itemRowToJson);
  const tombstones = rows
    .filter((row) => row.deleted_at !== null)
    .map((row) => ({
      itemId: row.item_id,
      version: row.version,
      deletedAt: row.deleted_at,
    }));

  return c.json({ items, tombstones });
});

/** POST /sync/events — optional client diagnostics. */
syncRoutes.post('/sync/events', requireAuth, async (c) => {
  const auth = user(c);
  let body: { deviceId?: unknown; type?: unknown; message?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  if (!type) {
    return c.json({ error: 'type is required.' }, 400);
  }

  const id = newId();
  await run(
    c.env.DB,
    `INSERT INTO sync_events (id, user_id, device_id, type, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      auth.id,
      typeof body.deviceId === 'string' ? body.deviceId : null,
      type,
      typeof body.message === 'string' ? body.message : null,
      nowMs(),
    ],
  );
  return c.json({ ok: true, id });
});
