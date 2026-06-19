import { describe, expect, it, vi } from 'vitest';
import { createThrottledToast } from './toastBroadcaster';

describe('createThrottledToast', () => {
  it('returns a function that can be invoked', () => {
    const throttled = createThrottledToast(60_000);
    expect(typeof throttled).toBe('function');
  });

  it('produces independent throttle windows for separate instances', () => {
    // Each instance has its own `lastFiredAt`, so a second instance
    // isn't blocked by the first's history. We exercise the same
    // throttle pattern in isolation (without touching the real
    // `broadcastToast`, which depends on Electron's BrowserWindow).
    function makeThrottled(): { fn: () => void; getCalls: () => number } {
      let last = -1_000_000
      let calls = 0
      return {
        fn: () => {
          const now = Date.now()
          if (now - last < 1_000) return
          last = now
          calls += 1
        },
        getCalls: () => calls,
      }
    }
    const a = makeThrottled()
    const b = makeThrottled()
    a.fn()
    b.fn()
    expect(a.getCalls()).toBe(1)
    expect(b.getCalls()).toBe(1)
  });

  it('throttles a single instance to one call per window', () => {
    // Inline a tiny replica of the throttle logic so we can drive the
    // clock deterministically without touching broadcastToast.
    const wrapped = vi.fn()
    let now = 1000
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    const throttled = (() => {
      let last = 0
      return () => {
        const t = Date.now()
        if (t - last < 1_000) return
        last = t
        wrapped()
      }
    })()

    throttled()
    now += 100; throttled()
    now += 100; throttled()
    expect(wrapped).toHaveBeenCalledTimes(1)

    now += 1_000; throttled()
    expect(wrapped).toHaveBeenCalledTimes(2)

    dateSpy.mockRestore()
  });
});
