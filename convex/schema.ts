import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    createdAt: v.number(),
  }).index("by_email", ["email"]),

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
    items: v.array(v.any()),
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
    values: v.any(),
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
});
