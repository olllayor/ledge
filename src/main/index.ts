import { app, Menu, net, protocol as protocolModule, screen, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appStateSchema, type AppState } from '@shared/schema'
import { NativeAgentClient, type ShakeDetectedEvent } from './native/nativeAgent'
import { detectPayloadFromText } from './services/payloads'
import { StateStore } from './services/stateStore'
import { InactivityTimer } from './services/inactivityTimer'
import { PreferencesWindow } from './windows/preferencesWindow'
import { ShelfWindow } from './windows/shelfWindow'
import { QuickPasteWindow } from './windows/quickPasteWindow'
import { PeekWindow } from './windows/peekWindow'
import { ClipboardWindow } from './windows/clipboardWindow'
import { ClipboardMonitor } from './services/clipboardMonitor'
import { TrayController } from './tray'
import { ShelfController, currentCursorPoint } from './services/shelfController'
import { ShelfActions } from './services/shelfActions'
import { ShelfItemOps } from './services/shelfItemOps'
import { ShelfContextMenus } from './services/contextMenus'
import { ClipboardHistoryService } from './services/clipboardHistory'
import { PreferencesSyncService } from './services/preferencesSync'
import { resolveAllowedAssetPath } from './services/assetPathResolver'
import { broadcastToast, createThrottledToast } from './services/toastBroadcaster'
import { IpcRegistrar } from './ipc'
import { ClipboardIpcController } from './services/clipboard/ipcController'
import { SecureSessionStore } from './services/secureSessionStore'
import { FEATURE_FLAGS } from './services/featureFlags'
import { NotchDropoutWindow } from './windows/notchDropoutWindow'
import { NotchHoverMonitor } from './services/notchHoverMonitor'

const PROJECT_URL = 'https://github.com/olllayor/ledge'
const WHATS_NEW_URL = `${PROJECT_URL}/releases`
const QUICK_START_URL = `${PROJECT_URL}#readme`
const ASSET_PROTOCOL = 'ledge-asset'

const PERSISTENCE_ERROR_TOAST_THROTTLE_MS = 30_000
const QUIT_FLUSH_TIMEOUT_MS = 1500

/**
 * Per-shelf watermark of the most recent remote `updatedAt` we have
 * applied. Used by `applyRemoteShelfSnapshot` to decide whether a new
 * remote snapshot carries state we haven't seen yet. In-memory only —
 * the renderer already debounces re-sends of identical timestamps via
 * `lastAppliedRemoteByShelf`, so a fresh app launch simply re-applies
 * the most recent remote, which is idempotent.
 */
const remoteShelfWatermarks = new Map<string, number>()
const secureSessionStore = new SecureSessionStore()

// Module-scope wiring. Filled in by `app.whenReady()`.
let stateStore: StateStore
let nativeAgent: NativeAgentClient
let tray: TrayController
let shelfWindow: ShelfWindow
let preferencesWindow: PreferencesWindow
let quickPasteWindow: QuickPasteWindow
let peekWindow: PeekWindow
let clipboardWindow: ClipboardWindow
let notchDropoutWindow: NotchDropoutWindow | null = null
let notchHoverMonitor: NotchHoverMonitor | null = null
let clipboardMonitor: ClipboardMonitor
let clipboardHistory: ClipboardHistoryService
let inactivityTimer: InactivityTimer
let shelfController: ShelfController
let shelfActions: ShelfActions
let shelfOps: ShelfItemOps
let contextMenus: ShelfContextMenus
let preferencesSync: PreferencesSyncService
let ipcRegistrar: IpcRegistrar
let isFlushingStateForQuit = false

const persistenceErrorToast = createThrottledToast(PERSISTENCE_ERROR_TOAST_THROTTLE_MS)

// Last-resort safety nets. These should never fire under normal operation,
// but if they do we want a stable log line and a user-visible toast rather
// than a silent crash or a hung renderer waiting for a response that will
// never come.
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[ledge] unhandledRejection:', reason)
  broadcastToast(
    'Ledge hit an unexpected error. The app should still respond; please report this if it repeats.',
    'error',
  )
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
])

function tickInactivity(): void {
  const shouldArm =
    stateStore.getPreferences().shelfInteraction.autoRetract && shelfWindow.isVisible()
  if (shouldArm) {
    inactivityTimer.reset()
  } else {
    inactivityTimer.clear()
  }
}

function broadcastState(): AppState {
  // The state is already validated when it is written to disk. We re-parse
  // on broadcast as a defense-in-depth check, but a parse failure must not
  // be able to crash the IPC handler or wedge the renderer; in that case
  // we fall back to the raw snapshot so the UI still receives an update.
  const snapshot = stateStore.snapshot(preferencesSync.currentPermissionStatus())
  let state: AppState
  try {
    state = appStateSchema.parse(snapshot)
  } catch (error) {
    console.error('[ledge] broadcastState: state validation failed; broadcasting raw snapshot.', error)
    state = snapshot as AppState
  }
  tray.update(state)
  shelfWindow.sendState(state)
  preferencesWindow.sendState(state)
  clipboardWindow.sendState(state)
  quickPasteWindow.sendState(state)
  peekWindow.sendState(state)
  notchDropoutWindow?.sendState(state)
  return state
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  app.setName('Ledge')
  protocolModule.handle(ASSET_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    const path = url.searchParams.get('path')

    if (!path) {
      console.error('[ledge] asset request missing path param')
      return new Response('Missing asset path.', { status: 400 })
    }

    const allowedPath = resolveAllowedAssetPath(path, {
      assetsDir: stateStore.assetsDir,
      liveItems: stateStore.getLiveShelf()?.items ?? [],
    })
    if (!allowedPath) {
      console.error('[ledge] asset path not allowed (path redacted)')
      return new Response('Asset path is not allowed.', { status: 403 })
    }

    if (extname(allowedPath).toLowerCase() === '.icns') {
      try {
        const pngBuffer = execFileSync('sips', ['-s', 'format', 'png', '--out', '/dev/stdout', allowedPath])
        return new Response(pngBuffer, {
          headers: { 'Content-Type': 'image/png' },
        })
      } catch (err) {
        console.error('[ledge] icns conversion failed:', err)
      }
    }

    return net.fetch(pathToFileURL(allowedPath).toString())
  })

  stateStore = new StateStore(app.getPath('userData'), {
    onPersistenceError: () => {
      // Suppress repeat toasts so a tight loop on EACCES/ENOSPC doesn't spam
      // the user. The error is still logged to the console above.
      persistenceErrorToast(
        'Ledge couldn’t save your latest changes. The state file may be read-only or full.',
        'error',
      )
    },
    onCorruptionDetected: ({ backupPath }) => {
      // Surface state corruption loudly: the previous state.json was
      // unreadable and was moved aside to avoid being overwritten. The
      // backup is in userData so support can recover the user’s shelves.
      const message = `Ledge couldn’t read your saved state. A backup was kept at ${backupPath}.`
      broadcastToast(message, 'error')
    },
  })

  nativeAgent = new NativeAgentClient()
  shelfWindow = new ShelfWindow()
  preferencesWindow = new PreferencesWindow()
  quickPasteWindow = new QuickPasteWindow()
  peekWindow = new PeekWindow()
  clipboardWindow = new ClipboardWindow()

  if (FEATURE_FLAGS.useNotchDropout) {
    notchDropoutWindow = new NotchDropoutWindow()
    notchHoverMonitor = new NotchHoverMonitor({
      onEnterHotZone: () => {
        void notchDropoutWindow?.show()
      },
      onLeaveHotZone: () => {
        notchDropoutWindow?.hide()
      },
      isPanelVisible: () => Boolean(notchDropoutWindow?.isVisible()),
      isCursorInsidePanel: () => {
        const win = notchDropoutWindow?.getBrowserWindow()
        if (!win || win.isDestroyed()) return false
        const bounds = win.getBounds()
        const point = screen.getCursorScreenPoint()
        return (
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height
        )
      },
    })
    notchHoverMonitor.start()
  }
  clipboardMonitor = new ClipboardMonitor({
    onChange: (snapshot) => {
      void clipboardHistory.capture(snapshot)
    },
    intervalMs: 500,
  })
  clipboardHistory = new ClipboardHistoryService({
    stateStore,
    nativeAgent,
    onStateChange: () => broadcastState(),
  })
  inactivityTimer = new InactivityTimer(() => {
    if (
      stateStore.getPreferences().shelfInteraction.autoRetract &&
      shelfWindow.isVisible()
    ) {
      shelfWindow.hide()
    }
  })

  shelfController = new ShelfController({
    stateStore,
    nativeAgent,
    shelfWindow,
    onStateChange: () => broadcastState(),
    onInactivityTick: () => tickInactivity(),
  })
  shelfActions = new ShelfActions({
    stateStore,
    nativeAgent,
    shelfWindow,
    preferencesWindow,
    onStateChange: () => broadcastState(),
  })
  shelfOps = new ShelfItemOps(stateStore, {
    onInactivityTick: () => tickInactivity(),
    broadcastState: () => broadcastState(),
  })
  contextMenus = new ShelfContextMenus({
    shelfWindow,
    shelfActions,
    shelfController,
    shelfOps,
    onInactivityTick: () => tickInactivity(),
    broadcastState: () => broadcastState(),
  })
  preferencesSync = new PreferencesSyncService(
    stateStore,
    nativeAgent,
    quickPasteWindow,
    peekWindow,
    clipboardMonitor,
    () => shelfController.createShelf('shortcut', currentCursorPoint(), false),
    FEATURE_FLAGS.useNotchDropout ? (notchDropoutWindow ?? undefined) : undefined,
  )

  tray = new TrayController({
    onNewShelf: () => {
      void shelfController.createShelf('tray', currentCursorPoint(), false)
    },
    onNewShelfFromClipboard: () => {
      void shelfController.createShelfFromClipboard()
    },
    onOpenPreferences: () => {
      void preferencesWindow.show()
    },
    onOpenClipboardHistory: () => {
      void clipboardWindow.show()
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
      void (async () => {
        await shelfController.restoreShelf(id)
        tickInactivity()
        broadcastState()
      })()
    },
    onDropFiles: (paths) => {
      void shelfController.addExternalPayloads([{ kind: 'fileDrop', paths }], 'tray')
    },
    onDropText: (text) => {
      void shelfController.addExternalPayloads([detectPayloadFromText(text)], 'tray')
    },
    onQuit: () => {
      app.quit()
    },
  })

  Menu.setApplicationMenu(null)

  ipcRegistrar = new IpcRegistrar({
    stateStore,
    nativeAgent,
    shelfWindow,
    quickPasteWindow,
    peekWindow,
    clipboardMonitor,
    shelfController,
    shelfActions,
    shelfOps,
    contextMenus,
    preferencesSync,
    clipboardIpc: new ClipboardIpcController({
      stateStore,
      clipboardMonitor,
      quickPasteWindow,
      peekWindow,
      notchDropoutWindow: FEATURE_FLAGS.useNotchDropout ? (notchDropoutWindow ?? undefined) : undefined,
      broadcastState: () => broadcastState(),
      reregisterShortcuts: () => preferencesSync.sync()
    }),
    secureSessionStore,
    broadcastState: () => broadcastState(),
    onInactivityTick: () => tickInactivity(),
    remoteShelfWatermarks,
    getAppVersion: () => app.getVersion(),
  })
  ipcRegistrar.registerAll()

  // The Swift helper is the primary clipboard observer. The TS format-hash
  // poller runs only while the helper is down: running both double-captures
  // every copy (their formats vocabularies never hash-match) and the
  // poller's synthetic change counts can collide with real NSPasteboard
  // counts, silently dropping genuine copies.
  const syncClipboardFallbackPoller = () => {
    if (nativeAgent.getStatus().nativeHelperAvailable) {
      clipboardMonitor.stop()
    } else {
      clipboardMonitor.start()
    }
  }
  nativeAgent.on('statusChanged', () => {
    broadcastState()
    syncClipboardFallbackPoller()
  })
  await nativeAgent.start()
  nativeAgent.on('shakeDetected', (event: ShakeDetectedEvent) => {
    void shelfController.handleShakeDetected(event)
  })
  nativeAgent.on('clipboardChanged', (event) => {
    if (event && typeof event === 'object' && 'changeCount' in event) {
      clipboardMonitor.notifyFromNative(
        event as Parameters<typeof clipboardMonitor.notifyFromNative>[0],
      )
    }
  })
  await nativeAgent.startClipboardObserver(500)
  syncClipboardFallbackPoller()

  preferencesSync.sync()
  await nativeAgent.configureGesture(stateStore.getPreferences())
  broadcastState()
})

app.on('activate', () => {
  // Ledge is a menu-bar-only app. macOS may transiently show a dock icon
  // (for example, when state restoration re-activates us from Finder), so
  // re-assert dock-hidden every time the app is re-activated.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }
  void preferencesWindow.show()
})

app.on('before-quit', (event) => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }
  // Drain the state-store write queue before letting the app exit.
  // Without this, a quick drop-then-quit (or any IPC reply that
  // triggered a save) can leave state.json half-written as a
  // `.tmp-PID` sibling; the next launch would then trip the
  // corruption handler and lose the most recent change. The first
  // time `before-quit` fires, we cancel the default quit, flush,
  // and re-quit. Subsequent firings (the re-quit) pass through.
  // Shut the helper down first: this clears the auto-restart timer so a
  // dying child can't respawn mid-quit, and reaps the process so it never
  // outlives the app.
  clipboardMonitor?.stop()
  nativeAgent?.stop()
  if (isFlushingStateForQuit) {
    return
  }
  if (!stateStore || stateStore.whenIdle === undefined) {
    return
  }
  event.preventDefault()
  isFlushingStateForQuit = true
  const flush = stateStore.whenIdle().catch((error: unknown) => {
    console.error('[ledge] failed to flush state on quit:', error)
  })
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn(`[ledge] state flush exceeded ${QUIT_FLUSH_TIMEOUT_MS}ms; forcing quit`)
      resolve()
    }, QUIT_FLUSH_TIMEOUT_MS)
  })
  void Promise.race([flush, timeout]).finally(() => {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
    }
    app.quit()
  })
})
