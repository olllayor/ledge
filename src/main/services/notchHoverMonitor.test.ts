import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGetCursorScreenPoint, mockGetDisplayNearestPoint } = vi.hoisted(() => ({
  mockGetCursorScreenPoint: vi.fn(() => ({ x: 720, y: 2 })),
  mockGetDisplayNearestPoint: vi.fn(() => ({
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 25, width: 1440, height: 875 },
  })),
}))

vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: mockGetCursorScreenPoint,
    getDisplayNearestPoint: mockGetDisplayNearestPoint,
  },
}))

import { NotchHoverMonitor } from './notchHoverMonitor'

function makeDisplay(overrides: Partial<{ x: number; y: number; width: number; height: number; workAreaY: number }> = {}) {
  const x = overrides.x ?? 0
  const y = overrides.y ?? 0
  const width = overrides.width ?? 1440
  const height = overrides.height ?? 900
  const workAreaY = overrides.workAreaY ?? 25
  return {
    bounds: { x, y, width, height },
    workArea: { x, y: y + workAreaY, width, height: height - workAreaY },
  }
}

describe('NotchHoverMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetCursorScreenPoint.mockReturnValue({ x: 720, y: 2 })
    mockGetDisplayNearestPoint.mockReturnValue(makeDisplay())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires onEnterHotZone when cursor enters the top edge', () => {
    const onEnter = vi.fn()
    const onLeave = vi.fn()
    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: onLeave,
      isPanelVisible: () => false,
      isCursorInsidePanel: () => false,
    })

    monitor.start()
    // First poll at 80ms, enter debounce fires at 80+50=130ms
    vi.advanceTimersByTime(200)

    expect(onEnter).toHaveBeenCalled()
    monitor.destroy()
  })

  it('does not fire onEnterHotZone when cursor is at bottom of screen', () => {
    const onEnter = vi.fn()
    const onLeave = vi.fn()
    mockGetCursorScreenPoint.mockReturnValue({ x: 720, y: 800 })

    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: onLeave,
      isPanelVisible: () => false,
      isCursorInsidePanel: () => false,
    })

    monitor.start()
    vi.advanceTimersByTime(200)

    expect(onEnter).not.toHaveBeenCalled()
    monitor.destroy()
  })

  it('does not fire onEnterHotZone when cursor is outside the notch band', () => {
    const onEnter = vi.fn()
    mockGetCursorScreenPoint.mockReturnValue({ x: 50, y: 2 })

    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: vi.fn(),
      isPanelVisible: () => false,
      isCursorInsidePanel: () => false,
    })

    monitor.start()
    vi.advanceTimersByTime(100)

    expect(onEnter).not.toHaveBeenCalled()
    monitor.destroy()
  })

  it('fires onLeaveHotZone after cursor leaves hot zone with delay', () => {
    const onEnter = vi.fn()
    const onLeave = vi.fn()
    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: onLeave,
      isPanelVisible: () => false,
      isCursorInsidePanel: () => false,
    })

    // Enter hot zone
    monitor.start()
    vi.advanceTimersByTime(200)
    expect(onEnter).toHaveBeenCalled()

    // Move cursor outside hot zone
    mockGetCursorScreenPoint.mockReturnValue({ x: 720, y: 500 })

    // Advance past the leave delay (200ms) + poll interval (80ms)
    vi.advanceTimersByTime(400)

    expect(onLeave).toHaveBeenCalled()
    monitor.destroy()
  })

  it('respects multi-monitor display bounds', () => {
    const onEnter = vi.fn()
    const display = makeDisplay({ x: 1440, y: 0, workAreaY: 25 })
    mockGetDisplayNearestPoint.mockReturnValue(display)
    mockGetCursorScreenPoint.mockReturnValue({ x: 2160, y: 2 })

    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: vi.fn(),
      isPanelVisible: () => false,
      isCursorInsidePanel: () => false,
    })

    monitor.start()
    vi.advanceTimersByTime(200)

    expect(onEnter).toHaveBeenCalled()
    monitor.destroy()
  })

  it('stop() prevents further polling', () => {
    const onEnter = vi.fn()
    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: vi.fn(),
      isPanelVisible: () => false,
      isCursorInsidePanel: () => false,
    })

    monitor.start()
    monitor.stop()

    vi.advanceTimersByTime(200)
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('polls the idle cadence while the cursor is far from the notch', () => {
    const onEnter = vi.fn()
    mockGetCursorScreenPoint.mockReturnValue({ x: 720, y: 800 })

    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: vi.fn(),
      isPanelVisible: () => false,
      isCursorInsidePanel: () => false,
    })

    monitor.start()
    // First poll runs at 80ms, finds the cursor far away, and drops to the
    // 250ms idle cadence: the next sample is not until 330ms.
    vi.advanceTimersByTime(100)
    expect(onEnter).not.toHaveBeenCalled()

    mockGetCursorScreenPoint.mockReturnValue({ x: 720, y: 2 })
    vi.advanceTimersByTime(250)
    // Sampled at 330ms; the 50ms enter debounce has not elapsed yet.
    expect(onEnter).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60)
    expect(onEnter).toHaveBeenCalled()

    monitor.destroy()
  })

  it('holds the panel open while the cursor is inside the exit margin', () => {
    const onEnter = vi.fn()
    const onLeave = vi.fn()
    const panel = { x: 370, y: 0, width: 700, height: 200 }
    let cursor = { x: 720, y: 2 }

    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: onLeave,
      isPanelVisible: () => true,
      isCursorInsidePanel: () =>
        cursor.x >= panel.x &&
        cursor.x <= panel.x + panel.width &&
        cursor.y >= panel.y &&
        cursor.y <= panel.y + panel.height,
      panelBounds: () => panel,
      now: () => Date.now(),
    })

    mockGetCursorScreenPoint.mockImplementation(() => cursor)
    monitor.start()
    vi.advanceTimersByTime(200)
    expect(onEnter).toHaveBeenCalled()

    // Just below the notch band, but nowhere near the panel's edge.
    cursor = { x: 720, y: 60 }
    vi.advanceTimersByTime(1500)
    expect(onLeave).not.toHaveBeenCalled()

    // Now well clear of the panel (exit margin is 60px).
    cursor = { x: 720, y: 400 }
    vi.advanceTimersByTime(1000)
    expect(onLeave).toHaveBeenCalled()

    monitor.destroy()
  })

  it('ignores the exit edge during the reveal settling window', () => {
    const onLeave = vi.fn()
    let cursor = { x: 720, y: 2 }

    const monitor = new NotchHoverMonitor({
      onEnterHotZone: vi.fn(),
      onLeaveHotZone: onLeave,
      isPanelVisible: () => true,
      isCursorInsidePanel: () => false,
      panelBounds: () => ({ x: 370, y: 0, width: 700, height: 200 }),
      now: () => Date.now(),
    })

    mockGetCursorScreenPoint.mockImplementation(() => cursor)
    monitor.start()
    vi.advanceTimersByTime(130)

    // Cursor drops straight out of the band; the panel must stay put while it
    // settles (700ms from the reveal) instead of collapsing instantly.
    cursor = { x: 720, y: 700 }
    vi.advanceTimersByTime(600)
    expect(onLeave).not.toHaveBeenCalled()

    // Once the settle window expires the leave edge is honoured again.
    vi.advanceTimersByTime(1200)
    expect(onLeave).toHaveBeenCalled()

    monitor.destroy()
  })

  it('uses the measured notch band for the hot zone', () => {
    const onEnter = vi.fn()
    // A 204pt notch centred on the display: x=200 is far outside it.
    mockGetCursorScreenPoint.mockReturnValue({ x: 200, y: 2 })

    const monitor = new NotchHoverMonitor({
      onEnterHotZone: onEnter,
      onLeaveHotZone: vi.fn(),
      isPanelVisible: () => false,
      isCursorInsidePanel: () => false,
      resolveGeometry: () => ({
        hasNotch: true,
        menuBarHeight: 38,
        notchWidth: 204,
        notchHeight: 38,
        scale: 1,
        cornerRadius: 10,
        centerX: 720,
        top: 0,
      }),
    })

    monitor.start()
    vi.advanceTimersByTime(400)
    expect(onEnter).not.toHaveBeenCalled()

    mockGetCursorScreenPoint.mockReturnValue({ x: 720, y: 20 })
    vi.advanceTimersByTime(400)
    expect(onEnter).toHaveBeenCalled()

    monitor.destroy()
  })
})
