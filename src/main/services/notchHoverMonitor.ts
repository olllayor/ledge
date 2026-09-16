import { screen, type Display } from 'electron';
import type { NotchGeometry } from '@shared/schema';
import {
  REVEAL_SETTLE_MS,
  containsPoint,
  enterRect,
  exitRect,
  resolveNotchGeometry,
  type Rect,
} from './notchGeometry';

/** Poll cadence while the cursor is near the notch or the panel is open. */
const POLL_INTERVAL_ACTIVE_MS = 80;
/** Poll cadence while the cursor is nowhere near: fewer wakeups, same UX. */
const POLL_INTERVAL_IDLE_MS = 250;
const ENTER_DEBOUNCE_MS = 50;
const LEAVE_DELAY_MS = 200;

export interface NotchHoverMonitorCallbacks {
  onEnterHotZone(): void;
  onLeaveHotZone(): void;
  isPanelVisible(): boolean;
  isCursorInsidePanel(): boolean;
}

export interface NotchHoverMonitorOptions extends NotchHoverMonitorCallbacks {
  /** Resolve the notch silhouette for a display (measured or fallback). */
  resolveGeometry?: (display: Display) => NotchGeometry;
  /** Visible panel bounds in screen coordinates; enables exit hysteresis. */
  panelBounds?: () => Rect | null;
  /** Injectable clock (tests). */
  now?: () => number;
}

/**
 * Reveals the notch panel when the cursor reaches the top-centre band, and
 * collapses it when the cursor leaves again.
 *
 * Two things stop it flickering:
 *
 * 1. **Asymmetric rects.** The enter rect is a notch-sized band; the exit rect
 *    is the *revealed panel* inflated by `HOVER_EXIT_MARGIN`. Identical rects
 *    collapse the panel the instant the pointer drops below the band, and the
 *    next pixel of movement re-opens it.
 * 2. **A settle window.** Revealing a panel under a notch-sized hot zone moves
 *    the cursor out of the enter rect immediately, so the exit edge is ignored
 *    for `REVEAL_SETTLE_MS` after a reveal.
 *
 * Polling (rather than a native mouse-move tap) keeps the helper's event tap
 * limited to gestures. The interval adapts, so an idle cursor in a corner does
 * not cost twelve wakeups a second.
 */
export class NotchHoverMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastInZone = false;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private settleUntil = 0;
  private readonly resolveGeometry: (display: Display) => NotchGeometry;
  private readonly panelBounds: () => Rect | null;
  private readonly now: () => number;

  constructor(private readonly options: NotchHoverMonitorOptions) {
    this.resolveGeometry =
      options.resolveGeometry ?? ((display) => resolveNotchGeometry(display, null));
    this.panelBounds = options.panelBounds ?? (() => null);
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.lastInZone = false;
    this.settleUntil = 0;
    this.scheduleNext(POLL_INTERVAL_ACTIVE_MS);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearTimers();
  }

  destroy(): void {
    this.stop();
  }

  private scheduleNext(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.poll();
    }, delay);
  }

  private poll(): void {
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const enterZone = enterRect(this.resolveGeometry(display), display.bounds);
    const inside = containsPoint(enterZone, point);

    if (inside && !this.lastInZone) {
      this.clearLeaveTimer();
      if (!this.enterTimer) {
        this.enterTimer = setTimeout(() => {
          this.enterTimer = null;
          this.lastInZone = true;
          this.settleUntil = this.now() + REVEAL_SETTLE_MS;
          this.options.onEnterHotZone();
        }, ENTER_DEBOUNCE_MS);
      }
    } else if (!inside && this.lastInZone) {
      // Left before the debounce elapsed: no reveal at all.
      this.clearEnterTimer();
      if (this.shouldHoldOpen(point, enterZone)) {
        // Still inside the exit margin, or the panel is still settling.
      } else if (!this.leaveTimer) {
        this.leaveTimer = setTimeout(() => {
          this.leaveTimer = null;
          // Re-check at fire time: the cursor may have come back.
          if (this.shouldHoldOpen(screen.getCursorScreenPoint(), enterZone)) return;
          this.lastInZone = false;
          this.options.onLeaveHotZone();
        }, LEAVE_DELAY_MS);
      }
    } else if (inside && this.lastInZone) {
      this.clearLeaveTimer();
    }

    this.scheduleNext(inside || this.lastInZone ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS);
  }

  /**
   * Keep the panel open when the cursor is still in its exit margin, parked on
   * the panel itself, or while the reveal is still settling.
   */
  private shouldHoldOpen(point: { x: number; y: number }, enterZone: Rect): boolean {
    if (this.options.isPanelVisible()) {
      if (this.now() < this.settleUntil) return true;
      if (this.options.isCursorInsidePanel()) return true;
      const panel = this.panelBounds();
      if (panel && containsPoint(exitRect(panel), point)) return true;
    }
    return containsPoint(exitRect(enterZone), point);
  }

  private clearTimers(): void {
    this.clearEnterTimer();
    this.clearLeaveTimer();
  }

  private clearEnterTimer(): void {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
      this.enterTimer = null;
    }
  }

  private clearLeaveTimer(): void {
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }
}