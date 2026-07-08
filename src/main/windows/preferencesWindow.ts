import { BrowserWindow } from 'electron';
import type { AppState } from '@shared/schema';
import { IPC_CHANNELS } from '@shared/ipc';
import { loadRenderer } from './loadRenderer';
import { resolvePreloadPath } from './preloadPath';
import { lockDownWebContents } from './webSecurity';

export class PreferencesWindow {
  private window: BrowserWindow | null = null;

  async show(): Promise<void> {
    const window = await this.ensure();
    window.show();
    window.focus();
  }

  sendState(state: AppState): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(IPC_CHANNELS.stateUpdated, state);
  }

  getBrowserWindow(): BrowserWindow | null {
    return this.window;
  }

  private async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    this.window = new BrowserWindow({
      width: 780,
      height: 640,
      minWidth: 680,
      minHeight: 520,
      show: false,
      transparent: true,
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
    await loadRenderer(this.window, 'preferences');
    lockDownWebContents(this.window);
    return this.window;
  }
}
