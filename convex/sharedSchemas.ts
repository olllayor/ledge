import { v } from "convex/values";

export const fileRef = v.object({
  originalPath: v.string(),
  resolvedPath: v.string(),
  isStale: v.boolean(),
  isMissing: v.boolean(),
});

export const preview = v.object({
  summary: v.string(),
  detail: v.string(),
});

export const shelfItemBase = {
  id: v.string(),
  createdAt: v.string(),
  order: v.number(),
  title: v.string(),
  subtitle: v.string(),
  preview,
};

export const shelfItemSchema = v.union(
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

export const preferencesValues = v.object({
  launchAtLogin: v.boolean(),
  shakeEnabled: v.boolean(),
  shakeSensitivity: v.union(v.literal("gentle"), v.literal("balanced"), v.literal("firm")),
  excludedBundleIds: v.array(v.string()),
  globalShortcut: v.string(),
  hasSeenShelfLimitMigration: v.boolean(),
});

export const PRO_IMAGE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
export const PRO_REQUIRED_FOR_PREFERENCES_MESSAGE =
  "Preferences sync is a Pro feature. Upgrade in Settings \u2192 Ledge Pro.";
