import { z } from 'zod';
import { fileRefSchema, shelfItemBaseSchema } from './commonSchemas';

export const shelfColorSchema = z.enum(['ember', 'wave', 'forest', 'sand']);
export const shelfOriginSchema = z.enum(['shake', 'tray', 'shortcut', 'manual', 'restore']);
export const shakeSensitivitySchema = z.enum(['gentle', 'balanced', 'firm']);

export const shakeDetectedEventSchema = z.object({
  x: z.number(),
  y: z.number(),
  displayId: z.number(),
  sourceBundleId: z.string(),
})

export const clipboardChangedEventSchema = z.object({
  changeCount: z.number().int(),
  sourceBundleId: z.string(),
  sourceAppName: z.string(),
  formats: z.array(z.string()),
})

export const fileItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('file'),
  file: fileRefSchema,
  mimeType: z.string().default('application/octet-stream'),
});

export const folderItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('folder'),
  file: fileRefSchema,
});

export const imageAssetItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('imageAsset'),
  file: fileRefSchema,
  mimeType: z.string().default('image/png'),
});

// Keep the ShelfItemRecord union in sync with convex/sharedSchemas.ts —
// adding a kind here requires adding it there too, otherwise drag-out from
// the clipboard into a real shelf will fail Convex sync silently.
export const textItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('text'),
  text: z.string(),
  savedFilePath: z.string().optional(),
});

export const urlItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('url'),
  url: z.string().url(),
  savedFilePath: z.string().optional(),
});

export const colorItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('color'),
  hex: z.string().regex(/^#[0-9a-fA-F]{6,8}$/),
  name: z.string().optional(),
});

export const codeItemSchema = shelfItemBaseSchema.extend({
  kind: z.literal('code'),
  text: z.string(),
  language: z.string().optional(),
});

export const shelfItemSchema = z.discriminatedUnion('kind', [
  fileItemSchema,
  folderItemSchema,
  imageAssetItemSchema,
  textItemSchema,
  urlItemSchema,
  colorItemSchema,
  codeItemSchema,
]);

export const shelfRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: shelfColorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  origin: shelfOriginSchema,
  items: z.array(shelfItemSchema),
});

export const shelfInteractionSchema = z.object({
  doubleClickAction: z.enum(['open', 'reveal']).default('open'),
  autoCloseShelf: z.boolean().default(false),
  autoRetract: z.boolean().default(false),
});

export const preferencesRecordSchema = z.object({
  launchAtLogin: z.boolean().default(false),
  shakeEnabled: z.boolean().default(true),
  shakeSensitivity: shakeSensitivitySchema.default('balanced'),
  excludedBundleIds: z.array(z.string()).default([]),
  globalShortcut: z.string().default('CommandOrControl+Shift+Space'),
  hasCompletedOnboarding: z.boolean().default(false),
  hasSeenShelfLimitMigration: z.boolean().default(false),
  shelfInteraction: shelfInteractionSchema.default({
    doubleClickAction: 'open',
    autoCloseShelf: false,
    autoRetract: false,
  }),
});

export const permissionStatusSchema = z.object({
  nativeHelperAvailable: z.boolean().default(false),
  accessibilityTrusted: z.boolean().default(false),
  shakeReady: z.boolean().default(false),
  lastError: z.string().default(''),
  shortcutRegistered: z.boolean().default(false),
  shortcutError: z.string().default(''),
});

export const syncStatusSchema = z.enum([
  'signedOut',
  'setupRequired',
  'syncing',
  'synced',
  'offline',
  'quotaReached',
  'entitlementStale',
  'error',
]);

export const billingPlanSchema = z.enum(['free', 'pro']);

export const syncStateSchema = z.object({
  enabled: z.boolean().default(false),
  status: syncStatusSchema.default('signedOut'),
  deviceId: z.string().default(''),
  signedInEmail: z.string().email().optional(),
  plan: billingPlanSchema.default('free'),
  syncedShelfCount: z.number().int().nonnegative().default(0),
  deviceCount: z.number().int().nonnegative().default(0),
  storageBytesUsed: z.number().int().nonnegative().default(0),
  lastSyncedAt: z.string().optional(),
  lastError: z.string().default(''),
});

export const defaultSyncState = {
  enabled: false,
  status: 'signedOut' as const,
  deviceId: '',
  plan: 'free' as const,
  syncedShelfCount: 0,
  deviceCount: 0,
  storageBytesUsed: 0,
  lastError: '',
};

// ---- Clipboard history (local-first; never reaches Convex) ----------------

export const clipboardEntrySchema = z.object({
  id: z.string(),
  capturedAt: z.string(),
  sourceBundleId: z.string().default(''),
  sourceAppName: z.string().default(''),
  item: shelfItemSchema,
  // 64x64 PNG data URI generated at capture for image items; lets
  // ClipboardView render thumbnails without re-decoding the full payload.
  thumbnailDataUri: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
});

export const clipboardCategorySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  color: shelfColorSchema,
  createdAt: z.string(),
});

export const clipboardSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  historyLimit: z.number().int().positive().max(2000).default(200),
  ignoreConcealedItems: z.boolean().default(true),
  ignoreBundleIds: z.array(z.string()).default([]),
  quickPasteHotkey: z.string().default('CommandOrControl+Shift+V'),
  peekHotkey: z.string().default(''),
  syntheticPasteEnabled: z.boolean().default(false),
});

export const defaultClipboardSettings = {
  enabled: false,
  historyLimit: 200,
  ignoreConcealedItems: true,
  ignoreBundleIds: [] as string[],
  quickPasteHotkey: 'CommandOrControl+Shift+V',
  peekHotkey: '',
  syntheticPasteEnabled: false,
};

export const appStateSchema = z.object({
  liveShelf: shelfRecordSchema.nullable(),
  recentShelves: z.array(shelfRecordSchema).max(10).default([]),
  preferences: preferencesRecordSchema,
  permissionStatus: permissionStatusSchema,
  sync: syncStateSchema.default(defaultSyncState),
  clipboardHistory: z.array(clipboardEntrySchema).default([]),
  clipboardCategories: z.array(clipboardCategorySchema).default([]),
  clipboardSettings: clipboardSettingsSchema.default(defaultClipboardSettings),
});

export const fileDropPayloadSchema = z.object({
  kind: z.literal('fileDrop'),
  paths: z.array(z.string()).min(1),
});

export const textPayloadSchema = z.object({
  kind: z.literal('text'),
  text: z.string().min(1),
});

export const urlPayloadSchema = z.object({
  kind: z.literal('url'),
  url: z.string().url(),
  label: z.string().default(''),
});

export const imagePayloadSchema = z.object({
  kind: z.literal('image'),
  mimeType: z.string(),
  base64: z.string(),
  filenameHint: z.string().default('drop-image'),
});

export const ingestPayloadSchema = z.discriminatedUnion('kind', [
  fileDropPayloadSchema,
  textPayloadSchema,
  urlPayloadSchema,
  imagePayloadSchema,
]);

export const createShelfInputSchema = z.object({
  reason: shelfOriginSchema,
});

export const preferencePatchSchema = preferencesRecordSchema.partial();

export const nativePermissionStatusSchema = z.object({
  accessibilityTrusted: z.boolean().default(false),
});

export const nativeBookmarkResolveSchema = z.object({
  resolvedPath: z.string().default(''),
  isStale: z.boolean().default(false),
  isMissing: z.boolean().default(false),
});

export const relinkItemInputSchema = z.object({
  itemId: z.string(),
});

export const syncStatePatchSchema = syncStateSchema.partial();

export type AppState = z.infer<typeof appStateSchema>;
export type BillingPlan = z.infer<typeof billingPlanSchema>;
export type CreateShelfInput = z.infer<typeof createShelfInputSchema>;
export type FileRef = z.infer<typeof fileRefSchema>;
export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
export type FileBackedShelfItem =
  | z.infer<typeof fileItemSchema>
  | z.infer<typeof folderItemSchema>
  | z.infer<typeof imageAssetItemSchema>;
export type PermissionStatus = z.infer<typeof permissionStatusSchema>;
export type PreferencePatch = z.infer<typeof preferencePatchSchema>;
export type PreferencesRecord = z.infer<typeof preferencesRecordSchema>;
export type ShelfColor = z.infer<typeof shelfColorSchema>;
export type ShelfItemRecord = z.infer<typeof shelfItemSchema>;
export type ShelfOrigin = z.infer<typeof shelfOriginSchema>;
export type ShelfRecord = z.infer<typeof shelfRecordSchema>;
export type ShakeSensitivity = z.infer<typeof shakeSensitivitySchema>;
export type SyncState = z.infer<typeof syncStateSchema>;
export type SyncStatePatch = z.infer<typeof syncStatePatchSchema>;
export type ClipboardEntry = z.infer<typeof clipboardEntrySchema>;
export type ClipboardCategory = z.infer<typeof clipboardCategorySchema>;
export type ClipboardSettings = z.infer<typeof clipboardSettingsSchema>;
