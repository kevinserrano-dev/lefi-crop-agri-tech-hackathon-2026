import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed dev port (1430: Lefi Desktop uses 1420) and serves `dist/` in release.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1430, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Inline nothing from the network; all assets are emitted locally.
    assetsInlineLimit: 0,
  },
});
