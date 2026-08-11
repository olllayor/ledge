import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserWithSession, sessionArgs, sha256 } from "./model";
import { sendOtpEmail } from "./email";

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Minimum gap between two successful `refreshSession` calls on the
// same session. Without this, a holder of a valid session token could
// pin `expiresAt` to `now + 90d` forever, effectively turning a
// 90-day session into a non-expiring one.
const REFRESH_MIN_INTERVAL_MS = 60 * 60 * 1000;

// Hard cap on a session's total lifetime, measured from its
// `createdAt`. Even with frequent refreshes, no session may outlive
// this. 365 days matches the longest reasonable user expectation;
// after that, the user must re-authenticate.
const SESSION_MAX_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

// At most this many OTPs per email in the rolling window. The window
// equals the OTP TTL so a single user can never accumulate more than
// this many active codes at once; an attacker spamming requestOtp gets
// refused after the limit.
const MAX_ACTIVE_OTPS_PER_EMAIL = 3;

// After this many failed verify attempts against a single OTP, that OTP
// is locked until its natural expiry. The lock counter lives on the otp
// row so it resets naturally when a new code is issued.
const MAX_FAILED_VERIFY_ATTEMPTS = 5;

export const me = query({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { userId, session } = await requireUserWithSession(ctx, args.sessionToken);
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const now = Date.now();
    const daysUntilExpiry = Math.floor((session.expiresAt - now) / (24 * 60 * 60 * 1000));

    return {
      userId,
      email: user.email,
      sessionExpiresAt: session.expiresAt,
      sessionDaysRemaining: daysUntilExpiry,
    };
  },
});

export const requestOtp = action({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);

    // Use a cryptographically secure random generator; Math.random() is
    // predictable and not safe for security tokens. We use rejection
    // sampling to produce an unbiased 6-digit code: a 32-bit Uint32 is
    // 4_294_967_296 values; the largest multiple of 1_000_000 that fits
    // is 4_000_000_000 (4_000 * 1_000_000), so we reject any draw above
    // 4_000_000_000 and re-roll. The previous `Uint32 % 900_000` had a
    // tiny modulo bias; rejection sampling is exact.
    const MAX_UNBIASED = 4_000_000_000; // 4_000 * 1_000_000
    let draw: number;
    do {
      draw = crypto.getRandomValues(new Uint32Array(1))[0]!;
    } while (draw >= MAX_UNBIASED);
    const code = String(1_000_000 + (draw % 1_000_000)).slice(1);
    await sendOtpEmail(email, code);

    const stored = await ctx.runMutation(internal.auth.tryStoreOtp, {
      email,
      codeHash: await sha256(`${email}:${code}`),
      expiresAt: Date.now() + OTP_TTL_MS,
    });
    if (!stored.ok) {
      // The atomic count+insert refused us. Throwing here surfaces the
      // same user-facing message the previous two-call flow did, but now
      // the cap is genuinely enforced under concurrency.
      throw new ConvexError(
        "Too many sign-in codes requested. Please wait for one to expire and try again.",
      );
    }

    return { ok: true };
  },
});

// Atomic count + insert. The previous flow ran `countActiveOtps` and then
// `storeOtp` as two separate calls, so two concurrent `requestOtp` actions
// could each see `count < MAX_ACTIVE_OTPS_PER_EMAIL` and both insert — letting
// an attacker issue N×MAX codes per TTL. This mutation reads the active
// count and writes the new row inside a single Convex transaction, so the
// rate cap is genuinely enforced.
export const tryStoreOtp = internalMutation({
  args: {
    email: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const active = await ctx.db
      .query("authOtps")
      .withIndex("by_email_and_createdAt", (q) => q.eq("email", args.email))
      .collect();
    const activeCount = active.filter(
      (otp) => otp.consumedAt === undefined && otp.expiresAt > now,
    ).length;
    if (activeCount >= MAX_ACTIVE_OTPS_PER_EMAIL) {
      return { ok: false as const, reason: "rate_limited" as const };
    }
    const id = await ctx.db.insert("authOtps", {
      email: args.email,
      codeHash: args.codeHash,
      expiresAt: args.expiresAt,
      createdAt: now,
    });
    return { ok: true as const, id };
  },
});

export const verifyOtp = mutation({
  args: {
    email: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const codeHash = await sha256(`${email}:${args.code.trim()}`);
    // Look up the specific OTP row matching this code. The hash is
    // stored on insert, so a (email, codeHash) lookup is unique in
    // practice and finds exactly the row that issued this code.
    const candidates = await ctx.db
      .query("authOtps")
      .withIndex("by_email_and_code_hash", (q) =>
        q.eq("email", email).eq("codeHash", codeHash),
      )
      .collect();
    // Prefer the most recent unconsumed match so a re-issued identical
    // hash (e.g. a code that happens to collide, or a re-send) can't
    // double-spend. There will normally be at most one row.
    const otp = candidates
      .filter((row) => row.consumedAt === undefined)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (!otp) {
      // No row matched this (email, code). The user typed a wrong
      // code. We bump `failedAttempts` on the most recent unconsumed
      // OTP for this email so the lockout counter advances. Because
      // this transaction only contains a single `db.patch` and no
      // `throw`, the patch commits atomically. The renderer treats
      // `{ ok: false }` as an error and surfaces the same user-facing
      // message a thrown ConvexError used to.
      //
      // The `by_email_and_createdAt` index is sorted by `createdAt`
      // (descending at the call site), but it does NOT filter on
      // `consumedAt` or `expiresAt`. The previous implementation
      // took `.first()` and then re-checked the row in JS — if the
      // newest row was already consumed/expired, the lockout counter
      // never advanced and the user could brute-force forever against
      // an older, still-active row. Walk the small bounded set of
      // rows for this email and pick the newest *active* one.
      const now = Date.now();
      const recentForEmail = await ctx.db
        .query("authOtps")
        .withIndex("by_email_and_createdAt", (q) => q.eq("email", email))
        .order("desc")
        .take(MAX_ACTIVE_OTPS_PER_EMAIL);
      const active = recentForEmail.find(
        (row) => row.consumedAt === undefined && row.expiresAt > now,
      );
      if (active) {
        const next = (active.failedAttempts ?? 0) + 1;
        if (next >= MAX_FAILED_VERIFY_ATTEMPTS) {
          // Lock the row by marking it consumed. The OTP can no
          // longer be verified even with the right code; the user
          // must wait for it to expire (or request a new one).
          await ctx.db.patch(active._id, {
            failedAttempts: next,
            consumedAt: Date.now(),
          });
        } else {
          await ctx.db.patch(active._id, { failedAttempts: next });
        }
      }
      return { ok: false as const, reason: "invalid" as const };
    }

    if (
      otp.consumedAt ||
      otp.expiresAt <= Date.now() ||
      (otp.failedAttempts ?? 0) >= MAX_FAILED_VERIFY_ATTEMPTS
    ) {
      // Already consumed, expired, or locked. We deliberately do not
      // bump `failedAttempts` here — the row is in a terminal state
      // for this code, so the lockout counter would never reach the
      // 5-attempt threshold anyway. Returning `{ ok: false }` lets the
      // renderer surface the same user-facing message.
      return { ok: false as const, reason: "invalid" as const };
    }

    await ctx.db.patch(otp._id, { consumedAt: Date.now() });
    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (!user) {
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("entitlements", {
        userId,
        plan: "free",
        status: "active",
        updatedAt: Date.now(),
      });
      user = await ctx.db.get(userId);
    }

    if (!user) {
      throw new ConvexError("Unable to create user.");
    }

    const sessionToken = crypto.randomUUID();
    await ctx.db.insert("authSessions", {
      userId: user._id,
      tokenHash: await sha256(sessionToken),
      expiresAt: Date.now() + SESSION_TTL_MS,
      createdAt: Date.now(),
    });

    return { sessionToken, email };
    // Note: the success return shape is unchanged, so the renderer's
    // `result.sessionToken` access still works.
  },
});

export const signOut = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const tokenHash = await sha256(args.sessionToken);
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) {
      await ctx.db.patch(session._id, { revokedAt: Date.now() });
    }
    return { ok: true };
  },
});

export const refreshSession = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { session } = await requireUserWithSession(ctx, args.sessionToken);
    const now = Date.now();
    // Enforce a minimum gap between refreshes. `lastRefreshedAt` is
    // `undefined` for sessions that have never been refreshed, in
    // which case the first refresh is always allowed.
    const lastRefresh = session.lastRefreshedAt ?? session.createdAt;
    if (now - lastRefresh < REFRESH_MIN_INTERVAL_MS) {
      throw new ConvexError(
        "Session was refreshed too recently. Please try again later.",
      );
    }
    // Enforce a hard cap on total session lifetime so a stolen token
    // can't be perpetually renewed into a non-expiring credential.
    const maxAllowedExpiry = session.createdAt + SESSION_MAX_LIFETIME_MS;
    const newExpiresAt = Math.min(now + SESSION_TTL_MS, maxAllowedExpiry);
    if (newExpiresAt <= session.expiresAt) {
      // The lifetime cap has been reached; refuse rather than no-op
      // so the renderer can prompt the user to re-authenticate.
      throw new ConvexError(
        "Session has reached its maximum lifetime. Please sign in again.",
      );
    }
    await ctx.db.patch(session._id, {
      expiresAt: newExpiresAt,
      lastRefreshedAt: now,
    });
    return { ok: true, expiresAt: newExpiresAt };
  },
});

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new ConvexError("Enter a valid email address.");
  }
  return normalized;
}


// Minimum gap between two successful `refreshSession` calls on the
// same session. Without this, a holder of a valid session token could
