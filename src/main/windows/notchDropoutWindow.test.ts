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
    isDestroyed: vi.fn(() => false),
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

  it('anchors below the menu bar when no notch metrics are available', async () => {
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

  const notchedGeometry = {
    hasNotch: true,
    menuBarHeight: 38,
    notchWidth: 204,
    notchHeight: 38,
    scale: 1,
    cornerRadius: 10,
    centerX: 864,
    top: 0,
  }

  it('anchors flush to the top on a notched display and pushes the geometry', async () => {
    const notched = new NotchDropoutWindow({ resolveGeometry: () => notchedGeometry })

    await notched.show()

    expect(mockBrowserWindowInstance.setBounds).toHaveBeenCalledWith(
      { x: 864 - 350, y: 0, width: 700, height: 200 },
      false,
    )
    expect(mockBrowserWindowInstance.webContents.send).toHaveBeenCalledWith(
      'ledge:notch-dropout:geometry',
      notchedGeometry,
    )
    expect(notched.getGeometry()).toEqual(notchedGeometry)
  })

  it('clamps the anchored x inside the display bounds', async () => {
    const notched = new NotchDropoutWindow({
      resolveGeometry: () => ({ ...notchedGeometry, centerX: 50 }),
    })

    await notched.show()

    expect(mockBrowserWindowInstance.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0 }),
      false,
    )
  })

  it('exposes panel bounds only while the panel is visible', async () => {
    const notched = new NotchDropoutWindow()

    expect(notched.getPanelBounds()).toBeNull()

    await notched.show()
    mockBrowserWindowInstance.isVisible.mockReturnValue(true)

    expect(notched.getPanelBounds()).toEqual({ x: 370, y: 25, width: 700, height: 200 })
  })

  it('reposition() re-anchors the panel to the new geometry', async () => {
    let top = 0
    const notched = new NotchDropoutWindow({
      resolveGeometry: () => ({ ...notchedGeometry, top }),
    })

    await notched.show()
    vi.clearAllMocks()

    top = 38
    notched.reposition()

    expect(mockBrowserWindowInstance.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ y: 38 }),
      false,
    )
  })
})
