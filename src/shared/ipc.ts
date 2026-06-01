import type {
  AppState,
  CreateShelfInput,
  IngestPayload,
  PermissionStatus,
  PreferencePatch,
  PreferencesRecord,
  ShelfRecord,
  SyncStatePatch,
} from './schema';

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
} as const;

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastPayload {
  message: string;
  kind: ToastKind;
}

export type StateListener = (state: AppState) => void;

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
}
