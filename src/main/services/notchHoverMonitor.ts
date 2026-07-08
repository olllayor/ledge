import { screen } from 'electron';

const POLL_INTERVAL_MS = 80;
const ENTER_DEBOUNCE_MS = 50;
const LEAVE_DELAY_MS = 200;
const HOT_ZONE_Y_PX = 5;
const HOT_ZONE_X_RATIO = 0.15;

interface NotchHoverMonitorCallbacks {
  onEnterHotZone(): void;
  onLeaveHotZone(): void;
  isPanelVisible(): boolean;
  isCursorInsidePanel(): boolean;
}

/**
 * Monitors global cursor position and fires callbacks when the cursor
 * enters or leaves the "hot zone" at the top edge of the screen (near
 * the MacBook notch).
 *
 * Uses polling (setInterval) with enter debounce and leave delay to
 * prevent flickering. Multi-monitor safe — uses display.bounds.
 */
export class NotchHoverMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastInZone = false;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly callbacks: NotchHoverMonitorCallbacks) {}

  start(): void {
    if (this.interval) return;
    this.lastInZone = false;
    this.interval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.clearTimers();
  }

  destroy(): void {
    this.stop();
  }

  private poll(): void {
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const { bounds, workArea } = display;

    const menuBarHeight = workArea.y > 0 ? workArea.y - bounds.y : 25;
    const hotZoneYMax = bounds.y + menuBarHeight + HOT_ZONE_Y_PX;
    const hotZoneXMin = bounds.x + bounds.width * HOT_ZONE_X_RATIO;
    const hotZoneXMax = bounds.x + bounds.width * (1 - HOT_ZONE_X_RATIO);

    const inHotZone =
      point.y >= bounds.y &&
      point.y <= hotZoneYMax &&
      point.x >= hotZoneXMin &&
      point.x <= hotZoneXMax;

    if (inHotZone && !this.lastInZone) {
      this.clearTimers();
      this.enterTimer = setTimeout(() => {
        this.lastInZone = true;
        this.callbacks.onEnterHotZone();
      }, ENTER_DEBOUNCE_MS);
    } else if (!inHotZone && this.lastInZone && !this.leaveTimer) {
      this.leaveTimer = setTimeout(() => {
        if (
          !this.callbacks.isPanelVisible() ||
          !this.callbacks.isCursorInsidePanel()
        ) {
          this.lastInZone = false;
          this.callbacks.onLeaveHotZone();
        }
        this.leaveTimer = null;
      }, LEAVE_DELAY_MS);
    } else if (inHotZone && this.lastInZone) {
      this.clearTimers();
    }
  }

  private clearTimers(): void {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
      this.enterTimer = null;
    }
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }
}
