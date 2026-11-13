import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const MOCK_BRAIN = process.env.MOCK_BRAIN_URL ?? 'http://127.0.0.1:8787';

// Tauri expects a fixed dev port and serves the built `dist/` in release.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    // Browser dev mode only: the web platform calls same-origin /api → mock Brain.
    proxy: { '/api': { target: MOCK_BRAIN, changeOrigin: true } },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Inline nothing from the network; all assets are emitted locally.
    assetsInlineLimit: 0,
  },
});
