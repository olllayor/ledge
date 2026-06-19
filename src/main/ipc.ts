import { BrowserWindow, ipcMain, screen } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS, type ToastPayload } from '@shared/ipc'
import {
  createShelfInputSchema,
  preferencePatchSchema,
  shelfRecordSchema,
  syncStatePatchSchema,
  type AppState,
  type ShelfItemRecord,
} from '@shared/schema'

import {
  clipboardCategoryCreateInputSchema,
  clipboardCategoryIdInputSchema,
  clipboardCategoryRenameInputSchema,
  clipboardEntryCategoryAssignInputSchema,
  clipboardEntryIdInputSchema,
  clipboardGetRecentInputSchema,
  clipboardQuickPastePasteInputSchema,
  clipboardSettingsUpdateSchema,
  ingestPayloadListSchema,
  MAX_DRAG_ITEM_IDS,
  renameShelfInputSchema,
  reorderItemsInputSchema,
  shareShelfItemsInputSchema,
  shelfItemIdParamSchema,
  toastKindSchema,
  toastMessageSchema,
} from '@shared/ipcSchemas'
import { fileBackedPathsFromEntry, quickPastePasteEntry } from './services/quickPaste'
import { normalizePreferencePatch } from './services/preferencesSync'
import { startNativeDrag, pathsExist } from './services/dragController'
import type { ShelfActions } from './services/shelfActions'
import type { ShelfController } from './services/shelfController'
import type { PreferencesSyncService } from './services/preferencesSync'
import type { StateStore } from './services/stateStore'
import type { NativeAgentClient } from './native/nativeAgent'
import type { ShelfWindow } from './windows/shelfWindow'
import type { QuickPasteWindow } from './windows/quickPasteWindow'
import type { PeekWindow } from './windows/peekWindow'
import type { ClipboardMonitor } from './services/clipboardMonitor'
import type { ShelfItemOps } from './services/shelfItemOps'
import type { ShelfContextMenus } from './services/contextMenus'
import { decideRemoteShelfApply } from './remoteShelf'

export interface IpcRegistrarDeps {
  stateStore: StateStore
  nativeAgent: NativeAgentClient
  shelfWindow: ShelfWindow
  quickPasteWindow: QuickPasteWindow
  peekWindow: PeekWindow
  clipboardMonitor: ClipboardMonitor
  shelfController: ShelfController
  shelfActions: ShelfActions
  shelfOps: ShelfItemOps
  contextMenus: ShelfContextMenus
  preferencesSync: PreferencesSyncService
  broadcastState(): AppState
  onInactivityTick(): void
  remoteShelfWatermarks: Map<string, number>
  getAppVersion(): string
}

/**
 * Register every IPC channel the main process exposes. The registrar
 * is intentionally a single class so channel wiring is colocated and
 * the orchestrator (`index.ts`) doesn't have to know about every
 * individual channel.
 */
export class IpcRegistrar {
  constructor(private readonly deps: IpcRegistrarDeps) {}

  registerAll(): void {
    this.registerAppIpc()
    this.registerShelfIpc()
    this.registerItemIpc()
    this.registerPreferencesIpc()
    this.registerSyncIpc()
    this.registerClipboardIpc()
    this.registerDragIpc()
  }

  // ---- App / state ----

  private registerAppIpc(): void {
    ipcMain.handle(IPC_CHANNELS.getAppVersion, async () => this.deps.getAppVersion())
    ipcMain.handle(IPC_CHANNELS.getState, async () => this.deps.broadcastState())
    ipcMain.handle(IPC_CHANNELS.getPermissionStatus, async () =>
      this.deps.preferencesSync.currentPermissionStatus(),
    )
    ipcMain.handle(IPC_CHANNELS.openPermissionSettings, async () =>
      this.deps.nativeAgent.openPermissionSettings(),
    )
    ipcMain.on(IPC_CHANNELS.showToast, (_event, message: unknown, kind: unknown) => {
      const parsedMessage = toastMessageSchema.safeParse(message)
      if (!parsedMessage.success) return
      const parsedKind = toastKindSchema.safeParse(kind ?? 'info')
      if (!parsedKind.success) return
      const payload: ToastPayload = { message: parsedMessage.data, kind: parsedKind.data }
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue
        window.webContents.send(IPC_CHANNELS.showToast, payload)
      }
    })
    ipcMain.on(IPC_CHANNELS.shelfInteractionPing, () => this.deps.onInactivityTick())
  }

  // ---- Shelf ----

  private registerShelfIpc(): void {
    ipcMain.handle(IPC_CHANNELS.createShelf, async (_event, input: unknown) => {
      const parsed = createShelfInputSchema.parse(input)
      await this.deps.shelfController.createShelf(parsed.reason, screen.getCursorScreenPoint(), false)
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.restoreShelf, async (_event, id: unknown) => {
      await this.deps.shelfController.restoreShelf(shelfItemIdParamSchema.parse(id))
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.addPayload, async (_event, payload: unknown) => {
      await this.deps.shelfController.addPayloadsToLiveShelf(ingestPayloadListSchema.parse([payload]))
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.addPayloads, async (_event, payloads: unknown) => {
      await this.deps.shelfController.addPayloadsToLiveShelf(ingestPayloadListSchema.parse(payloads))
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.closeShelf, async () => {
      this.deps.shelfController.closeShelf()
      this.deps.onInactivityTick()
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.renameShelf, async (_event, input: unknown) =>
      this.deps.shelfOps.rename(renameShelfInputSchema.parse(input).name))
    ipcMain.handle(IPC_CHANNELS.clearShelf, async () => this.deps.shelfOps.clear())
    ipcMain.handle(IPC_CHANNELS.reorderItems, async (_event, input: unknown) =>
      this.deps.shelfOps.reorder(reorderItemsInputSchema.parse(input).itemIds))
    ipcMain.handle(IPC_CHANNELS.removeItem, async (_event, itemId: unknown) =>
      this.deps.shelfOps.remove(shelfItemIdParamSchema.parse(itemId)))
    ipcMain.handle(IPC_CHANNELS.shareShelfItems, async (_event, itemIds: unknown) =>
      this.deps.shelfActions.shareItems(shareShelfItemsInputSchema.parse(itemIds)),
    )
    ipcMain.handle(IPC_CHANNELS.getRecentShelves, async () =>
      this.deps.stateStore.getRecentShelves(),
    )
  }

  // ---- Items ----

  private registerItemIpc(): void {
    const ids = (itemId: unknown) => shelfItemIdParamSchema.parse(itemId)
    ipcMain.handle(IPC_CHANNELS.previewItem, async (_event, itemId: unknown) =>
      this.deps.shelfActions.previewItem(ids(itemId)),
    )
    ipcMain.handle(IPC_CHANNELS.revealItem, async (_event, itemId: unknown) =>
      this.deps.shelfActions.revealItem(ids(itemId)),
    )
    ipcMain.handle(IPC_CHANNELS.openItem, async (_event, itemId: unknown) =>
      this.deps.shelfActions.openItem(ids(itemId)),
    )
    ipcMain.handle(IPC_CHANNELS.copyItem, async (_event, itemId: unknown) =>
      this.deps.shelfActions.copyItem(ids(itemId)),
    )
    ipcMain.handle(IPC_CHANNELS.saveItem, async (_event, itemId: unknown) =>
      this.deps.shelfActions.saveItem(ids(itemId)),
    )
    ipcMain.handle(IPC_CHANNELS.relinkItem, async (_event, itemId: unknown) => {
      await this.deps.shelfActions.relinkItem(ids(itemId))
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.showItemContextMenu, async (_event, itemId: unknown) => {
      const validId = shelfItemIdParamSchema.parse(itemId)
      const item = this.liveItems().find((i) => i.id === validId)
      if (!item) return false
      this.deps.contextMenus.popupForItem(item)
      return true
    })
    ipcMain.handle(IPC_CHANNELS.showShelfContextMenu, async () => {
      this.deps.contextMenus.popupForShelf(this.liveItems())
      return true
    })
  }

  private liveItems(): ShelfItemRecord[] {
    return this.deps.stateStore.getLiveShelf()?.items ?? []
  }

  // ---- Preferences ----

  private registerPreferencesIpc(): void {
    ipcMain.handle(IPC_CHANNELS.getPreferences, async () => this.deps.stateStore.getPreferences())
    ipcMain.handle(IPC_CHANNELS.setPreferences, async (_event, patch: unknown) => {
      this.deps.stateStore.setPreferences(normalizePreferencePatch(preferencePatchSchema.parse(patch)))
      this.deps.preferencesSync.sync()
      await this.deps.nativeAgent.configureGesture(this.deps.stateStore.getPreferences())
      this.deps.broadcastState()
      this.deps.onInactivityTick()
      return this.deps.stateStore.getPreferences()
    })
  }

  // ---- Sync ----

  private registerSyncIpc(): void {
    ipcMain.handle(IPC_CHANNELS.setSyncState, async (_event, patch: unknown) => {
      this.deps.stateStore.setSyncState(syncStatePatchSchema.parse(patch))
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.getSyncBackfillCandidates, async () =>
      this.deps.stateStore.getAllShelves(),
    )
    ipcMain.handle(IPC_CHANNELS.applyRemoteShelf, async (_event, shelf: unknown) => {
      const parsed = shelfRecordSchema.parse(shelf)
      const lastSynced = this.deps.remoteShelfWatermarks.get(parsed.id) ?? null
      const decision = decideRemoteShelfApply({
        remote: parsed,
        local: this.findLocalShelf(parsed.id),
        lastSyncedRemoteUpdatedAt: lastSynced,
      })
      this.deps.remoteShelfWatermarks.set(parsed.id, decision.nextWatermark)
      if (decision.apply) {
        this.deps.shelfController.applyRemoteShelfSnapshot(parsed)
      }
      return this.deps.broadcastState()
    })
  }

  private findLocalShelf(id: string) {
    const live = this.deps.stateStore.getLiveShelf()
    if (live?.id === id) return live
    return this.deps.stateStore.getRecentShelves().find((shelf) => shelf.id === id) ?? null
  }

  // ---- Clipboard ----

  /**
   * Run a mutator against the state store and broadcast the new
   * state. Returns whatever the mutator returns (often the new
   * resource the caller wants to echo back, sometimes nothing).
   * Centralizes the "mutate + broadcast" boilerplate that every
   * clipboard IPC handler used to repeat by hand.
   */
  private async mutateAndBroadcast<T>(mutate: () => T): Promise<T> {
    const result = mutate()
    this.deps.broadcastState()
    return result
  }

  private registerClipboardIpc(): void {
    ipcMain.handle(IPC_CHANNELS.clipboardGetRecent, async (_event, input: unknown) => {
      const { limit } = clipboardGetRecentInputSchema.parse(input ?? { limit: 200 })
      return this.deps.stateStore.getClipboardEntries().slice(0, limit)
    })
    ipcMain.handle(IPC_CHANNELS.clipboardSettingsGet, async () =>
      this.deps.stateStore.getClipboardSettings(),
    )
    ipcMain.handle(IPC_CHANNELS.clipboardSettingsUpdate, async (_event, patch: unknown) => {
      this.deps.stateStore.updateClipboardSettings(clipboardSettingsUpdateSchema.parse(patch))
      this.deps.broadcastState()
      return this.deps.stateStore.getClipboardSettings()
    })
    ipcMain.handle(IPC_CHANNELS.clipboardCategoryCreate, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryCreateInputSchema.parse(payload)
      return this.mutateAndBroadcast(() =>
        this.deps.stateStore.createClipboardCategory(parsed.name, parsed.color),
      )
    })
    ipcMain.handle(IPC_CHANNELS.clipboardCategoryRename, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryRenameInputSchema.parse(payload)
      return this.mutateAndBroadcast(() =>
        this.deps.stateStore.renameClipboardCategory(parsed.id, parsed.name),
      )
    })
    ipcMain.handle(IPC_CHANNELS.clipboardCategoryRemove, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryIdInputSchema.parse(payload)
      return this.mutateAndBroadcast(() =>
        this.deps.stateStore.removeClipboardCategory(parsed.id),
      )
    })
    ipcMain.handle(IPC_CHANNELS.clipboardEntryAssign, async (_event, payload: unknown) => {
      const parsed = clipboardEntryCategoryAssignInputSchema.parse(payload)
      return this.mutateAndBroadcast(() =>
        this.deps.stateStore.assignEntryToCategory(parsed.entryId, parsed.categoryId),
      )
    })
    ipcMain.handle(IPC_CHANNELS.clipboardEntryUnassign, async (_event, payload: unknown) => {
      const parsed = clipboardEntryCategoryAssignInputSchema.parse(payload)
      return this.mutateAndBroadcast(() =>
        this.deps.stateStore.unassignEntryFromCategory(parsed.entryId, parsed.categoryId),
      )
    })
    ipcMain.handle(IPC_CHANNELS.clipboardEntryRemove, async (_event, payload: unknown) => {
      const parsed = clipboardEntryIdInputSchema.parse(payload)
      return this.mutateAndBroadcast(() =>
        this.deps.stateStore.removeClipboardEntry(parsed.entryId),
      )
    })
    ipcMain.handle(IPC_CHANNELS.clipboardEntryClearAll, async () =>
      this.mutateAndBroadcast(() => this.deps.stateStore.clearClipboardHistory()),
    )
    ipcMain.handle(IPC_CHANNELS.clipboardPruneNow, async () =>
      this.mutateAndBroadcast(() => this.deps.stateStore.pruneClipboardHistory()),
    )

    ipcMain.on(IPC_CHANNELS.clipboardStartItemDrag, (event, payload: unknown) => {
      const parsed = clipboardEntryIdInputSchema.parse(payload)
      const entry = this.deps.stateStore
        .getClipboardEntries()
        .find((candidate) => candidate.id === parsed.entryId)
      if (!entry) {
        event.returnValue = false
        return
      }
      const paths = fileBackedPathsFromEntry(entry)
      if (paths.length === 0) {
        event.returnValue = false
        return
      }
      try {
        startNativeDrag(event.sender, paths)
        event.returnValue = true
      } catch {
        event.returnValue = false
      }
    })

    ipcMain.on(IPC_CHANNELS.clipboardQuickPasteShow, () => {
      // Use the cached snapshot to avoid the IPC race where the palette
      // window itself becomes frontmost before we read the previous app.
      const previousBundleId = this.deps.clipboardMonitor.getLastFrontmostApp()?.bundleId ?? ''
      void this.deps.quickPasteWindow.show(previousBundleId)
    })
    ipcMain.on(IPC_CHANNELS.clipboardQuickPasteHide, () => {
      this.deps.quickPasteWindow.hide()
    })
    ipcMain.on(IPC_CHANNELS.clipboardQuickPasteFocusIndex, (_event, index: unknown) => {
      const n = z.number().int().min(0).max(8).safeParse(index)
      if (!n.success) return
      this.deps.quickPasteWindow.focusIndex(n.data)
    })
    ipcMain.handle(IPC_CHANNELS.clipboardQuickPastePaste, async (_event, payload: unknown) => {
      const parsed = clipboardQuickPastePasteInputSchema.parse(payload)
      const settings = this.deps.stateStore.getClipboardSettings()
      await quickPastePasteEntry(
        parsed.entryId,
        parsed.previousBundleId,
        (id) => this.deps.stateStore.getClipboardEntries().find((e) => e.id === id),
        settings,
        'com.ollayor.ledge',
      )
    })

    ipcMain.on(IPC_CHANNELS.clipboardPeekShow, () => {
      void this.deps.peekWindow.show()
    })
    ipcMain.on(IPC_CHANNELS.clipboardPeekHide, () => {
      this.deps.peekWindow.hide()
    })
  }

  // ---- Drag ----

  private registerDragIpc(): void {
    ipcMain.on(IPC_CHANNELS.startItemDrag, (event, itemId: unknown) => {
      // Defensive: reject malformed payloads instead of letting an exception bubble
      // out of the synchronous IPC handler (which would silently kill the reply).
      const parsed = z.string().uuid().safeParse(itemId)
      if (!parsed.success) {
        event.returnValue = false
        return
      }
      const paths = this.deps.shelfActions.draggablePathsForItemIds([parsed.data])
      if (paths.length === 0 || !pathsExist(paths)) {
        event.returnValue = false
        return
      }
      try {
        startNativeDrag(event.sender, paths)
        event.returnValue = true
      } catch {
        event.returnValue = false
      }
    })
    ipcMain.on(IPC_CHANNELS.startItemsDrag, (event, itemIds: unknown) => {
      const parsed = z.array(z.string().uuid()).max(MAX_DRAG_ITEM_IDS).safeParse(itemIds)
      if (!parsed.success) {
        event.returnValue = false
        return
      }
      const paths = this.deps.shelfActions.draggablePathsForItemIds(parsed.data)
      if (paths.length === 0 || !pathsExist(paths)) {
        event.returnValue = false
        return
      }
      try {
        startNativeDrag(event.sender, paths)
        event.returnValue = true
      } catch {
        event.returnValue = false
      }
    })
  }
}
