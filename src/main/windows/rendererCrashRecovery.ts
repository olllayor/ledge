import type { BrowserWindow } from 'electron';

/**
 * Reload the renderer when its process dies unexpectedly. Without this a
 * dead window is reused forever and every subsequent `webContents.send`
 * is a no-op. Clean exits are intentional and left alone.
 */
export function attachRendererCrashRecovery(window: BrowserWindow): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.reload();
  });
}
