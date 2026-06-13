import { BrowserWindow, shell } from 'electron';

/**
 * Lock down the renderer against a handful of common Electron foot-guns:
 *   - `window.open(...)` / `target="_blank"` would otherwise spawn a new
 *     BrowserWindow that the user can be navigated anywhere.
 *   - In-page navigations (`<a href>`, `window.location = ...`) can be
 *     used to escape the local renderer context.
 *   - `webContents` permission requests (notifications, media, geolocation,
 *     MIDI, …) are denied by default; only what we explicitly need later
 *     will be opted in.
 *
 * This helper is applied to every BrowserWindow the main process creates.
 */
export function lockDownWebContents(window: BrowserWindow): void {
  const { webContents, webContents: { session } } = window;

  webContents.setWindowOpenHandler(({ url }) => {
    // If a renderer does manage to open a URL, send it to the OS browser
    // rather than another BrowserWindow. This keeps phishing/social-engineering
    // attacks from spawning a spoofed "Ledge" window. We only forward
    // well-formed http(s) URLs; everything else is silently denied.
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // Unparseable URL: fall through to deny.
    }
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    // Allow the initial load (file:// for packaged renderer, http://localhost:*
    // for the Vite dev server) but block every subsequent navigation attempt.
    // The check is `startsWith` against the full scheme + host so a URL like
    // `http://localhost.evil.example/` (which would also start with
    // `http://localhost` if we used a loose prefix) is correctly refused.
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      // Unparseable URL: block rather than fall through.
      event.preventDefault();
      return;
    }
    const isFile = parsed.protocol === 'file:';
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isFile || (isLocalhost && parsed.protocol === 'http:')) {
      return;
    }
    event.preventDefault();
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      void shell.openExternal(parsed.toString());
    }
  });

  // Deny all permission requests from the renderer by default. We don't
  // currently request any (no notifications, media, geolocation, …).
  session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
}
