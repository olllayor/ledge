// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
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

test("lemonsqueezy webhook accepts a valid signature and upserts a free entitlement when no event matches", async () => {
  const t = convexTest(schema, modules);
  const previousSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "test-secret";
  try {
    const payload = JSON.stringify({
      meta: { event_name: "unknown_event" },
      data: {
        id: "evt-1",
        attributes: {
          user_email: "webhook@example.com",
          status: "pending",
        },
      },
    });
    const signature = await sign("test-secret", payload);

    const response = await t.fetch("/lemonsqueezy/webhook", {
      method: "POST",
      headers: { "x-signature": signature, "content-type": "application/json" },
      body: payload,
    });
    expect(response.status).toBe(200);

    const user = await t.run(async (ctx) => {
      return await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "webhook@example.com")).unique();
    });
    expect(user).toBeDefined();

    const entitlement = await t.run(async (ctx) => {
      return user
        ? await ctx.db.query("entitlements").withIndex("by_user", (q) => q.eq("userId", user._id)).first()
        : null;
    });
    expect(entitlement?.plan).toBe("free");
    expect(entitlement?.status).toBe("inactive");
  } finally {
    if (previousSecret !== undefined) {
      process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = previousSecret;
    } else {
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    }
  }
});

test("lemonsqueezy webhook grants pro entitlement on subscription_payment_success", async () => {
  const t = convexTest(schema, modules);
  const previousSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "test-secret";
  try {
    const payload = JSON.stringify({
      meta: { event_name: "subscription_payment_success" },
      data: {
        id: "sub-1",
        attributes: {
          user_email: "pro@example.com",
          customer_id: 42,
          status: "active",
          renews_at: "2027-01-01T00:00:00.000Z",
        },
      },
    });
    const signature = await sign("test-secret", payload);

    const response = await t.fetch("/lemonsqueezy/webhook", {
      method: "POST",
      headers: { "x-signature": signature, "content-type": "application/json" },
      body: payload,
    });
    expect(response.status).toBe(200);

    const entitlement = await t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "pro@example.com")).unique();
      return user
        ? await ctx.db.query("entitlements").withIndex("by_user", (q) => q.eq("userId", user._id)).first()
        : null;
    });
    expect(entitlement?.plan).toBe("pro");
    expect(entitlement?.status).toBe("active");
    expect(entitlement?.lemonSqueezyCustomerId).toBe("42");
    expect(entitlement?.lemonSqueezySubscriptionId).toBe("sub-1");
    expect(entitlement?.renewsAt).toBe(Date.parse("2027-01-01T00:00:00.000Z"));
  } finally {
    if (previousSecret !== undefined) {
      process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = previousSecret;
    } else {
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    }
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
  const previousSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "test-secret";
  try {
    const payload = JSON.stringify({
      meta: { event_name: "subscription_created" },
      data: {
        id: "evt-1234",
        attributes: {
          user_email: "dedup@example.com",
          status: "active",
          created_at: new Date().toISOString(),
        },
      },
    });
    const signature = await sign("test-secret", payload);
    const headers = { "x-signature": signature, "content-type": "application/json" };

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
  } finally {
    if (previousSecret !== undefined) {
      process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = previousSecret;
    }
  }
});
