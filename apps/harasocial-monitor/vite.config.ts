import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Khi deploy dưới đường dẫn con (ví dụ /harasocial/) thì đặt VITE_BASE_PATH.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
