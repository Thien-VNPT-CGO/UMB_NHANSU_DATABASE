import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <PwaInstallPrompt />
  </React.StrictMode>
);

// Tự động hủy đăng ký service worker và xóa cache cũ khi đang chạy trên localhost
if ('serviceWorker' in navigator && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const reg of regs) reg.unregister();
  });
  if ('caches' in window) {
    caches.keys().then(keys => {
      for (const key of keys) caches.delete(key);
    });
  }
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(err => console.warn('[pwa] service worker registration failed:', err));
  });
}
