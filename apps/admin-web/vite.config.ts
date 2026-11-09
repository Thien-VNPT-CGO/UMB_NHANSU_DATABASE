import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Base tuyệt đối cho đường mount Nginx /admin/ (KHÔNG dùng './').
  // './' gây màn hình trắng khi vào /admin không có dấu gạch chéo
  // và làm Service Worker đăng ký sai scope (vô tình chiếm cả cổng
  // nhân viên). Base tuyệt đối đảm bảo asset + sw.js luôn đúng đường dẫn.
  base: '/admin/',
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
