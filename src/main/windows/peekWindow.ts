import { BrowserWindow, screen } from 'electron';
import type { AppState } from '@shared/schema';
import { IPC_CHANNELS } from '@shared/ipc';
import { loadRenderer } from './loadRenderer';
import { resolvePreloadPath } from './preloadPath';
import { lockDownWebContents } from './webSecurity';

const COLLAPSED_WIDTH = 280;
const COLLAPSED_HEIGHT = 48;
const PEEK_BELOW_MENUBAR = 8;
const PEEK_FALLBACK_MENUBAR_HEIGHT = 32;

export class PeekWindow {
  private window: BrowserWindow | null = null;

  async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    this.window = new BrowserWindow({
      width: COLLAPSED_WIDTH,
      height: COLLAPSED_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      alwaysOnTop: true,
      type: 'panel',
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

    await loadRenderer(this.window, 'peek');
    lockDownWebContents(this.window);
    return this.window;
  }

  async show(): Promise<void> {
    const window = await this.ensure();
    this.positionTopCenter(window);
    window.show();
    window.focus();
    // Tell the renderer we're visible so it can start rendering thumbnails.
    window.webContents.send(IPC_CHANNELS.clipboardPeekHint, { hint: 'visible' });
  }

  hide(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
  }

  sendState(state: AppState): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(IPC_CHANNELS.stateUpdated, state);
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
  }

  private positionTopCenter(window: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { workArea } = display;
    // workArea.y is the offset of the safe work area from the top of the
    // screen in display pixels. On non-notch Macs this is ~24px; on notch
    // 14"/16" M-series Pro/Max this is ~37px (the menu bar includes the
    // notch housing). We sit the peek window just below the menu bar.
    const menubarHeight = workArea.y > 0 ? workArea.y : PEEK_FALLBACK_MENUBAR_HEIGHT;
    const bounds = window.getBounds();
    const x = Math.round(workArea.x + (workArea.width - bounds.width) / 2);
    const y = menubarHeight + PEEK_BELOW_MENUBAR;
    window.setBounds({ x, y, width: bounds.width, height: bounds.height }, false);
  }
}
