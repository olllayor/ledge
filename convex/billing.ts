import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser, sessionArgs } from "./model";

export const entitlement = query({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    return entitlement ?? { plan: "free", status: "active", updatedAt: Date.now() };
  },
});

export const refreshEntitlements = action({
  args: {
    ...sessionArgs,
    licenseKey: v.optional(v.string()),
    orderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
    if (!apiKey) {
      throw new ConvexError("Lemon Squeezy API key is not configured.");
    }

    const userId = await ctx.runQuery(internal.billing.userIdForSession, {
      sessionToken: args.sessionToken,
    });
    const userEmail = await ctx.runQuery(internal.billing.emailForUserId, { userId });
    const result = await fetchLemonSqueezyEntitlement(apiKey, args.licenseKey, args.orderId);
    // Verify the license belongs to the signed-in user. Without this
    // check, any user could paste an arbitrary license key and promote
    // themselves to Pro using someone else's purchase.
    if (result.userEmail && userEmail && result.userEmail.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ConvexError(
        "This license key is registered to a different account. Sign in with the matching email to use it.",
      );
    }
    await ctx.runMutation(internal.billing.applyEntitlement, {
      userId,
      plan: result.active ? "pro" : "free",
      status: result.active ? "active" : "inactive",
      lemonSqueezyCustomerId: result.customerId,
      lemonSqueezySubscriptionId: result.subscriptionId,
      lemonSqueezyOrderId: args.orderId,
      lemonSqueezyLicenseKey: args.licenseKey,
      renewsAt: result.renewsAt,
    });

    return result;
  },
});

export const userIdForSession = internalQuery({
  args: sessionArgs,
  handler: async (ctx, args) => {
    return await requireUser(ctx, args.sessionToken);
  },
});

export const emailForUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.email;
  },
});

export const applyEntitlement = internalMutation({
  args: {
    userId: v.id("users"),
    plan: v.union(v.literal("free"), v.literal("pro")),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("pastDue"), v.literal("cancelled")),
    lemonSqueezyCustomerId: v.optional(v.string()),
    lemonSqueezySubscriptionId: v.optional(v.string()),
    lemonSqueezyOrderId: v.optional(v.string()),
    lemonSqueezyLicenseKey: v.optional(v.string()),
    renewsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const patch = {
      plan: args.plan,
      status: args.status,
      lemonSqueezyCustomerId: args.lemonSqueezyCustomerId,
      lemonSqueezySubscriptionId: args.lemonSqueezySubscriptionId,
      lemonSqueezyOrderId: args.lemonSqueezyOrderId,
      lemonSqueezyLicenseKey: args.lemonSqueezyLicenseKey,
      renewsAt: args.renewsAt,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("entitlements", {
      userId: args.userId,
      ...patch,
    });
  },
});

async function fetchLemonSqueezyEntitlement(
  apiKey: string,
  licenseKey?: string,
  orderId?: string,
): Promise<{
  active: boolean;
  customerId?: string;
  subscriptionId?: string;
  renewsAt?: number;
  userEmail?: string;
}> {
  if (!licenseKey && !orderId) {
    throw new ConvexError("Provide a Lemon Squeezy license key or order ID.");
  }

  if (licenseKey) {
    const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ license_key: licenseKey }),
    });
    const json = await response.json();
    return {
      active: Boolean(json.valid),
      customerId: json.meta?.customer_id ? String(json.meta.customer_id) : undefined,
      subscriptionId: json.meta?.subscription_id ? String(json.meta.subscription_id) : undefined,
      userEmail: json.license_key?.user_email ? String(json.license_key.user_email) : undefined,
    };
  }

  const response = await fetch(`https://api.lemonsqueezy.com/v1/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/vnd.api+json",
    },
  });
  const json = await response.json();
  return {
    active: response.ok && json.data?.attributes?.status !== "refunded",
    customerId: json.data?.attributes?.customer_id ? String(json.data.attributes.customer_id) : undefined,
  };
}
