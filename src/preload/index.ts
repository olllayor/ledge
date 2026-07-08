import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { z } from 'zod';
import {
  IPC_CHANNELS,
  clipboardCategoryCreateInputSchema,
  clipboardCategoryRenameInputSchema,
  clipboardCategoryRemoveInputSchema,
  clipboardCopyInputSchema,
  clipboardEntryAssignInputSchema,
  clipboardEntryRemoveInputSchema,
  clipboardEntryUnassignInputSchema,
  clipboardQuickPastePasteInputSchema,
  clipboardSettingsUpdateInputSchema,
  clipboardStartItemDragInputSchema,
  toastPayloadSchema,
  type LedgeAPI,
  type StateListener,
  type ToastKind,
} from '@shared/ipc';
import {
  appStateSchema,
  createShelfInputSchema,
  clipboardCategorySchema,
  clipboardEntrySchema,
  clipboardSettingsSchema,
  ingestPayloadSchema,
  permissionStatusSchema,
  preferencePatchSchema,
  preferencesRecordSchema,
  shelfRecordSchema,
} from '@shared/schema';

const api: LedgeAPI = {
  async getState() {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.getState));
  },
  async createShelf(input) {
    return appStateSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.createShelf, createShelfInputSchema.parse(input)),
    );
  },
  async restoreShelf(id) {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.restoreShelf, id));
  },
  async addPayload(payload) {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.addPayload, ingestPayloadSchema.parse(payload)));
  },
  async addPayloads(payloads) {
    const parsedPayloads = payloads.map((p: unknown) => ingestPayloadSchema.parse(p));
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.addPayloads, parsedPayloads));
  },
  async closeShelf() {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.closeShelf));
  },
  async getPreferences() {
    return preferencesRecordSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.getPreferences));
  },
  async setPreferences(patch) {
    return preferencesRecordSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.setPreferences, preferencePatchSchema.parse(patch)),
    );
  },
  async setSyncState(patch) {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.setSyncState, patch));
  },
  async getSyncBackfillCandidates() {
    return z.array(shelfRecordSchema).parse(await ipcRenderer.invoke(IPC_CHANNELS.getSyncBackfillCandidates));
  },
  async applyRemoteShelf(shelf) {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.applyRemoteShelf, shelfRecordSchema.parse(shelf)));
  },
  async relinkItem(itemId) {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.relinkItem, itemId));
  },
  async getRecentShelves() {
    return (await ipcRenderer.invoke(IPC_CHANNELS.getRecentShelves)).map((entry: unknown) =>
      shelfRecordSchema.parse(entry),
    );
  },
  async getPermissionStatus() {
    return permissionStatusSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.getPermissionStatus));
  },
  async openPermissionSettings() {
    return ipcRenderer.invoke(IPC_CHANNELS.openPermissionSettings);
  },
  startItemDrag(itemId) {
    return ipcRenderer.sendSync(IPC_CHANNELS.startItemDrag, itemId) as boolean;
  },
  startItemsDrag(itemIds) {
    return ipcRenderer.sendSync(IPC_CHANNELS.startItemsDrag, itemIds) as boolean;
  },
  async previewItem(itemId) {
    return ipcRenderer.invoke(IPC_CHANNELS.previewItem, itemId);
  },
  async revealItem(itemId) {
    return ipcRenderer.invoke(IPC_CHANNELS.revealItem, itemId);
  },
  async openItem(itemId) {
    return ipcRenderer.invoke(IPC_CHANNELS.openItem, itemId);
  },
  async copyItem(itemId) {
    return ipcRenderer.invoke(IPC_CHANNELS.copyItem, itemId);
  },
  async saveItem(itemId) {
    return ipcRenderer.invoke(IPC_CHANNELS.saveItem, itemId);
  },
  async removeItem(itemId) {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.removeItem, itemId));
  },
  async renameShelf(name) {
    const parsed = z.object({ name: z.string().min(1).max(120) }).parse({ name });
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.renameShelf, parsed));
  },
  async clearShelf() {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.clearShelf));
  },
  async reorderItems(itemIds) {
    const parsed = z.object({ itemIds: z.array(z.string().uuid()).max(1024) }).parse({ itemIds });
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.reorderItems, parsed));
  },
  async shareShelfItems(itemIds) {
    return ipcRenderer.invoke(IPC_CHANNELS.shareShelfItems, itemIds);
  },
  async showItemContextMenu(itemId) {
    return ipcRenderer.invoke(IPC_CHANNELS.showItemContextMenu, itemId);
  },
  async showShelfContextMenu() {
    return ipcRenderer.invoke(IPC_CHANNELS.showShelfContextMenu);
  },
  showToast(message, kind: ToastKind = 'info') {
    ipcRenderer.send(IPC_CHANNELS.showToast, message, kind);
  },
  onToast(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = toastPayloadSchema.parse(payload ?? {});
      listener(parsed);
    };
    ipcRenderer.on(IPC_CHANNELS.showToast, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.showToast, wrapped);
    };
  },
  getFilePath(file) {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  subscribeState(listener: StateListener) {
    const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => {
      listener(appStateSchema.parse(state));
    };
    ipcRenderer.on(IPC_CHANNELS.stateUpdated, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.stateUpdated, wrapped);
    };
  },
  shelfInteractionPing() {
    ipcRenderer.send(IPC_CHANNELS.shelfInteractionPing);
  },
  async getAppVersion() {
    const version = await ipcRenderer.invoke(IPC_CHANNELS.getAppVersion);
    return typeof version === 'string' ? version : '';
  },
  // ---- Clipboard ----
  async clipboardGetRecent(limit = 200) {
    const parsed = z.object({ limit: z.number().int().positive().max(500) }).parse({ limit });
    const raw = (await ipcRenderer.invoke(IPC_CHANNELS.clipboardGetRecent, parsed)) as unknown;
    return z.array(clipboardEntrySchema).parse(raw);
  },
  async clipboardSettingsGet() {
    const raw = await ipcRenderer.invoke(IPC_CHANNELS.clipboardSettingsGet);
    return clipboardSettingsSchema.parse(raw);
  },
  async clipboardSettingsUpdate(patch) {
    const parsed = clipboardSettingsUpdateInputSchema.parse(patch);
    const raw = await ipcRenderer.invoke(IPC_CHANNELS.clipboardSettingsUpdate, parsed);
    return clipboardSettingsSchema.parse(raw);
  },
  async clipboardCategoryCreate(payload) {
    const parsed = clipboardCategoryCreateInputSchema.parse(payload);
    const raw = await ipcRenderer.invoke(IPC_CHANNELS.clipboardCategoryCreate, parsed);
    return clipboardCategorySchema.parse(raw);
  },
  async clipboardCategoryRename(payload) {
    const parsed = clipboardCategoryRenameInputSchema.parse(payload);
    await ipcRenderer.invoke(IPC_CHANNELS.clipboardCategoryRename, parsed);
  },
  async clipboardCategoryRemove(payload) {
    const parsed = clipboardCategoryRemoveInputSchema.parse(payload);
    await ipcRenderer.invoke(IPC_CHANNELS.clipboardCategoryRemove, parsed);
  },
  async clipboardEntryAssign(payload) {
    const parsed = clipboardEntryAssignInputSchema.parse(payload);
    await ipcRenderer.invoke(IPC_CHANNELS.clipboardEntryAssign, parsed);
  },
  async clipboardEntryUnassign(payload) {
    const parsed = clipboardEntryUnassignInputSchema.parse(payload);
    await ipcRenderer.invoke(IPC_CHANNELS.clipboardEntryUnassign, parsed);
  },
  async clipboardEntryRemove(payload) {
    const parsed = clipboardEntryRemoveInputSchema.parse(payload);
    await ipcRenderer.invoke(IPC_CHANNELS.clipboardEntryRemove, parsed);
  },
  async clipboardEntryClearAll() {
    await ipcRenderer.invoke(IPC_CHANNELS.clipboardEntryClearAll);
  },
  async clipboardPruneNow() {
    await ipcRenderer.invoke(IPC_CHANNELS.clipboardPruneNow);
  },
  clipboardStartItemDrag(payload) {
    const parsed = clipboardStartItemDragInputSchema.parse(payload);
    return ipcRenderer.sendSync(IPC_CHANNELS.clipboardStartItemDrag, parsed) as boolean;
  },
  clipboardQuickPasteShow() {
    ipcRenderer.send(IPC_CHANNELS.clipboardQuickPasteShow);
  },
  clipboardQuickPasteHide() {
    ipcRenderer.send(IPC_CHANNELS.clipboardQuickPasteHide);
  },
  async clipboardCopy(payload) {
    const parsed = clipboardCopyInputSchema.parse(payload);
    return (await ipcRenderer.invoke(IPC_CHANNELS.clipboardCopy, parsed)) as boolean;
  },
  async clipboardQuickPastePaste(payload) {
    const parsed = clipboardQuickPastePasteInputSchema.parse(payload);
    await ipcRenderer.invoke(IPC_CHANNELS.clipboardQuickPastePaste, parsed);
  },
  clipboardQuickPasteFocusIndex(index) {
    ipcRenderer.send(IPC_CHANNELS.clipboardQuickPasteFocusIndex, index);
  },
  onClipboardQuickPasteHint(listener) {
    const hintSchema = z.object({
      hint: z.enum(['shown', 'focus']),
      index: z.number().int().min(0).max(8).optional(),
      previousBundleId: z.string().optional(),
    });
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = hintSchema.safeParse(payload);
      if (!parsed.success) return;
      listener(parsed.data);
    };
    ipcRenderer.on(IPC_CHANNELS.clipboardQuickPastePaste, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.clipboardQuickPastePaste, wrapped);
    };
  },
  clipboardPeekShow() {
    ipcRenderer.send(IPC_CHANNELS.clipboardPeekShow);
  },
  clipboardPeekHide() {
    ipcRenderer.send(IPC_CHANNELS.clipboardPeekHide);
  },
  onClipboardPeekHint(listener) {
    const hintSchema = z.object({ hint: z.enum(['visible', 'hidden']) });
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = hintSchema.safeParse(payload);
      if (!parsed.success) return;
      listener(parsed.data);
    };
    ipcRenderer.on(IPC_CHANNELS.clipboardPeekHint, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.clipboardPeekHint, wrapped);
    };
  },
  // ---- Notch dropout ----
  notchDropoutShow() {
    ipcRenderer.send(IPC_CHANNELS.notchDropoutShow);
  },
  notchDropoutHide() {
    ipcRenderer.send(IPC_CHANNELS.notchDropoutHide);
  },
  notchDropoutDragState(suppressed: boolean) {
    ipcRenderer.send(IPC_CHANNELS.notchDropoutDragState, { suppressed });
  },
  onNotchDropoutStateChanged(listener) {
    const schema = z.object({
      state: z.enum(['visible', 'hidden', 'expanded', 'collapsed']),
    });
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) return;
      listener(parsed.data);
    };
    ipcRenderer.on(IPC_CHANNELS.notchDropoutStateChanged, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.notchDropoutStateChanged, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('ledge', api);
