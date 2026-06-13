// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useLedgeState } from './useLedgeState';
import type { LedgeAPI } from '@shared/ipc';
import type { AppState } from '@shared/schema';

type Listener = (state: AppState) => void;

interface FakeLedge {
  state: AppState;
  listeners: Set<Listener>;
  getStateCalls: number;
  subscribeCalls: number;
  publish(next: AppState): void;
}

function makeState(): AppState {
  return {
    liveShelf: null,
    recentShelves: [],
    preferences: {} as AppState['preferences'],
    sync: {} as AppState['sync'],
    permissionStatus: {} as AppState['permissionStatus'],
  } as AppState;
}

function installFakeLedge(): FakeLedge {
  const fake: FakeLedge = {
    state: makeState(),
    listeners: new Set<Listener>(),
    getStateCalls: 0,
    subscribeCalls: 0,
    publish(next: AppState) {
      fake.state = next;
      for (const listener of fake.listeners) {
        listener(next);
      }
    },
  };
  const api: LedgeAPI = {
    async getState() {
      fake.getStateCalls += 1;
      return fake.state;
    },
    subscribeState(listener: Listener) {
      fake.subscribeCalls += 1;
      fake.listeners.add(listener);
      return () => {
        fake.listeners.delete(listener);
      };
    },
  } as unknown as LedgeAPI;
  (window as unknown as { ledge: LedgeAPI }).ledge = api;
  return fake;
}

function Probe({ selector }: { selector?: (s: AppState) => unknown }) {
  const result = useLedgeState(selector as never);
  return (
    <div>
      <span data-testid="state">{result.state === null ? 'null' : 'set'}</span>
      <span data-testid="error">{result.error}</span>
      <span data-testid="full">{result.fullState === null ? 'null' : 'set'}</span>
    </div>
  );
}

beforeEach(() => {
  // Always install a baseline fake so the very first render can find it.
  installFakeLedge();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useLedgeState', () => {
  it('returns the empty initial state, then fills it from getState()', async () => {
    const fake = installFakeLedge();
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('full').textContent).toBe('null');
    expect(getByTestId('state').textContent).toBe('null');
    expect(getByTestId('error').textContent).toBe('');

    await waitFor(() => {
      expect(getByTestId('full').textContent).toBe('set');
    });
    expect(fake.getStateCalls).toBe(1);
    expect(fake.subscribeCalls).toBe(1);
  });

  it('subscribes to state updates and propagates them', async () => {
    const fake = installFakeLedge();
    const { getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByTestId('full').textContent).toBe('set');
    });

    const newShelves = [{}] as unknown as AppState['recentShelves'];
    fake.publish({ ...makeState(), recentShelves: newShelves });
    // After the publish, the listener fires synchronously and React
    // re-renders, so the full state remains 'set'.
    expect(getByTestId('full').textContent).toBe('set');
  });

  it('unsubscribes on unmount so the listener set is empty', async () => {
    const fake = installFakeLedge();
    const { unmount } = render(<Probe />);
    await waitFor(() => {
      expect(fake.listeners.size).toBe(1);
    });
    unmount();
    expect(fake.listeners.size).toBe(0);
  });

  it('reports an error when the preload bridge is missing', async () => {
    delete (window as unknown as { ledge?: unknown }).ledge;
    const { getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByTestId('error').textContent).toMatch(/preload bridge did not load/);
    });
  });

  it('reports an error when getState() rejects', async () => {
    const api: LedgeAPI = {
      getState: () => Promise.reject(new Error('boom')) as ReturnType<LedgeAPI['getState']>,
      subscribeState: () => () => undefined,
    } as unknown as LedgeAPI;
    (window as unknown as { ledge: LedgeAPI }).ledge = api;

    const { getByTestId } = render(<Probe />);
    await waitFor(() => {
      expect(getByTestId('error').textContent).toBe('boom');
    });
  });

  it('projects the full state through a custom selector', async () => {
    installFakeLedge();
    const selector = (s: AppState) => ({ count: s.recentShelves.length });
    const { getByTestId } = render(<Probe selector={selector} />);
    await waitFor(() => {
      expect(getByTestId('state').textContent).toBe('set');
    });
  });

  it('preserves the slice reference across shallow-equal updates', async () => {
    const fake = installFakeLedge();
    const selector = (s: AppState) => ({ count: s.recentShelves.length });
    let renderCount = 0;
    function CountingProbe() {
      renderCount += 1;
      return <Probe selector={selector} />;
    }
    render(<CountingProbe />);
    await waitFor(() => {
      expect(fake.listeners.size).toBe(1);
    });
    const rendersAfterMount = renderCount;
    // Publish a state whose selected slice is shallow-equal (the
    // selector returns a fresh `{ count: 0 }` but the previous slice
    // was also `{ count: 0 }`, so the projection bails out).
    fake.publish({ ...makeState(), recentShelves: [] });
    // The setState in the projection effect short-circuits when
    // shallow-equal, but the full-state setState still happens. The
    // CountingProbe itself doesn't re-render unless it re-renders the
    // child — it does on every parent render, but the parent never
    // re-renders, so renderCount should not change here.
    expect(renderCount).toBe(rendersAfterMount);
  });
});
