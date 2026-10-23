import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { UiUpdateWatcher } from './components/UiUpdateWatcher';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <PwaInstallPrompt />
    <UiUpdateWatcher />
  </React.StrictMode>
);

// PWA: chỉ đăng ký ở bản build production để không ảnh hưởng HMR khi dev.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(err => console.warn('[pwa] service worker registration failed:', err));
  });
}
