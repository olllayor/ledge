import { httpRouter } from "convex/server";
import { httpAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const http = httpRouter();

http.route({
  path: "/lemonsqueezy/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    if (!secret) {
      return json({ error: "Webhook secret is not configured." }, 500);
    }

    const raw = await request.text();
    const signature = request.headers.get("x-signature") ?? "";
    const expected = await hmacSha256(secret, raw);
    if (!constantTimeEqual(signature, expected)) {
      return json({ error: "Invalid signature." }, 401);
    }

    const payload = JSON.parse(raw);
    const eventName = String(payload.meta?.event_name ?? "");
    const attributes = payload.data?.attributes ?? {};
    const email = String(attributes.user_email ?? attributes.customer_email ?? "").trim().toLowerCase();
    if (!email) {
      return json({ ok: true, ignored: "missing_email" });
    }

    const userId = await ctx.runMutation(internal.http.upsertUserForWebhook, { email });
    const isActive =
      eventName.includes("subscription_payment_success") ||
      eventName.includes("subscription_created") ||
      attributes.status === "active" ||
      attributes.status === "paid";
    const isCancelled = eventName.includes("subscription_cancelled") || attributes.status === "cancelled";

    await ctx.runMutation(internal.billing.applyEntitlement, {
      userId,
      plan: isActive && !isCancelled ? "pro" : "free",
      status: isActive && !isCancelled ? "active" : isCancelled ? "cancelled" : "inactive",
      lemonSqueezyCustomerId: attributes.customer_id ? String(attributes.customer_id) : undefined,
      lemonSqueezySubscriptionId: payload.data?.id ? String(payload.data.id) : undefined,
      lemonSqueezyOrderId: attributes.order_id ? String(attributes.order_id) : undefined,
      renewsAt: attributes.renews_at ? Date.parse(String(attributes.renews_at)) : undefined,
    });

    return json({ ok: true });
  }),
});

export default http;

export const upsertUserForWebhook = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { updatedAt: Date.now() });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      email: args.email,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
