import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Workspace packages export their TS sources (./src/index.ts); Vite bundles them directly.
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['@wind-spirit/sim', '@wind-spirit/gen', '@wind-spirit/agents', '@wind-spirit/harness'] },
});
