import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import './index.css';

// Link xác nhận phỏng vấn KIỂU CŨ (/public/interview/rsvp) từng bị cổng nhân viên
// (SPA) phục vụ nên hiện form đăng nhập SĐT. Chuyển thẳng sang API công khai của
// backend (/api/public/interview/rsvp) để ứng viên chỉ thấy bảng xác nhận.
(() => {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/public/interview/rsvp') {
    window.location.replace(`/api${window.location.pathname}${window.location.search}`);
  }
})();

// Chặn màn hình trắng "không một lời": nếu JS/DOM lỗi trước khi React mount
// (thiếu bundle, MIME sai, cache cũ), hiện thông báo thay vì để trang trắng trơn.
window.addEventListener('error', (event) => {
  try {
    const msg = String((event as ErrorEvent)?.message || '').slice(0, 300);
    if (!msg) return;
    const root = document.getElementById('root');
    if (root && root.childElementCount === 0) {
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:24px;text-align:center;background:#FFFBF9;color:#92400E;font:14px/1.6 system-ui,sans-serif;z-index:9999;';
      box.innerHTML =
        '<strong>Không tải được cổng nhân viên.</strong>' +
        '<span style="font-size:12px;color:#6B7280">Lỗi: ' +
        msg.replace(/[<>&]/g, '') +
        '</span>' +
        '<button type="button" onclick="location.reload()" style="padding:8px 16px;border-radius:8px;border:1px solid #F0E2DE;background:#fff;cursor:pointer">Tải lại (F5)</button>' +
        '<span style="font-size:11px;color:#6B7280">Nếu vẫn trắng, mở Console (F12) để xem chi tiết.</span>';
      root.appendChild(box);
    }
  } catch { /* bỏ qua */ }
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.insertAdjacentHTML('beforeend',
    '<div style="padding:24px;font:14px system-ui,sans-serif;color:#92400E">Không tìm thấy <code>#root</code> — kiểm tra lại bản build (index.html).</div>');
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
      <PwaInstallPrompt />
    </React.StrictMode>,
  );
}

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
