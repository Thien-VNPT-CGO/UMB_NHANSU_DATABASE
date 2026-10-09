import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Sourcemap vĩnh viễn: lỗi production map đúng file:dòng thật thay vì tên
  // biến minify (như vụ 'op'), chẩn đoán nhanh. Không ảnh hưởng tốc độ chạy.
  build: {
    sourcemap: true,
  },
  server: {
    port: 3005,
    proxy: {
      '/api': {
        target: 'http://localhost:4005',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
