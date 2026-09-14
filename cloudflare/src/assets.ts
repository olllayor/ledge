import { Hono, type Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  getPlan,
  newId,
  nowMs,
  personalShelfExists,
  queryOne,
  run,
  storageBytesUsed,
} from './db';
import {
  MAX_IMAGE_BYTES,
  MAX_INFLIGHT_UPLOAD_BYTES_PER_HOUR,
  PRO_IMAGE_STORAGE_LIMIT_BYTES,
  PRO_REQUIRED_FOR_IMAGES_MESSAGE,
} from './env';
import { requireAuth, user, type AppEnv } from './middleware';

const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const SCAN_CAP = 500;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
};

function extForMime(mime: string): string {
  const normalized = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  return MIME_EXT[normalized] ?? 'bin';
}

function r2KeyFor(userId: string, mimeType: string): string {
  return `users/${userId}/${newId()}.${extForMime(mimeType)}`;
}

function normalizeMime(raw: string | undefined, fallback: string): string {
  const mime = (raw ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return mime || fallback;
}

interface InFlightRow {
  bytes: number;
  created_at: number;
}

/**
 * Rolling-hour in-flight bytes. Bounded scan: if the cap is hit, treat the
 * sum as unknown-high so a slow-loris cannot stay under the scan window.
 */
async function inFlightBytes(
  db: D1Database,
  userId: string,
): Promise<{ bytes: number; saturated: boolean }> {
  const cutoff = nowMs() - UPLOAD_WINDOW_MS;
  const rows = await db
    .prepare(
      `SELECT bytes, created_at FROM image_upload_events
       WHERE user_id = ? AND status = 'in_flight' AND created_at > ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(userId, cutoff, SCAN_CAP)
    .all<InFlightRow>();
  const list = rows.results ?? [];
  const bytes = list.reduce((sum, row) => sum + row.bytes, 0);
  return { bytes, saturated: list.length >= SCAN_CAP };
}

async function assertUploadBudget(
  db: D1Database,
  userId: string,
  bytes: number,
): Promise<string | null> {
  const { bytes: inflight, saturated } = await inFlightBytes(db, userId);
  if (saturated && inflight + bytes > MAX_INFLIGHT_UPLOAD_BYTES_PER_HOUR * 0.8) {
    return 'Too many images uploading at once. Please wait for previous uploads to finish.';
  }
  if (inflight + bytes > MAX_INFLIGHT_UPLOAD_BYTES_PER_HOUR) {
    return 'Too many images uploading at once. Please wait for previous uploads to finish.';
  }
  return null;
}

async function assertStorageBudget(
  db: D1Database,
  userId: string,
  bytes: number,
): Promise<string | null> {
  const used = await storageBytesUsed(db, userId);
  if (used + bytes > PRO_IMAGE_STORAGE_LIMIT_BYTES) {
    return 'Image storage limit reached.';
  }
  return null;
}

interface ParsedUpload {
  shelfId: string;
  itemId: string;
  mimeType: string;
  body: ArrayBuffer;
  declaredBytes: number;
}

type UploadFailure = { error: string; status: 400 | 413 };

function isFileLike(value: unknown): value is File {
  return (
    value != null &&
    typeof value === 'object' &&
    'arrayBuffer' in value &&
    typeof (value as { arrayBuffer: unknown }).arrayBuffer === 'function'
  );
}

async function readUpload(
  c: Context<AppEnv>,
): Promise<ParsedUpload | UploadFailure> {
  const contentType = String(c.req.header('content-type') ?? '');
  const contentLengthHeader = c.req.header('content-length');
  const contentLength =
    contentLengthHeader != null && Number.isFinite(Number(contentLengthHeader))
      ? Number(contentLengthHeader)
      : null;

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return { error: 'Malformed multipart body.', status: 400 };
    }
    const filePart = form.get('file') ?? form.get('asset');
    if (!isFileLike(filePart)) {
      return { error: 'multipart field "file" is required.', status: 400 };
    }
    if (filePart.size > MAX_IMAGE_BYTES) {
      return { error: 'Image exceeds the 25MB upload limit.', status: 413 };
    }
    const shelfId = String(form.get('shelfId') ?? '').trim();
    const itemId = String(form.get('itemId') ?? '').trim();
    const mimeType = normalizeMime(
      filePart.type || String(form.get('mimeType') ?? ''),
      'application/octet-stream',
    );
    const body = await filePart.arrayBuffer();
    return {
      shelfId,
      itemId,
      mimeType,
      body,
      declaredBytes: body.byteLength,
    };
  }

  // Raw body (first-wave preferred path). Buffer with a hard cap so a
  // missing Content-Length cannot bypass MAX_IMAGE_BYTES.
  const shelfId = String(
    c.req.header('x-shelf-id') ?? c.req.query('shelfId') ?? '',
  ).trim();
  const itemId = String(
    c.req.header('x-item-id') ?? c.req.query('itemId') ?? '',
  ).trim();
  const mimeType = normalizeMime(contentType, 'application/octet-stream');

  if (contentLength != null && contentLength > MAX_IMAGE_BYTES) {
    return { error: 'Image exceeds the 25MB upload limit.', status: 413 };
  }

  try {
    const body = await c.req.raw.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) {
      return { error: 'Image exceeds the 25MB upload limit.', status: 413 };
    }
    if (body.byteLength === 0) {
      return { error: 'Image payload size is invalid.', status: 400 };
    }
    return {
      shelfId,
      itemId,
      mimeType,
      body,
      declaredBytes: body.byteLength,
    };
  } catch {
    return { error: 'Unable to read upload body.', status: 400 };
  }
}

export const assetsRoutes = new Hono<AppEnv>();

/**
 * POST /assets — first-wave upload: stream body to R2 (≤25MB), record
 * `image_assets` + resolve an `image_upload_events` row.
 *
 * Accepts multipart (`file` + optional `shelfId`/`itemId`/`mimeType`) or a
 * raw body with `X-Shelf-Id` / `X-Item-Id` headers.
 */
assetsRoutes.post('/assets', requireAuth, async (c) => {
  const auth = user(c);
  const db = c.env.DB;

  const plan = await getPlan(db, auth.id);
  if (plan !== 'pro') {
    return c.json({ error: PRO_REQUIRED_FOR_IMAGES_MESSAGE }, 403);
  }

  const upload = await readUpload(c);
  if ('error' in upload) {
    return c.json({ error: upload.error }, upload.status);
  }

  const bytes = upload.declaredBytes;
  if (bytes <= 0) {
    return c.json({ error: 'Image payload size is invalid.' }, 400);
  }
  if (bytes > MAX_IMAGE_BYTES) {
    return c.json({ error: 'Image exceeds the 25MB upload limit.' }, 413);
  }

  if (upload.shelfId) {
    const ownsShelf = await personalShelfExists(db, auth.id, upload.shelfId);
    if (!ownsShelf) {
      return c.json({ error: 'Shelf not found.' }, 404);
    }
  }

  const budgetError = await assertUploadBudget(db, auth.id, bytes);
  if (budgetError) return c.json({ error: budgetError }, 429);

  const storageError = await assertStorageBudget(db, auth.id, bytes);
  if (storageError) return c.json({ error: storageError }, 413);

  const at = nowMs();
  const eventId = newId();
  await run(
    db,
    `INSERT INTO image_upload_events (id, user_id, bytes, status, r2_key, created_at)
     VALUES (?, ?, ?, 'in_flight', NULL, ?)`,
    [eventId, auth.id, bytes, at],
  );

  const r2Key = r2KeyFor(auth.id, upload.mimeType);
  try {
    await c.env.ASSETS.put(r2Key, upload.body, {
      httpMetadata: { contentType: upload.mimeType },
      customMetadata: {
        userId: auth.id,
        shelfId: upload.shelfId,
        itemId: upload.itemId,
      },
    });
  } catch (err) {
    await run(db, `UPDATE image_upload_events SET status = 'abandoned' WHERE id = ?`, [eventId]);
    console.error('[assets] R2 put failed', err);
    return c.json({ error: 'Image upload failed.' }, 502);
  }

  // Re-check storage after the put (parallel uploads) before recording.
  const postPutStorageError = await assertStorageBudget(db, auth.id, bytes);
  if (postPutStorageError) {
    await c.env.ASSETS.delete(r2Key).catch(() => undefined);
    await run(db, `UPDATE image_upload_events SET status = 'abandoned' WHERE id = ?`, [eventId]);
    return c.json({ error: postPutStorageError }, 413);
  }

  const assetId = newId();
  await run(
    db,
    `INSERT INTO image_assets (id, user_id, shelf_id, item_id, r2_key, bytes, mime_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      assetId,
      auth.id,
      upload.shelfId,
      upload.itemId,
      r2Key,
      bytes,
      upload.mimeType,
      at,
    ],
  );
  await run(
    db,
    `UPDATE image_upload_events
     SET status = 'resolved', r2_key = ?, resolved_asset_id = ?
     WHERE id = ?`,
    [r2Key, assetId, eventId],
  );

  return c.json({
    ok: true,
    assetId,
    r2Key,
    eventId,
    bytes,
    mimeType: upload.mimeType,
    shelfId: upload.shelfId,
    itemId: upload.itemId,
  });
});

/**
 * POST /assets/complete — optional second phase for clients that already
 * put bytes (or received an r2Key out of band). Records the asset row.
 */
assetsRoutes.post('/assets/complete', requireAuth, async (c) => {
  const auth = user(c);
  const db = c.env.DB;

  const plan = await getPlan(db, auth.id);
  if (plan !== 'pro') {
    return c.json({ error: PRO_REQUIRED_FOR_IMAGES_MESSAGE }, 403);
  }

  let body: {
    r2Key?: unknown;
    shelfId?: unknown;
    itemId?: unknown;
    bytes?: unknown;
    mimeType?: unknown;
    eventId?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }

  const r2Key = typeof body.r2Key === 'string' ? body.r2Key.trim() : '';
  const shelfId = typeof body.shelfId === 'string' ? body.shelfId.trim() : '';
  const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
  const bytes = typeof body.bytes === 'number' ? body.bytes : NaN;
  const mimeType = normalizeMime(
    typeof body.mimeType === 'string' ? body.mimeType : undefined,
    'application/octet-stream',
  );
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';

  if (!r2Key || !Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_IMAGE_BYTES) {
    return c.json({ error: 'r2Key and a valid bytes value are required.' }, 400);
  }
  if (shelfId) {
    const ownsShelf = await personalShelfExists(db, auth.id, shelfId);
    if (!ownsShelf) {
      return c.json({ error: 'Shelf not found.' }, 404);
    }
  }

  // Ownership: only keys under this user's prefix may be completed.
  if (!r2Key.startsWith(`users/${auth.id}/`)) {
    return c.json({ error: 'r2Key is not owned by this account.' }, 403);
  }

  const existingAsset = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM image_assets WHERE user_id = ? AND r2_key = ?`,
    [auth.id, r2Key],
  );
  if (existingAsset) {
    return c.json({ ok: true, assetId: existingAsset.id, r2Key, deduped: true });
  }

  const storageError = await assertStorageBudget(db, auth.id, bytes);
  if (storageError) return c.json({ error: storageError }, 413);

  const head = await c.env.ASSETS.head(r2Key);
  if (!head) {
    return c.json({ error: 'Upload object not found in storage.' }, 404);
  }

  const at = nowMs();
  const assetId = newId();
  await run(
    db,
    `INSERT INTO image_assets (id, user_id, shelf_id, item_id, r2_key, bytes, mime_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [assetId, auth.id, shelfId, itemId, r2Key, bytes, mimeType, at],
  );

  if (eventId) {
    await run(
      db,
      `UPDATE image_upload_events
       SET status = 'resolved', r2_key = ?, resolved_asset_id = ?
       WHERE id = ? AND user_id = ? AND status = 'in_flight'`,
      [r2Key, assetId, eventId, auth.id],
    );
  }

  return c.json({ ok: true, assetId, r2Key, deduped: false });
});

/** POST /assets/abandon — drop an in-flight upload + optional R2 object. */
assetsRoutes.post('/assets/abandon', requireAuth, async (c) => {
  const auth = user(c);
  const db = c.env.DB;

  let body: { r2Key?: unknown; eventId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }

  const r2Key = typeof body.r2Key === 'string' ? body.r2Key.trim() : '';
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';

  if (!r2Key && !eventId) {
    return c.json({ error: 'r2Key or eventId is required.' }, 400);
  }

  if (r2Key) {
    if (!r2Key.startsWith(`users/${auth.id}/`)) {
      return c.json({ error: 'r2Key is not owned by this account.' }, 403);
    }
    // Only delete objects that are not already recorded as live assets.
    const recorded = await queryOne<{ id: string }>(
      db,
      `SELECT id FROM image_assets WHERE user_id = ? AND r2_key = ?`,
      [auth.id, r2Key],
    );
    if (!recorded) {
      await c.env.ASSETS.delete(r2Key).catch(() => undefined);
    }
  }

  if (eventId) {
    await run(
      db,
      `UPDATE image_upload_events SET status = 'abandoned'
       WHERE id = ? AND user_id = ? AND status = 'in_flight'`,
      [eventId, auth.id],
    );
  }

  return c.json({ ok: true });
});

/**
 * GET /assets/<key> — authenticated download. Verifies the object is
 * recorded for this user, then streams from R2.
 */
assetsRoutes.get('/assets/*', requireAuth, async (c) => {
  const auth = user(c);
  const key = decodeURIComponent(c.req.path.replace(/^\/assets\//, ''));
  if (!key || key.includes('..')) {
    return c.json({ error: 'Invalid asset key.' }, 400);
  }

  const asset = await queryOne<{
    id: string;
    r2_key: string;
    bytes: number;
    mime_type: string;
  }>(
    c.env.DB,
    `SELECT id, r2_key, bytes, mime_type FROM image_assets
     WHERE user_id = ? AND r2_key = ?`,
    [auth.id, key],
  );
  if (!asset) {
    return c.json({ error: 'Asset not found.' }, 404);
  }

  const object = await c.env.ASSETS.get(asset.r2_key);
  if (!object) {
    return c.json({ error: 'Asset blob missing.' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', asset.mime_type || 'application/octet-stream');
  headers.set('Content-Length', String(asset.bytes));
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('ETag', object.httpEtag ?? object.etag);

  return new Response(object.body, { headers });
});
