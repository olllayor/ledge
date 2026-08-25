import { httpRouter } from "convex/server";
import { httpAction, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { proVariantIds } from "./model";

const http = httpRouter();

// Events we explicitly understand and let touch entitlements. Everything
// else is acknowledged with `ignored` so Lemon Squeezy stops retrying.
// Applying an entitlement for EVERY signed delivery mapped unknown events
// (`order_refunded`, `subscription_payment_failed`, license notifications,
// …) to plan=free/status=inactive, silently downgrading active subscribers.
const PRO_GRANTING_EVENTS = new Set([
  "subscription_created",
  "subscription_payment_success",
  "subscription_payment_recovered",
]);
const PRO_REVOKING_EVENTS = new Set([
  "subscription_updated",
  "subscription_cancelled",
  "subscription_expired",
  "subscription_payment_failed",
]);

// Variant gate. With an allowlist configured, only deliveries whose
// variant matches may change entitlements — a store selling several
// products must not let a non-Pro SKU's lifecycle flip a Pro account.
// Without an allowlist: fail closed for upgrades (same policy as
// order-based activation in billing.ts) but still process
// cancellations/failures so lapsed subscriptions don't keep Pro forever.
function passesVariantGate(
  variantId: string | undefined,
  allowedVariants: string[],
  mode: "upgrade" | "downgrade",
): boolean {
  if (allowedVariants.length === 0) {
    return mode === "downgrade";
  }
  return variantId !== undefined && allowedVariants.includes(variantId);
}

function extractVariantId(payload: {
  data?: { attributes?: Record<string, unknown> };
}): string | undefined {
  const attrs = payload.data?.attributes ?? {};
  const candidates = [
    attrs.variant_id,
    (attrs.first_order_item as Record<string, unknown> | undefined)?.variant_id,
    (attrs.first_subscription_item as Record<string, unknown> | undefined)?.variant_id,
  ];
  for (const candidate of candidates) {
    if (candidate != null) {
      return String(candidate);
    }
  }
  return undefined;
}

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

    let payload: {
      meta?: { event_name?: unknown };
      data?: { id?: unknown; attributes?: Record<string, unknown> };
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: "Malformed JSON body." }, 400);
    }
    const eventName = String(payload.meta?.event_name ?? "");
    const attributes = payload.data?.attributes ?? {};
    const email = String(attributes.user_email ?? attributes.customer_email ?? "").trim().toLowerCase();
    if (!email) {
      return json({ ok: true, ignored: "missing_email" });
    }

    const granting = PRO_GRANTING_EVENTS.has(eventName);
    const revoking = PRO_REVOKING_EVENTS.has(eventName);
    if (!granting && !revoking) {
      return json({ ok: true, ignored: eventName });
    }

    const variantId = extractVariantId(payload);
    const allowedVariants = proVariantIds();
    if (!passesVariantGate(variantId, allowedVariants, granting ? "upgrade" : "downgrade")) {
      return json({ ok: true, ignored: `${eventName}:variant_not_pro` });
    }

    // Dedupe on the event identity: subscription id + event name +
    // created_at. Keying by status alone made a cancel-then-resubscribe
    // cycle look like a replay — the second `active` delivery carried the
    // same (subscriptionId, active) pair, got deduped, and a paying user
    // stayed cancelled. created_at differs for each real status change,
    // while Lemon Squeezy retries of the same delivery keep it identical.
    // Deliveries without a parseable created_at fall back to the raw
    // timestamp string so distinct events don't collapse into one key.
    const subscriptionId = payload.data?.id ? String(payload.data.id) : "";
    const createdAtRaw = String(attributes.created_at ?? "");
    const createdAtMs = Date.parse(createdAtRaw);
    const createdAtKey = Number.isFinite(createdAtMs) ? String(createdAtMs) : createdAtRaw;
    const eventId = subscriptionId
      ? `ls:${subscriptionId}:${eventName}:${createdAtKey}`
      : `ls:${email}:${eventName}:${createdAtKey}`;

    let isActive = false;
    let isCancelled = false;
    if (granting) {
      isActive = true;
    } else {
      const status = typeof attributes.status === "string" ? attributes.status : "";
      switch (eventName) {
        case "subscription_cancelled":
        case "subscription_expired":
        case "subscription_payment_failed":
          isCancelled = true;
          break;
        case "subscription_updated":
          // Only terminal statuses revoke here. Transient states
          // (past_due, paused, on_trial, unpaid grace) must not strip an
          // active subscription on a routine status tick.
          if (status === "cancelled" || status === "expired") {
            isCancelled = true;
          } else if (status === "active") {
            isActive = true;
          } else {
            return json({ ok: true, ignored: `subscription_updated:${status}` });
          }
          break;
      }
    }

    const isNew = await ctx.runMutation(internal.http.processWebhookEvent, {
      eventId,
      email,
      eventName,
      isActive,
      isCancelled,
      lemonSqueezyCustomerId: attributes.customer_id ? String(attributes.customer_id) : undefined,
      lemonSqueezySubscriptionId: payload.data?.id ? String(payload.data.id) : undefined,
      lemonSqueezyOrderId: attributes.order_id ? String(attributes.order_id) : undefined,
      lemonSqueezyLicenseKey: attributes.key ? String(attributes.key) : undefined,
      renewsAt: attributes.renews_at ? Date.parse(String(attributes.renews_at)) || undefined : undefined,
    });
    if (!isNew) {
      return json({ ok: true, deduped: true });
    }

    return json({ ok: true });
  }),
});

export default http;

// Claim + user upsert + entitlement apply in ONE transaction.
//
// The previous flow claimed the event in its own mutation before
// applying the entitlement, so a failure between the two consumed the
// event — a paying customer's `active` delivery was marked processed
// and lost. Wrapping everything in one transaction means any throw
// rolls back the claim too and Lemon Squeezy's retry reprocesses the
// event cleanly; replays after success hit the dedupe check.
export const processWebhookEvent = internalMutation({
  args: {
    eventId: v.string(),
    email: v.string(),
    eventName: v.string(),
    isActive: v.boolean(),
    isCancelled: v.boolean(),
    lemonSqueezyCustomerId: v.optional(v.string()),
    lemonSqueezySubscriptionId: v.optional(v.string()),
    lemonSqueezyOrderId: v.optional(v.string()),
    lemonSqueezyLicenseKey: v.optional(v.string()),
    renewsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.eventId) {
      const existing = await ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_event", (q) =>
          q.eq("source", "lemonsqueezy").eq("eventId", args.eventId),
        )
        .unique();
      if (existing) {
        return false;
      }
      await ctx.db.insert("processedWebhookEvents", {
        source: "lemonsqueezy",
        eventId: args.eventId,
        processedAt: Date.now(),
      });
    }

    const userId = await upsertUserForEmail(ctx, args.email);
    await applyEntitlementValues(ctx, {
      userId,
      plan: args.isActive && !args.isCancelled ? "pro" : "free",
      status:
        args.isActive && !args.isCancelled ? "active" : args.isCancelled ? "cancelled" : "inactive",
      lemonSqueezyCustomerId: args.lemonSqueezyCustomerId,
      lemonSqueezySubscriptionId: args.lemonSqueezySubscriptionId,
      lemonSqueezyOrderId: args.lemonSqueezyOrderId,
      lemonSqueezyLicenseKey: args.lemonSqueezyLicenseKey,
      renewsAt: args.renewsAt,
    });
    return true;
  },
});

async function upsertUserForEmail(ctx: MutationCtx, email: string): Promise<Id<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { updatedAt: Date.now() });
    return existing._id;
  }

  return await ctx.db.insert("users", {
    email,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

// Shared with `billing.applyEntitlement` semantics: patch the user's
// entitlement row, preserving stored LS identifiers the caller omitted.
async function applyEntitlementValues(
  ctx: MutationCtx,
  values: {
    userId: Id<"users">;
    plan: "free" | "pro";
    status: "active" | "inactive" | "pastDue" | "cancelled";
    lemonSqueezyCustomerId?: string;
    lemonSqueezySubscriptionId?: string;
    lemonSqueezyOrderId?: string;
    lemonSqueezyLicenseKey?: string;
    renewsAt?: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("entitlements")
    .withIndex("by_user", (q) => q.eq("userId", values.userId))
    .first();
  const patch = {
    plan: values.plan,
    status: values.status,
    lemonSqueezyCustomerId: values.lemonSqueezyCustomerId ?? existing?.lemonSqueezyCustomerId,
    lemonSqueezySubscriptionId:
      values.lemonSqueezySubscriptionId ?? existing?.lemonSqueezySubscriptionId,
    lemonSqueezyOrderId: values.lemonSqueezyOrderId ?? existing?.lemonSqueezyOrderId,
    lemonSqueezyLicenseKey: values.lemonSqueezyLicenseKey ?? existing?.lemonSqueezyLicenseKey,
    renewsAt: values.renewsAt ?? existing?.renewsAt,
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return;
  }
  await ctx.db.insert("entitlements", { userId: values.userId, ...patch });
}

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
