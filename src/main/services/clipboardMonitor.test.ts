import { describe, expect, it, vi } from 'vitest';
import { ClipboardMonitor, type ClipboardChangeSnapshot } from './clipboardMonitor';

function makeSnapshot(overrides: Partial<ClipboardChangeSnapshot> = {}): ClipboardChangeSnapshot {
  return {
    changeCount: 1,
    sourceBundleId: 'com.apple.Safari',
    sourceAppName: 'Safari',
    formats: ['public.utf8-plain-text'],
    ...overrides,
  };
}

describe('ClipboardMonitor', () => {
  it('emits onChange exactly once per distinct changeCount', () => {
    const onChange = vi.fn();
    const monitor = new ClipboardMonitor({ onChange });
    const snapshot = makeSnapshot({ changeCount: 7 });
    monitor.notifyFromNative(snapshot);
    monitor.notifyFromNative(snapshot); // duplicate
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(snapshot);
  });

  it('emits onChange when changeCount moves forward', () => {
    const onChange = vi.fn();
    const monitor = new ClipboardMonitor({ onChange });
    monitor.notifyFromNative(makeSnapshot({ changeCount: 1 }));
    monitor.notifyFromNative(makeSnapshot({ changeCount: 2 }));
    monitor.notifyFromNative(makeSnapshot({ changeCount: 3 }));
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('falls back to format-hash polling when invoked manually', () => {
    const onChange = vi.fn();
    let formatsCallCount = 0;
    const monitor = new ClipboardMonitor({
      onChange,
      // Avoid registering any real interval.
      scheduleInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
      readAvailableFormats: () => {
        formatsCallCount += 1;
        return ['public.utf8-plain-text'];
      },
      readFrontmostApp: () => ({ bundleId: 'com.test.app', name: 'Test' }),
    });
    // Each call to pollOnce is private; expose it via the EventEmitter.
    // The first poll only primes the baseline (pre-launch clipboard
    // contents are not a new copy); identical formats never re-emit.
    (monitor as unknown as { pollOnce: () => void }).pollOnce();
    (monitor as unknown as { pollOnce: () => void }).pollOnce();
    expect(formatsCallCount).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(0);
  });

  it('emits a change when formats differ after the priming poll', () => {
    const onChange = vi.fn();
    const calls: string[][] = [
      ['public.utf8-plain-text'],
      ['public.png'],
      ['public.tiff'],
    ];
    let idx = 0;
    const monitor = new ClipboardMonitor({
      onChange,
      scheduleInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
      readAvailableFormats: () => calls[idx++] ?? [],
      readFrontmostApp: () => ({ bundleId: 'com.test.app', name: 'Test' }),
    });
    (monitor as unknown as { pollOnce: () => void }).pollOnce(); // primes
    (monitor as unknown as { pollOnce: () => void }).pollOnce();
    (monitor as unknown as { pollOnce: () => void }).pollOnce();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not swallow a poll change when a native baseline already exists', () => {
    const onChange = vi.fn();
    const calls: string[][] = [['public.png']];
    let idx = 0;
    const monitor = new ClipboardMonitor({
      onChange,
      scheduleInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
      readAvailableFormats: () => calls[idx++] ?? [],
      readFrontmostApp: () => ({ bundleId: 'com.test.app', name: 'Test' }),
    });
    // Native path established the baseline, then the helper died and the
    // clipboard changed before the poller took over: the first poll must
    // emit, not prime.
    monitor.notifyFromNative(makeSnapshot({ changeCount: 5 }));
    (monitor as unknown as { pollOnce: () => void }).pollOnce();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('getLastFrontmostApp returns the cached snapshot', () => {
    const monitor = new ClipboardMonitor({ onChange: () => undefined });
    expect(monitor.getLastFrontmostApp()).toBeNull();
    monitor.notifyFromNative(makeSnapshot({ sourceBundleId: 'com.test.app', sourceAppName: 'Test' }));
    const app = monitor.getLastFrontmostApp();
    expect(app).toEqual({ bundleId: 'com.test.app', name: 'Test' });
  });
});
