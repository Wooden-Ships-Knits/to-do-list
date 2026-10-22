import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8010';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: proxyTarget, changeOrigin: true } },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        // React and the data libraries change rarely: their own chunk caches across releases and
        // downloads in parallel with the app code.
        manualChunks(id: string) {
          if (
            /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run|@tanstack)\//.test(
              id,
            )
          ) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
