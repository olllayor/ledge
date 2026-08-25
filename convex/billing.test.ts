// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { TestConvex } from "convex-test";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function setupUser(
  t: TestConvex<typeof schema>,
  email: string,
): Promise<{ sessionToken: string; userId: Id<"users"> }> {
  const sessionToken = `test-session-${Math.random().toString(36).slice(2)}`;
  return (await t.run(async (ctx) => {
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
    const tokenHash = await sha256(sessionToken);
    await ctx.db.insert("authSessions", {
      userId,
      tokenHash,
      expiresAt: Date.now() + SESSION_TTL_MS,
      createdAt: Date.now(),
    });
    return { sessionToken, userId };
  }))!;
}

function mockOrderResponse(userEmail: string, variantId: number | null = 901) {
  return {
    ok: true,
    json: async () => ({
      data: {
        attributes: {
          status: "paid",
          customer_id: 42,
          user_email: userEmail,
          first_order_item: variantId === null ? undefined : { variant_id: variantId },
        },
      },
    }),
  } as unknown as Response;
}

function mockLicenseResponse(userEmail: string, opts?: { status?: string; variantId?: number | null }) {
  const status = opts?.status ?? "active";
  const variantId = opts?.variantId === undefined ? 901 : opts.variantId;
  return {
    ok: true,
    json: async () => ({
      valid: true,
      license_key: { status, user_email: userEmail },
      meta: {
        customer_id: 42,
        subscription_id: 77,
        ...(variantId === null ? {} : { variant_id: variantId }),
      },
    }),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.LEMON_SQUEEZY_API_KEY = "test-key";
  process.env.LEMON_SQUEEZY_PRO_VARIANT_IDS = "901";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LEMON_SQUEEZY_API_KEY;
  delete process.env.LEMON_SQUEEZY_PRO_VARIANT_IDS;
});

async function planFor(t: TestConvex<typeof schema>, sessionToken: string): Promise<string> {
  const result = (await t.query(api.billing.entitlement, { sessionToken })) as { plan: string };
  return result.plan;
}

test("refreshEntitlements (order ID): rejects an order registered to a different email", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "victim@example.com");
  // The order belongs to someone else — this is the #78 bypass scenario.
  vi.stubGlobal("fetch", vi.fn(async () => mockOrderResponse("attacker-target@example.com")));

  await expect(
    t.action(api.billing.refreshEntitlements, { sessionToken, orderId: "123456" }),
  ).rejects.toThrow("registered to a different account");

  expect(await planFor(t, sessionToken)).toBe("free");
});

test("refreshEntitlements (order ID): upgrades when the order email matches the account", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "owner@example.com");
  vi.stubGlobal("fetch", vi.fn(async () => mockOrderResponse("owner@example.com")));

  await t.action(api.billing.refreshEntitlements, { sessionToken, orderId: "123456" });

  expect(await planFor(t, sessionToken)).toBe("pro");
});

test("refreshEntitlements (order ID): rejects a variant outside the Pro allowlist", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "owner@example.com");
  // Paid order, matching email, but for a different product (e.g. a $1
  // add-on). Must not grant Pro.
  vi.stubGlobal("fetch", vi.fn(async () => mockOrderResponse("owner@example.com", 999)));

  await t.action(api.billing.refreshEntitlements, { sessionToken, orderId: "123456" });

  expect(await planFor(t, sessionToken)).toBe("free");
});

test("refreshEntitlements (order ID): fails closed when Lemon Squeezy omits the buyer email", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "owner@example.com");
  // No user_email in the response: ownership cannot be proven, so the
  // activation must be refused rather than silently skipped.
  vi.stubGlobal("fetch", vi.fn(async () => mockOrderResponse("", 901)));

  await expect(
    t.action(api.billing.refreshEntitlements, { sessionToken, orderId: "123456" }),
  ).rejects.toThrow("ownership cannot be verified");

  expect(await planFor(t, sessionToken)).toBe("free");
});

test("refreshEntitlements (license key): upgrades when key is active and variant is Pro", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "license-owner@example.com");
  vi.stubGlobal("fetch", vi.fn(async () => mockLicenseResponse("license-owner@example.com")));

  const result = await t.action(api.billing.refreshEntitlements, {
    sessionToken,
    licenseKey: "KEY-1234",
  });

  expect(result.active).toBe(true);
  expect(await planFor(t, sessionToken)).toBe("pro");
});

test("refreshEntitlements (license key): refuses an expired or disabled key", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "expired-key@example.com");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => mockLicenseResponse("expired-key@example.com", { status: "expired" })),
  );

  await t.action(api.billing.refreshEntitlements, { sessionToken, licenseKey: "KEY-OLD" });

  expect(await planFor(t, sessionToken)).toBe("free");
});

test("refreshEntitlements (license key): refuses a key for a non-Pro variant", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "wrong-variant@example.com");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => mockLicenseResponse("wrong-variant@example.com", { variantId: 555 })),
  );

  await t.action(api.billing.refreshEntitlements, { sessionToken, licenseKey: "KEY-OTHER-SKU" });

  expect(await planFor(t, sessionToken)).toBe("free");
});
