import { BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS, type ToastPayload } from '@shared/ipc'
import {
  createShelfInputSchema,
  ingestPayloadSchema,
  preferencePatchSchema,
  shelfRecordSchema,
  syncStatePatchSchema,
  type AppState,
  type ShelfItemRecord,
} from '@shared/schema'
import { isFileBackedItem } from '@shared/fileUtils'
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
import { decideRemoteShelfApply } from './remoteShelf'

const itemIdParamSchema = z.string().uuid()
const renameShelfParamSchema = z.object({ name: z.string().min(1).max(120) })
const reorderItemsParamSchema = z.object({ itemIds: z.array(itemIdParamSchema).max(1024) })
const shareShelfItemsParamSchema = z.array(itemIdParamSchema).max(1024).optional()

/** Cap the per-call payload count for `addPayloads`. */
const MAX_PAYLOADS_PER_REQUEST = 1024
const payloadListSchema = z.array(ingestPayloadSchema).max(MAX_PAYLOADS_PER_REQUEST)

const clipboardEntryIdSchema = z.object({ entryId: z.string().min(1) })
const clipboardCategoryCreatePayloadSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.enum(['ember', 'wave', 'forest', 'sand']),
})
const clipboardCategoryIdPayloadSchema = z.object({ id: z.string().min(1) })
const clipboardCategoryRenamePayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
})
const clipboardEntryCategoryAssignPayloadSchema = z.object({
  entryId: z.string().min(1),
  categoryId: z.string().min(1),
})
const clipboardSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    historyLimit: z.number().int().positive().max(2000).optional(),
    ignoreConcealedItems: z.boolean().optional(),
    ignoreBundleIds: z.array(z.string()).optional(),
    quickPasteHotkey: z.string().optional(),
    peekHotkey: z.string().optional(),
    syntheticPasteEnabled: z.boolean().optional(),
  })
  .strict()
const clipboardQuickPastePastePayloadSchema = z.object({
  entryId: z.string().min(1),
  previousBundleId: z.string().default(''),
})

// Cap the message length and clamp the kind so a compromised or buggy
// renderer can't spam the user with arbitrary toast content.
const TOAST_MESSAGE_MAX = 500
const toastMessageSchema = z.string().min(1).max(TOAST_MESSAGE_MAX)
const toastKindSchema = z.enum(['info', 'success', 'error'])

export interface IpcRegistrarDeps {
  stateStore: StateStore
  nativeAgent: NativeAgentClient
  shelfWindow: ShelfWindow
  quickPasteWindow: QuickPasteWindow
  peekWindow: PeekWindow
  clipboardMonitor: ClipboardMonitor
  shelfController: ShelfController
  shelfActions: ShelfActions
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
      await this.deps.shelfController.restoreShelf(itemIdParamSchema.parse(id))
      this.deps.onInactivityTick()
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.addPayload, async (_event, payload: unknown) => {
      await this.deps.shelfController.addPayloadsToLiveShelf(payloadListSchema.parse([payload]))
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.addPayloads, async (_event, payloads: unknown) => {
      await this.deps.shelfController.addPayloadsToLiveShelf(payloadListSchema.parse(payloads))
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.closeShelf, async () => {
      this.deps.shelfController.closeShelf()
      this.deps.onInactivityTick()
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.renameShelf, async (_event, input: unknown) => {
      this.deps.stateStore.renameLiveShelf(renameShelfParamSchema.parse(input).name)
      this.deps.onInactivityTick()
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.clearShelf, async () => {
      this.deps.stateStore.clearLiveShelf()
      this.deps.onInactivityTick()
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.reorderItems, async (_event, input: unknown) => {
      this.deps.stateStore.reorderItems(reorderItemsParamSchema.parse(input).itemIds)
      this.deps.onInactivityTick()
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.removeItem, async (_event, itemId: unknown) => {
      this.deps.stateStore.removeItem(itemIdParamSchema.parse(itemId))
      this.deps.onInactivityTick()
      return this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.shareShelfItems, async (_event, itemIds: unknown) =>
      this.deps.shelfActions.shareItems(shareShelfItemsParamSchema.parse(itemIds)),
    )
    ipcMain.handle(IPC_CHANNELS.getRecentShelves, async () =>
      this.deps.stateStore.getRecentShelves(),
    )
  }

  // ---- Items ----

  private registerItemIpc(): void {
    const ids = (itemId: unknown) => itemIdParamSchema.parse(itemId)
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
      const validId = itemIdParamSchema.parse(itemId)
      const item = this.liveItems().find((i) => i.id === validId)
      if (!item) return false
      this.popupItemMenu(item)
      return true
    })
    ipcMain.handle(IPC_CHANNELS.showShelfContextMenu, async () => {
      this.popupShelfMenu(this.liveItems())
      return true
    })
  }

  private popupItemMenu(item: ShelfItemRecord): void {
    const missing = isFileBackedItem(item) && item.file.isMissing
    const template: Electron.MenuItemConstructorOptions[] = []

    if (isFileBackedItem(item)) {
      template.push(
        { label: 'Quick Look', enabled: !missing, click: () => this.deps.shelfActions.previewItem(item.id) },
        { label: 'Reveal in Finder', enabled: !missing, click: () => this.deps.shelfActions.revealItem(item.id) },
        { label: 'Open', enabled: !missing, click: () => this.deps.shelfActions.openItem(item.id) },
        { label: 'Relink…', click: () => void this.deps.shelfActions.relinkItem(item.id) },
        { type: 'separator' },
        { label: 'Share', enabled: true, click: () => void this.deps.shelfActions.shareItems([item.id]) },
      )
    } else if (item.kind === 'text' || item.kind === 'url') {
      template.push(
        { label: 'Copy', click: () => void this.deps.shelfActions.copyItem(item.id) },
        { label: 'Save', click: () => void this.deps.shelfActions.saveItem(item.id) },
      )
      if (item.kind === 'url') {
        template.push({ label: 'Open', click: () => void this.deps.shelfActions.openItem(item.id) })
      }
    }

    template.push(
      { type: 'separator' },
      {
        label: 'Remove Item',
        click: () => {
          this.deps.stateStore.removeItem(item.id)
          this.deps.onInactivityTick()
          this.deps.broadcastState()
        },
      },
    )

    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: this.deps.shelfWindow.getBrowserWindow() ?? undefined })
  }

  private popupShelfMenu(items: ShelfItemRecord[]): void {
    const template: Electron.MenuItemConstructorOptions[] = []

    if (items.length > 0) {
      const primaryItem = items[0]
      const missing = isFileBackedItem(primaryItem) && primaryItem.file.isMissing

      template.push(
        { label: 'Quick Look', enabled: !missing, click: () => this.deps.shelfActions.previewItem(primaryItem.id) },
        { label: 'Reveal in Finder', enabled: !missing, click: () => this.deps.shelfActions.revealItem(primaryItem.id) },
        { label: 'Open', enabled: !missing, click: () => this.deps.shelfActions.openItem(primaryItem.id) },
        { label: 'Copy', click: () => void this.deps.shelfActions.copyItem(primaryItem.id) },
        { label: 'Save', click: () => void this.deps.shelfActions.saveItem(primaryItem.id) },
        { type: 'separator' },
      )
    }

    template.push(
      { label: 'Share All', enabled: items.length > 0, click: () => void this.deps.shelfActions.shareItems() },
      { type: 'separator' },
      {
        label: 'Clear Shelf',
        enabled: items.length > 0,
        click: () => {
          this.deps.stateStore.clearLiveShelf()
          this.deps.onInactivityTick()
          this.deps.broadcastState()
        },
      },
      {
        label: 'Close Shelf',
        click: () => {
          this.deps.shelfController.closeShelf()
          this.deps.onInactivityTick()
          this.deps.broadcastState()
        },
      },
    )

    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: this.deps.shelfWindow.getBrowserWindow() ?? undefined })
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

  private registerClipboardIpc(): void {
    ipcMain.handle(IPC_CHANNELS.clipboardGetRecent, async (_event, input: unknown) => {
      const limit = (
        z.object({ limit: z.number().int().positive().max(500) }).parse(input ?? { limit: 200 })
      ).limit
      return this.deps.stateStore.getClipboardEntries().slice(0, limit)
    })
    ipcMain.handle(IPC_CHANNELS.clipboardSettingsGet, async () =>
      this.deps.stateStore.getClipboardSettings(),
    )
    ipcMain.handle(IPC_CHANNELS.clipboardSettingsUpdate, async (_event, patch: unknown) => {
      this.deps.stateStore.updateClipboardSettings(clipboardSettingsPatchSchema.parse(patch))
      this.deps.broadcastState()
      return this.deps.stateStore.getClipboardSettings()
    })
    ipcMain.handle(IPC_CHANNELS.clipboardCategoryCreate, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryCreatePayloadSchema.parse(payload)
      const created = this.deps.stateStore.createClipboardCategory(parsed.name, parsed.color)
      this.deps.broadcastState()
      return created
    })
    ipcMain.handle(IPC_CHANNELS.clipboardCategoryRename, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryRenamePayloadSchema.parse(payload)
      this.deps.stateStore.renameClipboardCategory(parsed.id, parsed.name)
      this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.clipboardCategoryRemove, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryIdPayloadSchema.parse(payload)
      this.deps.stateStore.removeClipboardCategory(parsed.id)
      this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.clipboardEntryAssign, async (_event, payload: unknown) => {
      const parsed = clipboardEntryCategoryAssignPayloadSchema.parse(payload)
      this.deps.stateStore.assignEntryToCategory(parsed.entryId, parsed.categoryId)
      this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.clipboardEntryUnassign, async (_event, payload: unknown) => {
      const parsed = clipboardEntryCategoryAssignPayloadSchema.parse(payload)
      this.deps.stateStore.unassignEntryFromCategory(parsed.entryId, parsed.categoryId)
      this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.clipboardEntryRemove, async (_event, payload: unknown) => {
      const parsed = clipboardEntryIdSchema.parse(payload)
      this.deps.stateStore.removeClipboardEntry(parsed.entryId)
      this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.clipboardEntryClearAll, async () => {
      this.deps.stateStore.clearClipboardHistory()
      this.deps.broadcastState()
    })
    ipcMain.handle(IPC_CHANNELS.clipboardPruneNow, async () => {
      this.deps.stateStore.pruneClipboardHistory()
      this.deps.broadcastState()
    })

    ipcMain.on(IPC_CHANNELS.clipboardStartItemDrag, (event, payload: unknown) => {
      const parsed = clipboardEntryIdSchema.parse(payload)
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
      const parsed = clipboardQuickPastePastePayloadSchema.parse(payload)
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
      const parsed = z.array(z.string().uuid()).max(64).safeParse(itemIds)
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
