import { lazy, Suspense } from 'react';
import { ShelfView } from './components/ShelfView';
import { useLedgeState } from './hooks/useLedgeState';

const PreferencesView = lazy(() =>
  import('./components/PreferencesView').then((module) => ({ default: module.PreferencesView })),
);

export function App() {
  const { state, error } = useLedgeState();
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
        <PreferencesView state={state} />
      </Suspense>
    );
  }

  return <ShelfView state={state} />;
}
