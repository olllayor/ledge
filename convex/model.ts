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

// Variant ids that grant Pro. Configured via env (comma-separated) so a
// future SKU change does not require a code deploy. Shared by the
// order/license activation paths in billing.ts and the webhook in http.ts:
// without an allowlist, ANY paid order / subscription on the store would
// promote the caller to Pro.
export function proVariantIds(): string[] {
  const raw = process.env.LEMON_SQUEEZY_PRO_VARIANT_IDS ?? "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

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
  // Legacy imageAssets only. Per-item shelfItems rows carry no byte
  // fields yet (nothing writes them), so any shelfItems-based accounting
  // here would be a global table scan returning zero. Revisit when the
  // rows gain real byte counts plus a by_createdBy index.
  //
  // Full index iteration instead of `.take(1000)`: a capped take silently
  // dropped the tail once a user passed 1000 assets, undercounting usage
  // and letting the per-plan storage cap be bypassed with arbitrary
  // additional uploads.
  let total = 0;
  for await (const asset of ctx.db
    .query("imageAssets")
    .withIndex("by_user", (q) => q.eq("userId", userId))) {
    total += asset.bytes;
  }
  return total;
}

export async function assertTeamPermission(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
  userId: Id<"users">,
  requiredRole?: "admin" | "member",
): Promise<Doc<"teamMembers">> {
  const membership = await ctx.db
    .query("teamMembers")
    .withIndex("by_team_and_user", (q) => q.eq("teamId", teamId).eq("userId", userId))
    .unique();

  if (!membership) {
    throw new ConvexError("You are not a member of this team.");
  }

  if (requiredRole === "admin" && membership.role !== "admin") {
    throw new ConvexError("Admin permission required.");
  }

  return membership;
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
