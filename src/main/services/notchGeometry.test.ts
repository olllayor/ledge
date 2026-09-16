import { describe, it, expect } from 'vitest'
import type { NativeScreenMetrics } from '@shared/schema'
import {
  enterRect,
  exitRect,
  containsPoint,
  measureNotch,
  resolveNotchGeometry,
  scaleForDisplay,
  HOVER_EXIT_MARGIN,
} from './notchGeometry'

function metrics(overrides: Partial<NativeScreenMetrics> = {}): NativeScreenMetrics {
  return {
    displayId: 1,
    frame: { x: 0, y: 0, width: 1728, height: 1117 },
    visibleFrame: { x: 0, y: 38, width: 1728, height: 1079 },
    hasNotch: true,
    // Raw cut-out width as AppKit measures it; main adds the presentation
    // bleed on top.
    notchWidth: 200,
    notchHeight: 38,
    menuBarHeight: 38,
    safeAreaTop: 38,
    ...overrides,
  }
}

const display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1728, height: 1117 },
  workArea: { x: 0, y: 38, width: 1728, height: 1079 },
}

describe('measureNotch', () => {
  it('bleeds past the measured notch width', () => {
    const measured = measureNotch({
      hasNotch: true,
      measuredWidth: 200,
      menuBarHeight: 38,
      safeAreaTop: 38,
    })
    expect(measured.width).toBe(204)
    expect(measured.height).toBe(38)
  })

  it('falls back to the closed notch size when AppKit reports no notch', () => {
    const measured = measureNotch({
      hasNotch: false,
      measuredWidth: 0,
      menuBarHeight: 25,
      safeAreaTop: 0,
    })
    expect(measured.width).toBe(189)
    expect(measured.height).toBe(25)
  })

  it('uses safeAreaTop when the menu bar height is unknown', () => {
    const measured = measureNotch({
      hasNotch: true,
      measuredWidth: 190,
      menuBarHeight: 0,
      safeAreaTop: 32,
    })
    expect(measured.height).toBe(32)
  })

  it('prefers the helper’s flushed notchHeight over a Dock-contaminated menu bar', () => {
    const measured = measureNotch({
      hasNotch: true,
      measuredWidth: 200,
      // menu + Dock, as the old helper formula reported
      menuBarHeight: 94,
      safeAreaTop: 38,
      helperNotchHeight: 37.8,
    })
    expect(measured.height).toBe(37.8)
  })
})

describe('scaleForDisplay', () => {
  it('is 1.0 at the design reference resolution', () => {
    expect(scaleForDisplay({ x: 0, y: 0, width: 1728, height: 1117 })).toBeCloseTo(1)
  })

  it('clamps small and huge panels into the 0.85–1.10 band', () => {
    expect(scaleForDisplay({ x: 0, y: 0, width: 1280, height: 800 })).toBe(0.85)
    expect(scaleForDisplay({ x: 0, y: 0, width: 3840, height: 2160 })).toBe(1.1)
  })
})

describe('resolveNotchGeometry', () => {
  it('anchors a notched display to the very top of the screen', () => {
    const geometry = resolveNotchGeometry(display, metrics())
    expect(geometry.hasNotch).toBe(true)
    expect(geometry.notchWidth).toBe(204)
    expect(geometry.notchHeight).toBe(38)
    expect(geometry.top).toBe(0)
    expect(geometry.centerX).toBe(864)
  })

  it('drops below the menu bar when no metrics are available yet', () => {
    const geometry = resolveNotchGeometry(display, null)
    expect(geometry.hasNotch).toBe(false)
    expect(geometry.menuBarHeight).toBe(38)
    expect(geometry.notchWidth).toBe(189)
    expect(geometry.notchHeight).toBe(38)
    expect(geometry.top).toBe(38)
  })

  it('drops below the menu bar on an external display', () => {
    const external = { ...display, bounds: { x: 1728, y: 0, width: 2560, height: 1440 } }
    const geometry = resolveNotchGeometry(
      external,
      metrics({ hasNotch: false, notchWidth: 0, notchHeight: 0, menuBarHeight: 24 }),
    )
    expect(geometry.hasNotch).toBe(false)
    expect(geometry.top).toBe(24)
    expect(geometry.centerX).toBe(1728 + 1280)
  })
})

describe('enter/exit rects', () => {
  it('enters through a notch-sized hot zone', () => {
    const geometry = resolveNotchGeometry(display, metrics())
    const rect = enterRect(geometry, display.bounds)
    expect(rect.width).toBe(204 + 16)
    expect(rect.x).toBe(Math.round(864 - 220 / 2))
    expect(containsPoint(rect, { x: 864, y: 0 })).toBe(true)
  })

  it('exits only after leaving the revealed panel by the exit margin', () => {
    const rect = exitRect({ x: 514, y: 0, width: 700, height: 200 })
    expect(rect.x).toBe(514 - HOVER_EXIT_MARGIN)
    // A point inside the exit margin no longer collapses the panel.
    expect(containsPoint(rect, { x: 500, y: 100 })).toBe(true)
    expect(containsPoint(rect, { x: 514 - HOVER_EXIT_MARGIN - 1, y: 100 })).toBe(false)
  })
})