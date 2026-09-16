import { BrowserWindow, screen, type Display } from 'electron';
import type { AppState, NotchGeometry } from '@shared/schema';
import { IPC_CHANNELS } from '@shared/ipc';
import { resolveNotchGeometry, type Rect } from '../services/notchGeometry';
import { loadRenderer } from './loadRenderer';
import { resolvePreloadPath } from './preloadPath';
import { attachRendererCrashRecovery } from './rendererCrashRecovery';
import { lockDownWebContents } from './webSecurity';

const PANEL_WIDTH = 700;
const PANEL_HEIGHT = 200;

export interface NotchDropoutWindowOptions {
  /**
   * Resolve the notch silhouette for a display. Defaults to the un-measured
   * fallback (menu-bar-height band, classic notch width) so the panel keeps
   * working before the Swift helper answers — or if it never does.
   */
  resolveGeometry?: (display: Display) => NotchGeometry;
  /** Anchor display; defaults to the display under the cursor. */
  resolveDisplay?: () => Display;
}

export class NotchDropoutWindow {
  private window: BrowserWindow | null = null;
  private geometry: NotchGeometry | null = null;
  private readonly resolveDisplay: () => Display;
  private readonly resolveGeometry: (display: Display) => NotchGeometry;
  private _suppressHide = false;
  private suppressHideSince = 0;

  constructor(options: NotchDropoutWindowOptions = {}) {
    this.resolveDisplay =
      options.resolveDisplay ??
      (() => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
    this.resolveGeometry =
      options.resolveGeometry ?? ((display) => resolveNotchGeometry(display, null));
  }

  get suppressHide(): boolean {
    return this._suppressHide;
  }

  set suppressHide(value: boolean) {
    this._suppressHide = value;
    if (value) {
      this.suppressHideSince = Date.now();
    }
  }

  /**
   * Hold hide-suppression for a native drag session and release it
   * safely afterwards.
   *
   * `webContents.startDrag()` returns as soon as the drag session
   * STARTS, so the renderer cannot know when the drop happened — its
   * "drag finished" IPC fired mid-drag and the hover monitor could hide
   * the panel out from under the drag. Main owns the lifecycle instead:
   * hold for at least `minHoldMs`, then let the cursor position decide
   * whether the panel should go away.
   */
  beginDragSuppression(minHoldMs = 1500): void {
    this.suppressHide = true;
    const since = this.suppressHideSince;
    const release = () => {
      if (!this._suppressHide || this.suppressHideSince !== since) {
        // Released elsewhere or a newer suppression started — nothing to do.
        return;
      }
      if (Date.now() - since < minHoldMs) {
        setTimeout(release, 200);
        return;
      }
      this._suppressHide = false;
      this.hideUnlessCursorInside();
    };
    setTimeout(release, minHoldMs);
  }

  async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    this.window = new BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      alwaysOnTop: true,
      type: 'panel',
      vibrancy: 'hud',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        sandbox: true,
        // Hover-triggered HUD; must be responsive the moment the cursor
        // enters the notch hot zone, even after long idle.
        backgroundThrottling: false,
      },
    });

    this.window.setAlwaysOnTop(true, 'floating');
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });

    this.window.on('closed', () => {
      this.window = null;
    });

    lockDownWebContents(this.window);
    attachRendererCrashRecovery(this.window);
    await loadRenderer(this.window, 'notchDropout');
    return this.window;
  }

  async show(): Promise<void> {
    const window = await this.ensure();
    this.applyGeometry(window);
    window.show();
    window.webContents.send(IPC_CHANNELS.notchDropoutStateChanged, {
      state: 'visible',
    });
  }

  /**
   * Re-anchor the panel to the measured notch. Called on reveal and whenever
   * macOS reports a display change: a hot-plug must not leave the panel
   * hugging the notch of a display that is no longer there.
   */
  reposition(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.applyGeometry(this.window);
  }

  /** Latest silhouette pushed to the renderer, or null before the first show. */
  getGeometry(): NotchGeometry | null {
    return this.geometry;
  }

  /** Visible panel bounds in screen coordinates (drives hover hysteresis). */
  getPanelBounds(): Rect | null {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return null;
    const bounds = this.window.getBounds();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }

  hide(): void {
    // A drag-out is in flight: hiding now would kill the drag session.
    // The drag-state IPC handler re-checks via hideUnlessCursorInside()
    // once the drag finishes.
    if (this._suppressHide) return;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(IPC_CHANNELS.notchDropoutStateChanged, {
      state: 'hidden',
    });
    this.window.hide();
  }

  /**
   * Hide the panel if the cursor is no longer over it. Called when a
   * drag-out ends: the hover monitor's leave edge already fired (and was
   * suppressed) during the drag, so it will not fire again.
   */
  hideUnlessCursorInside(): void {
    if (this._suppressHide || !this.isVisible()) return;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const inside =
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height;
    if (!inside) this.hide();
  }

  async toggle(): Promise<void> {
    if (this.isVisible()) {
      this.hide();
    } else {
      await this.show();
      this.window?.focus();
    }
  }

  async focusSearch(): Promise<void> {
    const window = await this.ensure();
    window.focus();
    window.webContents.send(IPC_CHANNELS.notchDropoutStateChanged, {
      state: 'visible',
    });
  }

  sendState(state: AppState): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(IPC_CHANNELS.stateUpdated, state);
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
  }

  getBrowserWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Anchor the panel to the notch: flush against the top edge on a notched
   * display, just below the menu bar otherwise. The window stays full-size
   * (the renderer clips it) so the expanded card is never cut off.
   */
  private applyGeometry(window: BrowserWindow): void {
    const display = this.resolveDisplay();
    const geometry = this.resolveGeometry(display);
    this.geometry = geometry;

    const width = Math.max(PANEL_WIDTH, Math.round(geometry.notchWidth));
    const { bounds } = display;
    const centeredX = Math.round(geometry.centerX - width / 2);
    const minX = bounds.x;
    const maxX = bounds.x + bounds.width - width;
    const x = Math.round(Math.min(Math.max(centeredX, minX), Math.max(minX, maxX)));

    window.setBounds(
      { x, y: Math.round(geometry.top), width, height: PANEL_HEIGHT },
      false,
    );

    if (!window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.notchDropoutGeometry, geometry);
    }
  }
}
