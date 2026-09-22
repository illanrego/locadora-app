import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { vttGlobalShim } from './tools/vttGlobalShim.ts';

export default defineConfig({
  plugins: [react(), vttGlobalShim()],
  // Tauri serves the bundled frontend from its custom asset origin. Relative
  // URLs keep the production entrypoint portable across that origin and the
  // regular Vite preview server.
  base: './',
  build: {
    license: { fileName: 'third-party-licenses.md' },
    target: 'es2022',
  },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
});
