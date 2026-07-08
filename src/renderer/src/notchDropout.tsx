import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotchDropoutView } from './components/NotchDropoutView';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Notch dropout root was not found');
}

createRoot(container).render(
  <StrictMode>
    <NotchDropoutView />
  </StrictMode>,
);
