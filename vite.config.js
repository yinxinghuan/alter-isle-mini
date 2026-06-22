import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { assetsDir: '_app' },
  preview: { host: '0.0.0.0', allowedHosts: true },
  server: { host: '0.0.0.0', allowedHosts: true },
});
