import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QuickPastePalette } from './components/QuickPastePalette';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastHost } from './components/ToastHost';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Quick paste root was not found');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <QuickPastePalette />
    </ErrorBoundary>
    <ToastHost />
  </StrictMode>,
);
