import { describe, it, expect, vi } from 'vitest'
import type { NativeScreenMetrics } from '@shared/schema'
import { matchMetrics, NotchMetricsService } from './notchMetrics'

function metrics(overrides: Partial<NativeScreenMetrics> = {}): NativeScreenMetrics {
  return {
    displayId: 1,
    frame: { x: 0, y: 0, width: 1728, height: 1117 },
    visibleFrame: { x: 0, y: 38, width: 1728, height: 1079 },
    hasNotch: true,
    // Raw cut-out width as AppKit measures it.
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

describe('matchMetrics', () => {
  it('prefers the display id', () => {
    const entry = matchMetrics([metrics({ displayId: 7 })], { ...display, id: 7 })
    expect(entry?.displayId).toBe(7)
  })

  it('falls back to the display frame when the id is unknown', () => {
    const entry = matchMetrics([metrics()], { ...display, id: 0 })
    expect(entry?.displayId).toBe(1)
  })

  it('does not inherit another display’s metrics when centres are far apart', () => {
    // Built-in at x=0; external at x=1440 is a different panel and must not
    // receive hasNotch via nearest-centre.
    const entry = matchMetrics(
      [metrics({ displayId: 1, frame: { x: 0, y: 0, width: 1440, height: 900 } })],
      {
        bounds: { x: 1440, y: 0, width: 1440, height: 900 },
        workArea: { x: 1440, y: 25, width: 1440, height: 875 },
        id: 99,
      },
    )
    expect(entry).toBeNull()
  })

  it('still matches the same display by centre when only the id drifted', () => {
    const entry = matchMetrics(
      [metrics({ displayId: 1, frame: { x: 10, y: 5, width: 1440, height: 900 } })],
      {
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 25, width: 1440, height: 875 },
        id: 99,
      },
    )
    expect(entry?.displayId).toBe(1)
  })

  it('returns null without a snapshot', () => {
    expect(matchMetrics([], display)).toBeNull()
  })
})

describe('NotchMetricsService', () => {
  it('caches the snapshot within the TTL', async () => {
    const fetchMetrics = vi.fn(async () => [metrics()])
    const service = new NotchMetricsService({ fetchMetrics, ttlMs: 1000, now: () => 0 })

    await service.refresh()
    await service.refresh()

    expect(fetchMetrics).toHaveBeenCalledTimes(1)
    expect(service.geometryForDisplay(display).hasNotch).toBe(true)
  })

  it('refreshes after invalidate()', async () => {
    const fetchMetrics = vi.fn(async () => [metrics()])
    const service = new NotchMetricsService({ fetchMetrics, ttlMs: 1000 })

    await service.refresh()
    service.invalidate()
    await service.refresh()

    expect(fetchMetrics).toHaveBeenCalledTimes(2)
  })

  it('keeps the last snapshot when a refresh fails and retries next call', async () => {
    const fetchMetrics = vi
      .fn<() => Promise<NativeScreenMetrics[]>>()
      .mockResolvedValueOnce([metrics()])
      .mockRejectedValueOnce(new Error('helper gone'))
      .mockResolvedValueOnce([metrics({ displayId: 2 })])
    const onError = vi.fn()
    const service = new NotchMetricsService({ fetchMetrics, ttlMs: 0, onError })

    await service.refresh()
    await service.refresh(true)
    expect(onError).toHaveBeenCalled()
    expect(service.geometryForDisplay(display).hasNotch).toBe(true)

    // Failure must not stamp the TTL: the next refresh is allowed through.
    await service.refresh()
    expect(fetchMetrics).toHaveBeenCalledTimes(3)
  })

  it('shares one in-flight fetch between concurrent callers', async () => {
    const fetchMetrics = vi.fn(async () => [metrics()])
    const service = new NotchMetricsService({ fetchMetrics, ttlMs: 0 })

    await Promise.all([service.refresh(), service.refresh(), service.refresh()])

    expect(fetchMetrics).toHaveBeenCalledTimes(1)
  })

  it('resolves fallback geometry when the helper never answers', () => {
    const service = new NotchMetricsService({ fetchMetrics: async () => [] })
    const geometry = service.geometryForDisplay(display)
    expect(geometry.hasNotch).toBe(false)
    expect(geometry.menuBarHeight).toBe(38)
  })
})