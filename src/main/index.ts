import { app, BrowserWindow, clipboard, dialog, globalShortcut, Menu, ipcMain, nativeImage, net, protocol, screen, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  appStateSchema,
  createShelfInputSchema,
  ingestPayloadSchema,
  permissionStatusSchema,
  preferencePatchSchema,
  type AppState,
  type IngestPayload,
  type PermissionStatus,
  type ShelfItemRecord,
  type ShelfRecord
} from '@shared/schema'
import { normalizeExcludedBundleIds } from '@shared/preferences'
import { NativeAgentClient, type ShakeDetectedEvent } from './native/nativeAgent'
import { payloadToItems, detectPayloadFromText, getFileBackedPath, isFileBackedItem, refreshFileRef } from './services/payloads'
import { isOpenPathSuccess, normalizeGlobalShortcut, urlToWebloc, validateGlobalShortcut } from './services/systemUtils'
import { StateStore } from './services/stateStore'
import { PreferencesWindow } from './windows/preferencesWindow'
import { ShelfWindow } from './windows/shelfWindow'
import { TrayController } from './tray'

let stateStore: StateStore
let nativeAgent: NativeAgentClient
let tray: TrayController
let shelfWindow: ShelfWindow
let preferencesWindow: PreferencesWindow
let shortcutStatus: Pick<PermissionStatus, 'shortcutRegistered' | 'shortcutError'> = {
  shortcutRegistered: false,
  shortcutError: ''
}
const PROJECT_URL = 'https://github.com/olllayor/dropover'
const WHATS_NEW_URL = `${PROJECT_URL}/releases`
const QUICK_START_URL = `${PROJECT_URL}#readme`
const ASSET_PROTOCOL = 'dropover-asset'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  app.setName('Ledge')
  Menu.setApplicationMenu(null)
  protocol.handle(ASSET_PROTOCOL, (request) => {
    const url = new URL(request.url)
    const path = url.searchParams.get('path')

    if (!path) {
      return new Response('Missing asset path.', { status: 400 })
    }

    return net.fetch(pathToFileURL(path).toString())
  })

  stateStore = new StateStore(app.getPath('userData'))
  nativeAgent = new NativeAgentClient()
  shelfWindow = new ShelfWindow()
  preferencesWindow = new PreferencesWindow()
  tray = new TrayController({
    onNewShelf: () => {
      void createShelf('tray', currentCursorPoint(), false)
    },
    onNewShelfFromClipboard: () => {
      void createShelfFromClipboard()
    },
    onOpenPreferences: () => {
      void preferencesWindow.show()
    },
    onOpenWhatsNew: () => {
      void shell.openExternal(WHATS_NEW_URL)
    },
    onOpenQuickStart: () => {
      void shell.openExternal(QUICK_START_URL)
    },
    onOpenAbout: () => {
      app.showAboutPanel()
    },
    onRestoreShelf: (id) => {
      void restoreShelf(id)
    },
    onDropFiles: (paths) => {
      void handleExternalPayload({ kind: 'fileDrop', paths }, 'tray')
    },
    onDropText: (text) => {
      void handleExternalPayload(detectPayloadFromText(text), 'tray')
    },
    onQuit: () => {
      app.quit()
    }
  })

  nativeAgent.on('statusChanged', () => {
    broadcastState()
  })
  await nativeAgent.start()
  nativeAgent.on('shakeDetected', (event: ShakeDetectedEvent) => {
    void handleShakeDetected(event)
  })

  syncSystemPreferences()
  await nativeAgent.configureGesture(stateStore.getPreferences())
  broadcastState()
  registerIpc()
})

app.on('activate', () => {
  void preferencesWindow.show()
})

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getState, async () => broadcastState())
  ipcMain.handle(IPC_CHANNELS.createShelf, async (_event, input: unknown) => {
    const parsed = createShelfInputSchema.parse(input)
    await createShelf(parsed.reason, currentCursorPoint(), false)
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.restoreShelf, async (_event, id: string) => restoreShelf(id))
  ipcMain.handle(IPC_CHANNELS.addPayload, async (_event, payload: unknown) => {
    await addPayloadToLiveShelf(ingestPayloadSchema.parse(payload))
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.closeShelf, async () => {
    stateStore.closeShelf()
    shelfWindow.resetPosition()
    shelfWindow.hide()
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.getPreferences, async () => stateStore.getPreferences())
  ipcMain.handle(IPC_CHANNELS.setPreferences, async (_event, patch: unknown) => {
    stateStore.setPreferences(normalizePreferencePatch(preferencePatchSchema.parse(patch)))
    syncSystemPreferences()
    await nativeAgent.configureGesture(stateStore.getPreferences())
    broadcastState()
    return stateStore.getPreferences()
  })
  ipcMain.handle(IPC_CHANNELS.getRecentShelves, async () => stateStore.getRecentShelves())
  ipcMain.handle(IPC_CHANNELS.getPermissionStatus, async () => currentPermissionStatus())
  ipcMain.handle(IPC_CHANNELS.openPermissionSettings, async () => nativeAgent.openPermissionSettings())
  ipcMain.handle(IPC_CHANNELS.previewItem, async (_event, itemId: string) => previewItem(itemId))
  ipcMain.handle(IPC_CHANNELS.revealItem, async (_event, itemId: string) => revealItem(itemId))
  ipcMain.handle(IPC_CHANNELS.openItem, async (_event, itemId: string) => openItem(itemId))
  ipcMain.handle(IPC_CHANNELS.copyItem, async (_event, itemId: string) => copyItem(itemId))
  ipcMain.handle(IPC_CHANNELS.saveItem, async (_event, itemId: string) => saveItem(itemId))
  ipcMain.handle(IPC_CHANNELS.removeItem, async (_event, itemId: string) => {
    stateStore.removeItem(itemId)
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.renameShelf, async (_event, name: string) => {
    stateStore.renameLiveShelf(name)
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.clearShelf, async () => {
    stateStore.clearLiveShelf()
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.reorderItems, async (_event, itemIds: string[]) => {
    stateStore.reorderItems(itemIds)
    return broadcastState()
  })
  ipcMain.handle(IPC_CHANNELS.shareShelfItems, async (_event, itemIds?: string[]) => shareItems(itemIds))
  ipcMain.on(IPC_CHANNELS.startItemDrag, (event, itemId: string) => {
    const paths = draggablePathsForItemIds([itemId])
    if (paths.length === 0) {
      return
    }

    startNativeDrag(event.sender, paths)
  })
  ipcMain.on(IPC_CHANNELS.startItemsDrag, (event, itemIds: string[]) => {
    const paths = draggablePathsForItemIds(itemIds)
    if (paths.length === 0) {
      return
    }

    startNativeDrag(event.sender, paths)
  })
}

async function handleExternalPayload(payload: IngestPayload, reason: ShelfRecord['origin']): Promise<void> {
  const point = currentCursorPoint()
  await addPayloadToLiveShelf(payload, {
    origin: reason,
    point,
    inactive: reason === 'tray'
  })
}

async function createShelfFromClipboard(): Promise<void> {
  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    await handleExternalPayload(
      {
        kind: 'image',
        mimeType: 'image/png',
        base64: image.toPNG().toString('base64'),
        filenameHint: 'clipboard-image'
      },
      'tray'
    )
    return
  }

  const text = clipboard.readText().trim()
  if (text) {
    await handleExternalPayload(detectPayloadFromText(text), 'tray')
    return
  }

  await createShelf('tray', currentCursorPoint(), false)
}

async function handleShakeDetected(event: ShakeDetectedEvent): Promise<void> {
  const preferences = stateStore.getPreferences()
  if (!preferences.shakeEnabled) {
    return
  }

  if (event.sourceBundleId && preferences.excludedBundleIds.includes(event.sourceBundleId)) {
    return
  }

  // Electron already reports the cursor in the coordinate space used by BrowserWindow.
  // Using it here avoids AppKit-to-Electron translation errors on multi-display setups.
  await createShelf('shake', currentCursorPoint(), true)
}

async function createShelf(
  reason: ShelfRecord['origin'],
  point: { x: number; y: number },
  inactive: boolean
): Promise<void> {
  const liveShelf = stateStore.getLiveShelf()
  if (!liveShelf) {
    stateStore.createShelf(reason)
    shelfWindow.resetPosition()
  }

  await shelfWindow.showNear(point, inactive)
  broadcastState()
}

async function restoreShelf(id: string): Promise<AppState> {
  const shelf = stateStore.restoreShelf(id)
  if (!shelf) {
    return broadcastState()
  }

  const refreshedItems = await Promise.all(
    shelf.items.map(async (item) => {
      if (!isFileBackedItem(item)) {
        return item
      }

      return {
        ...item,
        file: await refreshFileRef(item.file, {
          resolveBookmark: (bookmarkBase64, originalPath) => nativeAgent.resolveBookmark(bookmarkBase64, originalPath)
        })
      }
    })
  )

  stateStore.replaceLiveShelf({
    ...shelf,
    items: refreshedItems
  })

  shelfWindow.resetPosition()
  await shelfWindow.showNear(currentCursorPoint(), false)
  return broadcastState()
}

async function addPayloadToLiveShelf(
  payload: IngestPayload,
  options: {
    origin?: ShelfRecord['origin']
    point?: { x: number; y: number }
    inactive?: boolean
  } = {}
): Promise<boolean> {
  const items = await payloadToItems(payload, {
    assetsDir: stateStore.assetsDir,
    createBookmark: (path) => nativeAgent.createBookmark(path),
    resolveBookmark: (bookmarkBase64, originalPath) => nativeAgent.resolveBookmark(bookmarkBase64, originalPath)
  })

  if (items.length === 0) {
    return false
  }

  stateStore.ensureLiveShelf(options.origin ?? 'manual')
  stateStore.appendItems(items)
  if (shelfWindow.isVisible()) {
    await shelfWindow.show(options.inactive ?? false)
  } else {
    await shelfWindow.showNear(options.point ?? currentCursorPoint(), options.inactive ?? false)
  }
  broadcastState()
  return true
}

function syncSystemPreferences(): void {
  const preferences = stateStore.getPreferences()
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: preferences.launchAtLogin
      })
    } catch {
      // Some macOS environments can still reject login-item writes.
    }
  }
  globalShortcut.unregisterAll()
  shortcutStatus = {
    shortcutRegistered: false,
    shortcutError: ''
  }

  if (!preferences.globalShortcut) {
    return
  }

  const shortcutError = validateGlobalShortcut(preferences.globalShortcut)
  if (shortcutError) {
    shortcutStatus = {
      shortcutRegistered: false,
      shortcutError
    }
    return
  }

  try {
    const registered = globalShortcut.register(preferences.globalShortcut, () => {
      void createShelf('shortcut', currentCursorPoint(), false)
    })

    shortcutStatus = registered
      ? {
          shortcutRegistered: true,
          shortcutError: ''
        }
      : {
          shortcutRegistered: false,
          shortcutError: 'Shortcut could not be registered. It may already be in use.'
        }
  } catch (error) {
    shortcutStatus = {
      shortcutRegistered: false,
      shortcutError: error instanceof Error ? error.message : 'Shortcut could not be registered.'
    }
  }
}

function broadcastState(): AppState {
  const state = appStateSchema.parse(stateStore.snapshot(currentPermissionStatus()))
  tray.update(state)
  shelfWindow.sendState(state)
  preferencesWindow.sendState(state)
  return state
}

function liveShelfItems(): ShelfItemRecord[] {
  return stateStore.getLiveShelf()?.items ?? []
}

async function previewItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item || !isFileBackedItem(item)) {
    return false
  }

  const path = getFileBackedPath(item)
  if (!path) {
    return false
  }

  return shelfWindow.previewFile(path, basename(path))
}

async function revealItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  const path = item && isFileBackedItem(item) ? getFileBackedPath(item) : null
  if (!path) {
    return false
  }

  shell.showItemInFolder(path)
  return true
}

async function openItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item) {
    return false
  }

  if (item.kind === 'url') {
    await shell.openExternal(item.url)
    return true
  }

  const path =
    isFileBackedItem(item)
      ? getFileBackedPath(item)
      : item.kind === 'text'
        ? item.savedFilePath ?? null
        : null

  if (!path) {
    return false
  }

  return isOpenPathSuccess(await shell.openPath(path))
}

async function copyItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item) {
    return false
  }

  if (item.kind === 'text') {
    clipboard.writeText(item.text)
    return true
  }

  if (item.kind === 'url') {
    clipboard.writeText(item.url)
    return true
  }

  return false
}

async function saveItem(itemId: string): Promise<boolean> {
  const item = liveShelfItems().find((entry) => entry.id === itemId)
  if (!item || (item.kind !== 'text' && item.kind !== 'url')) {
    return false
  }

  const extension = item.kind === 'url' ? 'webloc' : 'txt'
  const window = shelfWindow.getBrowserWindow()
  const options = {
    defaultPath: join(stateStore.exportsDir, `${sanitizeName(item.title)}.${extension}`)
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) {
    return false
  }

  if (item.kind === 'text') {
    await fs.writeFile(result.filePath, item.text, 'utf8')
  } else {
    const data = urlToWebloc(item.url)
    await fs.writeFile(result.filePath, data, 'utf8')
  }

  return true
}

async function shareItems(itemIds?: string[]): Promise<boolean> {
  const liveShelf = stateStore.getLiveShelf()
  if (!liveShelf) {
    return false
  }

  const selection = (itemIds?.length ? liveShelf.items.filter((item) => itemIds.includes(item.id)) : liveShelf.items)
    .filter(isFileBackedItem)
    .map((item) => getFileBackedPath(item))
    .filter((path): path is string => Boolean(path))

  if (selection.length === 0) {
    return false
  }

  const menu = Menu.buildFromTemplate([
    {
      role: 'shareMenu',
      sharingItem: {
        filePaths: selection
      }
    }
  ])

  menu.popup({
    window: shelfWindow.getBrowserWindow() ?? undefined
  })
  return true
}

function currentCursorPoint() {
  return screen.getCursorScreenPoint()
}

function currentPermissionStatus(): PermissionStatus {
  return permissionStatusSchema.parse({
    ...nativeAgent.getStatus(),
    ...shortcutStatus
  })
}

function normalizePreferencePatch(patch: ReturnType<typeof preferencePatchSchema.parse>) {
  let nextPatch = patch

  if (patch.globalShortcut !== undefined) {
    nextPatch = {
      ...nextPatch,
      globalShortcut: normalizeGlobalShortcut(patch.globalShortcut)
    }
  }

  if (patch.excludedBundleIds !== undefined) {
    const { normalized, invalid } = normalizeExcludedBundleIds(patch.excludedBundleIds)
    if (invalid.length > 0) {
      throw new Error(
        invalid.length === 1
          ? `Invalid macOS bundle identifier: ${invalid[0]}`
          : `Invalid macOS bundle identifiers: ${invalid.join(', ')}`
      )
    }

    nextPatch = {
      ...nextPatch,
      excludedBundleIds: normalized
    }
  }

  return nextPatch
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'drop-item'
}

function draggablePathsForItemIds(itemIds: string[]): string[] {
  if (itemIds.length === 0) {
    return []
  }

  const ids = new Set(itemIds)
  const paths: string[] = []

  for (const entry of liveShelfItems()) {
    if (!ids.has(entry.id) || !isFileBackedItem(entry)) {
      continue
    }

    const path = getFileBackedPath(entry)
    if (path) {
      paths.push(path)
    }
  }

  return paths
}

function startNativeDrag(webContents: Electron.WebContents, paths: string[]): void {
  const [firstPath] = paths
  if (!firstPath) {
    return
  }

  const ownerWindow = BrowserWindow.fromWebContents(webContents)
  if (ownerWindow && !ownerWindow.isDestroyed()) {
    ownerWindow.show()
    ownerWindow.focus()
  }

  const icon = dragIconImage(paths)

  webContents.startDrag(
    paths.length > 1
      ? {
          file: firstPath,
          files: paths,
          icon
        }
      : {
          file: firstPath,
          icon
        }
  )
}

function dragIconImage(paths: string[]) {
  const previews = paths
    .slice(0, 3)
    .map((path) => nativeImage.createFromPath(path))
    .filter((image) => !image.isEmpty())
    .map((image) => image.resize({ width: 72, height: 72, quality: 'best' }))

  if (previews.length > 0) {
    const placements =
      previews.length === 1
        ? [{ x: 14, y: 12, rotation: 0 }]
        : previews.length === 2
          ? [
              { x: 10, y: 12, rotation: -8 },
              { x: 28, y: 18, rotation: 8 }
            ]
          : [
              { x: 12, y: 10, rotation: -10 },
              { x: 24, y: 12, rotation: 8 },
              { x: 18, y: 24, rotation: 0 }
            ]

    const cards = previews
      .map((preview, index) => {
        const placement = placements[index]
        if (!placement) {
          return ''
        }

        return `
          <g transform="translate(${placement.x} ${placement.y}) rotate(${placement.rotation} 36 36)">
            <rect x="0" y="0" width="72" height="72" rx="14" fill="rgba(255,255,255,0.98)"/>
            <rect x="0.75" y="0.75" width="70.5" height="70.5" rx="13.25" fill="none" stroke="rgba(255,255,255,0.82)" stroke-width="1.5"/>
            <image href="${escapeSvgAttribute(preview.toDataURL())}" x="6" y="6" width="60" height="60" preserveAspectRatio="xMidYMid slice" clip-path="url(#drag-card-${index})"/>
          </g>
        `
      })
      .join('')
    const defs = previews
      .map(
        (_preview, index) => `
          <clipPath id="drag-card-${index}">
            <rect x="6" y="6" width="60" height="60" rx="10"/>
          </clipPath>
        `
      )
      .join('')

    const composed = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(
        `
          <svg width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
            <defs>${defs}</defs>
            ${cards}
          </svg>
        `
      ).toString('base64')}`
    )

    if (!composed.isEmpty()) {
      return composed
    }
  }

  const svg = `
    <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="14" width="48" height="36" rx="12" fill="#16120F" opacity="0.92"/>
      <rect x="14" y="20" width="36" height="8" rx="4" fill="#F4E7D2"/>
      <rect x="14" y="33" width="24" height="6" rx="3" fill="#D6C3AA"/>
    </svg>
  `

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function escapeSvgAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
