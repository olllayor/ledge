import { EventEmitter } from 'node:events';
import { clipboard } from 'electron';

export interface ClipboardChangeSnapshot {
  /** NSPasteboard.general.changeCount (from the Swift helper) or the
   *  fallback loop iteration count for the pure-TS path. */
  changeCount: number;
  sourceBundleId: string;
  sourceAppName: string;
  /** UTIs / pasteboard types present on the pasteboard, without reading
   *  the payloads. */
  formats: string[];
}

export interface ClipboardMonitorOptions {
  onChange: (snapshot: ClipboardChangeSnapshot) => void;
  intervalMs?: number;
  scheduleInterval?: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
  readAvailableFormats?: () => string[];
  readFrontmostApp?: () => { bundleId: string; name: string };
}

/**
 * Clipboard monitor with two paths:
 *
 *  - Primary: relies on the Swift helper to emit `clipboard.changed`
 *    notifications keyed on `NSPasteboard.general.changeCount` (this
 *    avoids triggering macOS Sonoma's "Pasted from" banner on every poll).
 *
 *  - Fallback: pure-TS `clipboard.availableFormats()` hash-poll. Used when
 *    the helper is unavailable (e.g. accessibility permission not yet
 *    granted, or the helper crashed mid-session). Reads formats only, so
 *    the "Pasted from" banner only fires when the payload is actually
 *    read downstream.
 *
 * The most recent snapshot is cached so the Quick Paste hotkey handler can
 * synchronously read the frontmost-app bundle id without a new RPC (which
 * would race the palette window itself becoming frontmost).
 */
export class ClipboardMonitor extends EventEmitter {
  private readonly onChange: (snapshot: ClipboardChangeSnapshot) => void;
  private readonly intervalMs: number;
  private readonly scheduleInterval: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  private readonly clearIntervalFn: (handle: ReturnType<typeof setInterval>) => void;
  private readonly readAvailableFormats: () => string[];
  private readonly readFrontmostApp: () => { bundleId: string; name: string };

  /** Dedupe key for the native path only. NSPasteboard change counts and
   *  the poller's synthetic ticks live in different number spaces, so they
   *  must never share a field: a synthetic tick colliding with a future
   *  real change count would silently drop a genuine copy. */
  private lastNativeChangeCount = -1;
  private pollTick = 0;
  private pollPrimed = false;
  private lastFormatsHash = '';
  private lastSnapshot: ClipboardChangeSnapshot | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: ClipboardMonitorOptions) {
    super();
    this.onChange = options.onChange;
    this.intervalMs = options.intervalMs ?? 500;
    this.scheduleInterval = options.scheduleInterval ?? ((cb, ms) => setInterval(cb, ms));
    this.clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle));
    this.readAvailableFormats = options.readAvailableFormats ?? (() => {
      try {
        return clipboard.availableFormats();
      } catch {
        return [];
      }
    });
    this.readFrontmostApp = options.readFrontmostApp ?? (() => ({ bundleId: '', name: '' }));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Run once immediately so the first clipboard event after launch isn't
    // delayed by `intervalMs`. Then poll on a steady cadence.
    this.pollOnce();
    this.intervalHandle = this.scheduleInterval(() => this.pollOnce(), this.intervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalHandle !== null) {
      this.clearIntervalFn(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Called by the Swift helper's `clipboard.changed` notification handler.
   * Skips when the change count hasn't moved (defensive; the Swift side
   * should already filter).
   */
  notifyFromNative(snapshot: ClipboardChangeSnapshot): void {
    if (snapshot.changeCount === this.lastNativeChangeCount) return;
    this.lastNativeChangeCount = snapshot.changeCount;
    this.lastFormatsHash = snapshot.formats.join('|');
    this.lastSnapshot = snapshot;
    this.emit('change', snapshot);
    this.onChange(snapshot);
  }

  /**
   * Synchronous cache lookup. The Quick Paste hotkey handler uses this to
   * capture the previously-focused app's bundle id before showing the
   * palette (avoiding the RPC round-trip race).
   */
  getLastFrontmostApp(): { bundleId: string; name: string } | null {
    if (!this.lastSnapshot) return null;
    return { bundleId: this.lastSnapshot.sourceBundleId, name: this.lastSnapshot.sourceAppName };
  }

  private pollOnce(): void {
    const formats = this.readAvailableFormats();
    const hash = formats.join('|');
    // First observation with no baseline (native or polled) only primes the
    // hash: whatever sat on the pasteboard before the app launched is not a
    // new copy, and re-capturing it on every launch would duplicate it.
    const hasBaseline = this.pollPrimed || this.lastNativeChangeCount >= 0;
    this.pollPrimed = true;
    if (!hasBaseline) {
      this.lastFormatsHash = hash;
      return;
    }
    if (hash === this.lastFormatsHash) {
      return;
    }
    const frontmost = this.readFrontmostApp();
    const snapshot: ClipboardChangeSnapshot = {
      changeCount: ++this.pollTick,
      sourceBundleId: frontmost.bundleId,
      sourceAppName: frontmost.name,
      formats,
    };
    this.lastFormatsHash = hash;
    this.lastSnapshot = snapshot;
    this.emit('change', snapshot);
    this.onChange(snapshot);
  }
}
