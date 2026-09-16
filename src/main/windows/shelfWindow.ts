import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { AppState } from '@shared/schema';
import { IPC_CHANNELS } from '@shared/ipc';
import { loadRenderer } from './loadRenderer';
import { resolvePreloadPath } from './preloadPath';
import { attachRendererCrashRecovery } from './rendererCrashRecovery';
import { lockDownWebContents } from './webSecurity';

export class ShelfWindow {
  private window: BrowserWindow | null = null;
  private manualBounds: Rectangle | null = null;
  private programmaticMoveDepth = 0;

  async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    this.window = new BrowserWindow({
      width: 320,
      height: 380,
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
        // Panels idle hidden for hours; Chromium would otherwise throttle
        // timers/rAF and the first shake after a break feels dead.
        backgroundThrottling: false,
      },
    });

    this.window.setAlwaysOnTop(true, 'floating');
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    this.window.on('move', () => {
      if (!this.window || this.window.isDestroyed() || this.programmaticMoveDepth > 0) {
        return;
      }

      this.manualBounds = this.window.getBounds();
    });
    this.window.on('closed', () => {
      this.manualBounds = null;
      this.window = null;
    });
    lockDownWebContents(this.window);
    attachRendererCrashRecovery(this.window);
    await loadRenderer(this.window, 'shelf');
    return this.window;
  }

  async showNear(
    point: { x: number; y: number },
    inactive = false,
    sizeOverride?: { width: number; height: number },
  ): Promise<void> {
    const window = await this.ensure();
    const width = sizeOverride?.width ?? window.getBounds().width;
    const height = sizeOverride?.height ?? window.getBounds().height;
    // A saved manual position can be off-screen after the display it was
    // parked on was unplugged (a hidden window emits no `move` events to
    // correct it). Clamp it against the current displays; fall back to
    // the cursor-anchored bounds when nothing is visible. The shake
    // gesture's sizeOverride also wins over the remembered size — a
    // 240x296 summon should never silently grow back.
    const bounds =
      this.manualBounds && sizeOverride === undefined
        ? clampToDisplays(this.manualBounds)
        : null;
    this.withProgrammaticMove(() => {
      window.setBounds(bounds ?? computeBounds(point, width, height), false);
    });
    this.showWindow(window, inactive);
  }

  async show(inactive = false): Promise<void> {
    const window = await this.ensure();
    this.showWindow(window, inactive);
  }

  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
  }

  hide(): void {
    this.window?.closeFilePreview();
    this.window?.hide();
  }

  resetPosition(): void {
    this.manualBounds = null;
  }

  sendState(state: AppState): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send(IPC_CHANNELS.stateUpdated, state);
  }

  previewFile(path: string, displayName?: string): boolean {
    if (!this.window) {
      return false;
    }

    this.window.previewFile(path, displayName);
    return true;
  }

  getBrowserWindow(): BrowserWindow | null {
    return this.window;
  }

  private showWindow(window: BrowserWindow, inactive: boolean): void {
    if (inactive) {
      window.showInactive();
      return;
    }

    window.show();
    window.focus();
  }

  private withProgrammaticMove(callback: () => void): void {
    this.programmaticMoveDepth += 1;
    try {
      callback();
    } finally {
      this.programmaticMoveDepth -= 1;
    }
  }
}

function computeBounds(point: { x: number; y: number }, width: number, height: number) {
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  const padding = 16;
  const x = Math.min(Math.max(area.x + padding, point.x - width / 2), area.x + area.width - width - padding);
  const y = Math.min(Math.max(area.y + padding, point.y - 52), area.y + area.height - height - padding);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
  };
}

/** Nearest visible position for saved bounds across all current displays. */
function clampToDisplays(bounds: Rectangle): Rectangle | null {
  let bestDisplay: ReturnType<typeof screen.getDisplayMatching> | null = null;
  let bestOverlap = 0;
  for (const display of screen.getAllDisplays()) {
    const area = display.workArea;
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    const overlap = Math.max(0, overlapX) * Math.max(0, overlapY);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestDisplay = display;
    }
  }
  if (!bestDisplay || bestOverlap <= 0) {
    return null;
  }

  const area = bestDisplay.workArea;
  const x = Math.min(Math.max(area.x, bounds.x), area.x + area.width - bounds.width);
  const y = Math.min(Math.max(area.y, bounds.y), area.y + area.height - bounds.height);
  return { x: Math.round(x), y: Math.round(y), width: bounds.width, height: bounds.height };
}
