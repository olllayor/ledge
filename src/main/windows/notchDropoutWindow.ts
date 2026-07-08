import { BrowserWindow, screen } from 'electron';
import type { AppState } from '@shared/schema';
import { IPC_CHANNELS } from '@shared/ipc';
import { loadRenderer } from './loadRenderer';
import { resolvePreloadPath } from './preloadPath';
import { lockDownWebContents } from './webSecurity';

const PANEL_WIDTH = 700;
const PANEL_HEIGHT = 200;
const PEEK_BELOW_MENUBAR = 0;
const PEEK_FALLBACK_MENUBAR_HEIGHT = 32;

export class NotchDropoutWindow {
  private window: BrowserWindow | null = null;
  private _suppressHide = false;

  get suppressHide(): boolean {
    return this._suppressHide;
  }

  set suppressHide(value: boolean) {
    this._suppressHide = value;
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
      },
    });

    this.window.setAlwaysOnTop(true, 'floating');
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });

    this.window.on('closed', () => {
      this.window = null;
    });

    await loadRenderer(this.window, 'notchDropout');
    lockDownWebContents(this.window);
    return this.window;
  }

  async show(): Promise<void> {
    const window = await this.ensure();
    this.positionTopCenter(window);
    window.show();
    window.webContents.send(IPC_CHANNELS.notchDropoutStateChanged, {
      state: 'visible',
    });
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

  private positionTopCenter(window: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { workArea } = display;
    const menubarHeight = workArea.y > 0 ? workArea.y : PEEK_FALLBACK_MENUBAR_HEIGHT;
    const bounds = window.getBounds();
    const x = Math.round(workArea.x + (workArea.width - bounds.width) / 2);
    const y = menubarHeight + PEEK_BELOW_MENUBAR;
    window.setBounds({ x, y, width: bounds.width, height: bounds.height }, false);
  }
}
