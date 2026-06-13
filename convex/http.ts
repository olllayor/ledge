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

    // Bound the request body so a malicious or buggy caller can’t exhaust
  // the worker’s memory with a multi-GB POST. 256KB is far more than any
  // legitimate Lemon Squeezy webhook payload.
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
    return json({ error: "Payload too large." }, 413);
  }
  const raw = await request.text();
  if (raw.length > 256 * 1024) {
    return json({ error: "Payload too large." }, 413);
  }
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

    // Use the Lemon Squeezy event id when available, otherwise fall back
    // to subscription id + status. Either way, a duplicate delivery from
    // Lemon Squeezy or a replay attack against our endpoint becomes a
    // no-op instead of a stale entitlement reapplication.
    const subscriptionId = payload.data?.id ? String(payload.data.id) : "";
    const statusKey = attributes.status ? String(attributes.status) : "";
    const eventId = subscriptionId
      ? `ls:${subscriptionId}:${statusKey}`
      : `ls:${email}:${eventName}:${Date.parse(String(attributes.created_at ?? "0")) || 0}`;

    const isNew = await ctx.runMutation(internal.http.claimWebhookEvent, {
      source: "lemonsqueezy",
      eventId,
    });
    if (!isNew) {
      return json({ ok: true, deduped: true });
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

// Check + record that we've already processed a webhook event with the
// given (source, eventId) pair. Returns true if this is the first time we
// see it; false if it's a replay.
export const claimWebhookEvent = internalMutation({
  args: { source: v.string(), eventId: v.string() },
  handler: async (ctx, args) => {
    if (!args.eventId) {
      // No event id is a misconfiguration; let the caller process anyway
      // so we don't drop legitimate traffic.
      return true;
    }
    const existing = await ctx.db
      .query("processedWebhookEvents")
      .withIndex("by_event", (q) =>
        q.eq("source", args.source).eq("eventId", args.eventId),
      )
      .unique();
    if (existing) {
      return false;
    }
    await ctx.db.insert("processedWebhookEvents", {
      source: args.source,
      eventId: args.eventId,
      processedAt: Date.now(),
    });
    return true;
  },
});

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
