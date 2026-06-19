import { BrowserWindow, screen } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { loadRenderer } from './loadRenderer';
import { resolvePreloadPath } from './preloadPath';
import { lockDownWebContents } from './webSecurity';

export class QuickPasteWindow {
  private window: BrowserWindow | null = null;
  private previousBundleId = '';

  async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    this.window = new BrowserWindow({
      width: 520,
      height: 420,
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
      vibrancy: 'popover',
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

    this.window.on('blur', () => {
      // Auto-hide when the user clicks away — matches the menu-bar pattern.
      this.window?.hide();
    });
    this.window.on('closed', () => {
      this.window = null;
    });

    await loadRenderer(this.window, 'quickPaste');
    lockDownWebContents(this.window);
    return this.window;
  }

  async show(previousBundleId: string): Promise<void> {
    this.previousBundleId = previousBundleId;
    const window = await this.ensure();
    window.webContents.send(IPC_CHANNELS.clipboardQuickPastePaste, {
      // 'shown' is a sentinel payload the renderer uses to focus index 0
      // and refresh the previous-app label; the renderer reads the bundle
      // id via its own snapshot subscription. Avoid a parallel channel.
      hint: 'shown',
      previousBundleId,
    });
    this.positionAtBottomCenter(window);
    window.show();
    window.focus();
  }

  hide(): void {
    this.window?.hide();
  }

  focusIndex(index: number): void {
    this.window?.webContents.send(IPC_CHANNELS.clipboardQuickPastePaste, {
      hint: 'focus',
      index,
      previousBundleId: this.previousBundleId,
    });
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
  }

  private positionAtBottomCenter(window: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { workArea } = display;
    const bounds = window.getBounds();
    const x = Math.round(workArea.x + (workArea.width - bounds.width) / 2);
    const y = Math.round(workArea.y + workArea.height - bounds.height - 80);
    window.setBounds({ x, y, width: bounds.width, height: bounds.height }, false);
  }
}
