import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS, toastPayloadSchema, type LedgeAPI, type StateListener, type ToastKind } from '@shared/ipc';
import {
  appStateSchema,
  createShelfInputSchema,
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
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.renameShelf, name));
  },
  async clearShelf() {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.clearShelf));
  },
  async reorderItems(itemIds) {
    return appStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.reorderItems, itemIds));
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
};

contextBridge.exposeInMainWorld('ledge', api);
