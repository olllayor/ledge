import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  PRO_IMAGE_STORAGE_LIMIT_BYTES,
  PRO_REQUIRED_FOR_PREFERENCES_MESSAGE,
} from "./sharedSchemas";
import {
  syncShelfLimitForPlan,
  syncDeviceLimitForPlan,
} from "../src/shared/syncUtils";

// Re-export the plan helpers under the model-local names used by the rest of
// convex/. The shared utils use a `sync*` prefix to make their purpose
// explicit; the Convex fn layer historically called them without the prefix.
export const deviceLimitForPlan = syncDeviceLimitForPlan;
export const shelfLimitForPlan = syncShelfLimitForPlan;
export { PRO_IMAGE_STORAGE_LIMIT_BYTES, PRO_REQUIRED_FOR_PREFERENCES_MESSAGE };

export const FREE_SYNC_SHELF_LIMIT = 100;
export const FREE_SYNC_DEVICE_LIMIT = 1;
export const PRO_SYNC_SHELF_LIMIT = 500;
export const PRO_SYNC_DEVICE_LIMIT = 3;

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
