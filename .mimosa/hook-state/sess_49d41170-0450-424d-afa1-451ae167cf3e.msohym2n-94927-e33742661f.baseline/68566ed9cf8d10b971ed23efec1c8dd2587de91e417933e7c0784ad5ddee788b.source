// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { OnboardingView } from './OnboardingView';
import type { AppState } from '@shared/schema';

function buildState(): AppState {
  return {
    liveShelf: null,
    recentShelves: [],
    preferences: {
      launchAtLogin: false,
      shakeEnabled: true,
      shakeSensitivity: 'balanced',
      excludedBundleIds: [],
      globalShortcut: 'CommandOrControl+Shift+Space',
      hasCompletedOnboarding: false,
      hasSeenShelfLimitMigration: false,
      shelfInteraction: { doubleClickAction: 'open', autoCloseShelf: false, autoRetract: false }
    },
    permissionStatus: {
      nativeHelperAvailable: true,
      accessibilityTrusted: true,
      shakeReady: true,
      lastError: '',
      shortcutRegistered: true,
      shortcutError: ''
    },
    sync: {
      enabled: false,
      status: 'signedOut',
      deviceId: '',
      plan: 'free',
      syncedShelfCount: 0,
      deviceCount: 0,
      storageBytesUsed: 0,
      lastError: ''
    },
    clipboardHistory: [],
    clipboardCategories: [],
    clipboardSettings: {
      enabled: false,
      historyLimit: 200,
      ignoreConcealedItems: true,
      ignoreBundleIds: [],
      quickPasteHotkey: 'CommandOrControl+Shift+V',
      peekHotkey: '',
      syntheticPasteEnabled: false
    },
    team: { activeTeamId: null }
  };
}

let setPreferencesMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setPreferencesMock = vi.fn(async () => buildState().preferences);
  (window as unknown as { ledge: { setPreferences: ReturnType<typeof vi.fn> } }).ledge = {
    setPreferences: setPreferencesMock,
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OnboardingView (user stories 9.1-9.10)', () => {
  it('9.1 first launch: shows step 1 (drag file) by default', () => {
    render(<OnboardingView state={buildState()} onComplete={() => undefined} />);
    // Title text is unique
    expect(document.body.textContent).toContain('Your floating shelf');
    // Step 1 has a unique drop zone testid
    expect(document.querySelector('[data-testid="onboarding-drop-shelf"]')).toBeTruthy();
  });

  it('9.5 ArrowRight on a locked step does not preventDefault and does not advance', () => {
    const result = render(<OnboardingView state={buildState()} onComplete={() => undefined} />);
    const cta = result.getByRole('button', { name: /Drop File to Unlock/ });
    expect((cta as HTMLButtonElement).disabled).toBe(true);

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(false);
    expect(result.getByRole('button', { name: /Drop File to Unlock/ })).toBeTruthy();
  });

  it('9.5 step 0: ArrowLeft does not preventDefault (BUG-003)', () => {
    render(<OnboardingView state={buildState()} onComplete={() => undefined} />);
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('9.5 Enter on locked step does not preventDefault (BUG-003)', () => {
    const result = render(<OnboardingView state={buildState()} onComplete={() => undefined} />);
    const cta = result.getByRole('button', { name: /Drop File to Unlock/ });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('9.7 Get Started on step 3 (after step 1+2 unlocked) calls onComplete and setPreferences', async () => {
    const onComplete = vi.fn();
    const result = render(<OnboardingView state={buildState()} onComplete={onComplete} />);
    // Step 0: drop file to unlock (simulated)
    const dropZone = result.getByTestId('onboarding-drop-shelf');
    fireEvent.drop(dropZone);
    // Now step 1 is done; advance to step 2 via Next button
    await waitFor(() => {
      expect((result.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(result.getByRole('button', { name: /Next/ }));
    // Step 2 (index 1) shows the activation methods
    await waitFor(() => {
      expect(document.body.textContent).toContain('Three ways to summon it');
    });
    // Step 2 is unlocked by default; advance to step 3
    fireEvent.click(result.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Drop anything, drag anywhere');
    });
    // Click "Get Started" on the final step
    const getStarted = result.getByRole('button', { name: /Get Started/ });
    fireEvent.click(getStarted);
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
      expect(setPreferencesMock).toHaveBeenCalledWith({ hasCompletedOnboarding: true });
    });
  });

  it('9.6 Skip on step 1 marks onboarding complete', async () => {
    const onComplete = vi.fn();
    const result = render(<OnboardingView state={buildState()} onComplete={onComplete} />);
    fireEvent.click(result.getByRole('button', { name: /Skip/ }));
    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({ hasCompletedOnboarding: true });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('9.2 step 1: drop file on the sandbox shelf unlocks step', async () => {
    const result = render(<OnboardingView state={buildState()} onComplete={() => undefined} />);
    const dropZone = result.getByTestId('onboarding-drop-shelf');
    fireEvent.drop(dropZone);
    await waitFor(() => {
      // After drop, CTA should be enabled (Next, not 'Drop File to Unlock')
      const cta = result.getByRole('button', { name: /Next/ });
      expect((cta as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('9.3 step 2: shows the three activation methods', async () => {
    const result = render(<OnboardingView state={buildState()} onComplete={() => undefined} />);
    // Unlock step 0 first by dropping
    fireEvent.drop(result.getByTestId('onboarding-drop-shelf'));
    await waitFor(() => {
      expect((result.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(result.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Three ways to summon it');
      // Three activation cards
      expect(document.body.textContent).toContain('Shortcut');
      expect(document.body.textContent).toContain('Shake');
      expect(document.body.textContent).toContain('Menu Bar');
    });
  });

  it('9.4 step 3: shows drop/drag flow', async () => {
    const result = render(<OnboardingView state={buildState()} onComplete={() => undefined} />);
    fireEvent.drop(result.getByTestId('onboarding-drop-shelf'));
    await waitFor(() => {
      expect((result.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(result.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Three ways to summon it');
    });
    fireEvent.click(result.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Drop anything, drag anywhere');
      // The drop-flow shows 'Drop in' and 'Drag out'
      expect(document.body.textContent).toContain('Drop in');
      expect(document.body.textContent).toContain('Drag out');
    });
  });

  it('9.9 dev-mode Alt+D unlocks all steps', async () => {
    const onComplete = vi.fn();
    const result = render(<OnboardingView state={buildState()} onComplete={onComplete} />);
    // Press Alt+D
    const event = new KeyboardEvent('keydown', { key: 'd', altKey: true, bubbles: true, cancelable: true });
    fireEvent(window, event);
    await waitFor(() => {
      // After Alt+D the lock is cleared, so 'Next' is enabled
      const cta = result.getByRole('button', { name: /Next/ });
      expect((cta as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('9.8 Escape on step 1 marks onboarding complete', async () => {
    const onComplete = vi.fn();
    render(<OnboardingView state={buildState()} onComplete={onComplete} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(window, event);
    await waitFor(() => {
      expect(setPreferencesMock).toHaveBeenCalledWith({ hasCompletedOnboarding: true });
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
