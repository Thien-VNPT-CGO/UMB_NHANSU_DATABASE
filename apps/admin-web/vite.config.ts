import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build DEMO (VITE_UBM_PORTAL=demo) xuất sang dist-demo để Nat riêng khỏi bản
// chính thức — cùng 1 file nguồn, dùng để test giao sự kiện trước khi promocó.
const isDemoBuild = process.env.VITE_UBM_PORTAL === 'demo';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Sourcemap vĩnh viễn: lỗi production map đúng file:dòng thật thay vì tên
  // biến minify (như vụ 'op'), chẩn đoán nhanh. Không ảnh hưởng tốc độ chạy.
  build: {
    sourcemap: true,
    outDir: isDemoBuild ? 'dist-demo' : 'dist',
    emptyOutDir: true,
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
