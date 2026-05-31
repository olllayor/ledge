import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export const FREE_SYNC_SHELF_LIMIT = 10;
export const FREE_SYNC_DEVICE_LIMIT = 1;
export const PRO_SYNC_SHELF_LIMIT = 500;
export const PRO_SYNC_DEVICE_LIMIT = 3;
export const PRO_IMAGE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

export const sessionArgs = {
  sessionToken: v.string(),
};

export async function requireUser(ctx: QueryCtx | MutationCtx, sessionToken: string): Promise<Id<"users">> {
  const { userId } = await requireUserWithSession(ctx, sessionToken);
  return userId;
}

export async function requireUserWithSession(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
): Promise<{ userId: Id<"users">; session: Doc<"authSessions"> }> {
  const tokenHash = await sha256(sessionToken);
  const session = await ctx.db
    .query("authSessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

  if (!session || session.revokedAt || session.expiresAt <= Date.now()) {
    throw new ConvexError("Authentication required.");
  }

  return { userId: session.userId, session };
}

export async function currentPlan(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<"free" | "pro"> {
  const entitlement = await ctx.db
    .query("entitlements")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  return entitlement?.plan === "pro" && entitlement.status === "active" ? "pro" : "free";
}

export function shelfLimitForPlan(plan: "free" | "pro"): number {
  return plan === "pro" ? PRO_SYNC_SHELF_LIMIT : FREE_SYNC_SHELF_LIMIT;
}

export function deviceLimitForPlan(plan: "free" | "pro"): number {
  return plan === "pro" ? PRO_SYNC_DEVICE_LIMIT : FREE_SYNC_DEVICE_LIMIT;
}

export async function storageBytesUsed(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<number> {
  const assets = await ctx.db
    .query("imageAssets")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  return assets.reduce((total, asset) => total + asset.bytes, 0);
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
