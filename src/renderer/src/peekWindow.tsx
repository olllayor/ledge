import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PeekWindowView } from './components/PeekWindowView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastHost } from './components/ToastHost';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Peek window root was not found');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <PeekWindowView />
    </ErrorBoundary>
    <ToastHost />
  </StrictMode>,
);
