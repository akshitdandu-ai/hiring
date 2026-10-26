import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/syne/600.css';
import '@fontsource/syne/800.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
