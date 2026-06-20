import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import { ClipboardIpcController, type ClipboardIpcDeps } from './ipcController'
import type { StateStore } from '../stateStore'
import type { ClipboardMonitor } from '../clipboardMonitor'
import type { QuickPasteWindow } from '../../windows/quickPasteWindow'
import type { PeekWindow } from '../../windows/peekWindow'

type Handler = (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>

class FakeBus {
  handlers = new Map<string, Handler>()
  listeners = new Map<string, Handler>()
  handle(channel: string, handler: Handler) {
    this.handlers.set(channel, handler)
  }
  on(channel: string, listener: Handler) {
    this.listeners.set(channel, listener)
  }
  call(channel: string, ...args: unknown[]) {
    const h = this.handlers.get(channel)
    if (!h) throw new Error(`no handler for ${channel}`)
    return h({}, ...args)
  }
  emit(channel: string, ...args: unknown[]) {
    const l = this.listeners.get(channel)
    if (!l) throw new Error(`no listener for ${channel}`)
    return l({}, ...args)
  }
}

function makeStoreStub(): StateStore {
  return {
    getClipboardSettings: vi.fn(() => ({
      enabled: true,
      historyLimit: 200,
      ignoreConcealedItems: true,
      ignoreBundleIds: [],
      quickPasteHotkey: 'CommandOrControl+Shift+V',
      peekHotkey: '',
      syntheticPasteEnabled: false
    })),
    getClipboardEntries: vi.fn(() => []),
    createClipboardCategory: vi.fn(),
    renameClipboardCategory: vi.fn(),
    removeClipboardCategory: vi.fn(),
    assignEntryToCategory: vi.fn(),
    unassignEntryFromCategory: vi.fn(),
    removeClipboardEntry: vi.fn(),
    clearClipboardHistory: vi.fn(),
    pruneClipboardHistory: vi.fn(),
    updateClipboardSettings: vi.fn()
  } as unknown as StateStore
}

function makeMonitorStub(): ClipboardMonitor {
  return {
    getLastFrontmostApp: vi.fn(() => null)
  } as unknown as ClipboardMonitor
}

function makeQuickPasteWindowStub(): QuickPasteWindow {
  return {
    show: vi.fn(async () => undefined),
    hide: vi.fn(),
    focusIndex: vi.fn()
  } as unknown as QuickPasteWindow
}

function makePeekWindowStub(): PeekWindow {
  return {
    show: vi.fn(async () => undefined),
    hide: vi.fn()
  } as unknown as PeekWindow
}

let bus: FakeBus
let deps: ClipboardIpcDeps

beforeEach(() => {
  bus = new FakeBus()
  deps = {
    stateStore: makeStoreStub(),
    clipboardMonitor: makeMonitorStub(),
    quickPasteWindow: makeQuickPasteWindowStub(),
    peekWindow: makePeekWindowStub(),
    broadcastState: vi.fn(),
    ipcMain: bus
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ClipboardIpcController', () => {
  it('registers one handler per channel family', () => {
    const c = new ClipboardIpcController(deps)
    c.registerAll()
    // History
    expect(bus.handlers.has(IPC_CHANNELS.clipboardGetRecent)).toBe(true)
    expect(bus.handlers.has(IPC_CHANNELS.clipboardEntryClearAll)).toBe(true)
    expect(bus.handlers.has(IPC_CHANNELS.clipboardPruneNow)).toBe(true)
    // Settings
    expect(bus.handlers.has(IPC_CHANNELS.clipboardSettingsGet)).toBe(true)
    expect(bus.handlers.has(IPC_CHANNELS.clipboardSettingsUpdate)).toBe(true)
    // Categories
    expect(bus.handlers.has(IPC_CHANNELS.clipboardCategoryCreate)).toBe(true)
    expect(bus.handlers.has(IPC_CHANNELS.clipboardCategoryRename)).toBe(true)
    expect(bus.handlers.has(IPC_CHANNELS.clipboardCategoryRemove)).toBe(true)
    // Entry mutations
    expect(bus.handlers.has(IPC_CHANNELS.clipboardEntryAssign)).toBe(true)
    expect(bus.handlers.has(IPC_CHANNELS.clipboardEntryUnassign)).toBe(true)
    expect(bus.handlers.has(IPC_CHANNELS.clipboardEntryRemove)).toBe(true)
    // Quick paste
    expect(bus.handlers.has(IPC_CHANNELS.clipboardQuickPastePaste)).toBe(true)
    expect(bus.listeners.has(IPC_CHANNELS.clipboardQuickPasteShow)).toBe(true)
    expect(bus.listeners.has(IPC_CHANNELS.clipboardQuickPasteHide)).toBe(true)
    expect(bus.listeners.has(IPC_CHANNELS.clipboardQuickPasteFocusIndex)).toBe(true)
    // Peek
    expect(bus.listeners.has(IPC_CHANNELS.clipboardPeekShow)).toBe(true)
    expect(bus.listeners.has(IPC_CHANNELS.clipboardPeekHide)).toBe(true)
    // Drag
    expect(bus.listeners.has(IPC_CHANNELS.clipboardStartItemDrag)).toBe(true)
  })

  it('broadcasts state after a category is created', async () => {
    const c = new ClipboardIpcController(deps)
    c.registerAll()
    await bus.call(IPC_CHANNELS.clipboardCategoryCreate, { name: 'Work', color: 'wave' })
    expect(deps.stateStore.createClipboardCategory).toHaveBeenCalledWith('Work', 'wave')
    expect(deps.broadcastState).toHaveBeenCalledTimes(1)
  })

  it('broadcasts state after settings are updated', async () => {
    const c = new ClipboardIpcController(deps)
    c.registerAll()
    await bus.call(IPC_CHANNELS.clipboardSettingsUpdate, { enabled: false })
    expect(deps.stateStore.updateClipboardSettings).toHaveBeenCalledWith({ enabled: false })
    expect(deps.broadcastState).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid settings patch', async () => {
    const c = new ClipboardIpcController(deps)
    c.registerAll()
    await expect(bus.call(IPC_CHANNELS.clipboardSettingsUpdate, { historyLimit: -1 })).rejects.toThrow()
  })

  it('shows the quick paste window with the cached frontmost bundle id', () => {
    deps.clipboardMonitor = {
      getLastFrontmostApp: vi.fn(() => ({ bundleId: 'com.apple.Terminal', name: 'Terminal' }))
    } as unknown as ClipboardMonitor
    const c = new ClipboardIpcController(deps)
    c.registerAll()
    bus.emit(IPC_CHANNELS.clipboardQuickPasteShow)
    expect(deps.quickPasteWindow.show).toHaveBeenCalledWith('com.apple.Terminal')
  })

  it('falls back to empty bundle id when no snapshot is cached', () => {
    const c = new ClipboardIpcController(deps)
    c.registerAll()
    bus.emit(IPC_CHANNELS.clipboardQuickPasteShow)
    expect(deps.quickPasteWindow.show).toHaveBeenCalledWith('')
  })

  it('rejects out-of-range quick paste focus indices', () => {
    const c = new ClipboardIpcController(deps)
    c.registerAll()
    bus.emit(IPC_CHANNELS.clipboardQuickPasteFocusIndex, 99)
    expect(deps.quickPasteWindow.focusIndex).not.toHaveBeenCalled()
  })

  it('accepts a valid quick paste focus index', () => {
    const c = new ClipboardIpcController(deps)
    c.registerAll()
    bus.emit(IPC_CHANNELS.clipboardQuickPasteFocusIndex, 3)
    expect(deps.quickPasteWindow.focusIndex).toHaveBeenCalledWith(3)
  })
})
