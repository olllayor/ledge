import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertTeamPermission,
  currentPlan,
  deviceLimitForPlan,
  PRO_IMAGE_STORAGE_LIMIT_BYTES,
  PRO_REQUIRED_FOR_PREFERENCES_MESSAGE,
  requireUser,
  sessionArgs,
  shelfLimitForPlan,
  storageBytesUsed,
} from "./model";
import type { Id } from "./_generated/dataModel";
import { shelfItemSchema, preferencesValues } from "./sharedSchemas";

const PERSONAL = "";

// Read cap for the reactive team-shelf query. Beyond this the snapshot
// is flagged truncated and clients must not reconcile against it.
const TEAM_ITEMS_READ_CAP = 500;

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
      // Tombstoned shelves are pending deletions, not held storage.
      syncedShelfCount: shelves.filter((shelf) => !shelf.deletedAt).length,
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

    const limit = deviceLimitForPlan(plan);
    const devicesProbe = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(limit + 1);

    if (devicesProbe.length >= limit) {
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
      const limit = shelfLimitForPlan(plan);
      // Tombstoned shelves do not count toward the cap — they are pending
      // deletions, not storage the user still holds. Bounded async
      // iteration: stop once `limit` active rows have been seen.
      let activeShelfCount = 0;
      for await (const row of ctx.db
        .query("shelves")
        .withIndex("by_user", (q) => q.eq("userId", userId))) {
        if (!row.deletedAt) {
          activeShelfCount += 1;
          if (activeShelfCount >= limit) {
            break;
          }
        }
      }
      if (activeShelfCount >= limit) {
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
      // Tombstone guard: a device that has not yet seen the deletion must
      // not resurrect the shelf with its next blind push. Only an edit
      // stamped AFTER the deletion (the owner deliberately recreating it)
      // clears the tombstone. Stale pushes get a silent no-op (same shape
      // as the LWW-reject path below); the pushing device learns about the
      // deletion from `listShelves` and drops its local copy.
      if (existing.deletedAt) {
        const incomingMs = Date.parse(args.localUpdatedAt);
        if (!Number.isFinite(incomingMs) || incomingMs <= existing.deletedAt) {
          return existing._id;
        }
        await ctx.db.patch(existing._id, { deletedAt: undefined });
      }
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
      // Batched: one collect + inserts for missing items instead of N unique queries.
      const existingItems = await ctx.db
        .query("shelfItems")
        .withIndex("by_team_shelf", (q) =>
          q.eq("teamId", PERSONAL).eq("shelfId", args.shelfId),
        )
        .collect();
      const existingItemIds = new Set(existingItems.map((row) => row.itemId));
      for (const item of args.items) {
        if (!existingItemIds.has(item.id)) {
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
    for (const item of args.items) {
      await ctx.db.insert("shelfItems", itemToShelfItemRow(item, {
        shelfId: args.shelfId,
        teamId: PERSONAL,
        userId,
        version: 1,
        serverUpdatedAt: serverNow,
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
    if (shelf && !shelf.deletedAt) {
      // Soft delete: the tombstone row stays so other devices see the
      // deletion via `listShelves` and drop their local copies. A hard
      // delete here let a device that still held the shelf resurrect it
      // with its next blind `upsertShelf`.
      await ctx.db.patch(shelf._id, { deletedAt: Date.now(), updatedAt: Date.now() });
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
    // Use by_user_and_status to avoid full hour scan, then filter by
    // time. Bounded take(500) keeps TX cheap; at avg 3MB per event 500
    // already covers the 1.5GB cap.
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const inFlightCandidates = await ctx.db
      .query("imageUploadEvents")
      .withIndex("by_user_and_status", (q) => q.eq("userId", userId).eq("status", "in_flight"))
      .take(500);
    const inFlight = inFlightCandidates
      .filter((event) => event.createdAt > oneHourAgo)
      .reduce((sum, event) => sum + event.bytes, 0);
    // If we hit the take limit, we may have underestimated; treat as over-cap
    // to prevent slow-loris bypass that stays under per-request scan.
    if (inFlightCandidates.length >= 500 && inFlight + args.bytes > MAX_INFLIGHT_UPLOAD_BYTES_PER_HOUR * 0.8) {
      throw new ConvexError(
        "Too many images uploading at once. Please wait for previous uploads to finish.",
      );
    }
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

// Personal shelves are owned via the `shelves` table (userId + shelfId).
// The `shelfItems` index is keyed by teamId+shelfId+itemId with no userId,
// so every per-item entry point MUST verify the caller owns the personal
// shelf row before touching its items. Without this, any authenticated
// user could read/write/delete another user's items given a shelfId.
async function assertPersonalShelfOwnership(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  shelfId: string,
): Promise<void> {
  const shelf = await ctx.db
    .query("shelves")
    .withIndex("by_user_and_shelf", (q) => q.eq("userId", userId).eq("shelfId", shelfId))
    .unique();
  if (!shelf) {
    throw new ConvexError("Shelf not found.");
  }
}

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
    if (args.teamId !== PERSONAL) {
      await assertTeamPermission(ctx, args.teamId as Id<"teams">, userId);
    } else {
      await assertPersonalShelfOwnership(ctx, userId, args.shelfId);
    }

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
    if (args.teamId !== PERSONAL) {
      await assertTeamPermission(ctx, args.teamId as Id<"teams">, userId);
    } else {
      await assertPersonalShelfOwnership(ctx, userId, args.shelfId);
    }

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

// Reactive query: get all active items on a team shelf with creator user email.
//
// Returns `{ items, truncated }`. `truncated` is true when the shelf holds
// more rows than the read cap. A partial snapshot is NOT safe for the
// client's reconcile step: mirroring it down would silently drop tail
// items, and deriving deletes from bookkeeping built on it could delete
// live server rows. Callers MUST treat a truncated snapshot as
// untrustworthy (see TeamShelfSyncProvider) instead of paging to
// completion here — looping cursors inside one query risks the
// transaction read limits, and huge arrays risk the response size cap.
export const getTeamShelfItems = query({
  args: {
    ...sessionArgs,
    teamId: v.id("teams"),
    shelfId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    await assertTeamPermission(ctx, args.teamId, userId);

    const shelfId = args.shelfId ?? "default";
    const rawItems = await ctx.db
      .query("shelfItems")
      .withIndex("by_team_shelf", (q) =>
        q.eq("teamId", args.teamId).eq("shelfId", shelfId),
      )
      .take(TEAM_ITEMS_READ_CAP + 1);
    const truncated = rawItems.length > TEAM_ITEMS_READ_CAP;
    const capped = truncated ? rawItems.slice(0, TEAM_ITEMS_READ_CAP) : rawItems;

    const activeItems = capped
      .filter((i) => !i.deletedAt)
      // Plain code-unit comparison, not localeCompare: `order` holds
      // lexorank strings, whose ordering is defined by byte-wise string
      // comparison and can differ from locale collation.
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

    const items = await Promise.all(
      activeItems.map(async (item) => {
        const creator = await ctx.db.get(item.createdBy);
        // Omit the key entirely when the creator is gone — `undefined`
        // is not a valid Convex value.
        return creator
          ? { ...item, createdByUser: { email: creator.email } }
          : { ...item };
      }),
    );

    return { items, truncated };
  },
});

// List shelf items with cursor-based pagination. Returns:
// - items: active (non-deleted) items
// - tombstones: deleted item metadata so the client can remove local copies
// - continueCursor: pass as `cursor` in the next call's paginationOpts (or null when done)
export const listShelfItems = query({
  args: {
    ...sessionArgs,
    teamId: v.string(),
    shelfId: v.string(),
    paginationOpts: paginationOptsValidator,
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    if (args.teamId !== PERSONAL) {
      await assertTeamPermission(ctx, args.teamId as Id<"teams">, userId);
    } else {
      await assertPersonalShelfOwnership(ctx, userId, args.shelfId);
    }

    const result = await ctx.db
      .query("shelfItems")
      .withIndex("by_team_shelf_updated", (q) =>
        q.eq("teamId", args.teamId).eq("shelfId", args.shelfId).gt("serverUpdatedAt", args.since ?? 0),
      )
      .order("asc")
      .paginate(args.paginationOpts);

    return {
      items: result.page.filter((i) => !i.deletedAt),
      tombstones: result.page
        .filter((i) => i.deletedAt)
        .map((i) => ({ itemId: i.itemId, version: i.version, deletedAt: i.deletedAt })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
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
    const existingItems = await ctx.db
      .query("shelfItems")
      .withIndex("by_team_shelf", (q) =>
        q.eq("teamId", PERSONAL).eq("shelfId", args.shelfId),
      )
      .collect();
    const existingIds = new Set(existingItems.map((row) => row.itemId));
    for (const item of args.items) {
      if (!existingIds.has(item.id)) {
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
