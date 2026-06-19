import { BrowserWindow, screen } from 'electron';
import type { AppState } from '@shared/schema';
import { IPC_CHANNELS } from '@shared/ipc';
import { loadRenderer } from './loadRenderer';
import { resolvePreloadPath } from './preloadPath';
import { lockDownWebContents } from './webSecurity';

const DEFAULT_WIDTH = 920;
const DEFAULT_HEIGHT = 640;

export class ClipboardWindow {
  private window: BrowserWindow | null = null;

  async show(): Promise<void> {
    const window = await this.ensure();
    this.position(window);
    window.show();
    window.focus();
  }

  sendState(state: AppState): void {
    this.window?.webContents.send(IPC_CHANNELS.stateUpdated, state);
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
  }

  getBrowserWindow(): BrowserWindow | null {
    return this.window;
  }

  private async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    this.window = new BrowserWindow({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: 720,
      minHeight: 480,
      show: false,
      titleBarStyle: 'hiddenInset',
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.window.on('closed', () => {
      this.window = null;
    });
    await loadRenderer(this.window, 'clipboard');
    lockDownWebContents(this.window);
    return this.window;
  }

  private position(window: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { workArea } = display;
    const bounds = window.getBounds();
    const x = Math.round(workArea.x + (workArea.width - bounds.width) / 2);
    const y = Math.round(workArea.y + (workArea.height - bounds.height) / 2);
    window.setBounds({ x, y, width: bounds.width, height: bounds.height }, false);
  }
}
