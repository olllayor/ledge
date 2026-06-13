import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { shelfItemSchema } from "./sharedSchemas";

const preferencesValues = v.object({
  launchAtLogin: v.boolean(),
  shakeEnabled: v.boolean(),
  shakeSensitivity: v.union(v.literal("gentle"), v.literal("balanced"), v.literal("firm")),
  excludedBundleIds: v.array(v.string()),
  globalShortcut: v.string(),
  hasSeenShelfLimitMigration: v.boolean(),
});

export default defineSchema({
  users: defineTable({
    email: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_email", ["email"]),

  authOtps: defineTable({
    email: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    failedAttempts: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    // Composite index used by `verifyOtp` to look up the exact OTP row
    // the user is trying to consume, instead of "the newest row for this
    // email". `codeHash` includes the email salt (see `sha256(`${email}:${code}`)`),
    // so the lookup is unique in practice.
    .index("by_email_and_code_hash", ["email", "codeHash"]),

  authSessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_token_hash", ["tokenHash"]),

  devices: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    name: v.string(),
    platform: v.string(),
    lastSeenAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_device", ["userId", "deviceId"]),

  shelves: defineTable({
    userId: v.id("users"),
    shelfId: v.string(),
    name: v.string(),
    color: v.union(v.literal("ember"), v.literal("wave"), v.literal("forest"), v.literal("sand")),
    origin: v.union(
      v.literal("shake"),
      v.literal("tray"),
      v.literal("shortcut"),
      v.literal("manual"),
      v.literal("restore"),
    ),
    items: v.array(shelfItemSchema),
    localCreatedAt: v.string(),
    localUpdatedAt: v.string(),
    itemCount: v.number(),
    imageStorageBytes: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_shelf", ["userId", "shelfId"])
    .index("by_user_and_updated", ["userId", "updatedAt"]),

  preferences: defineTable({
    userId: v.id("users"),
    values: preferencesValues,
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  entitlements: defineTable({
    userId: v.id("users"),
    plan: v.union(v.literal("free"), v.literal("pro")),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("pastDue"), v.literal("cancelled")),
    lemonSqueezyCustomerId: v.optional(v.string()),
    lemonSqueezySubscriptionId: v.optional(v.string()),
    lemonSqueezyOrderId: v.optional(v.string()),
    lemonSqueezyLicenseKey: v.optional(v.string()),
    renewsAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  imageAssets: defineTable({
    userId: v.id("users"),
    shelfId: v.string(),
    itemId: v.string(),
    storageId: v.id("_storage"),
    bytes: v.number(),
    mimeType: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_shelf", ["userId", "shelfId"]),

  syncEvents: defineTable({
    userId: v.id("users"),
    deviceId: v.optional(v.string()),
    type: v.string(),
    message: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_created", ["userId", "createdAt"]),

  imageUploadEvents: defineTable({
    userId: v.id("users"),
    bytes: v.number(),
    createdAt: v.number(),
    // `in_flight` rows count toward the 1.5GB/hour cap; `resolved` and
    // `abandoned` rows are kept for telemetry but no longer count, so a
    // flaky client that uploads-then-never-records stops blocking itself
    // as soon as it explicitly abandons the upload.
    status: v.union(
      v.literal("in_flight"),
      v.literal("resolved"),
      v.literal("abandoned"),
    ),
    // When a matching recordImageAsset lands we tag the row with the
    // resulting imageAsset id. Lets us prove the in-flight event ever
    // resolved and skip deletion in the cron.
    resolvedAssetId: v.optional(v.id("imageAssets")),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_created", ["userId", "createdAt"])
    // Lets us look up the specific event when the client calls
    // recordImageAsset or abandonImageUpload with the id we returned
    // from authorizeImageUpload.
    .index("by_user_and_status", ["userId", "status"]),

  // Dedupe key for inbound billing webhooks. We persist the Lemon Squeezy
  // event id (or a synthetic id derived from subscription id + status) so
  // a replayed event is a no-op rather than re-applying an entitlement
  // and possibly reverting a cancellation.
  processedWebhookEvents: defineTable({
    eventId: v.string(),
    source: v.string(),
    processedAt: v.number(),
  })
    .index("by_event", ["source", "eventId"])
    .index("by_processed_at", ["processedAt"]),
});
