import { BrowserWindow } from 'electron'
import { IPC_CHANNELS, type ToastKind, type ToastPayload } from '@shared/ipc'

/**
 * Push a toast to every live BrowserWindow. Use the throttle helper
 * (see `withThrottle`) for error toasts that can fire in a tight loop.
 */
export function broadcastToast(message: string, kind: ToastKind = 'info'): void {
  const payload: ToastPayload = { message, kind }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IPC_CHANNELS.showToast, payload)
  }
}

/**
 * Build a throttled wrapper around `broadcastToast` that swallows calls
 * inside the throttle window. We use this for persistence errors and
 * oversized-image toasts that can fire from a tight loop (e.g. EACCES
 * on every state write).
 */
export function createThrottledToast(throttleMs: number): (message: string, kind?: ToastKind) => void {
  let lastFiredAt = 0
  return (message, kind = 'info') => {
    const now = Date.now()
    if (now - lastFiredAt < throttleMs) return
    lastFiredAt = now
    broadcastToast(message, kind)
  }
}
