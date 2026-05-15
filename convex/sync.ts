import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  currentPlan,
  deviceLimitForPlan,
  PRO_IMAGE_STORAGE_LIMIT_BYTES,
  requireUser,
  sessionArgs,
  shelfLimitForPlan,
  storageBytesUsed,
} from "./model";

const fileRef = v.object({
  originalPath: v.string(),
  resolvedPath: v.string(),
  isStale: v.boolean(),
  isMissing: v.boolean(),
});

const preview = v.object({
  summary: v.string(),
  detail: v.string(),
});

const shelfItemBase = {
  id: v.string(),
  createdAt: v.string(),
  order: v.number(),
  title: v.string(),
  subtitle: v.string(),
  preview,
};

const shelfItemSchema = v.union(
  v.object({
    ...shelfItemBase,
    kind: v.literal("file"),
    file: fileRef,
    mimeType: v.string(),
  }),
  v.object({
    ...shelfItemBase,
    kind: v.literal("folder"),
    file: fileRef,
  }),
  v.object({
    ...shelfItemBase,
    kind: v.literal("imageAsset"),
    file: fileRef,
    mimeType: v.string(),
  }),
  v.object({
    ...shelfItemBase,
    kind: v.literal("text"),
    text: v.string(),
    savedFilePath: v.optional(v.string()),
  }),
  v.object({
    ...shelfItemBase,
    kind: v.literal("url"),
    url: v.string(),
    savedFilePath: v.optional(v.string()),
  }),
);

const preferencesValues = v.object({
  launchAtLogin: v.boolean(),
  shakeEnabled: v.boolean(),
  shakeSensitivity: v.union(v.literal("gentle"), v.literal("balanced"), v.literal("firm")),
  excludedBundleIds: v.array(v.string()),
  globalShortcut: v.string(),
});

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

    const next = {
      name: args.name,
      color: args.color,
      origin: args.origin,
      items: args.items,
      localCreatedAt: args.localCreatedAt,
      localUpdatedAt: args.localUpdatedAt,
      itemCount: args.items.length,
      imageStorageBytes: Math.max(0, args.imageStorageBytes),
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, next);
      return existing._id;
    }

    return await ctx.db.insert("shelves", {
      userId,
      shelfId: args.shelfId,
      ...next,
      createdAt: Date.now(),
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

export const authorizeImageUpload = mutation({
  args: {
    ...sessionArgs,
    shelfId: v.string(),
    itemId: v.string(),
    bytes: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const plan = await currentPlan(ctx, userId);
    if (plan !== "pro") {
      throw new ConvexError("Image cloud storage requires Pro.");
    }

    const used = await storageBytesUsed(ctx, userId);
    if (used + args.bytes > PRO_IMAGE_STORAGE_LIMIT_BYTES) {
      throw new ConvexError("Image storage limit reached.");
    }

    return await ctx.storage.generateUploadUrl();
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
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx, args.sessionToken);
    const used = await storageBytesUsed(ctx, userId);
    if (used + args.bytes > PRO_IMAGE_STORAGE_LIMIT_BYTES) {
      throw new ConvexError("Image storage limit reached.");
    }

    return await ctx.db.insert("imageAssets", {
      userId,
      shelfId: args.shelfId,
      itemId: args.itemId,
      storageId: args.storageId,
      bytes: args.bytes,
      mimeType: args.mimeType,
      createdAt: Date.now(),
    });
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
