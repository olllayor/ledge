import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser, sessionArgs, sha256 } from "./model";

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const me = query({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const user = await ctx.db.get(userId);
    return user ? { userId, email: user.email } : null;
  },
});

export const requestOtp = action({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await ctx.runMutation(internal.auth.storeOtp, {
      email,
      codeHash: await sha256(`${email}:${code}`),
      expiresAt: Date.now() + OTP_TTL_MS,
    });

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.LEDGE_AUTH_EMAIL_FROM ?? "Ledge <auth@ledge.app>";
    if (apiKey) {
      await fetch("https://api.resend.com/emails", {
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
    } else {
      console.log(`Ledge OTP for ${email}: ${code}`);
    }

    return { ok: true };
  },
});

export const storeOtp = internalMutation({
  args: {
    email: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("authOtps", {
      email: args.email,
      codeHash: args.codeHash,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
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
    const otp = await ctx.db
      .query("authOtps")
      .withIndex("by_email", (q) => q.eq("email", email))
      .order("desc")
      .first();

    if (!otp || otp.consumedAt || otp.expiresAt <= Date.now() || otp.codeHash !== codeHash) {
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

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new ConvexError("Enter a valid email address.");
  }
  return normalized;
}
