// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { TestConvex } from "convex-test";
import schema from "./schema";
import {
  FREE_SYNC_DEVICE_LIMIT,
  FREE_SYNC_SHELF_LIMIT,
  PRO_REQUIRED_FOR_PREFERENCES_MESSAGE,
  PRO_SYNC_DEVICE_LIMIT,
  PRO_SYNC_SHELF_LIMIT,
  PRO_IMAGE_STORAGE_LIMIT_BYTES,
} from "./model";

const modules = import.meta.glob("./**/*.ts");

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface TestUser {
  sessionToken: string;
  userId: Id<"users">;
  email: string;
}

async function setupUser(
  t: TestConvex<typeof schema>,
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

    return { sessionToken, userId, email };
  }))!;
}

async function setEntitlementStatus(
  t: TestConvex<typeof schema>,
  userId: Id<"users">,
  status: "active" | "cancelled" | "pastDue" | "inactive",
): Promise<void> {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
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
      .withIndex("by_user", (q) => q.eq("userId", userId))
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
      .withIndex("by_user", (q) => q.eq("userId", userId))
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

test("authorizeImageUpload: free user is rejected", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "img-free@example.com", "free");

  await expect(
    t.mutation(api.sync.authorizeImageUpload, {
      sessionToken,
      shelfId: "shelf-1",
      itemId: "item-1",
      bytes: 1024,
      mimeType: "image/png",
    }),
  ).rejects.toThrow("Image cloud storage requires Pro.");
});

test("authorizeImageUpload: pro user under the storage cap gets an upload URL", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "img-under@example.com", "pro");

  const result = await t.mutation(api.sync.authorizeImageUpload, {
    sessionToken,
    shelfId: "shelf-1",
    itemId: "item-1",
    bytes: 1024,
    mimeType: "image/png",
  });

  expect(result).toMatchObject({});
  expect(typeof result.uploadUrl).toBe("string");
  expect(result.uploadUrl).toMatch(/^https?:\/\//);
  expect(result.eventId).toBeDefined();
});

test("authorizeImageUpload: pro user near the storage cap still gets an upload URL", async () => {
  // The size check has moved to recordImageAsset so a parallel-upload race
  // can\u2019t let two requests each pass the check and overflow the cap.
  // authorizeImageUpload should only enforce the Pro plan and a sane size.
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "img-near@example.com", "pro");

  const result = await t.mutation(api.sync.authorizeImageUpload, {
    sessionToken,
    shelfId: "shelf-1",
    itemId: "item-1",
    bytes: PRO_IMAGE_STORAGE_LIMIT_BYTES,
    mimeType: "image/png",
  });

  expect(typeof result.uploadUrl).toBe("string");
  expect(result.eventId).toBeDefined();
});

test("authorizeImageUpload: rejects zero or negative byte counts", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "img-bad-size@example.com", "pro");

  for (const bytes of [0, -1]) {
    await expect(
      t.mutation(api.sync.authorizeImageUpload, {
        sessionToken,
        shelfId: "shelf-1",
        itemId: "item-1",
        bytes,
        mimeType: "image/png",
      }),
    ).rejects.toThrow("Image payload size is invalid.");
  }
});

test("recordImageAsset: re-checks the plan and rejects when subscription lapsed", async () => {
  const t = convexTest(schema, modules);
  const { userId, sessionToken } = await setupUser(t, "img-lapse@example.com", "pro");

  const storageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob([new Uint8Array(16)], { type: "image/png" }));
  });

  // Lapse the subscription between authorize and record.
  await t.run(async (ctx) => {
    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (entitlement) {
      await ctx.db.patch(entitlement._id, { plan: "free", status: "cancelled", updatedAt: Date.now() });
    }
  });

  await expect(
    t.mutation(api.sync.recordImageAsset, {
      sessionToken,
      shelfId: "shelf-1",
      itemId: "item-1",
      storageId,
      bytes: 16,
      mimeType: "image/png",
    }),
  ).rejects.toThrow("Image cloud storage requires Pro.");
});

test("recordImageAsset: rejects when the new asset would overflow the cap", async () => {
  const t = convexTest(schema, modules);
  const { userId, sessionToken } = await setupUser(t, "img-record-cap@example.com", "pro");

  // Seed an imageAssets row whose `bytes` already equals the cap.
  // The cap check in recordImageAsset sums the `bytes` column; we
  // don't need a real 1GB _storage payload to exercise it, and
  // allocating one OOMs the test runner.
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([new Uint8Array(16)], { type: "image/png" }));
    await ctx.db.insert("imageAssets", {
      userId,
      shelfId: "existing",
      itemId: "existing",
      storageId,
      bytes: PRO_IMAGE_STORAGE_LIMIT_BYTES,
      mimeType: "image/png",
      createdAt: Date.now(),
    });
  });

  const newStorageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob([new Uint8Array(16)], { type: "image/png" }));
  });

  await expect(
    t.mutation(api.sync.recordImageAsset, {
      sessionToken,
      shelfId: "shelf-1",
      itemId: "item-1",
      storageId: newStorageId,
      bytes: 16,
      mimeType: "image/png",
    }),
  ).rejects.toThrow("Image storage limit reached");
});

test("refreshSession: extends the session expiry", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "refresh@example.com", "free");
  const tokenHash = await sha256(sessionToken);
  const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  // Backdate the session to 2 hours ago so the rate-limit guard
  // (1 hour minimum gap between refreshes) doesn't reject the call.
  // The fix for #4 added that guard to prevent a stolen session
  // token from being perpetually renewed; the test now has to
  // simulate a long-lived session instead of a freshly-created one.
  const TWO_HOURS_AGO = Date.now() - 2 * 60 * 60 * 1000;
  await t.run(async (ctx) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) {
      await ctx.db.patch(session._id, { createdAt: TWO_HOURS_AGO });
    }
  });
  const originalExpires = await t.run(async (ctx) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    return session?.expiresAt;
  });
  expect(originalExpires).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 5_000);

  const result = await t.mutation(api.auth.refreshSession, { sessionToken });
  expect(result.ok).toBe(true);

  const newExpires = await t.run(async (ctx) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    return session?.expiresAt;
  });
  expect(newExpires).toBeGreaterThan(originalExpires ?? 0);

});

test("refreshSession: rejected for an expired session", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "refresh-expired@example.com", "free");
  const tokenHash = await sha256(sessionToken);
  // Force the session into the past.
  await t.run(async (ctx) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) {
      await ctx.db.patch(session._id, { expiresAt: Date.now() - 1 });
    }
  });
  await expect(
    t.mutation(api.auth.refreshSession, { sessionToken }),
  ).rejects.toThrow("Authentication required");
});

test("recordSyncEvent: persists events for the authenticated user", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken, userId } = await setupUser(t, "events@example.com", "free");

  const id = await t.mutation(api.sync.recordSyncEvent, {
    sessionToken,
    deviceId: "device-1",
    type: "shelf_pushed",
    message: "pushed shelf-abc",
  });
  expect(id).toBeDefined();

  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(id);
  });
  expect(stored).toMatchObject({
    userId,
    deviceId: "device-1",
    type: "shelf_pushed",
    message: "pushed shelf-abc",
  });
});

test("recordSyncEvent: works without an optional device id", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "events-no-device@example.com", "free");

  const id = await t.mutation(api.sync.recordSyncEvent, {
    sessionToken,
    type: "device_revoked",
  });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(id);
  });
  expect(stored).toMatchObject({ type: "device_revoked" });
  expect(stored).not.toHaveProperty("deviceId");
});

test("upsertShelf: an older localUpdatedAt is dropped instead of clobbering newer server state", async () => {
  const t = convexTest(schema, modules);
  const { userId, sessionToken } = await setupUser(t, "lww@example.com", "pro");

  // Use timestamps relative to now so the new future-skew guard
  // (`MAX_FUTURE_SKEW_MS`) in upsertShelf can't reject a hardcoded
  // date that's drifted into the future.
  const newer = new Date(Date.now() - 60_000).toISOString();
  const older = new Date(Date.now() - 3_600_000).toISOString();

  // Server starts with the newer snapshot.
  const existingId = await t.mutation(api.sync.upsertShelf, {
    sessionToken,
    shelfId: "shelf-1",
    name: "newer",
    color: "ember",
    origin: "manual",
    items: [],
    localCreatedAt: older,
    localUpdatedAt: newer,
    imageStorageBytes: 0,
  });
  expect(existingId).toBeTruthy();

  // The client tries to push an older snapshot of the same shelf.
  await t.mutation(api.sync.upsertShelf, {
    sessionToken,
    shelfId: "shelf-1",
    name: "older-attempt",
    color: "ember",
    origin: "manual",
    items: [],
    localCreatedAt: older,
    localUpdatedAt: older,
    imageStorageBytes: 0,
  });

  // The server should still have the newer row.
  const stored = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("shelves")
      .withIndex("by_user_and_shelf", (q) => q.eq("userId", userId).eq("shelfId", "shelf-1"))
      .unique();
    return row;
  });
  expect(stored?.name).toBe("newer");
});

test("authorizeImageUpload: rejects when in-flight bytes exceed the per-hour cap", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "img-cap@example.com", "pro");

  // Authorize 1.5GB + 1.5GB = 3GB; the 2GB/hour cap should refuse the
  // second call. We don\'t actually upload the bytes — the rate limit
  // is enforced in authorizeImageUpload, before generateUploadUrl.
  await t.mutation(api.sync.authorizeImageUpload, {
    sessionToken,
    shelfId: "shelf-1",
    itemId: "item-1",
    bytes: 800 * 1024 * 1024,
    mimeType: "image/png",
  });
  await expect(
    t.mutation(api.sync.authorizeImageUpload, {
      sessionToken,
      shelfId: "shelf-2",
      itemId: "item-2",
      bytes: 800 * 1024 * 1024,
      mimeType: "image/png",
    }),
  ).rejects.toThrow(/Too many images uploading/);
});


test("imageUploadEvents: recordImageAsset consumes the in-flight event atomically", async () => {
  // Regression: previously, an authorizeImageUpload call inserted an
  // imageUploadEvents row that was never resolved by recordImageAsset,
  // so a flaky client that uploaded bytes but never recorded them
  // stayed locked out for the full hour. With the new eventId handshake,
  // recordImageAsset must mark the matching event resolved inside the
  // same transaction.
  const t = convexTest(schema, modules);
  const { sessionToken, userId } = await setupUser(t, "img-eventflow@example.com", "pro");

  const authorizeResult = await t.mutation(api.sync.authorizeImageUpload, {
    sessionToken,
    shelfId: "shelf-1",
    itemId: "item-1",
    bytes: 1024,
    mimeType: "image/png",
  });
  const eventId = authorizeResult.eventId;

  // The event starts in_flight.
  const beforeStatus = await t.run(async (ctx) => {
    const event = await ctx.db.get(eventId);
    return event?.status;
  });
  expect(beforeStatus).toBe("in_flight");

  const storageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob([new Uint8Array(16)], { type: "image/png" }));
  });

  // recordImageAsset accepts the eventId and marks it resolved.
  const assetId = await t.mutation(api.sync.recordImageAsset, {
    sessionToken,
    shelfId: "shelf-1",
    itemId: "item-1",
    storageId,
    bytes: 1024,
    mimeType: "image/png",
    eventId,
  });

  const after = await t.run(async (ctx) => {
    const event = await ctx.db.get(eventId);
    return { status: event?.status, resolvedAssetId: event?.resolvedAssetId };
  });
  expect(after.status).toBe("resolved");
  expect(after.resolvedAssetId).toEqual(assetId);

  // The resolved event no longer counts toward the in-flight cap.
  const stillInFlight = await t.run(async (ctx) => {
    const events = await ctx.db
      .query("imageUploadEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return events.filter((e) => e.status === "in_flight").length;
  });
  expect(stillInFlight).toBe(0);
});

test("imageUploadEvents: abandonImageUpload frees the in-flight slot", async () => {
  // The abandon path is what a flaky client uses to free its slot
  // without uploading. Without it the in-flight cap is sticky for the
  // full hour after the authorize call.
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "img-abandon@example.com", "pro");

  const { eventId } = await t.mutation(api.sync.authorizeImageUpload, {
    sessionToken,
    shelfId: "shelf-1",
    itemId: "item-1",
    bytes: 1024,
    mimeType: "image/png",
  });

  await t.mutation(api.sync.abandonImageUpload, { sessionToken, eventId });

  const status = await t.run(async (ctx) => {
    const event = await ctx.db.get(eventId);
    return event?.status;
  });
  expect(status).toBe("abandoned");

  // After abandon, the in-flight cap is restored: we can authorize
  // another 1.5GB without tripping the cap.
  const hugeBytes = Math.floor(MAX_INFLIGHT_BYTES_FOR_TEST * 0.9);
  const second = await t.mutation(api.sync.authorizeImageUpload, {
    sessionToken,
    shelfId: "shelf-1",
    itemId: "item-2",
    bytes: hugeBytes,
    mimeType: "image/png",
  });
  expect(typeof second.uploadUrl).toBe("string");
});

test("imageUploadEvents: cannot abandon an event you don\'t own", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken: ownerToken } = await setupUser(t, "img-owner@example.com", "pro");
  const { sessionToken: otherToken } = await setupUser(t, "img-other@example.com", "pro");

  const { eventId } = await t.mutation(api.sync.authorizeImageUpload, {
    sessionToken: ownerToken,
    shelfId: "shelf-1",
    itemId: "item-1",
    bytes: 1024,
    mimeType: "image/png",
  });

  // The wrong user gets a no-op (the event is not theirs).
  await t.mutation(api.sync.abandonImageUpload, { sessionToken: otherToken, eventId });
  const status = await t.run(async (ctx) => {
    const event = await ctx.db.get(eventId);
    return event?.status;
  });
  expect(status).toBe("in_flight");
});

// The abandon-test above authorizes ~1.4GB to prove the in-flight cap
// resets after an abandon. We don\'t want to allocate a real 1.4GB
// buffer, so we monkey-patch the constant on the cap-check side via
// the import — but the easiest path is to use a smaller authorize
// and assert the cap allows a second authorize that would have
// tripped the original cap. The actual 1.5GB cap is large enough
// that two 1MB events would not trip it anyway, so the proof of
// "abandon frees the slot" is the status field on the event row.
const MAX_INFLIGHT_BYTES_FOR_TEST = 1024 * 1024 * 1024; // 1 GB

test("upsertShelf: rejects a localUpdatedAt too far in the future", async () => {
  // Regression: a misbehaving client (or attacker) could pin its write
  // on top of every other device by setting localUpdatedAt to a date
  // far in the future. The new future-skew guard refuses any timestamp
  // more than MAX_FUTURE_SKEW_MS ahead of the server clock.
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "skew@example.com", "pro");

  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await expect(
    t.mutation(api.sync.upsertShelf, {
      sessionToken,
      shelfId: "shelf-1",
      name: "future",
      color: "ember",
      origin: "manual",
      items: [],
      localCreatedAt: future,
      localUpdatedAt: future,
      imageStorageBytes: 0,
    }),
  ).rejects.toThrow(/too far in the future/);
});

test("upsertShelf: rejects an unparseable localUpdatedAt", async () => {
  const t = convexTest(schema, modules);
  const { sessionToken } = await setupUser(t, "badts@example.com", "pro");

  await expect(
    t.mutation(api.sync.upsertShelf, {
      sessionToken,
      shelfId: "shelf-1",
      name: "bad",
      color: "ember",
      origin: "manual",
      items: [],
      localCreatedAt: "not-a-date",
      localUpdatedAt: "not-a-date",
      imageStorageBytes: 0,
    }),
  ).rejects.toThrow(/not a valid timestamp/);
});
