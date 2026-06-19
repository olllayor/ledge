import { lazy, Suspense, useMemo, useState } from 'react';
import { ShelfView } from './components/ShelfView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OnboardingView } from './components/OnboardingView';
import { ToastHost } from './components/ToastHost';
import { useLedgeState } from './hooks/useLedgeState';
import type { AppState } from '@shared/schema';

const PreferencesView = lazy(() =>
  import('./components/PreferencesView').then((module) => ({ default: module.PreferencesView })),
);
const ClipboardView = lazy(() =>
  import('./components/ClipboardView').then((module) => ({ default: module.ClipboardView })),
);

export function App() {
  const selectShelfViewState = useMemo(
    () => (state: AppState) => ({
      liveShelf: state.liveShelf,
      preferences: {
        shelfInteraction: state.preferences.shelfInteraction,
        shakeEnabled: state.preferences.shakeEnabled,
      },
      permissionStatus: state.permissionStatus,
      sync: {
        plan: state.sync.plan,
      },
    }),
    []
  );

  const { state, error, fullState } = useLedgeState(selectShelfViewState);
  const [showOnboarding, setShowOnboarding] = useState(
    () => fullState && !fullState.preferences.hasCompletedOnboarding,
  );
  const view = new URLSearchParams(window.location.search).get('view') ?? 'shelf';

  if (error) {
    return (
      <main className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Renderer Error</p>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!fullState) {
    return (
      <main className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Ledge</p>
          <p>Loading shelf state…</p>
        </div>
      </main>
    );
  }

  if (showOnboarding && view === 'shelf') {
    return (
      <>
        <OnboardingView state={fullState} onComplete={() => setShowOnboarding(false)} />
        <ToastHost />
      </>
    );
  }

  if (view === 'preferences') {
    return (
      <>
        <Suspense
          fallback={
            <main className="loading-shell">
              <div className="loading-card">
                <p className="eyebrow">Ledge</p>
                <p>Loading preferences…</p>
              </div>
            </main>
          }
        >
          <ErrorBoundary>
            <PreferencesView state={fullState} />
          </ErrorBoundary>
        </Suspense>
        <ToastHost />
      </>
    );
  }

  if (view === 'clipboard') {
    return (
      <>
        <Suspense
          fallback={
            <main className="loading-shell">
              <div className="loading-card">
                <p className="eyebrow">Ledge</p>
                <p>Loading clipboard…</p>
              </div>
            </main>
          }
        >
          <ErrorBoundary>
            <ClipboardView />
          </ErrorBoundary>
        </Suspense>
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <ErrorBoundary>
        <ShelfView state={state!} />
      </ErrorBoundary>
      <ToastHost />
    </>
  );
}
