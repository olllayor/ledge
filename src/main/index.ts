import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  ipcMain,
  nativeImage,
  net,
  protocol as protocolModule,
  screen,
  shell,
} from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve as resolvePath, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS,  type ToastPayload } from '@shared/ipc';
import {
  appStateSchema,
  createShelfInputSchema,
  ingestPayloadSchema,
  permissionStatusSchema,
  preferencePatchSchema,
  shelfRecordSchema,
  syncStatePatchSchema,
  type AppState,
  type IngestPayload,
  type PermissionStatus,
  type ShelfItemRecord,
  type ShelfRecord,
} from '@shared/schema';
import { z } from 'zod';
import { normalizeExcludedBundleIds } from '@shared/preferences';
import { NativeAgentClient, type ShakeDetectedEvent } from './native/nativeAgent';
import {
  payloadToItems,
  detectPayloadFromText,
  refreshFileRef,
  ImportedImageTooLargeError,
} from './services/payloads';
import { getFileBackedPath, isFileBackedItem } from '@shared/fileUtils';
import {
  isOpenPathSuccess,
  normalizeGlobalShortcut,
  urlToWebloc,
  validateGlobalShortcut,
} from './services/systemUtils';
import { StateStore } from './services/stateStore';
import { decideRemoteShelfApply, sanitizeRemoteFileRefs } from './remoteShelf';

/**
 * Per-shelf watermark of the most recent remote `updatedAt` we have
 * applied. Used by `applyRemoteShelfSnapshot` to decide whether a new
 * remote snapshot carries state we haven't seen yet. In-memory only —
 * the renderer already debounces re-sends of identical timestamps via
 * `lastAppliedRemoteByShelf`, so a fresh app launch simply re-applies
 * the most recent remote, which is idempotent.
 */
const remoteShelfWatermarks = new Map<string, number>();
import { InactivityTimer } from './services/inactivityTimer';
import { PreferencesWindow } from './windows/preferencesWindow';
import { ShelfWindow } from './windows/shelfWindow';
import { TrayController } from './tray';

let stateStore: StateStore;
let nativeAgent: NativeAgentClient;
let tray: TrayController;
let shelfWindow: ShelfWindow;
let preferencesWindow: PreferencesWindow;
let inactivityTimer: InactivityTimer;
let shortcutStatus: Pick<PermissionStatus, 'shortcutRegistered' | 'shortcutError'> = {
  shortcutRegistered: false,
  shortcutError: '',
};
const PROJECT_URL = 'https://github.com/olllayor/ledge';
const WHATS_NEW_URL = `${PROJECT_URL}/releases`;
const QUICK_START_URL = `${PROJECT_URL}#readme`;
const ASSET_PROTOCOL = 'ledge-asset';

const PERSISTENCE_ERROR_TOAST_THROTTLE_MS = 30_000;
let lastPersistenceErrorToastAt = 0;

// Last-resort safety nets. These should never fire under normal operation,
// but if they do we want a stable log line and a user-visible toast rather
// than a silent crash or a hung renderer waiting for a response that will
// never come.
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[ledge] unhandledRejection:', reason)
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IPC_CHANNELS.showToast, {
      message: 'Ledge hit an unexpected error. The app should still respond; please report this if it repeats.',
      kind: 'error',
    })
  }
})

process.on('uncaughtException', (error) => {
  console.error('[ledge] uncaughtException:', error)
})

protocolModule.registerSchemesAsPrivileged([
  {
    scheme: ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  app.setName('Ledge');
  protocolModule.handle(ASSET_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');

    if (!path) {
      console.error('[ledge] asset request missing path param');
      return new Response('Missing asset path.', { status: 400 });
    }

    const allowedPath = resolveAllowedAssetPath(path);
    if (!allowedPath) {
      console.error('[ledge] asset path not allowed (path redacted)');
      return new Response('Asset path is not allowed.', { status: 403 });
    }


    if (extname(allowedPath).toLowerCase() === '.icns') {
      try {
        const pngBuffer = execFileSync('sips', ['-s', 'format', 'png', '--out', '/dev/stdout', allowedPath]);
        return new Response(pngBuffer, {
          headers: { 'Content-Type': 'image/png' },
        });
      } catch (err) {
        console.error('[ledge] icns conversion failed:', err);
      }
    }

    return net.fetch(pathToFileURL(allowedPath).toString());
  });

  stateStore = new StateStore(app.getPath('userData'), {
    onPersistenceError: () => {
      // Suppress repeat toasts so a tight loop on EACCES/ENOSPC doesn't spam
      // the user. The error is still logged to the console above.
      const now = Date.now()
      if (now - lastPersistenceErrorToastAt < PERSISTENCE_ERROR_TOAST_THROTTLE_MS) {
        return
      }
      lastPersistenceErrorToastAt = now
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.showToast, {
          message: 'Ledge couldn’t save your latest changes. The state file may be read-only or full.',
          kind: 'error',
        })
      }
    },
    onCorruptionDetected: ({ backupPath }) => {
      // Surface state corruption loudly: the previous state.json was
      // unreadable and was moved aside to avoid being overwritten. The
      // backup is in userData so support can recover the user’s shelves.
      const message = `Ledge couldn’t read your saved state. A backup was kept at ${backupPath}.`
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue
        window.webContents.send(IPC_CHANNELS.showToast, { message, kind: 'error' })
      }
    },
  });
  nativeAgent = new NativeAgentClient();
  shelfWindow = new ShelfWindow();
  preferencesWindow = new PreferencesWindow();
  inactivityTimer = new InactivityTimer(() => {
    if (
      stateStore.getPreferences().shelfInteraction.autoRetract &&
      shelfWindow.isVisible()
    ) {
      shelfWindow.hide();
    }
  });
  tray = new TrayController({
    onNewShelf: () => {
      void createShelf('tray', currentCursorPoint(), false);
    },
    onNewShelfFromClipboard: () => {
      void createShelfFromClipboard();
    },
    onOpenPreferences: () => {
      void preferencesWindow.show();
    },
    onOpenWhatsNew: () => {
      void shell.openExternal(WHATS_NEW_URL);
    },
    onOpenQuickStart: () => {
      void shell.openExternal(QUICK_START_URL);
    },
    onOpenAbout: () => {
      app.showAboutPanel();
    },
    onRestoreShelf: (id) => {
      void restoreShelf(id);
    },
    onDropFiles: (paths) => {
      void handleExternalPayloads([{ kind: 'fileDrop', paths }], 'tray');
    },
    onDropText: (text) => {
      void handleExternalPayloads([detectPayloadFromText(text)], 'tray');
    },
    onQuit: () => {
      app.quit();
    },
  });

  Menu.setApplicationMenu(null);

  nativeAgent.on('statusChanged', () => {
    broadcastState();
  });
  await nativeAgent.start();
  nativeAgent.on('shakeDetected', (event: ShakeDetectedEvent) => {
    void handleShakeDetected(event);
  });

  syncSystemPreferences();
  await nativeAgent.configureGesture(stateStore.getPreferences());
  broadcastState();
  registerIpc();
});

app.on('activate', () => {
  // Ledge is a menu-bar-only app. macOS may transiently show a dock icon
  // (for example, when state restoration re-activates us from Finder), so
  // re-assert dock-hidden every time the app is re-activated.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }
  void preferencesWindow.show();
});

let isFlushingStateForQuit = false;
// Cap how long we'll wait for the in-flight state.json write to
// finish before letting the app exit. Most writes complete in <50ms;
// the 1500ms ceiling is well below the user's tolerance for an
// unresponsive quit dialog, and it bounds the worst case (a stalled
// EACCES write that's blocking the write queue).
const QUIT_FLUSH_TIMEOUT_MS = 1500;

app.on('before-quit', (event) => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }
  // Drain the state-store write queue before letting the app exit.
  // Without this, a quick drop-then-quit (or any IPC reply that
  // triggered a save) can leave state.json half-written as a
  // `.tmp-PID` sibling; the next launch would then trip the
  // corruption handler and lose the most recent change. The first
  // time `before-quit` fires, we cancel the default quit, flush,
  // and re-quit. Subsequent firings (the re-quit) pass through.
  if (isFlushingStateForQuit) {
    return;
  }
  if (!stateStore || stateStore.whenIdle === undefined) {
    return;
  }
  event.preventDefault();
  isFlushingStateForQuit = true;
  const flush = stateStore.whenIdle().catch((error: unknown) => {
    console.error('[ledge] failed to flush state on quit:', error);
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn(`[ledge] state flush exceeded ${QUIT_FLUSH_TIMEOUT_MS}ms; forcing quit`);
      resolve();
    }, QUIT_FLUSH_TIMEOUT_MS);
  });
  void Promise.race([flush, timeout]).finally(() => {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
    app.quit();
  });
});

const itemIdParamSchema = z.string().uuid()
const renameShelfParamSchema = z.object({ name: z.string().min(1).max(120) })
const reorderItemsParamSchema = z.object({ itemIds: z.array(itemIdParamSchema).max(1024) })
const shareShelfItemsParamSchema = z.array(itemIdParamSchema).max(1024).optional()

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getAppVersion, async () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS.getState, async () => broadcastState());
  ipcMain.handle(IPC_CHANNELS.createShelf, async (_event, input: unknown) => {
    const parsed = createShelfInputSchema.parse(input);
    await createShelf(parsed.reason, currentCursorPoint(), false);
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.restoreShelf, async (_event, id: unknown) => restoreShelf(itemIdParamSchema.parse(id)));
  // Cap the per-call payload count. A compromised or buggy renderer
  // could otherwise ship tens of thousands of payloads in a single
  // request, each of which is base64-decoded and (for images) buffered
  // into memory before validation. 1024 is far more than any realistic
  // paste / drop event; the UI splits drops into multiple calls when
  // they exceed this size.
  const MAX_PAYLOADS_PER_REQUEST = 1024;
  const payloadListSchema = z.array(ingestPayloadSchema).max(MAX_PAYLOADS_PER_REQUEST);
  ipcMain.handle(IPC_CHANNELS.addPayload, async (_event, payload: unknown) => {
    await addPayloadsToLiveShelf(payloadListSchema.parse([payload]));
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.addPayloads, async (_event, payloads: unknown) => {
    const parsedPayloads = payloadListSchema.parse(payloads);
    await addPayloadsToLiveShelf(parsedPayloads);
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.closeShelf, async () => {
    stateStore.closeShelf();
    shelfWindow.resetPosition();
    shelfWindow.hide();
    inactivityTimer.clear();
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.getPreferences, async () => stateStore.getPreferences());
  ipcMain.handle(IPC_CHANNELS.setPreferences, async (_event, patch: unknown) => {
    stateStore.setPreferences(normalizePreferencePatch(preferencePatchSchema.parse(patch)));
    syncSystemPreferences();
    await nativeAgent.configureGesture(stateStore.getPreferences());
    broadcastState();
    tickInactivity();
    return stateStore.getPreferences();
  });
  ipcMain.handle(IPC_CHANNELS.setSyncState, async (_event, patch: unknown) => {
    stateStore.setSyncState(syncStatePatchSchema.parse(patch));
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.getSyncBackfillCandidates, async () => stateStore.getAllShelves());
  ipcMain.handle(IPC_CHANNELS.applyRemoteShelf, async (_event, shelf: unknown) => {
    applyRemoteShelfSnapshot(shelfRecordSchema.parse(shelf));
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.relinkItem, async (_event, itemId: unknown) => {
    await relinkItem(itemIdParamSchema.parse(itemId));
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.getRecentShelves, async () => stateStore.getRecentShelves());
  ipcMain.handle(IPC_CHANNELS.getPermissionStatus, async () => currentPermissionStatus());
  ipcMain.handle(IPC_CHANNELS.openPermissionSettings, async () => nativeAgent.openPermissionSettings());
  ipcMain.handle(IPC_CHANNELS.previewItem, async (_event, itemId: unknown) => previewItem(itemIdParamSchema.parse(itemId)));
  ipcMain.handle(IPC_CHANNELS.revealItem, async (_event, itemId: unknown) => revealItem(itemIdParamSchema.parse(itemId)));
  ipcMain.handle(IPC_CHANNELS.openItem, async (_event, itemId: unknown) => openItem(itemIdParamSchema.parse(itemId)));
  ipcMain.handle(IPC_CHANNELS.copyItem, async (_event, itemId: unknown) => copyItem(itemIdParamSchema.parse(itemId)));
  ipcMain.handle(IPC_CHANNELS.saveItem, async (_event, itemId: unknown) => saveItem(itemIdParamSchema.parse(itemId)));
  ipcMain.handle(IPC_CHANNELS.removeItem, async (_event, itemId: unknown) => {
    stateStore.removeItem(itemIdParamSchema.parse(itemId));
    tickInactivity();
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.renameShelf, async (_event, input: unknown) => {
    stateStore.renameLiveShelf(renameShelfParamSchema.parse(input).name);
    tickInactivity();
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.clearShelf, async () => {
    stateStore.clearLiveShelf();
    tickInactivity();
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.reorderItems, async (_event, input: unknown) => {
    stateStore.reorderItems(reorderItemsParamSchema.parse(input).itemIds);
    tickInactivity();
    return broadcastState();
  });
  ipcMain.handle(IPC_CHANNELS.shareShelfItems, async (_event, itemIds: unknown) => shareItems(shareShelfItemsParamSchema.parse(itemIds)));
  ipcMain.handle(IPC_CHANNELS.showItemContextMenu, async (_event, itemId: unknown) => {
    const validId = itemIdParamSchema.parse(itemId);
    const item = liveShelfItems().find((i) => i.id === validId);
    if (!item) return false;

    const missing = isFileBackedItem(item) && item.file.isMissing;
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (isFileBackedItem(item)) {
      template.push(
        { label: 'Quick Look', enabled: !missing, click: () => previewItem(item.id) },
        { label: 'Reveal in Finder', enabled: !missing, click: () => revealItem(item.id) },
        { label: 'Open', enabled: !missing, click: () => openItem(item.id) },
        { label: 'Relink…', click: () => relinkItem(item.id) },
        { type: 'separator' },
        { label: 'Share', enabled: true, click: () => shareItems([item.id]) },
      );
    } else if (item.kind === 'text' || item.kind === 'url') {
      template.push(
        { label: 'Copy', click: () => copyItem(item.id) },
        { label: 'Save', click: () => saveItem(item.id) },
      );
      if (item.kind === 'url') {
        template.push({ label: 'Open', click: () => openItem(item.id) });
      }
    }

    template.push(
      { type: 'separator' },
      {
        label: 'Remove Item',
        click: () => {
          stateStore.removeItem(item.id);
          tickInactivity();
          broadcastState();
        },
      },
    );

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: shelfWindow.getBrowserWindow() ?? undefined });
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.showShelfContextMenu, async () => {
    const items = liveShelfItems();
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (items.length > 0) {
      const primaryItem = items[0];
      const missing = isFileBackedItem(primaryItem) && primaryItem.file.isMissing;

      template.push(
        { label: 'Quick Look', enabled: !missing, click: () => previewItem(primaryItem.id) },
        { label: 'Reveal in Finder', enabled: !missing, click: () => revealItem(primaryItem.id) },
        { label: 'Open', enabled: !missing, click: () => openItem(primaryItem.id) },
        { label: 'Copy', click: () => copyItem(primaryItem.id) },
        { label: 'Save', click: () => saveItem(primaryItem.id) },
        { type: 'separator' },
      );
    }

    template.push(
      { label: 'Share All', enabled: items.length > 0, click: () => shareItems() },
      { type: 'separator' },
      {
        label: 'Clear Shelf',
        enabled: items.length > 0,
        click: () => {
          stateStore.clearLiveShelf();
          tickInactivity();
          broadcastState();
        },
      },
      {
        label: 'Close Shelf',
        click: () => {
          stateStore.closeShelf();
          shelfWindow.resetPosition();
          shelfWindow.hide();
          inactivityTimer.clear();
          broadcastState();
        },
      },
    );

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: shelfWindow.getBrowserWindow() ?? undefined });
    return true;
  });

  // Cap the message length and clamp the kind so a compromised or buggy
  // renderer can't spam the user with arbitrary toast content.
  const TOAST_MESSAGE_MAX = 500;
  const toastMessageSchema = z.string().min(1).max(TOAST_MESSAGE_MAX);
  const toastKindSchema = z.enum(['info', 'success', 'error']);
  ipcMain.on(IPC_CHANNELS.showToast, (_event, message: unknown, kind: unknown) => {
    const parsedMessage = toastMessageSchema.safeParse(message);
    if (!parsedMessage.success) {
      return;
    }
    const parsedKind = toastKindSchema.safeParse(kind ?? 'info');
    if (!parsedKind.success) {
      return;
    }
    const payload: ToastPayload = { message: parsedMessage.data, kind: parsedKind.data };
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(IPC_CHANNELS.showToast, payload);
    }
  });

  ipcMain.on(IPC_CHANNELS.shelfInteractionPing, () => {
    tickInactivity();
  });

  ipcMain.on(IPC_CHANNELS.startItemDrag, (event, itemId: unknown) => {
    // Defensive: reject malformed payloads instead of letting an exception bubble
    // out of the synchronous IPC handler (which would silently kill the reply).
    const parsed = z.string().uuid().safeParse(itemId);
    if (!parsed.success) {
      event.returnValue = false;
      return;
    }
    const paths = draggablePathsForItemIds([parsed.data]);
    if (paths.length === 0 || !pathsExist(paths)) {
      event.returnValue = false;
      return;
    }

    try {
      startNativeDrag(event.sender, paths);
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });
  ipcMain.on(IPC_CHANNELS.startItemsDrag, (event, itemIds: unknown) => {
    const parsed = z.array(z.string().uuid()).max(64).safeParse(itemIds);
    if (!parsed.success) {
      event.returnValue = false;
      return;
    }
    const paths = draggablePathsForItemIds(parsed.data);
    if (paths.length === 0 || !pathsExist(paths)) {
      event.returnValue = false;
      return;
    }

    try {
      startNativeDrag(event.sender, paths);
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });
}

async function handleExternalPayloads(payloads: IngestPayload[], reason: ShelfRecord['origin']): Promise<void> {
  const point = currentCursorPoint();
  await addPayloadsToLiveShelf(payloads, {
    origin: reason,
    point,
    inactive: reason === 'tray',
  });
}

async function createShelfFromClipboard(): Promise<void> {
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    await handleExternalPayloads(
      [
        {
          kind: 'image',
          mimeType: 'image/png',
          base64: image.toPNG().toString('base64'),
          filenameHint: 'clipboard-image',
        },
      ],
      'tray',
    );
    return;
  }

  const text = clipboard.readText().trim();
  if (text) {
    await handleExternalPayloads([detectPayloadFromText(text)], 'tray');
    return;
  }

  await createShelf('tray', currentCursorPoint(), false);
}

async function handleShakeDetected(event: ShakeDetectedEvent): Promise<void> {
  const preferences = stateStore.getPreferences();
  if (!preferences.shakeEnabled) {
    return;
  }

  if (event.sourceBundleId && preferences.excludedBundleIds.includes(event.sourceBundleId)) {
    return;
  }

  // Electron already reports the cursor in the coordinate space used by BrowserWindow.
  // Using it here avoids AppKit-to-Electron translation errors on multi-display setups.
  await createShelf('shake', currentCursorPoint(), true);
}

async function createShelf(
  reason: ShelfRecord['origin'],
  point: { x: number; y: number },
  inactive: boolean,
): Promise<void> {
  const liveShelf = stateStore.getLiveShelf();
  if (!liveShelf) {
    stateStore.createShelf(reason);
    shelfWindow.resetPosition();
  }

  const isShake = reason === 'shake';
  await shelfWindow.showNear(point, inactive, isShake ? { width: 240, height: 296 } : undefined);
  broadcastState();
  tickInactivity();
}

function applyRemoteShelfSnapshot(remoteShelf: ShelfRecord): void {
  // Routing:
  //   1. Live shelf id matches remote (or there is no live shelf) -> the
  //      live shelf is the destination.
  //   2. A recent shelf id matches remote -> that recent entry is the
  //      destination.
  //   3. Neither -> drop. The user has a different shelf open locally and
  //      no history of this one; silently adopting it would clobber the
  //      user's work.
  const sanitized = sanitizeRemoteFileRefs(remoteShelf);
  const liveShelf = stateStore.getLiveShelf();
  const recentShelf = liveShelf?.id === remoteShelf.id
    ? null
    : stateStore.getRecentShelves().find((shelf) => shelf.id === remoteShelf.id) ?? null;
  const local = liveShelf?.id === remoteShelf.id ? liveShelf : recentShelf;
  const lastSynced = remoteShelfWatermarks.get(remoteShelf.id) ?? null;

  const decision = decideRemoteShelfApply({
    remote: remoteShelf,
    local,
    lastSyncedRemoteUpdatedAt: lastSynced
  });
  remoteShelfWatermarks.set(remoteShelf.id, decision.nextWatermark);

  if (!decision.apply) {
    return;
  }

  if (local === liveShelf || (!local && !liveShelf)) {
    // No live shelf, or the live shelf's id matches the remote. In both
    // cases the live shelf is the destination — including the
    // first-contact case where the device has never seen this shelf.
    stateStore.replaceLiveShelf(sanitized);
  } else {
    stateStore.replaceRecentShelf(sanitized);
  }
}

async function restoreShelf(id: string): Promise<AppState> {
  const shelf = stateStore.restoreShelf(id);
  if (!shelf) {
    return broadcastState();
  }

  const refreshedItems = await Promise.all(
    shelf.items.map(async (item) => {
      if (!isFileBackedItem(item)) {
        return item;
      }

      return {
        ...item,
        file: await refreshFileRef(item.file, {
          resolveBookmark: (bookmarkBase64, originalPath) => nativeAgent.resolveBookmark(bookmarkBase64, originalPath),
        }),
      };
    }),
  );

  stateStore.replaceLiveShelf({
    ...shelf,
    items: refreshedItems,
  });

  shelfWindow.resetPosition();
  await shelfWindow.showNear(currentCursorPoint(), false);
  tickInactivity();
  return broadcastState();
}

async function relinkItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item || !isFileBackedItem(item)) {
    return false
  }

  const browserWindow = shelfWindow.getBrowserWindow() ?? preferencesWindow.getBrowserWindow()
  const properties: Electron.OpenDialogOptions['properties'] = item.kind === 'folder'
    ? ['openDirectory']
    : ['openFile']
  const result = browserWindow
    ? await dialog.showOpenDialog(browserWindow, { properties })
    : await dialog.showOpenDialog({ properties })

  if (result.canceled || result.filePaths.length === 0) {
    return false
  }

  const selectedPath = result.filePaths[0]
  const bookmarkBase64 = await nativeAgent.createBookmark(selectedPath)
  stateStore.relinkFileBackedItem(itemId, {
    originalPath: selectedPath,
    resolvedPath: selectedPath,
    bookmarkBase64
  })
  broadcastState()
  return true
}

async function addPayloadsToLiveShelf(
  payloads: IngestPayload[],
  options: {
    origin?: ShelfRecord['origin'];
    point?: { x: number; y: number };
    inactive?: boolean;
  } = {},
): Promise<boolean> {
  const allItems: ShelfItemRecord[] = [];
  let oversizedError: ImportedImageTooLargeError | null = null

  for (const payload of payloads) {
    try {
      const items = await payloadToItems(payload, {
        assetsDir: stateStore.assetsDir,
        createBookmark: (path) => nativeAgent.createBookmark(path),
        resolveBookmark: (bookmarkBase64, originalPath) => nativeAgent.resolveBookmark(bookmarkBase64, originalPath),
      })
      allItems.push(...items)
    } catch (error) {
      // Imported-image size cap is a user-facing failure, not an internal
      // bug. Remember the first one and continue so other payloads in the
      // same drop (e.g. text from a multi-item drag) still get ingested.
      if (error instanceof ImportedImageTooLargeError) {
        if (!oversizedError) oversizedError = error
        continue
      }
      throw error
    }
  }

  if (allItems.length === 0) {
    if (oversizedError) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue
        window.webContents.send(IPC_CHANNELS.showToast, { message: oversizedError.message, kind: 'error' })
      }
    }
    return false;
  }

  stateStore.ensureLiveShelf(options.origin ?? 'manual');
  stateStore.appendItems(allItems);
  if (shelfWindow.isVisible()) {
    await shelfWindow.show(options.inactive ?? false);
  } else {
    await shelfWindow.showNear(options.point ?? currentCursorPoint(), options.inactive ?? false);
  }
  broadcastState();
  tickInactivity();
  return true;
}

function syncSystemPreferences(): void {
  let preferences = stateStore.getPreferences();
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: preferences.launchAtLogin,
      });
    } catch {
      // Some macOS environments can still reject login-item writes.
    }
  }
  globalShortcut.unregisterAll();
  shortcutStatus = {
    shortcutRegistered: false,
    shortcutError: '',
  };

  const normalizedShortcut = normalizeGlobalShortcut(preferences.globalShortcut);
  if (normalizedShortcut !== preferences.globalShortcut) {
    preferences = stateStore.setPreferences({
      globalShortcut: normalizedShortcut,
    });
  }

  if (!normalizedShortcut) {
    return;
  }

  const shortcutError = validateGlobalShortcut(normalizedShortcut);
  if (shortcutError) {
    shortcutStatus = {
      shortcutRegistered: false,
      shortcutError,
    };
    return;
  }

  try {
    const registered = globalShortcut.register(normalizedShortcut, () => {
      void createShelf('shortcut', currentCursorPoint(), false);
    });

    shortcutStatus = registered
      ? {
          shortcutRegistered: true,
          shortcutError: '',
        }
      : {
          shortcutRegistered: false,
          shortcutError: 'Shortcut could not be registered. It may already be in use.',
        };
  } catch (error) {
    shortcutStatus = {
      shortcutRegistered: false,
      shortcutError: error instanceof Error ? error.message : 'Shortcut could not be registered.',
    };
  }
}

function broadcastState(): AppState {
  // The state is already validated when it is written to disk. We re-parse on
  // broadcast as a defense-in-depth check, but a parse failure must not be
  // able to crash the IPC handler or wedge the renderer; in that case we fall
  // back to the raw snapshot so the UI still receives an update.
  const snapshot = stateStore.snapshot(currentPermissionStatus());
  let state: AppState
  try {
    state = appStateSchema.parse(snapshot)
  } catch (error) {
    console.error('[ledge] broadcastState: state validation failed; broadcasting raw snapshot.', error)
    state = snapshot as AppState
  }
  tray.update(state);
  shelfWindow.sendState(state);
  preferencesWindow.sendState(state);
  return state;
}

function tickInactivity(): void {
  const shouldArm =
    stateStore.getPreferences().shelfInteraction.autoRetract && shelfWindow.isVisible();
  if (shouldArm) {
    inactivityTimer.reset();
  } else {
    inactivityTimer.clear();
  }
}

function liveShelfItems(): ShelfItemRecord[] {
  return stateStore.getLiveShelf()?.items ?? [];
}

async function previewItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  if (!item || !isFileBackedItem(item)) {
    return false;
  }

  const path = getFileBackedPath(item);
  if (!path) {
    return false;
  }

  return shelfWindow.previewFile(path, basename(path));
}

async function revealItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  const path = item && isFileBackedItem(item) ? getFileBackedPath(item) : null;
  if (!path) {
    return false;
  }

  shell.showItemInFolder(path);
  return true;
}

async function openItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  if (!item) {
    return false;
  }

  if (item.kind === 'url') {
    // Refuse non-http(s) schemes. A URL item is a web link; opening
    // `file://`, `javascript:`, or a custom URI scheme here would
    // either open the wrong app or, in the worst case, allow a remote
    // shelf to pivot into a local resource.
    let parsed: URL;
    try {
      parsed = new URL(item.url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    await shell.openExternal(parsed.toString());
    return true;
  }

  const path = isFileBackedItem(item)
    ? getFileBackedPath(item)
    : item.kind === 'text'
      ? (item.savedFilePath ?? null)
      : null;

  if (!path) {
    return false;
  }

  return isOpenPathSuccess(await shell.openPath(path));
}

async function copyItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  if (!item) {
    return false;
  }

  if (item.kind === 'text') {
    clipboard.writeText(item.text);
    return true;
  }

  if (item.kind === 'url') {
    clipboard.writeText(item.url);
    return true;
  }

  if (isFileBackedItem(item)) {
    const filePath = getFileBackedPath(item);
    if (filePath) {
      writeFilePathsToClipboard([filePath]);
      return true;
    }
  }

  return false;
}

async function saveItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId);
  if (!item || (item.kind !== 'text' && item.kind !== 'url')) {
    return false;
  }

  const extension = item.kind === 'url' ? 'webloc' : 'txt';
  const window = shelfWindow.getBrowserWindow();
  const options = {
    defaultPath: join(stateStore.exportsDir, `${sanitizeName(item.title)}.${extension}`),
  };
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return false;
  }

  if (item.kind === 'text') {
    await fs.writeFile(result.filePath, item.text, 'utf8');
  } else {
    const data = urlToWebloc(item.url);
    await fs.writeFile(result.filePath, data, 'utf8');
  }

  return true;
}

async function shareItems(itemIds?: string[]): Promise<boolean> {
  const liveShelf = stateStore.getLiveShelf();
  if (!liveShelf) {
    return false;
  }

  const selection = (itemIds?.length ? liveShelf.items.filter((item) => itemIds.includes(item.id)) : liveShelf.items)
    .filter(isFileBackedItem)
    .map((item) => getFileBackedPath(item))
    .filter((path): path is string => Boolean(path));

  if (selection.length === 0) {
    return false;
  }

  const menu = Menu.buildFromTemplate([
    {
      role: 'shareMenu',
      sharingItem: {
        filePaths: selection,
      },
    },
  ]);

  menu.popup({
    window: shelfWindow.getBrowserWindow() ?? undefined,
  });
  return true;
}

function currentCursorPoint() {
  return screen.getCursorScreenPoint();
}

function currentPermissionStatus(): PermissionStatus {
  return permissionStatusSchema.parse({
    ...nativeAgent.getStatus(),
    ...shortcutStatus,
  });
}

function resolveAllowedAssetPath(path: string): string | null {
  if (!isAbsolute(path)) {
    return null;
  }

  const normalizedPath = resolvePath(path);
  if (isPathInside(stateStore.assetsDir, normalizedPath)) {
    return normalizedPath;
  }

  for (const item of liveShelfItems()) {
    if (item.kind !== 'imageAsset' && !(item.kind === 'file' && item.mimeType.startsWith('image/'))) {
      continue;
    }

    const itemPath = getFileBackedPath(item);
    if (itemPath && resolvePath(itemPath) === normalizedPath) {
      return normalizedPath;
    }
  }

  return null;
}

function isPathInside(parent: string, candidate: string): boolean {
  const normalizedParent = resolvePath(parent);
  const normalizedCandidate = resolvePath(candidate);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${sep}`);
}

function writeFilePathsToClipboard(paths: string[]): void {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) {
    return;
  }

  const uriList = uniquePaths.map((path) => pathToFileURL(path).toString()).join('\r\n');
  clipboard.clear();
  clipboard.writeText(uniquePaths.join('\n'));
  clipboard.writeBuffer('text/uri-list', Buffer.from(uriList, 'utf8'));
}

function normalizePreferencePatch(patch: ReturnType<typeof preferencePatchSchema.parse>) {
  let nextPatch = patch;

  if (patch.globalShortcut !== undefined) {
    nextPatch = {
      ...nextPatch,
      globalShortcut: normalizeGlobalShortcut(patch.globalShortcut),
    };
  }

  if (patch.excludedBundleIds !== undefined) {
    const { normalized, invalid } = normalizeExcludedBundleIds(patch.excludedBundleIds);
    if (invalid.length > 0) {
      throw new Error(
        invalid.length === 1
          ? `Invalid macOS bundle identifier: ${invalid[0]}`
          : `Invalid macOS bundle identifiers: ${invalid.join(', ')}`,
      );
    }

    nextPatch = {
      ...nextPatch,
      excludedBundleIds: normalized,
    };
  }

  return nextPatch;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'drop-item';
}

function draggablePathsForItemIds(itemIds: string[]): string[] {
  if (itemIds.length === 0) {
    return [];
  }

  const ids = new Set(itemIds);
  const paths: string[] = [];

  for (const entry of liveShelfItems()) {
    if (!ids.has(entry.id) || !isFileBackedItem(entry)) {
      continue;
    }

    const path = getFileBackedPath(entry);
    if (path) {
      paths.push(path);
    }
  }

  return paths;
}

// Synchronous path-existence check. `fs.existsSync` is fine here: the
// alternative (a promise-based access check) would race against the
// `webContents.startDrag` call, which is itself synchronous from the
// renderer's perspective.
function pathsExist(paths: string[]): boolean {
  if (paths.length === 0) return false;
  for (const p of paths) {
    try {
      if (!existsSync(p)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function startNativeDrag(webContents: Electron.WebContents, paths: string[]): void {
  const [firstPath] = paths;
  if (!firstPath) {
    return;
  }

  // Validate every path exists before kicking off the native drag. The
  // previous version happily passed a missing path to startDrag, which
  // silently produced a broken drag and could mask stale FileRefs in
  // the live shelf. The IPC handlers above already filter on
  // `isMissing` for the bookmark resolution path, but a fast-moving
  // file (e.g. mounted DMG ejected mid-shake) can race that check.
  if (!pathsExist(paths)) {
    return;
  }

  const icon = dragIconImage(paths);

  const dragPayload =
    paths.length > 1
      ? {
          file: firstPath,
          files: paths,
          icon,
        }
      : {
          file: firstPath,
          icon,
        };

  webContents.startDrag(dragPayload);
}

function dragIconImage(paths: string[]) {
  const iconCandidates = [
    ...paths,
    join(app.getAppPath(), 'build', 'app.icns'),
    join(process.resourcesPath, 'app.icns'),
    join(app.getAppPath(), 'build', 'icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ];

  for (const candidate of iconCandidates) {
    const image = nativeImage.createFromPath(candidate);
    if (image.isEmpty()) {
      continue;
    }

    return image.resize({ width: 72, height: 72, quality: 'best' });
  }

  const embeddedFallback = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+P+/HgAEtQJ8j3u7EwAAAABJRU5ErkJggg==',
      'base64',
    ),
  );

  if (!embeddedFallback.isEmpty()) {
    return embeddedFallback.resize({ width: 72, height: 72, quality: 'best' });
  }

  return nativeImage.createEmpty();
}
