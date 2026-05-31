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

export default crons;
