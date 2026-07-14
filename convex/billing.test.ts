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

function mockOrderResponse(userEmail: string) {
  return {
    ok: true,
    json: async () => ({
      data: { attributes: { status: "paid", customer_id: 42, user_email: userEmail } },
    }),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.LEMON_SQUEEZY_API_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LEMON_SQUEEZY_API_KEY;
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
