import { BrowserWindow, shell } from 'electron';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LockDownOptions {
  /** Absolute directory containing the app's own renderer HTML. `file:`
   *  navigations outside it are blocked — an arbitrary local HTML file
   *  would otherwise inherit the preload bridge and the full IPC surface.
   *  Defaults to the packaged renderer directory next to the main bundle. */
  rendererRoot?: string;
}

function defaultRendererRoot(): string | null {
  try {
    // `__dirname` is the bundled main directory (out/main) in both dev and
    // packaged builds; the renderer HTML sits in the sibling out/renderer.
    return resolve(__dirname, '../renderer');
  } catch {
    return null;
  }
}

function isInsideRendererRoot(parsed: URL, root: string | null): boolean {
  if (!root) return false;
  try {
    const filePath = resolve(fileURLToPath(parsed));
    return filePath === root || filePath.startsWith(root + sep);
  } catch {
    return false;
  }
}

/**
 * Lock down the renderer against a handful of common Electron foot-guns:
 *   - `window.open(...)` / `target="_blank"` would otherwise spawn a new
 *     BrowserWindow that the user can be navigated anywhere.
 *   - In-page navigations (`<a href>`, `window.location = ...`) can be
 *     used to escape the local renderer context. `file:` targets outside
 *     the app's own renderer directory are blocked outright.
 *   - `webContents` permission requests (notifications, media, geolocation,
 *     MIDI, …) are denied by default; only what we explicitly need later
 *     will be opted in.
 *
 * This helper is applied to every BrowserWindow the main process creates.
 */
export function lockDownWebContents(window: BrowserWindow, options: LockDownOptions = {}): void {
  const rendererRoot = options.rendererRoot ?? defaultRendererRoot();
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
    const isAppFile = parsed.protocol === 'file:' && isInsideRendererRoot(parsed, rendererRoot);
    const isDev = process.env.ELECTRON_RENDERER_URL != null;
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isAppFile || (isDev && isLocalhost && parsed.protocol === 'http:')) {
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
