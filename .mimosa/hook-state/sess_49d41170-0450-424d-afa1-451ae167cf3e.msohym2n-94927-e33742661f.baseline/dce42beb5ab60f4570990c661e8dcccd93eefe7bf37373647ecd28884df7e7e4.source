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

  it('does not fire onEnterHotZone when cursor is at screen edges (not center 70%)', () => {
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
})
