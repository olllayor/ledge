import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const BATCH_SIZE = 100;

export const cleanupExpiredSessions = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("authSessions")
      .order("asc")
      .take(BATCH_SIZE);

    const toDelete = expired.filter(
      (s) => s.expiresAt <= now || s.revokedAt !== undefined,
    );

    for (const session of toDelete) {
      await ctx.db.delete(session._id);
    }

    if (toDelete.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupExpiredSessions);
    }
  },
});

export const cleanupExpiredOtps = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const otps = await ctx.db
      .query("authOtps")
      .order("asc")
      .take(BATCH_SIZE);

    const toDelete = otps.filter(
      (o) => o.expiresAt <= now || o.consumedAt !== undefined,
    );

    for (const otp of toDelete) {
      await ctx.db.delete(otp._id);
    }

    if (toDelete.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupExpiredOtps);
    }
  },
});

export const cleanupOldWebhookEvents = internalMutation({
  handler: async (ctx) => {
    // Keep 30 days of dedup history. A replayed event older than that
    // is a non-issue: even if we re-apply the entitlement, the worst
    // case is "active" overwriting "active" (or "cancelled" staying
    // "cancelled") — both already protected by the email-match check
    // in refreshEntitlements.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query("processedWebhookEvents")
      .order("asc")
      .take(BATCH_SIZE);
    const toDelete = old.filter((event) => event.processedAt < cutoff);
    for (const event of toDelete) {
      await ctx.db.delete(event._id);
    }
    if (toDelete.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupOldWebhookEvents);
    }
  },
});

export const cleanupOldUploadEvents = internalMutation({
  handler: async (ctx) => {
    // Image upload events are only meaningful for the rolling 1-hour
    // in-flight cap. Anything older than 24h can be safely discarded.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query("imageUploadEvents")
      .order("asc")
      .take(BATCH_SIZE);
    const toDelete = old.filter((event) => event.createdAt < cutoff);
    for (const event of toDelete) {
      await ctx.db.delete(event._id);
    }
    if (toDelete.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.cleanupOldUploadEvents);
    }
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
  "cleanup old webhook events",
  { hours: 24 },
  internal.crons.cleanupOldWebhookEvents,
);

export default crons;
