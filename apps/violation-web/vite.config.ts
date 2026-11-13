import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Cổng vi phạm được mount tại /violations/ trên cùng domain với backend.
  base: '/violations/',
  plugins: [react()],
  server: {
    port: 3007,
    proxy: {
      '/api': {
        target: 'http://localhost:4005',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
