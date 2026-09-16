/**
 * Caches the Swift helper's measured screen metrics and turns them into a
 * notch silhouette per display.
 *
 * The helper is asked once at startup (and again whenever macOS reports a
 * display change), never on the reveal hot path: measuring the notch is an
 * AppKit call that must not sit between "cursor touched the top edge" and
 * "panel is on screen".
 */
import type { NativeScreenMetrics, NotchGeometry } from '@shared/schema'
import {
  resolveNotchGeometry,
  type DisplayLike,
  type DisplayRect,
} from './notchGeometry'

export type ScreenMetricsFetcher = () => Promise<NativeScreenMetrics[]>

export interface DisplayWithId extends DisplayLike {
  id?: number
}

export interface NotchMetricsServiceOptions {
  fetchMetrics: ScreenMetricsFetcher
  /** Injectable clock so TTL behaviour is testable. */
  now?: () => number
  /** A cached snapshot younger than this is reused without a fetch. */
  ttlMs?: number
  onError?: (error: unknown) => void
}

const DEFAULT_TTL_MS = 30_000
/** Display frames are whole points; allow a point of drift for safety. */
const FRAME_MATCH_TOLERANCE = 2
/**
 * Nearest-centre is only a last resort when the helper id does not line up
 * with Electron's. An adjacent external monitor sits hundreds of points from
 * the built-in, so anything farther than this is a different display and must
 * not inherit its notch metrics.
 */
const MAX_CENTER_MATCH_DISTANCE = 100

/**
 * Pick the metrics entry that describes this Electron display.
 *
 * `Display.id` is the `CGDirectDisplayID` on macOS, so an id match is exact.
 * Frame matching is the fallback for a helper that reported `0` (or for a
 * display that was hot-plugged between the snapshot and this call).
 */
export function matchMetrics(
  metrics: NativeScreenMetrics[],
  display: DisplayWithId,
): NativeScreenMetrics | null {
  if (metrics.length === 0) return null

  if (typeof display.id === 'number' && display.id !== 0) {
    const byId = metrics.find((entry) => entry.displayId === display.id)
    if (byId) return byId
  }

  const byFrame = metrics.find(
    (entry) =>
      Math.abs(entry.frame.x - display.bounds.x) <= FRAME_MATCH_TOLERANCE &&
      Math.abs(entry.frame.y - display.bounds.y) <= FRAME_MATCH_TOLERANCE &&
      Math.abs(entry.frame.width - display.bounds.width) <= FRAME_MATCH_TOLERANCE,
  )
  if (byFrame) return byFrame

  return nearestByCenter(metrics, display.bounds)
}

function nearestByCenter(
  metrics: NativeScreenMetrics[],
  bounds: DisplayRect,
): NativeScreenMetrics | null {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  let best: NativeScreenMetrics | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const entry of metrics) {
    const dx = entry.frame.x + entry.frame.width / 2 - centerX
    const dy = entry.frame.y + entry.frame.height / 2 - centerY
    const distance = Math.hypot(dx, dy)
    if (distance < bestDistance) {
      bestDistance = distance
      best = entry
    }
  }

  if (bestDistance > MAX_CENTER_MATCH_DISTANCE) return null
  return best
}

export class NotchMetricsService {
  private readonly fetchMetrics: ScreenMetricsFetcher
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly onError: (error: unknown) => void
  private snapshot: NativeScreenMetrics[] = []
  private lastFetchedAt = Number.NEGATIVE_INFINITY
  private inFlight: Promise<void> | null = null

  constructor(options: NotchMetricsServiceOptions) {
    this.fetchMetrics = options.fetchMetrics
    this.now = options.now ?? (() => Date.now())
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.onError = options.onError ?? (() => undefined)
  }

  /** Latest metrics; empty until the first `refresh()` resolves. */
  getSnapshot(): NativeScreenMetrics[] {
    return this.snapshot
  }

  /**
   * Refresh the snapshot unless a fresh one is already cached. Concurrent
   * callers share one in-flight fetch. Failures are swallowed: the previous
   * snapshot (or the fallback geometry) stays in use.
   */
  async refresh(force = false): Promise<void> {
    if (this.inFlight) return this.inFlight
    if (!force && this.now() - this.lastFetchedAt < this.ttlMs) return

    const task = (async () => {
      try {
        this.snapshot = await this.fetchMetrics()
        this.lastFetchedAt = this.now()
      } catch (error) {
        // Do not stamp lastFetchedAt on failure: a transient helper blip
        // would otherwise freeze fallback geometry for the whole TTL.
        this.onError(error)
      }
    })()

    this.inFlight = task.finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  metricsForDisplay(display: DisplayWithId): NativeScreenMetrics | null {
    return matchMetrics(this.snapshot, display)
  }

  geometryForDisplay(display: DisplayWithId): NotchGeometry {
    return resolveNotchGeometry(display, this.metricsForDisplay(display))
  }

  /** Drop the cache (display added/removed/moved) so the next read re-measures. */
  invalidate(): void {
    this.lastFetchedAt = Number.NEGATIVE_INFINITY
  }
}
