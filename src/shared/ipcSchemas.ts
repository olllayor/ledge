import { z } from 'zod';
import { ingestPayloadSchema } from './schema';

// Re-export a curated subset of the per-channel Zod schemas. The full
// payload shapes for IPC channels live here (instead of inline in
// `main/ipc.ts`) so the renderer can reuse them when typing outgoing
// payloads, and so the validation rules stay close to the channel
// constants in `ipc.ts`.

// ---- Shelf IPC ----

/** Cap the per-call payload count for `addPayloads`. */
export const MAX_PAYLOADS_PER_REQUEST = 1024;

/** A shelf item's id, the building block of most shelf IPC payloads. */
export const shelfItemIdParamSchema = z.string().uuid();

export const renameShelfInputSchema = z.object({
  name: z.string().min(1).max(120),
});

export const reorderItemsInputSchema = z.object({
  itemIds: z.array(shelfItemIdParamSchema).max(1024),
});

/** Argument for `ledge:share-shelf-items`. Optional so a missing value means "share all". */
export const shareShelfItemsInputSchema = z.array(shelfItemIdParamSchema).max(1024).optional();

/** Argument for `ledge:add-payloads` (an array form of the single-payload channel). */
export const ingestPayloadListSchema = z.array(ingestPayloadSchema).max(MAX_PAYLOADS_PER_REQUEST);

// ---- Toast IPC ----

export const TOAST_MESSAGE_MAX = 500;

export const toastMessageSchema = z.string().min(1).max(TOAST_MESSAGE_MAX);
export const toastKindSchema = z.enum(['info', 'success', 'error']);

// ---- Clipboard IPC ----

export const clipboardEntryIdInputSchema = z.object({
  entryId: z.string().min(1),
});

export const clipboardCategoryCreateInputSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.enum(['ember', 'wave', 'forest', 'sand']),
});

export const clipboardCategoryIdInputSchema = z.object({
  id: z.string().min(1),
});

export const clipboardCategoryRenameInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
});

export const clipboardEntryCategoryAssignInputSchema = z.object({
  entryId: z.string().min(1),
  categoryId: z.string().min(1),
});

export const clipboardSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    historyLimit: z.number().int().positive().max(2000).optional(),
    ignoreConcealedItems: z.boolean().optional(),
    ignoreBundleIds: z.array(z.string()).optional(),
    quickPasteHotkey: z.string().optional(),
    peekHotkey: z.string().optional(),
    syntheticPasteEnabled: z.boolean().optional(),
  })
  .strict();

export const clipboardQuickPastePasteInputSchema = z.object({
  entryId: z.string().min(1),
  // The bundle id of the app that owned the pasteboard at the last
  // clipboard.changed notification. Defaulted to '' so the synthetic
  // paste path can be skipped without an explicit bundle id.
  previousBundleId: z.string().default(''),
});

/** Argument for `ledge:clipboard-get-recent`. */
export const clipboardGetRecentInputSchema = z
  .object({ limit: z.number().int().positive().max(500) })
  .default({ limit: 200 });

// ---- Drag IPC ----

/** Per-call cap for the multi-item drag channel. */
export const MAX_DRAG_ITEM_IDS = 64;
