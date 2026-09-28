import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

import { vttGlobalShim } from './tools/vttGlobalShim.ts';
import { shellOverlayShim } from './tools/shellOverlayShim.ts';

export default defineConfig({
  plugins: [react(), vttGlobalShim(), shellOverlayShim()],
  // Tauri serves the bundled frontend from its custom asset origin. Relative
  // URLs keep the production entrypoint portable across that origin and the
  // regular Vite preview server.
  base: './',
  build: {
    license: { fileName: 'third-party-licenses.md' },
    target: 'es2022',
  },
  clearScreen: false,
  test: {
    // Vitest stubs CSS imports by default, which also swallows `?raw` queries
    // and made the presentation source-guard assert against an empty string.
    css: true,
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
});
