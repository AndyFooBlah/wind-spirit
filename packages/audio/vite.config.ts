import { defineConfig } from 'vite';

/** Serves the audition demo: `pnpm --filter @wind-spirit/audio demo`. */
export default defineConfig({
  root: 'demo',
  server: { port: 5183, strictPort: true },
  build: { outDir: '../dist-demo', emptyOutDir: true },
});
