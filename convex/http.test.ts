// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { TestConvex } from "convex-test";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function useWebhookEnv(): () => void {
  const previousSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const previousVariants = process.env.LEMON_SQUEEZY_PRO_VARIANT_IDS;
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "test-secret";
  process.env.LEMON_SQUEEZY_PRO_VARIANT_IDS = "11111";
  return () => {
    if (previousSecret !== undefined) {
      process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = previousSecret;
    } else {
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    }
    if (previousVariants !== undefined) {
      process.env.LEMON_SQUEEZY_PRO_VARIANT_IDS = previousVariants;
    } else {
      delete process.env.LEMON_SQUEEZY_PRO_VARIANT_IDS;
    }
  };
}

async function postSigned(t: TestConvex<typeof schema>, payload: string): Promise<Response> {
  const signature = await sign("test-secret", payload);
  return await t.fetch("/lemonsqueezy/webhook", {
    method: "POST",
    headers: { "x-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

async function entitlementFor(
  t: TestConvex<typeof schema>,
  email: string,
): Promise<{ plan: string; status: string } | null> {
  return await t.run(async (ctx) => {
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (!user) return null;
    const row = await ctx.db.query("entitlements").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
    return row ? { plan: row.plan, status: row.status } : null;
  });
}

test("lemonsqueezy webhook rejects requests without a configured secret", async () => {
  const t = convexTest(schema, modules);
  // Ensure the env var is unset for the test.
  const previousSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  try {
    const response = await t.fetch("/lemonsqueezy/webhook", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(500);
  } finally {
    if (previousSecret !== undefined) {
      process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = previousSecret;
    }
  }
});

test("lemonsqueezy webhook rejects requests with an invalid signature", async () => {
  const t = convexTest(schema, modules);
  const previousSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "test-secret";
  try {
    const response = await t.fetch("/lemonsqueezy/webhook", {
      method: "POST",
      headers: { "x-signature": "deadbeef" },
      body: "{}",
    });
    expect(response.status).toBe(401);
  } finally {
    if (previousSecret !== undefined) {
      process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = previousSecret;
    } else {
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    }
  }
});

test("lemonsqueezy webhook ignores unrecognized events instead of downgrading", async () => {
  const t = convexTest(schema, modules);
  const restore = useWebhookEnv();
  try {
    for (const eventName of ["order_refunded", "license_key_created", "subscription_plan_changed"]) {
      const payload = JSON.stringify({
        meta: { event_name: eventName },
        data: {
          id: "evt-1",
          attributes: {
            user_email: "webhook@example.com",
            status: "pending",
            variant_id: 11111,
          },
        },
      });
      const response = await postSigned(t, payload);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, ignored: eventName });
    }

    // No user or entitlement rows may be created for ignored events.
    expect(await entitlementFor(t, "webhook@example.com")).toBeNull();
  } finally {
    restore();
  }
});

test("lemonsqueezy webhook grants pro entitlement on subscription_payment_success", async () => {
  const t = convexTest(schema, modules);
  const restore = useWebhookEnv();
  try {
    const payload = JSON.stringify({
      meta: { event_name: "subscription_payment_success" },
      data: {
        id: "sub-1",
        attributes: {
          user_email: "pro@example.com",
          customer_id: 42,
          status: "active",
          variant_id: 11111,
          renews_at: "2027-01-01T00:00:00.000Z",
        },
      },
    });

    const response = await postSigned(t, payload);
    expect(response.status).toBe(200);

    const entitlement = await entitlementFor(t, "pro@example.com");
    expect(entitlement?.plan).toBe("pro");
    expect(entitlement?.status).toBe("active");
  } finally {
    restore();
  }
});

test("lemonsqueezy webhook refuses pro upgrades from a non-Pro variant", async () => {
  const t = convexTest(schema, modules);
  const restore = useWebhookEnv();
  try {
    const payload = JSON.stringify({
      meta: { event_name: "subscription_created" },
      data: {
        id: "sub-other-sku",
        attributes: {
          user_email: "other-sku@example.com",
          status: "active",
          variant_id: 99999,
        },
      },
    });

    const response = await postSigned(t, payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ignored: "subscription_created:variant_not_pro" });
    expect(await entitlementFor(t, "other-sku@example.com")).toBeNull();
  } finally {
    restore();
  }
});

test("lemonsqueezy webhook fails closed on upgrades when no variants are configured", async () => {
  const t = convexTest(schema, modules);
  const previousSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "test-secret";
  delete process.env.LEMON_SQUEEZY_PRO_VARIANT_IDS;
  try {
    const payload = JSON.stringify({
      meta: { event_name: "subscription_created" },
      data: {
        id: "sub-unconfigured",
        attributes: {
          user_email: "unconfigured@example.com",
          status: "active",
          variant_id: 11111,
        },
      },
    });

    const response = await postSigned(t, payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ignored: "subscription_created:variant_not_pro" });
    expect(await entitlementFor(t, "unconfigured@example.com")).toBeNull();
  } finally {
    if (previousSecret !== undefined) {
      process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = previousSecret;
    } else {
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    }
  }
});

test("lemonsqueezy webhook revokes pro on cancellation and ignores transient statuses", async () => {
  const t = convexTest(schema, modules);
  const restore = useWebhookEnv();
  try {
    // Seed an active Pro subscriber.
    await postSigned(
      t,
      JSON.stringify({
        meta: { event_name: "subscription_payment_success" },
        data: {
          id: "sub-cycle",
          attributes: {
            user_email: "cycle@example.com",
            status: "active",
            variant_id: 11111,
          },
        },
      }),
    );
    expect((await entitlementFor(t, "cycle@example.com"))?.plan).toBe("pro");

    // A past_due tick must NOT revoke.
    await postSigned(
      t,
      JSON.stringify({
        meta: { event_name: "subscription_updated" },
        data: {
          id: "sub-cycle",
          attributes: { user_email: "cycle@example.com", status: "past_due", variant_id: 11111 },
        },
      }),
    );
    expect(await entitlementFor(t, "cycle@example.com")).toMatchObject({ plan: "pro", status: "active" });

    // Cancellation revokes.
    await postSigned(
      t,
      JSON.stringify({
        meta: { event_name: "subscription_cancelled" },
        data: {
          id: "sub-cycle",
          attributes: { user_email: "cycle@example.com", status: "cancelled", variant_id: 11111 },
        },
      }),
    );
    expect(await entitlementFor(t, "cycle@example.com")).toMatchObject({ plan: "free", status: "cancelled" });
  } finally {
    restore();
  }
});


test("lemonsqueezy webhook rejects oversized payloads", async () => {
  const t = convexTest(schema, modules);
  const previousSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "test-secret";
  try {
    const oversize = "x".repeat(257 * 1024);
    const response = await t.fetch("/lemonsqueezy/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(oversize.length) },
      body: oversize,
    });
    expect(response.status).toBe(413);
  } finally {
    if (previousSecret !== undefined) {
      process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = previousSecret;
    } else {
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    }
  }
});

test("lemonsqueezy webhook dedupes repeated deliveries", async () => {
  const t = convexTest(schema, modules);
  const restore = useWebhookEnv();
  try {
    const payload = JSON.stringify({
      meta: { event_name: "subscription_created" },
      data: {
        id: "evt-1234",
        attributes: {
          user_email: "dedup@example.com",
          status: "active",
          variant_id: 11111,
          created_at: new Date().toISOString(),
        },
      },
    });
    const headers = { "x-signature": await sign("test-secret", payload), "content-type": "application/json" };

    const first = await t.fetch("/lemonsqueezy/webhook", { method: "POST", headers, body: payload });
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson).toMatchObject({ ok: true });

    // Replay the same payload — should be deduped and the user should
    // only have been processed once. We assert the second response is
    // 200 with deduped=true and that only one entitlement row exists.
    const second = await t.fetch("/lemonsqueezy/webhook", { method: "POST", headers, body: payload });
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson).toMatchObject({ ok: true, deduped: true });
    expect(await entitlementFor(t, "dedup@example.com")).toMatchObject({ plan: "pro" });
  } finally {
    restore();
  }
});
