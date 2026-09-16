import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotchDropoutView } from './components/NotchDropoutView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastHost } from './components/ToastHost';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Notch dropout root was not found');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <NotchDropoutView />
    </ErrorBoundary>
    <ToastHost />
  </StrictMode>,
);
