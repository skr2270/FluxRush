import { defineConfig } from 'vite';

export default defineConfig({
  worker: {
    format: 'es',
  },
  server: {
    port: 3000,
    open: true
  },
  build: {
    target: 'esnext'
  }
});
