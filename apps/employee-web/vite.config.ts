import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build DEMO (VITE_UBM_PORTAL=demo) xuất sang dist-demo để tách riêng khỏi bản
// chính thức — cùng 1 file nguồn, dùng để test giao diện sự kiện trước khi áp dụng.
const isDemoBuild = process.env.VITE_UBM_PORTAL === 'demo';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: isDemoBuild ? 'dist-demo' : 'dist',
    emptyOutDir: true,
  },
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
