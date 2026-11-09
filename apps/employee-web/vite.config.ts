import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Base tuyệt đối cho cổng nhân viên "/" (KHÔNG dùng './' để tránh lỗi
  // Service Worker scope khi deploy phía sau Nginx/Express subpath).
  base: '/',
  plugins: [react()],
  server: {
    port: 3006,
    proxy: {
      '/api': {
        target: 'http://localhost:4005',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
