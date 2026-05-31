import { lazy, Suspense, useState } from 'react';
import { ShelfView } from './components/ShelfView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OnboardingView } from './components/OnboardingView';
import { useLedgeState } from './hooks/useLedgeState';

const PreferencesView = lazy(() =>
  import('./components/PreferencesView').then((module) => ({ default: module.PreferencesView })),
);

export function App() {
  const { state, error } = useLedgeState();
  const [showOnboarding, setShowOnboarding] = useState(
    () => state && !state.preferences.hasCompletedOnboarding,
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

  if (!state) {
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
    return <OnboardingView state={state} onComplete={() => setShowOnboarding(false)} />;
  }

  if (view === 'preferences') {
    return (
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
          <PreferencesView state={state} />
        </ErrorBoundary>
      </Suspense>
    );
  }

  return (
    <ErrorBoundary>
      <ShelfView state={state} />
    </ErrorBoundary>
  );
}
