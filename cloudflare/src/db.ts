import type { D1Database } from '@cloudflare/workers-types';
import {
  FREE_SYNC_DEVICE_LIMIT,
  FREE_SYNC_SHELF_LIMIT,
  PRO_SYNC_DEVICE_LIMIT,
  PRO_SYNC_SHELF_LIMIT,
  PRO_IMAGE_STORAGE_LIMIT_BYTES,
  type Plan,
} from './env';

type BindParams = readonly unknown[];

function bound(db: D1Database, sql: string, params: BindParams) {
  return db.prepare(sql).bind(...(params as string[]));
}

/** Prefer this over casting at every call site. */
export function newId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

/** Alias used by billing (imported via middleware re-export). */
export function nowMs(): number {
  return now();
}

export async function queryOne<T>(
  db: D1Database,
  sql: string,
  params: BindParams = [],
): Promise<T | null> {
  return bound(db, sql, params).first<T>();
}

export async function queryAll<T>(
  db: D1Database,
  sql: string,
  params: BindParams = [],
): Promise<T[]> {
  const result = await bound(db, sql, params).all<T>();
  return result.results ?? [];
}

export async function run(
  db: D1Database,
  sql: string,
  params: BindParams = [],
): Promise<void> {
  await bound(db, sql, params).run();
}

/** Returns true when at least one row was written (rate-limit guard). */
export async function insertIfUnderLimit(
  db: D1Database,
  sql: string,
  params: BindParams = [],
): Promise<boolean> {
  const result = await bound(db, sql, params).run();
  return (result.meta.changes ?? 0) > 0;
}

export function deviceLimitForPlan(plan: Plan): number {
  return plan === 'pro' ? PRO_SYNC_DEVICE_LIMIT : FREE_SYNC_DEVICE_LIMIT;
}

export function shelfLimitForPlan(plan: Plan): number {
  return plan === 'pro' ? PRO_SYNC_SHELF_LIMIT : FREE_SYNC_SHELF_LIMIT;
}

export function storageLimitForPlan(plan: Plan): number {
  return plan === 'pro' ? PRO_IMAGE_STORAGE_LIMIT_BYTES : 0;
}

/** Active pro entitlement required; anything else is free. */
export async function getPlan(db: D1Database, userId: string): Promise<Plan> {
  const row = await queryOne<{ plan: string; status: string }>(
    db,
    `SELECT plan, status FROM entitlements WHERE user_id = ?`,
    [userId],
  );
  if (!row || row.plan !== 'pro') return 'free';
  return row.status === 'active' || row.status === 'pastDue' ? 'pro' : 'free';
}

export async function countDevices(db: D1Database, userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM devices WHERE user_id = ?`,
    [userId],
  );
  return row?.n ?? 0;
}

export async function countActiveShelves(db: D1Database, userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM shelves WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  return row?.n ?? 0;
}

export async function storageBytesUsed(db: D1Database, userId: string): Promise<number> {
  const row = await queryOne<{ used: number }>(
    db,
    `SELECT COALESCE(SUM(bytes), 0) AS used FROM image_assets WHERE user_id = ?`,
    [userId],
  );
  return row?.used ?? 0;
}

/** Active (non-tombstoned) personal shelf only — deleted shelves reject item/asset ops. */
export async function personalShelfExists(
  db: D1Database,
  userId: string,
  shelfId: string,
): Promise<boolean> {
  const row = await queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok FROM shelves
     WHERE user_id = ? AND shelf_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [userId, shelfId],
  );
  return row != null;
}
