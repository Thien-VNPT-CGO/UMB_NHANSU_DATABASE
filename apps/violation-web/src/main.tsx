import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/toast';
import './index.css';

const rootEl = document.getElementById('root');

if (!rootEl) {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div style="padding:24px;font:14px system-ui,sans-serif;color:#e3b866">Không tìm thấy <code>#root</code> — kiểm tra lại bản build.</div>',
  );
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>,
  );
}
