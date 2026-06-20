import { z } from 'zod';
import type {
  AppState,
  CreateShelfInput,
  IngestPayload,
  PermissionStatus,
  PreferencePatch,
  PreferencesRecord,
  ShelfRecord,
  SyncStatePatch,
  ClipboardCategory,
  ClipboardEntry,
  ClipboardSettings,
} from './schema';
import { clipboardSettingsSchema } from './schema';

export const IPC_CHANNELS = {
  getState: 'ledge:get-state',
  createShelf: 'ledge:create-shelf',
  restoreShelf: 'ledge:restore-shelf',
  addPayload: 'ledge:add-payload',
  addPayloads: 'ledge:add-payloads',
  closeShelf: 'ledge:close-shelf',
  getPreferences: 'ledge:get-preferences',
  setPreferences: 'ledge:set-preferences',
  setSyncState: 'ledge:set-sync-state',
  getSyncBackfillCandidates: 'ledge:get-sync-backfill-candidates',
  applyRemoteShelf: 'ledge:apply-remote-shelf',
  relinkItem: 'ledge:relink-item',
  getRecentShelves: 'ledge:get-recent-shelves',
  getPermissionStatus: 'ledge:get-permission-status',
  openPermissionSettings: 'ledge:open-permission-settings',
  startItemDrag: 'ledge:start-item-drag',
  startItemsDrag: 'ledge:start-items-drag',
  previewItem: 'ledge:preview-item',
  revealItem: 'ledge:reveal-item',
  openItem: 'ledge:open-item',
  copyItem: 'ledge:copy-item',
  saveItem: 'ledge:save-item',
  removeItem: 'ledge:remove-item',
  renameShelf: 'ledge:rename-shelf',
  clearShelf: 'ledge:clear-shelf',
  reorderItems: 'ledge:reorder-items',
  shareShelfItems: 'ledge:share-shelf-items',
  showItemContextMenu: 'ledge:show-item-context-menu',
  showShelfContextMenu: 'ledge:show-shelf-context-menu',
  showToast: 'ledge:show-toast',
  stateUpdated: 'ledge:state-updated',
  shelfInteractionPing: 'ledge:shelf-interaction-ping',
  getAppVersion: 'ledge:get-app-version',
  // ---- Clipboard history (local-first; never reaches Convex) ----
  clipboardQuickPasteShow: 'ledge:clipboard-quick-paste:show',
  clipboardQuickPasteHide: 'ledge:clipboard-quick-paste:hide',
  clipboardQuickPastePaste: 'ledge:clipboard-quick-paste:paste',
  clipboardCopy: 'ledge:clipboard-copy',
  clipboardQuickPasteFocusIndex: 'ledge:clipboard-quick-paste:focus-index',
  clipboardGetRecent: 'ledge:clipboard-get-recent',
  clipboardPeekShow: 'ledge:clipboard-peek:show',
  clipboardPeekHide: 'ledge:clipboard-peek:hide',
  clipboardStartItemDrag: 'ledge:clipboard-start-item-drag',
  clipboardSettingsGet: 'ledge:clipboard-settings:get',
  clipboardSettingsUpdate: 'ledge:clipboard-settings:update',
  clipboardCategoryCreate: 'ledge:clipboard-category:create',
  clipboardCategoryRename: 'ledge:clipboard-category:rename',
  clipboardCategoryRemove: 'ledge:clipboard-category:remove',
  clipboardEntryAssign: 'ledge:clipboard-entry:assign',
  clipboardEntryUnassign: 'ledge:clipboard-entry:unassign',
  clipboardEntryRemove: 'ledge:clipboard-entry:remove',
  clipboardEntryClearAll: 'ledge:clipboard-entry:clear-all',
  clipboardPruneNow: 'ledge:clipboard-prune-now',
} as const;

export type ToastKind = 'success' | 'error' | 'info';

export const toastPayloadSchema = z.object({
  message: z.string(),
  kind: z.enum(['success', 'error', 'info']),
});

export type ToastPayload = z.infer<typeof toastPayloadSchema>;

// ---- Clipboard IPC schemas ----

export const clipboardEntryInputSchema = z.object({
  capturedAt: z.string(),
  sourceBundleId: z.string().default(''),
  sourceAppName: z.string().default(''),
  item: z.unknown(), // Shape validated against shelfItemSchema in the main process.
  thumbnailDataUri: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
});
export type ClipboardEntryInputPayload = z.infer<typeof clipboardEntryInputSchema>;

export const clipboardCopyInputSchema = z.object({
  entryId: z.string().min(1),
})
export type ClipboardCopyInputPayload = z.infer<typeof clipboardCopyInputSchema>

export const clipboardQuickPastePasteInputSchema = z.object({
  entryId: z.string(),
  // The bundle id of the app that owned the pasteboard at the last
  // clipboard.changed notification. Optional — when absent the paste
  // path falls back to writing the clipboard and showing a ⌘V hint.
  previousBundleId: z.string().default(''),
});

export const clipboardStartItemDragInputSchema = z.object({
  entryId: z.string(),
});

export const clipboardCategoryCreateInputSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.enum(['ember', 'wave', 'forest', 'sand']),
});
export type ClipboardCategoryCreatePayload = z.infer<typeof clipboardCategoryCreateInputSchema>;

export const clipboardCategoryRenameInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
});

export const clipboardCategoryRemoveInputSchema = z.object({
  id: z.string(),
});

export const clipboardEntryAssignInputSchema = z.object({
  entryId: z.string(),
  categoryId: z.string(),
});

export const clipboardEntryUnassignInputSchema = z.object({
  entryId: z.string(),
  categoryId: z.string(),
});

export const clipboardEntryRemoveInputSchema = z.object({
  entryId: z.string(),
});

export const clipboardSettingsUpdateInputSchema = clipboardSettingsSchema.partial();
export type ClipboardSettingsUpdatePayload = z.infer<typeof clipboardSettingsUpdateInputSchema>;

export type StateListener = (state: AppState) => void;

export interface ClipboardQuickPasteHint {
  hint: 'shown' | 'focus';
  index?: number;
  previousBundleId?: string;
}

export interface ClipboardPeekHint {
  hint: 'visible' | 'hidden';
}

export interface LedgeAPI {
  getState(): Promise<AppState>;
  createShelf(input: CreateShelfInput): Promise<AppState>;
  restoreShelf(id: string): Promise<AppState>;
  addPayload(payload: IngestPayload): Promise<AppState>;
  addPayloads(payloads: IngestPayload[]): Promise<AppState>;
  closeShelf(): Promise<AppState>;
  getPreferences(): Promise<PreferencesRecord>;
  setPreferences(patch: PreferencePatch): Promise<PreferencesRecord>;
  setSyncState(patch: SyncStatePatch): Promise<AppState>;
  getSyncBackfillCandidates(): Promise<ShelfRecord[]>;
  applyRemoteShelf(shelf: ShelfRecord): Promise<AppState>;
  relinkItem(itemId: string): Promise<AppState>;
  getRecentShelves(): Promise<ShelfRecord[]>;
  getPermissionStatus(): Promise<PermissionStatus>;
  openPermissionSettings(): Promise<boolean>;
  startItemDrag(itemId: string): boolean;
  startItemsDrag(itemIds: string[]): boolean;
  previewItem(itemId: string): Promise<boolean>;
  revealItem(itemId: string): Promise<boolean>;
  openItem(itemId: string): Promise<boolean>;
  copyItem(itemId: string): Promise<boolean>;
  saveItem(itemId: string): Promise<boolean>;
  removeItem(itemId: string): Promise<AppState>;
  renameShelf(name: string): Promise<AppState>;
  clearShelf(): Promise<AppState>;
  reorderItems(itemIds: string[]): Promise<AppState>;
  shareShelfItems(itemIds?: string[]): Promise<boolean>;
  showItemContextMenu(itemId: string): Promise<boolean>;
  showShelfContextMenu(): Promise<boolean>;
  showToast(message: string, kind?: ToastKind): void;
  onToast(listener: (payload: ToastPayload) => void): () => void;
  getFilePath(file: File): string;
  subscribeState(listener: StateListener): () => void;
  shelfInteractionPing(): void;
  getAppVersion(): Promise<string>;
  // ---- Clipboard ----
  clipboardGetRecent(limit?: number): Promise<ClipboardEntry[]>;
  clipboardSettingsGet(): Promise<ClipboardSettings>;
  clipboardSettingsUpdate(patch: ClipboardSettingsUpdatePayload): Promise<ClipboardSettings>;
  clipboardCategoryCreate(payload: ClipboardCategoryCreatePayload): Promise<ClipboardCategory>;
  clipboardCategoryRename(payload: { id: string; name: string }): Promise<void>;
  clipboardCategoryRemove(payload: { id: string }): Promise<void>;
  clipboardEntryAssign(payload: { entryId: string; categoryId: string }): Promise<void>;
  clipboardEntryUnassign(payload: { entryId: string; categoryId: string }): Promise<void>;
  clipboardEntryRemove(payload: { entryId: string }): Promise<void>;
  clipboardEntryClearAll(): Promise<void>;
  clipboardPruneNow(): Promise<void>;
  clipboardStartItemDrag(payload: { entryId: string }): boolean;
  clipboardQuickPasteShow(): void;
  clipboardQuickPasteHide(): void;
  clipboardQuickPastePaste(payload: { entryId: string; previousBundleId?: string }): Promise<void>;
  /** Copy a single clipboard history entry to the system pasteboard
   *  without triggering the synthetic-paste keystroke. */
  clipboardCopy(payload: { entryId: string }): Promise<boolean>;
  clipboardQuickPasteFocusIndex(index: number): void;
  // Subscribe to hints the main process pushes via the quick-paste
  // channel. Hints reset focus to 0, refresh entries, or move focus
  // to a specific index. Returned function unsubscribes.
  onClipboardQuickPasteHint(listener: (hint: ClipboardQuickPasteHint) => void): () => void;
  clipboardPeekShow(): void;
  clipboardPeekHide(): void;
  onClipboardPeekHint(listener: (hint: ClipboardPeekHint) => void): () => void;
}
