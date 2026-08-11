import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockBrowserWindowInstance = {
  show: vi.fn(),
  hide: vi.fn(),
  focus: vi.fn(),
  isDestroyed: vi.fn(() => false),
  isVisible: vi.fn(() => false),
  getBounds: vi.fn(() => ({ x: 370, y: 25, width: 700, height: 200 })),
  setBounds: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setVisibleOnAllWorkspaces: vi.fn(),
  on: vi.fn(),
  webContents: {
    send: vi.fn(),
    on: vi.fn(),
  },
}

// Must be a regular function (not arrow) to work with `new`
function MockBrowserWindow() {
  return mockBrowserWindowInstance
}

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 720, y: 5 })),
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 25, width: 1440, height: 875 },
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
    })),
  },
}))

vi.mock('../windows/loadRenderer', () => ({
  loadRenderer: vi.fn(),
}))

vi.mock('../windows/preloadPath', () => ({
  resolvePreloadPath: vi.fn(() => '/mock/preload'),
}))

vi.mock('../windows/webSecurity', () => ({
  lockDownWebContents: vi.fn(),
}))

describe('NotchDropoutWindow', () => {
  let NotchDropoutWindow: typeof import('./notchDropoutWindow').NotchDropoutWindow
  let window: InstanceType<typeof NotchDropoutWindow>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockBrowserWindowInstance.isDestroyed.mockReturnValue(false)
    mockBrowserWindowInstance.isVisible.mockReturnValue(false)
    const mod = await import('./notchDropoutWindow')
    NotchDropoutWindow = mod.NotchDropoutWindow
    window = new NotchDropoutWindow()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('positionTopCenter places window below menu bar', async () => {
    await window.show()

    expect(mockBrowserWindowInstance.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({
        y: 25,
        width: 700,
        height: 200,
      }),
      false,
    )
  })

  it('show() makes window visible and sends state-changed', async () => {
    await window.show()

    expect(mockBrowserWindowInstance.show).toHaveBeenCalled()
    expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith(
      'ledge:notch-dropout:state-changed',
      { state: 'visible' },
    )
  })

  it('hide() hides window and sends state-changed', async () => {
    await window.show()
    vi.clearAllMocks()

    window.hide()

    expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith(
      'ledge:notch-dropout:state-changed',
      { state: 'hidden' },
    )
    expect(mockBrowserWindowInstance.hide).toHaveBeenCalled()
  })

  it('toggle() shows and focuses when hidden', async () => {
    mockBrowserWindowInstance.isVisible.mockReturnValue(false)

    await window.toggle()

    expect(mockBrowserWindowInstance.show).toHaveBeenCalled()
    expect(mockBrowserWindowInstance.focus).toHaveBeenCalled()
  })

  it('toggle() hides when visible', async () => {
    await window.show()
    mockBrowserWindowInstance.isVisible.mockReturnValue(true)
    vi.clearAllMocks()

    await window.toggle()

    expect(mockBrowserWindowInstance.hide).toHaveBeenCalled()
  })

  it('suppressHide flag can be set', () => {
    expect(window.suppressHide).toBe(false)
    window.suppressHide = true
    expect(window.suppressHide).toBe(true)
  })
})
