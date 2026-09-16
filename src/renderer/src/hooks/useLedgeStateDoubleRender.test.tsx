// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useLedgeState } from './useLedgeState';
import type { LedgeAPI } from '@shared/ipc';
import type { AppState } from '@shared/schema';

type Listener = (state: AppState) => void;

interface FakeLedge {
  state: AppState;
  listeners: Set<Listener>;
  publish(next: AppState): void;
}

function makeState(): AppState {
  return {
    liveShelf: null,
    teamLiveShelves: {},
    recentShelves: [],
    preferences: {} as AppState['preferences'],
    sync: {} as AppState['sync'],
    permissionStatus: {} as AppState['permissionStatus'],
    clipboardHistory: [],
    clipboardCategories: [],
    clipboardSettings: {} as AppState['clipboardSettings'],
    team: { activeTeamId: null },
    shelfPinned: false,
  } as AppState;
}

function installFakeLedge(): FakeLedge {
  const fake: FakeLedge = {
    state: makeState(),
    listeners: new Set<Listener>(),
    publish(next: AppState) {
      fake.state = next;
      for (const listener of fake.listeners) {
        listener(next);
      }
    },
  };
  const api: LedgeAPI = {
    async getState() {
      return fake.state;
    },
    subscribeState(listener: Listener) {
      fake.listeners.add(listener);
      return () => {
        fake.listeners.delete(listener);
      };
    },
  } as unknown as LedgeAPI;
  (window as unknown as { ledge: LedgeAPI }).ledge = api;
  return fake;
}

describe('useLedgeState double render check', () => {
  afterEach(() => {
    cleanup();
  });

  it('empirically checks if the component calling useLedgeState re-renders when unrelated state changes', async () => {
    const fake = installFakeLedge();
    const selector = (s: AppState) => s.recentShelves.length;

    let childRenderCount = 0;
    function TargetComponent() {
      childRenderCount += 1;
      const { state } = useLedgeState(selector);
      return <div data-testid="count">{state}</div>;
    }

    const { getByTestId } = render(<TargetComponent />);

    // Wait for initial load to settle
    await waitFor(() => {
      expect(getByTestId('count').textContent).not.toBe('null');
    });

    const rendersAfterMount = childRenderCount;

    // Publish an update where recentShelves.length is STILL 0 (so selected state is identical),
    // but the full state object changes (unrelated state update).
    fake.publish({
      ...makeState(),
      recentShelves: [],
      clipboardHistory: [{ id: 'cb-1' } as any], // unrelated change
    });

    // Let React process the updates
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(childRenderCount).toBe(rendersAfterMount);
  });
});
