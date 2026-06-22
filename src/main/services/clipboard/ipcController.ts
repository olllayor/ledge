import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  clipboardCategoryCreateInputSchema,
  clipboardCategoryIdInputSchema,
  clipboardCategoryRenameInputSchema,
  clipboardCopyInputSchema,
  clipboardEntryCategoryAssignInputSchema,
  clipboardEntryIdInputSchema,
  clipboardGetRecentInputSchema,
  clipboardQuickPastePasteInputSchema,
  clipboardSettingsUpdateSchema
} from '@shared/ipcSchemas'
import { startNativeDrag } from '../dragController'
import { copyEntryToPasteboard, fileBackedPathsFromEntry, quickPastePasteEntry } from '../quickPaste'
import type { StateStore } from '../stateStore'
import type { ClipboardMonitor } from '../clipboardMonitor'
import type { QuickPasteWindow } from '../../windows/quickPasteWindow'
import type { PeekWindow } from '../../windows/peekWindow'
import type { WebContents } from 'electron'
import type { ClipboardWriter } from './writer'

/**
 * Single owner of every clipboard-related IPC channel. The
 * `IpcRegistrar` becomes a thin glue layer that just calls
 * `this.deps.clipboardIpc.registerAll()`; the body of the clipboard
 * surface lives here so a future change to clipboard IPC doesn't
 * have to touch the multi-channel registrar.
 */
export interface ClipboardIpcDeps {
  stateStore: StateStore
  clipboardMonitor: ClipboardMonitor
  quickPasteWindow: QuickPasteWindow
  peekWindow: PeekWindow
  broadcastState(): void
  /** Optional override so tests can register a fake main module. */
  ipcMain?: { handle: typeof ipcMain.handle; on: typeof ipcMain.on }
  /** Optional writer override so tests can capture writes without
   *  touching the real Electron clipboard. */
  clipboardWriter?: ClipboardWriter
  /** Bundle id used to short-circuit "paste back into Ledge" checks. */
  ledgeBundleId?: string
}

export class ClipboardIpcController {
  constructor(private readonly deps: ClipboardIpcDeps) {}

  private get bus(): NonNullable<ClipboardIpcDeps['ipcMain']> {
    return this.deps.ipcMain ?? ipcMain
  }

  registerAll(): void {
    this.registerHistoryChannels()
    this.registerCopyChannel()
    this.registerSettingsChannels()
    this.registerCategoryChannels()
    this.registerEntryMutationChannels()
    this.registerDragChannel()
    this.registerQuickPasteChannels()
    this.registerPeekChannels()
  }

  // ---- Copy (in-app) ---------------------------------------------------

  private registerCopyChannel(): void {
    this.bus.handle(IPC_CHANNELS.clipboardCopy, async (_event, payload: unknown) => {
      const parsed = clipboardCopyInputSchema.parse(payload)
      return copyEntryToPasteboard(
        parsed.entryId,
        (id) => this.deps.stateStore.getClipboardEntries().find((e) => e.id === id),
        this.deps.clipboardWriter,
      )
    })
  }

  // ---- Settings --------------------------------------------------------

  private registerSettingsChannels(): void {
    this.bus.handle(IPC_CHANNELS.clipboardSettingsGet, async () =>
      this.deps.stateStore.getClipboardSettings(),
    )
    this.bus.handle(IPC_CHANNELS.clipboardSettingsUpdate, async (_event, patch: unknown) => {
      this.deps.stateStore.updateClipboardSettings(clipboardSettingsUpdateSchema.parse(patch))
      this.deps.broadcastState()
      return this.deps.stateStore.getClipboardSettings()
    })
  }

  // ---- History ---------------------------------------------------------

  private registerHistoryChannels(): void {
    this.bus.handle(IPC_CHANNELS.clipboardGetRecent, async (_event, input: unknown) => {
      const { limit } = clipboardGetRecentInputSchema.parse(input ?? { limit: 200 })
      return this.deps.stateStore.getClipboardEntries().slice(0, limit)
    })
    this.bus.handle(IPC_CHANNELS.clipboardEntryClearAll, async () => {
      this.deps.stateStore.clearClipboardHistory()
      this.deps.broadcastState()
    })
    this.bus.handle(IPC_CHANNELS.clipboardPruneNow, async () => {
      this.deps.stateStore.pruneClipboardHistory()
      this.deps.broadcastState()
    })
  }

  // ---- Categories ------------------------------------------------------

  private registerCategoryChannels(): void {
    this.bus.handle(IPC_CHANNELS.clipboardCategoryCreate, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryCreateInputSchema.parse(payload)
      const created = this.deps.stateStore.createClipboardCategory(parsed.name, parsed.color)
      this.deps.broadcastState()
      return created
    })
    this.bus.handle(IPC_CHANNELS.clipboardCategoryRename, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryRenameInputSchema.parse(payload)
      this.deps.stateStore.renameClipboardCategory(parsed.id, parsed.name)
      this.deps.broadcastState()
    })
    this.bus.handle(IPC_CHANNELS.clipboardCategoryRemove, async (_event, payload: unknown) => {
      const parsed = clipboardCategoryIdInputSchema.parse(payload)
      this.deps.stateStore.removeClipboardCategory(parsed.id)
      this.deps.broadcastState()
    })
  }

  // ---- Entry mutations -------------------------------------------------

  private registerEntryMutationChannels(): void {
    this.bus.handle(IPC_CHANNELS.clipboardEntryAssign, async (_event, payload: unknown) => {
      const parsed = clipboardEntryCategoryAssignInputSchema.parse(payload)
      this.deps.stateStore.assignEntryToCategory(parsed.entryId, parsed.categoryId)
      this.deps.broadcastState()
    })
    this.bus.handle(IPC_CHANNELS.clipboardEntryUnassign, async (_event, payload: unknown) => {
      const parsed = clipboardEntryCategoryAssignInputSchema.parse(payload)
      this.deps.stateStore.unassignEntryFromCategory(parsed.entryId, parsed.categoryId)
      this.deps.broadcastState()
    })
    this.bus.handle(IPC_CHANNELS.clipboardEntryRemove, async (_event, payload: unknown) => {
      const parsed = clipboardEntryIdInputSchema.parse(payload)
      this.deps.stateStore.removeClipboardEntry(parsed.entryId)
      this.deps.broadcastState()
    })
  }

  // ---- Drag-out --------------------------------------------------------

  private registerDragChannel(): void {
    this.bus.on(IPC_CHANNELS.clipboardStartItemDrag, (event, payload: unknown) => {
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
        startNativeDrag(event.sender as WebContents, paths)
        event.returnValue = true
      } catch {
        event.returnValue = false
      }
    })
  }

  // ---- Quick paste -----------------------------------------------------

  private registerQuickPasteChannels(): void {
    this.bus.on(IPC_CHANNELS.clipboardQuickPasteShow, () => {
      // Use the cached snapshot to avoid the IPC race where the palette
      // window itself becomes frontmost before we read the previous app.
      const previousBundleId = this.deps.clipboardMonitor.getLastFrontmostApp()?.bundleId ?? ''
      void this.deps.quickPasteWindow.show(previousBundleId)
    })
    this.bus.on(IPC_CHANNELS.clipboardQuickPasteHide, () => {
      this.deps.quickPasteWindow.hide()
    })
    this.bus.on(IPC_CHANNELS.clipboardQuickPasteFocusIndex, (_event, index: unknown) => {
      const n = z.number().int().min(0).max(8).safeParse(index)
      if (!n.success) return
      this.deps.quickPasteWindow.focusIndex(n.data)
    })
    this.bus.handle(IPC_CHANNELS.clipboardQuickPastePaste, async (_event, payload: unknown) => {
      const parsed = clipboardQuickPastePasteInputSchema.parse(payload)
      const settings = this.deps.stateStore.getClipboardSettings()
      await quickPastePasteEntry(
        parsed.entryId,
        parsed.previousBundleId,
        (id) => this.deps.stateStore.getClipboardEntries().find((e) => e.id === id),
        settings,
        this.deps.ledgeBundleId ?? 'com.ollayor.ledge',
      )
    })
  }

  // ---- Peek ------------------------------------------------------------

  private registerPeekChannels(): void {
    this.bus.on(IPC_CHANNELS.clipboardPeekShow, () => {
      void this.deps.peekWindow.show()
    })
    this.bus.on(IPC_CHANNELS.clipboardPeekHide, () => {
      this.deps.peekWindow.hide()
    })
  }
}
