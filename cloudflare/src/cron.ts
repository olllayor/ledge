import type { Env } from './env';
import { queryAll, run } from './db';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cleanup expired sessions, OTPs, webhook dedupe rows, abandoned uploads, orphan R2. */
export async function runScheduledCleanup(env: Env): Promise<void> {
  const now = Date.now();

  await run(env.DB, `DELETE FROM auth_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL`, [
    now,
  ]);

  await run(env.DB, `DELETE FROM auth_otps WHERE expires_at < ? OR consumed_at IS NOT NULL`, [now]);

  await run(env.DB, `DELETE FROM processed_webhook_events WHERE processed_at < ?`, [
    now - 7 * DAY_MS,
  ]);

  await run(env.DB, `DELETE FROM image_upload_events WHERE created_at < ?`, [now - DAY_MS]);

  // Orphan R2 objects: keys with no image_assets row after the upload window.
  const assets = await queryAll<{ r2_key: string }>(
    env.DB,
    `SELECT r2_key FROM image_assets`,
  );
  const known = new Set(assets.map((row) => row.r2_key));

  const listed = await env.ASSETS.list({ limit: 1000 });
  for (const object of listed.objects) {
    if (!known.has(object.key)) {
      // Only delete objects older than 24h so in-flight uploads survive.
      if (Date.now() - object.uploaded.getTime() > DAY_MS) {
        await env.ASSETS.delete(object.key);
      }
    }
  }
}
