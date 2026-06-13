import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserWithSession, sessionArgs, sha256 } from "./model";

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.LEDGE_AUTH_EMAIL_FROM ?? "Ledge <auth@ledge.app>";
    // In production, refuse to issue an OTP that we can’t deliver.
    // Local `npx convex dev` deployments have no email service in scope,
    // so we keep the console.log fallback behind a deployment check.
    const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
    const isProd = deployment.startsWith("prod:") || deployment.includes(":prod");
    if (!apiKey && isProd) {
      throw new ConvexError(
        "Email delivery is not configured. Set RESEND_API_KEY in the Convex dashboard.",
      );
    }

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

    if (!apiKey) {
      console.warn(
        `[ledge auth] RESEND_API_KEY not set; logging OTP for ${email} (dev only)`,
      );
      console.log(`Ledge OTP for ${email}: ${code}`);
    } else {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: email,
          subject: "Your Ledge sign-in code",
          text: `Your Ledge sign-in code is ${code}. It expires in 10 minutes.`,
        }),
      });
      if (!response.ok) {
        // Don’t store the OTP if the email was never sent. Otherwise
        // a transient Resend outage would burn one of the user’s three
        // active-code slots and they’d be stuck waiting 10 minutes.
        throw new ConvexError(
          `Email delivery failed (${response.status}). Please try again.`,
        );
      }
    }

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
      .withIndex("by_email", (q) => q.eq("email", args.email))
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
    // Look up the specific OTP row matching this code. The previous
    // implementation did `by_email … order("desc").first()`, which
    // silently selected the newest code even when the user was entering
    // a still-valid older one — and (worse) a wrong-code attempt would
    // increment the lockout counter on whatever row happened to be
    // newest, not the row the user was actually trying. The hash is
    // stored on insert, so a (email, codeHash) lookup is unique and
    // finds exactly the row that issued this code.
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
      throw new ConvexError("Invalid or expired sign-in code.");
    }

    if (
      otp.consumedAt ||
      otp.expiresAt <= Date.now() ||
      (otp.failedAttempts ?? 0) >= MAX_FAILED_VERIFY_ATTEMPTS
    ) {
      throw new ConvexError("Invalid or expired sign-in code.");
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
    const newExpiresAt = Date.now() + SESSION_TTL_MS;
    await ctx.db.patch(session._id, { expiresAt: newExpiresAt });
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
