import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const BATCH_SIZE = 100;

export const cleanupExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Walk the `by_expiresAt` and `by_revokedAt` indexes to find
    // every session that's either expired or revoked. The previous
    // `.order("asc")` scan returned the 100 oldest sessions by
    // creation time, not by expiry, so any session created more
    // recently than 100 expired-but-recently-created ones would
    // never be cleaned up.
    const expired = await ctx.db
      .query("authSessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(BATCH_SIZE);
    // Filter on the application side as well: withIndex("by_revokedAt",
    // q.lt("revokedAt", now)) also matches rows where `revokedAt` is
    // undefined (Convex treats `undefined` as less than any number for
    // indexed optional fields).
    const revoked = (
      await ctx.db
        .query("authSessions")
        .withIndex("by_revokedAt", (q) => q.lt("revokedAt", now))
        .take(BATCH_SIZE)
    ).filter((s) => s.revokedAt !== undefined);

    // Dedupe: the two indexes might overlap if a session is both
    // expired and revoked.
    const seen = new Set<string>();
    const toDelete = [...expired, ...revoked].filter((session) => {
      if (seen.has(session._id)) return false;
      seen.add(session._id);
      return true;
    });

    for (const session of toDelete) {
      await ctx.db.delete(session._id);
    }

    if (toDelete.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupExpiredSessions);
    }
  },
});

export const cleanupExpiredOtps = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Same fix as `cleanupExpiredSessions`: walk the `by_expiresAt`
    // and `by_consumedAt` indexes to find every OTP that's either
    // expired or consumed.
    const expired = await ctx.db
      .query("authOtps")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(BATCH_SIZE);
    // See note in `cleanupExpiredSessions`: withIndex on an optional
    // field with `q.lt(..., now)` also matches rows where the field
    // is `undefined`, so we filter on the application side.
    const consumed = (
      await ctx.db
        .query("authOtps")
        .withIndex("by_consumedAt", (q) => q.lt("consumedAt", now))
        .take(BATCH_SIZE)
    ).filter((o) => o.consumedAt !== undefined);
    const seen = new Set<string>();
    const toDelete = [...expired, ...consumed].filter((otp) => {
      if (seen.has(otp._id)) return false;
      seen.add(otp._id);
      return true;
    });

    for (const otp of toDelete) {
      await ctx.db.delete(otp._id);
    }

    if (toDelete.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupExpiredOtps);
    }
  },
});

export const cleanupOldWebhookEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Keep 30 days of dedup history. A replayed event older than that
    // is a non-issue: even if we re-apply the entitlement, the worst
    // case is "active" overwriting "active" (or "cancelled" staying
    // "cancelled") — both already protected by the email-match check
    // in refreshEntitlements.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    // Use the existing `by_processed_at` index so the take() is
    // bounded to events older than the cutoff, not "the first 100
    // ever processed".
    const toDelete = await ctx.db
      .query("processedWebhookEvents")
      .withIndex("by_processed_at", (q) => q.lt("processedAt", cutoff))
      .take(BATCH_SIZE);
    for (const event of toDelete) {
      await ctx.db.delete(event._id);
    }
    if (toDelete.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupOldWebhookEvents);
    }
  },
});

export const cleanupOldUploadEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Image upload events are only meaningful for the rolling 1-hour
    // in-flight cap. Anything older than 24h can be safely discarded.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    // Use the new `by_createdAt` index so the take() is bounded to
    // events older than the cutoff.
    const toDelete = await ctx.db
      .query("imageUploadEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(BATCH_SIZE);
    for (const event of toDelete) {
      await ctx.db.delete(event._id);
    }
    if (toDelete.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupOldUploadEvents);
    }
  },
});

// Reclaim storage blobs whose upload never completed. A client crash
// between "generate upload URL" and `recordImageAsset` leaves a billed
// blob in `_storage` with no imageAssets row pointing at it — deleted
// rows never, leaking bytes forever. Blobs younger than the grace
// period may still be mid-upload and are skipped.
//
// NOTE: iteration is oldest-first (ascending _creationTime), so old
// orphans are always reached regardless of upload volume.
//
// TODO(phase-2): this only understands claims via legacy `imageAssets`.
// Once `shelfItems.storageId` / `cloudStorageId` are populated they need
// a `by_storageId` index and a claim check here, or this cron will
// delete LIVE team-item blobs after the grace period.
const ORPHAN_BLOB_GRACE_MS = 24 * 60 * 60 * 1000;

export const cleanupOrphanedStorageBlobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ORPHAN_BLOB_GRACE_MS;
    let orphaned = 0;
    let scanned = 0;

    for await (const blob of ctx.db.system.query("_storage")) {
      if (scanned >= BATCH_SIZE) break;
      scanned += 1;
      if (blob._creationTime >= cutoff) continue;

      const claimed = await ctx.db
        .query("imageAssets")
        .withIndex("by_storage", (q) => q.eq("storageId", blob._id))
        .first();
      if (!claimed) {
        await ctx.storage.delete(blob._id);
        orphaned += 1;
      }
    }

    // Reschedule when we filled the scan window; there may be more.
    if (scanned === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupOrphanedStorageBlobs);
    }
    void orphaned;
  },
});

const crons = cronJobs();

crons.interval(
  "cleanup expired sessions",
  { hours: 1 },
  internal.crons.cleanupExpiredSessions,
);

crons.interval(
  "cleanup expired OTPs",
  { hours: 1 },
  internal.crons.cleanupExpiredOtps,
);

crons.interval(
  "cleanup old upload events",
  { hours: 1 },
  internal.crons.cleanupOldUploadEvents,
);

crons.interval(
  "delete orphaned storage blobs",
  { hours: 6 },
  internal.crons.cleanupOrphanedStorageBlobs,
);

crons.interval(
  "cleanup old webhook events",
  { hours: 24 },
  internal.crons.cleanupOldWebhookEvents,
);

export default crons;
