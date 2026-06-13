import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
      return existing._id;
    }

    return await ctx.db.insert("shelves", {
      userId,
      shelfId: args.shelfId,
      ...next,
      createdAt: serverNow,
    });
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
