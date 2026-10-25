import { createRoot } from 'react-dom/client';
import App from './app/page';
import { AppearanceProvider } from './components/appearance-settings';
import { APPEARANCE_KEY, parseAppearance } from './lib/appearance';
import './app/globals.css';

// Apply saved appearance before React paints, without evaluating inline scripts.
try {
  const saved = parseAppearance(localStorage.getItem(APPEARANCE_KEY));
  document.documentElement.classList.toggle('dark', saved.theme === 'dark');
  document.documentElement.style.setProperty('--code-font-size', `${saved.fontSize}px`);
} catch {
  // Browsers that block storage can still use the default appearance.
}

createRoot(document.getElementById('root')!).render(
  <AppearanceProvider>
    <App />
  </AppearanceProvider>,
);
