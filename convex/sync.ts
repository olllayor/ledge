import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import {
  currentPlan,
  deviceLimitForPlan,
  PRO_IMAGE_STORAGE_LIMIT_BYTES,
  PRO_REQUIRED_FOR_PREFERENCES_MESSAGE,
  requireUser,
  sessionArgs,
  shelfLimitForPlan,
  storageBytesUsed,
} from "./model";
import { shelfItemSchema, preferencesValues } from "./sharedSchemas";

const PERSONAL = "";

const shelfPayload = {
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
  imageStorageBytes: v.number(),
};

interface ShelfItemMeta {
  shelfId: string;
  teamId: string;
  userId: string;
  version: number;
  serverUpdatedAt: number;
  migratedAt?: number;
}

function itemToShelfItemRow(item: Record<string, unknown>, meta: ShelfItemMeta): Record<string, unknown> {
  const base: Record<string, unknown> = {
    shelfId: meta.shelfId,
    teamId: meta.teamId,
    itemId: item.id,
    createdBy: meta.userId,
    updatedBy: meta.userId,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    preview: item.preview,
    order: item.order,
    version: meta.version,
    serverUpdatedAt: meta.serverUpdatedAt,
    deletedAt: undefined,
    localUpdatedAt: item.createdAt,
  };
  if (meta.migratedAt !== undefined) {
    base.migratedAt = meta.migratedAt;
  }

  switch (item.kind) {
    case "file":
      return { ...base, file: item.file, mimeType: item.mimeType };
    case "folder":
      return { ...base, file: item.file };
    case "imageAsset":
      return { ...base, file: item.file, mimeType: item.mimeType };
    case "text":
      return { ...base, text: item.text, savedFilePath: item.savedFilePath };
    case "url":
      return { ...base, url: item.url, savedFilePath: item.savedFilePath };
    case "color":
      return { ...base, hex: item.hex, name: item.name };
    case "code":
      return { ...base, codeText: item.text, language: item.language };
    default:
      return base;
  }
}

export const overview = query({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const plan = await currentPlan(ctx, userId);
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const shelves = await ctx.db
      .query("shelves")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const storage = await storageBytesUsed(ctx, userId);

    return {
      plan,
      deviceCount: devices.length,
      deviceLimit: deviceLimitForPlan(plan),
      syncedShelfCount: shelves.length,
      shelfLimit: shelfLimitForPlan(plan),
      storageBytesUsed: storage,
      storageBytesLimit: plan === "pro" ? PRO_IMAGE_STORAGE_LIMIT_BYTES : 0,
    };
  },
});

export const listShelves = query({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    return await ctx.db
      .query("shelves")
      .withIndex("by_user_and_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(500);
  },
});

export const registerDevice = mutation({
  args: {
    ...sessionArgs,
    deviceId: v.string(),
    name: v.string(),
    platform: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const plan = await currentPlan(ctx, userId);
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_user_and_device", (q) => q.eq("userId", userId).eq("deviceId", args.deviceId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        platform: args.platform,
        lastSeenAt: Date.now(),
      });
      return existing._id;
    }

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (devices.length >= deviceLimitForPlan(plan)) {
      throw new ConvexError("Device sync limit reached for this plan.");
    }

    return await ctx.db.insert("devices", {
      userId,
      deviceId: args.deviceId,
      name: args.name,
      platform: args.platform,
      lastSeenAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const upsertShelf = mutation({
  args: {
    ...sessionArgs,
    ...shelfPayload,
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const plan = await currentPlan(ctx, userId);
    const existing = await ctx.db
      .query("shelves")
      .withIndex("by_user_and_shelf", (q) => q.eq("userId", userId).eq("shelfId", args.shelfId))
      .unique();

    if (!existing) {
      const shelves = await ctx.db
        .query("shelves")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      if (shelves.length >= shelfLimitForPlan(plan)) {
        throw new ConvexError("Cloud shelf limit reached for this plan.");
      }
    }

    // Validate the client-supplied timestamp up front, before either the
    // insert or the patch path. The previous version only validated
    // inside the `if (existing)` branch, so an attacker could create a
    // new shelf with a poisoned `localUpdatedAt` and never trip the
    // guard. See the `upsertShelf` test for the future-skew case.
    const incoming = Date.parse(args.localUpdatedAt);
    if (!Number.isFinite(incoming)) {
      throw new ConvexError("Shelf localUpdatedAt is not a valid timestamp.");
    }
    const serverNow = Date.now();
    if (incoming - serverNow > MAX_FUTURE_SKEW_MS) {
      throw new ConvexError("Shelf localUpdatedAt is too far in the future.");
    }
    const clampedLocalUpdatedAt = new Date(Math.min(incoming, serverNow)).toISOString();

    const next = {
      name: args.name,
      color: args.color,
      origin: args.origin,
      items: args.items,
      localCreatedAt: args.localCreatedAt,
      localUpdatedAt: clampedLocalUpdatedAt,
      itemCount: args.items.length,
      imageStorageBytes: Math.max(0, args.imageStorageBytes),
      updatedAt: serverNow,
    };

    if (existing) {
      // Last-write-wins by `localUpdatedAt`. The previous version of
      // this check trusted the client timestamp absolutely, so a
      // device that pushed a `9999-12-31...` timestamp would pin its
      // write on top of every future legitimate update. The skew
      // validation above makes that impossible.
      const existingAt = Date.parse(existing.localUpdatedAt);
      if (Number.isFinite(existingAt) && incoming < existingAt) {
        // Slower device is replaying an older snapshot. Keep the
        // server's copy; the slower device will pick it up on its
        // next listShelves poll and re-apply.
        return existing._id;
      }
      await ctx.db.patch(existing._id, next);

      // Dual-write: backfill new items into shelfItems for migration. Only
      // insert items that don't already have a row (existing items already
      // tracked via per-item mutations). Phase 2 will remove the items array
      // and switch reads exclusively to shelfItems.
      for (const item of args.items) {
        const existingItem = await ctx.db
          .query("shelfItems")
          .withIndex("by_team_shelf_item", (q) =>
            q.eq("teamId", PERSONAL).eq("shelfId", args.shelfId).eq("itemId", item.id),
          )
          .unique();
        if (!existingItem) {
          await ctx.db.insert("shelfItems", itemToShelfItemRow(item, {
            shelfId: args.shelfId,
            teamId: PERSONAL,
            userId,
            version: 1,
            serverUpdatedAt: serverNow,
          }) as any);
        }
      }

      return existing._id;
    }

    const shelfId = await ctx.db.insert("shelves", {
      userId,
      shelfId: args.shelfId,
      ...next,
      createdAt: serverNow,
    });

    // Dual-write all items to shelfItems (new shelf, all items are fresh).
    const serverNowDedup = serverNow;
    for (const item of args.items) {
      await ctx.db.insert("shelfItems", itemToShelfItemRow(item, {
        shelfId: args.shelfId,
        teamId: PERSONAL,
        userId,
        version: 1,
        serverUpdatedAt: serverNowDedup,
      }) as any);
    }

    return shelfId;
  },
});

// Reclaim all cloud storage for a shelf the user permanently discarded on
// a device. Without this, `shelves` and `imageAssets` rows accumulate
// forever (Ledge is a transient-shelf workflow), eventually tripping the
// per-plan shelf cap in `upsertShelf` and the image-storage cap even
// though the user's live state uses a fraction of it.
//
// Safe across devices: a shelf still present on another device is
// re-created by that device's next `upsertShelf`, so deleting here only
// sticks when no device references the shelf anymore.
export const deleteShelf = mutation({
  args: {
    ...sessionArgs,
    shelfId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);

    const shelf = await ctx.db
      .query("shelves")
      .withIndex("by_user_and_shelf", (q) => q.eq("userId", userId).eq("shelfId", args.shelfId))
      .unique();
    if (shelf) {
      await ctx.db.delete(shelf._id);
    }

    // Delete image assets and their underlying _storage blobs so the
    // per-user storage cap (storageBytesUsed) is actually reclaimed.
    const assets = await ctx.db
      .query("imageAssets")
      .withIndex("by_user_and_shelf", (q) => q.eq("userId", userId).eq("shelfId", args.shelfId))
      .collect();
    for (const asset of assets) {
      await ctx.storage.delete(asset.storageId);
      await ctx.db.delete(asset._id);
    }

    // Remove per-item rows for the personal copy of this shelf.
    const items = await ctx.db
      .query("shelfItems")
      .withIndex("by_team_shelf_item", (q) =>
        q.eq("teamId", PERSONAL).eq("shelfId", args.shelfId),
      )
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    return { deleted: shelf !== null, assetsDeleted: assets.length };
  },
});

export const patchPreferences = mutation({
  args: {
    ...sessionArgs,
    values: preferencesValues,
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const plan = await currentPlan(ctx, userId);
    if (plan !== "pro") {
      throw new ConvexError(PRO_REQUIRED_FOR_PREFERENCES_MESSAGE);
    }
    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { values: args.values, updatedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("preferences", {
      userId,
      values: args.values,
      updatedAt: Date.now(),
    });
  },
});

// Cap how many bytes a single user can put in flight (upload URLs issued
// but never recorded) in a rolling hour. Without this, a Pro user with
// a valid session could request thousands of upload URLs, push bytes
// into Convex storage, and never call recordImageAsset — paying the
// _storage bill without ever recording against the per-user cap.
const MAX_INFLIGHT_UPLOAD_BYTES_PER_HOUR = 1500 * 1024 * 1024; // 1.5GB

// Maximum allowed clock skew between the client and server. If a client
// claims a localUpdatedAt more than this far ahead of the server clock,
// it is either misconfigured (bad wall clock) or actively trying to pin
// its write on top of every other device. Refuse in either case.
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export const authorizeImageUpload = mutation({
  args: {
    ...sessionArgs,
    shelfId: v.string(),
    itemId: v.string(),
    bytes: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    // Plan check only. The size check is deferred to recordImageAsset so the
    // read and the insert happen in a single atomic transaction. Doing both
    // checks here would let two parallel uploads each pass the check, then
    // both insert and overflow the per-user storage cap.
    const userId = await requireUser(ctx, args.sessionToken);
    const plan = await currentPlan(ctx, userId);
    if (plan !== "pro") {
      throw new ConvexError("Image cloud storage requires Pro.");
    }

    if (args.bytes <= 0 || args.bytes > PRO_IMAGE_STORAGE_LIMIT_BYTES) {
      throw new ConvexError("Image payload size is invalid.");
    }

    // Sum the bytes from upload events the client still has "in flight".
    // An event is in-flight until the client either calls
    // `recordImageAsset` (success) or `abandonImageUpload` (failure /
    // give up). Without that distinction, a flaky client that uploads
    // bytes but never resolves them used to be blocked for the full
    // hour; with it, the client can fail fast and free the slot.
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = await ctx.db
      .query("imageUploadEvents")
      .withIndex("by_user_and_created", (q) =>
        q.eq("userId", userId).gt("createdAt", oneHourAgo),
      )
      .collect();
    const inFlight = recent
      .filter((event) => event.status === "in_flight")
      .reduce((sum, event) => sum + event.bytes, 0);
    if (inFlight + args.bytes > MAX_INFLIGHT_UPLOAD_BYTES_PER_HOUR) {
      throw new ConvexError(
        "Too many images uploading at once. Please wait for previous uploads to finish.",
      );
    }

    const eventId = await ctx.db.insert("imageUploadEvents", {
      userId,
      bytes: args.bytes,
      createdAt: Date.now(),
      status: "in_flight",
    });

    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      eventId,
    };
  },
});

export const abandonImageUpload = mutation({
  args: {
    ...sessionArgs,
    eventId: v.id("imageUploadEvents"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const event = await ctx.db.get(args.eventId);
    if (!event || event.userId !== userId) {
      return { ok: false };
    }
    if (event.status !== "in_flight") {
      // Idempotent: a resolved event can't be abandoned.
      return { ok: true };
    }
    await ctx.db.patch(event._id, { status: "abandoned" });
    return { ok: true };
  },
});

export const recordImageAsset = mutation({
  args: {
    ...sessionArgs,
    shelfId: v.string(),
    itemId: v.string(),
    storageId: v.id("_storage"),
    bytes: v.number(),
    mimeType: v.string(),
    // Optional: when the client got here via authorizeImageUpload, pass
    // back the eventId we returned so we can mark the in-flight event
    // resolved in the same transaction. Older clients may not pass it.
    eventId: v.optional(v.id("imageUploadEvents")),
  },
  handler: async (ctx, args) => {
    // Re-check the plan and the storage cap atomically with the insert.
    // Authorize happened in a previous mutation; a subscription could have
    // lapsed in the meantime, and parallel uploads could each have passed
    // the check there. This mutation is the single source of truth.
    const userId = await requireUser(ctx, args.sessionToken);
    const plan = await currentPlan(ctx, userId);
    if (plan !== "pro") {
      throw new ConvexError("Image cloud storage requires Pro.");
    }

    if (args.bytes <= 0 || args.bytes > PRO_IMAGE_STORAGE_LIMIT_BYTES) {
      throw new ConvexError("Image payload size is invalid.");
    }

    const used = await storageBytesUsed(ctx, userId);
    if (used + args.bytes > PRO_IMAGE_STORAGE_LIMIT_BYTES) {
      throw new ConvexError("Image storage limit reached.");
    }

    // Validate and consume the in-flight event (if the client passed one)
    // atomically with the imageAssets insert. Doing it here, in the same
    // transaction as the cap check and the insert, means a parallel
    // authorizeImageUpload can't double-count this event and we can't
    // record bytes against the cap without also freeing the in-flight slot.
    if (args.eventId) {
      const event = await ctx.db.get(args.eventId);
      if (!event || event.userId !== userId) {
        throw new ConvexError("Upload authorization event is invalid.");
      }
      if (event.status !== "in_flight") {
        throw new ConvexError("Upload authorization event was already resolved or abandoned.");
      }
      if (event.bytes !== args.bytes) {
        // The client uploaded a different number of bytes than they
        // claimed in the authorize step. Refuse rather than silently
        // reconcile — the storage cap is enforced against the larger
        // of the two and we don't want a future bug to silently
        // underestimate storage usage.
        throw new ConvexError("Uploaded bytes do not match authorized bytes.");
      }
    }

    const assetId = await ctx.db.insert("imageAssets", {
      userId,
      shelfId: args.shelfId,
      itemId: args.itemId,
      storageId: args.storageId,
      bytes: args.bytes,
      mimeType: args.mimeType,
      createdAt: Date.now(),
    });

    if (args.eventId) {
      await ctx.db.patch(args.eventId, {
        status: "resolved",
        resolvedAssetId: assetId,
      });
    }

    return assetId;
  },
});

export const recordSyncEvent = mutation({
  args: {
    ...sessionArgs,
    deviceId: v.optional(v.string()),
    type: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    return await ctx.db.insert("syncEvents", {
      userId,
      deviceId: args.deviceId,
      type: args.type,
      message: args.message,
      createdAt: Date.now(),
    });
  },
});

// ============================================================
// Phase 1: Per-item sync mutations (team-ready)
// ============================================================

const shelfItemCommonArgs = {
  shelfId: v.string(),
  teamId: v.string(),
  itemId: v.string(),
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
  preview: v.object({ summary: v.string(), detail: v.string() }),
  order: v.string(),
};

// Upsert a single shelf item with version-based LWW.
// - version + serverUpdatedAt is the source of truth (not localUpdatedAt)
// - teamId sentinel "" for personal shelves
export const upsertShelfItem = mutation({
  args: {
    ...sessionArgs,
    ...shelfItemCommonArgs,
    version: v.number(),
    serverUpdatedAt: v.number(),
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
    hex: v.optional(v.string()),
    name: v.optional(v.string()),
    codeText: v.optional(v.string()),
    language: v.optional(v.string()),
    localUpdatedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);

    const existing = await ctx.db
      .query("shelfItems")
      .withIndex("by_team_shelf_item", (q) =>
        q.eq("teamId", args.teamId).eq("shelfId", args.shelfId).eq("itemId", args.itemId),
      )
      .unique();

    if (existing) {
      // LWW by version, then serverUpdatedAt.
      if (args.version < existing.version) {
        return { applied: false, reason: "stale_version" };
      }
      if (args.version === existing.version && args.serverUpdatedAt <= existing.serverUpdatedAt) {
        return { applied: false, reason: "stale_timestamp" };
      }
      await ctx.db.patch(existing._id, {
        kind: args.kind,
        title: args.title,
        subtitle: args.subtitle,
        preview: args.preview,
        order: args.order,
        file: args.file,
        mimeType: args.mimeType,
        text: args.text,
        savedFilePath: args.savedFilePath,
        url: args.url,
        hex: args.hex,
        name: args.name,
        codeText: args.codeText,
        language: args.language,
        updatedBy: userId,
        version: args.version,
        serverUpdatedAt: args.serverUpdatedAt,
        localUpdatedAt: args.localUpdatedAt,
        deletedAt: undefined,
      });
      return { applied: true, reason: "updated" };
    }

    await ctx.db.insert("shelfItems", {
      shelfId: args.shelfId,
      teamId: args.teamId,
      itemId: args.itemId,
      createdBy: userId,
      updatedBy: userId,
      kind: args.kind,
      title: args.title,
      subtitle: args.subtitle,
      preview: args.preview,
      order: args.order,
      file: args.file,
      mimeType: args.mimeType,
      text: args.text,
      savedFilePath: args.savedFilePath,
      url: args.url,
      hex: args.hex,
      name: args.name,
      codeText: args.codeText,
      language: args.language,
      version: args.version,
      serverUpdatedAt: args.serverUpdatedAt,
      localUpdatedAt: args.localUpdatedAt,
      deletedAt: undefined,
    });
    return { applied: true, reason: "inserted" };
  },
});

// Soft-delete a shelf item (sets deletedAt tombstone).
export const deleteShelfItem = mutation({
  args: {
    ...sessionArgs,
    teamId: v.string(),
    shelfId: v.string(),
    itemId: v.string(),
    version: v.number(),
    serverUpdatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);

    const existing = await ctx.db
      .query("shelfItems")
      .withIndex("by_team_shelf_item", (q) =>
        q.eq("teamId", args.teamId).eq("shelfId", args.shelfId).eq("itemId", args.itemId),
      )
      .unique();

    if (!existing) {
      return { applied: false, reason: "not_found" };
    }

    // LWW on version exactly like upsertShelfItem.
    if (args.version < existing.version) {
      return { applied: false, reason: "stale_version" };
    }
    if (args.version === existing.version && args.serverUpdatedAt <= existing.serverUpdatedAt) {
      return { applied: false, reason: "stale_timestamp" };
    }

    await ctx.db.patch(existing._id, {
      deletedAt: Date.now(),
      updatedBy: userId,
      version: args.version,
      serverUpdatedAt: args.serverUpdatedAt,
    });
    return { applied: true, reason: "deleted" };
  },
});

// List shelf items with cursor-based pagination. Returns:
// - items: active (non-deleted) items
// - tombstones: deleted item metadata so the client can remove local copies
// - nextCursor: pass as `cursor` in the next call (or null when done)
export const listShelfItems = query({
  args: {
    ...sessionArgs,
    teamId: v.string(),
    shelfId: v.string(),
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.sessionToken);

    const page = await ctx.db
      .query("shelfItems")
      .withIndex("by_team_shelf_updated", (q) =>
        q.eq("teamId", args.teamId).eq("shelfId", args.shelfId).gt("serverUpdatedAt", args.cursor ?? 0),
      )
      .order("asc")
      .take(args.limit ?? 100);

    return {
      items: page.filter((i) => !i.deletedAt),
      tombstones: page
        .filter((i) => i.deletedAt)
        .map((i) => ({ itemId: i.itemId, version: i.version, deletedAt: i.deletedAt })),
      nextCursor: page.length > 0 ? page[page.length - 1].serverUpdatedAt : args.cursor ?? 0,
    };
  },
});

// Internal: backfill shelfItems from existing shelves.items array.
// Used by @convex-dev/migrations during Phase 1 migration.
export const migrateOneShelf = internalMutation({
  args: {
    shelfDocId: v.id("shelves"),
    userId: v.id("users"),
    shelfId: v.string(),
    items: v.array(shelfItemSchema),
    shelfUpdatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const serverNow = Date.now();
    for (const item of args.items) {
      const existing = await ctx.db
        .query("shelfItems")
        .withIndex("by_team_shelf_item", (q) =>
          q.eq("teamId", PERSONAL).eq("shelfId", args.shelfId).eq("itemId", item.id),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("shelfItems", itemToShelfItemRow(item, {
          shelfId: args.shelfId,
          teamId: PERSONAL,
          userId: args.userId,
          version: 1,
          serverUpdatedAt: args.shelfUpdatedAt ?? serverNow,
          migratedAt: serverNow,
        }) as any);
      }
    }
    await ctx.db.patch(args.shelfDocId, { itemsMigratedAt: serverNow });
  },
});
