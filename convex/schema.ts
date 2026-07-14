import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { shelfItemSchema, preferencesValues } from "./sharedSchemas";

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
    .index("by_email_and_code_hash", ["email", "codeHash"])
    // Used by `verifyOtp` to find the most recent unconsumed OTP for a
    // given email when the user enters a wrong code (so we can bump
    // `failedAttempts` on the row they were actually trying to consume,
    // not whichever row was newest). Ordered DESC at the call site.
    .index("by_email_and_createdAt", ["email", "createdAt"])
    // Cleanup cron: deletes any row whose `expiresAt` is in the past
    // (consumed or not). Indexing by `expiresAt` keeps the take()
    // bounded to expired candidates.
    .index("by_expiresAt", ["expiresAt"])
    // Lets the cleanup cron pick up consumed-but-not-yet-expired
    // OTPs in O(rows-with-consumedAt) time.
    .index("by_consumedAt", ["consumedAt"]),

  authSessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    // Wall-clock time of the most recent successful `refreshSession`
    // call against this session. Optional so existing rows (pre-fix)
    // continue to validate; the refresh handler treats `undefined` as
    // "never refreshed", which always allows a first refresh.
    lastRefreshedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    // The cleanup cron deletes any session whose `expiresAt` is in the
    // past or whose `revokedAt` is set. Indexing by `expiresAt` makes
    // the take() bounded to candidates, not "the first 100 ever
    // created" — otherwise an active session created recently would
    // starve an older expired one.
    .index("by_expiresAt", ["expiresAt"])
    // Lets the cleanup cron pick up revoked-but-not-yet-expired
    // sessions in O(rows-with-revokedAt) time. Without this index
    // the cron would have to scan the whole table.
    .index("by_revokedAt", ["revokedAt"]),

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
    itemsMigratedAt: v.optional(v.number()),
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

  // Phase 1: Per-item shelf storage for team-ready sync.
  // - teamId: empty string "" for personal shelves, actual team ID for team shelves.
  //   Convex cannot index on null, so we use "" as sentinel.
  // - order: v.string() for lexorank (fractional-indexing) to avoid conflict storms
  //   on reorder. NOT v.number().
  // - version + serverUpdatedAt for LWW. NOT localUpdatedAt (client timestamps untrusted).
  // - deletedAt for soft-delete tombstones.
  shelfItems: defineTable({
    shelfId: v.string(),
    teamId: v.string(),
    itemId: v.string(),
    createdBy: v.id("users"),
    updatedBy: v.optional(v.id("users")),
    kind: v.union(
      v.literal("file"),
      v.literal("folder"),
      v.literal("imageAsset"),
      v.literal("text"),
      v.literal("url"),
      v.literal("color"),
      v.literal("code"),
    ),
    title: v.string(),
    subtitle: v.string(),
    preview: v.object({
      summary: v.string(),
      detail: v.string(),
    }),
    order: v.string(),
    file: v.optional(v.object({
      originalPath: v.string(),
      resolvedPath: v.string(),
      isStale: v.boolean(),
      isMissing: v.boolean(),
    })),
    mimeType: v.optional(v.string()),
    text: v.optional(v.string()),
    savedFilePath: v.optional(v.string()),
    url: v.optional(v.string()),
    cloudStorageId: v.optional(v.string()),
    cloudStorageBytes: v.optional(v.number()),
    hex: v.optional(v.string()),
    name: v.optional(v.string()),
    codeText: v.optional(v.string()),
    language: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    storageBytes: v.optional(v.number()),
    localUpdatedAt: v.optional(v.string()),
    version: v.number(),
    serverUpdatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    migratedAt: v.optional(v.number()),
  })
    .index("by_team_shelf", ["teamId", "shelfId"])
    .index("by_team_shelf_updated", ["teamId", "shelfId", "serverUpdatedAt"])
    .index("by_team_shelf_item", ["teamId", "shelfId", "itemId"])
    .index("by_migrated", ["migratedAt"]),

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
    .index("by_user_and_status", ["userId", "status"])
    // Cleanup cron: deletes events older than 24h. Indexing by
    // `createdAt` keeps the take() bounded to old candidates.
    .index("by_createdAt", ["createdAt"]),

  // Phase 2: Team collaboration tables.
  // - teamId joins teams, team_members, team_invitations, and scopes shelfItems.
  // - team_members.role controls permissions (admin vs member).

  teams: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_created_by", ["createdBy"]),

  teamMembers: defineTable({
    teamId: v.id("teams"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_user", ["userId"])
    .index("by_team_and_user", ["teamId", "userId"]),

  teamInvitations: defineTable({
    teamId: v.id("teams"),
    email: v.string(),
    invitedBy: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
    token: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("revoked"),
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_team", ["teamId"])
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_email_and_status", ["email", "status"]),

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
