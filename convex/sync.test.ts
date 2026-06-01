// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import {
  FREE_SYNC_DEVICE_LIMIT,
  FREE_SYNC_SHELF_LIMIT,
  PRO_REQUIRED_FOR_PREFERENCES_MESSAGE,
  PRO_SYNC_DEVICE_LIMIT,
  PRO_SYNC_SHELF_LIMIT,
} from "./model";

const modules = import.meta.glob("./**/*.ts");

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface TestUser {
  sessionToken: string;
  userId: string;
  email: string;
}

async function setupUser(
  t: ReturnType<typeof convexTest>,
  email = "user@example.com",
  plan: "free" | "pro" = "free",
): Promise<TestUser> {
  const sessionToken = `test-session-${Math.random().toString(36).slice(2)}`;

  return (await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("entitlements", {
      userId,
      plan,
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

    return { sessionToken, userId: userId as string, email };
  }))!;
}

async function setEntitlementStatus(
  t: ReturnType<typeof convexTest>,
  userId: string,
  status: "active" | "cancelled" | "pastDue" | "inactive",
): Promise<void> {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { status, updatedAt: Date.now() });
    }
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const basePreferences = {
  launchAtLogin: false,
  shakeEnabled: true,
  shakeSensitivity: "balanced" as const,
  excludedBundleIds: [] as string[],
  globalShortcut: "CommandOrControl+Shift+Space",
  hasSeenShelfLimitMigration: false,
};

test("FREE_SYNC_SHELF_LIMIT is 100", () => {
  expect(FREE_SYNC_SHELF_LIMIT).toBe(100);
});

test("FREE_SYNC_DEVICE_LIMIT is 1", () => {
  expect(FREE_SYNC_DEVICE_LIMIT).toBe(1);
});

test("PRO_SYNC_SHELF_LIMIT is 500", () => {
  expect(PRO_SYNC_SHELF_LIMIT).toBe(500);
});

test("PRO_SYNC_DEVICE_LIMIT is 3", () => {
  expect(PRO_SYNC_DEVICE_LIMIT).toBe(3);
});

test("patchPreferences: free user is rejected with exact Pro message", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "free@example.com", "free");

  await expect(
    t.mutation(api.sync.patchPreferences, {
      sessionToken,
      values: basePreferences,
    }),
  ).rejects.toThrow(PRO_REQUIRED_FOR_PREFERENCES_MESSAGE);
});

test("patchPreferences: pro user succeeds and persists preferences", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken, userId } = await setupUser(t, "pro@example.com", "pro");

  await t.mutation(api.sync.patchPreferences, {
    sessionToken,
    values: {
      ...basePreferences,
      launchAtLogin: true,
      shakeEnabled: false,
      shakeSensitivity: "firm",
      excludedBundleIds: ["com.apple.Safari"],
      globalShortcut: "CommandOrControl+Alt+Space",
    },
  });

  const stored = await t.run(async (ctx) => {
    const prefs = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .unique();
    return prefs?.values;
  });
  expect(stored).toMatchObject({
    launchAtLogin: true,
    shakeEnabled: false,
    shakeSensitivity: "firm",
    excludedBundleIds: ["com.apple.Safari"],
    globalShortcut: "CommandOrControl+Alt+Space",
  });
});

test("patchPreferences: cancelled entitlement falls back to free and is rejected", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken, userId } = await setupUser(t, "cancelled@example.com", "pro");
  await setEntitlementStatus(t, userId, "cancelled");

  await expect(
    t.mutation(api.sync.patchPreferences, {
      sessionToken,
      values: basePreferences,
    }),
  ).rejects.toThrow(PRO_REQUIRED_FOR_PREFERENCES_MESSAGE);
});

test("patchPreferences: pastDue entitlement is treated as free and rejected", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken, userId } = await setupUser(t, "pastdue@example.com", "pro");
  await setEntitlementStatus(t, userId, "pastDue");

  await expect(
    t.mutation(api.sync.patchPreferences, {
      sessionToken,
      values: basePreferences,
    }),
  ).rejects.toThrow(PRO_REQUIRED_FOR_PREFERENCES_MESSAGE);
});

test("patchPreferences: inactive entitlement is rejected", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken, userId } = await setupUser(t, "inactive@example.com", "pro");
  await setEntitlementStatus(t, userId, "inactive");

  await expect(
    t.mutation(api.sync.patchPreferences, {
      sessionToken,
      values: basePreferences,
    }),
  ).rejects.toThrow(PRO_REQUIRED_FOR_PREFERENCES_MESSAGE);
});

test("patchPreferences: revoked session is rejected (auth precedes plan check)", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "revoked@example.com", "pro");

  const tokenHash = await sha256(sessionToken);
  await t.run(async (ctx) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) {
      await ctx.db.patch(session._id, { revokedAt: Date.now() });
    }
  });

  await expect(
    t.mutation(api.sync.patchPreferences, {
      sessionToken,
      values: basePreferences,
    }),
  ).rejects.toThrow("Authentication required");
});

test("overview reflects plan changes immediately (stale-cache safety)", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken, userId } = await setupUser(t, "flip@example.com", "free");

  const freeOverview = await t.query(api.sync.overview, { sessionToken });
  expect(freeOverview.plan).toBe("free");
  expect(freeOverview.shelfLimit).toBe(FREE_SYNC_SHELF_LIMIT);
  expect(freeOverview.deviceLimit).toBe(FREE_SYNC_DEVICE_LIMIT);

  await t.run(async (ctx) => {
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .first();
    if (entitlement) {
      await ctx.db.patch(entitlement._id, { plan: "pro", status: "active", updatedAt: Date.now() });
    }
  });

  const proOverview = await t.query(api.sync.overview, { sessionToken });
  expect(proOverview.plan).toBe("pro");
  expect(proOverview.shelfLimit).toBe(PRO_SYNC_SHELF_LIMIT);
  expect(proOverview.deviceLimit).toBe(PRO_SYNC_DEVICE_LIMIT);
});

test("upsertShelf: free user is capped at FREE_SYNC_SHELF_LIMIT", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "shelf-cap@example.com", "free");

  for (let i = 0; i < FREE_SYNC_SHELF_LIMIT; i++) {
    await t.mutation(api.sync.upsertShelf, {
      sessionToken,
      shelfId: `shelf-${i}`,
      name: `Shelf ${i}`,
      color: "ember",
      origin: "manual",
      items: [],
      localCreatedAt: new Date().toISOString(),
      localUpdatedAt: new Date().toISOString(),
      imageStorageBytes: 0,
    });
  }

  await expect(
    t.mutation(api.sync.upsertShelf, {
      sessionToken,
      shelfId: `shelf-${FREE_SYNC_SHELF_LIMIT}`,
      name: "Over limit",
      color: "ember",
      origin: "manual",
      items: [],
      localCreatedAt: new Date().toISOString(),
      localUpdatedAt: new Date().toISOString(),
      imageStorageBytes: 0,
    }),
  ).rejects.toThrow("Cloud shelf limit reached");
});

test("registerDevice: free user is capped at FREE_SYNC_DEVICE_LIMIT", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "device-cap@example.com", "free");

  await t.mutation(api.sync.registerDevice, {
    sessionToken,
    deviceId: "device-1",
    name: "Mac",
    platform: "macOS",
  });

  await expect(
    t.mutation(api.sync.registerDevice, {
      sessionToken,
      deviceId: "device-2",
      name: "Mac",
      platform: "macOS",
    }),
  ).rejects.toThrow("Device sync limit reached");
});
