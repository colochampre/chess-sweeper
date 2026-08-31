import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cm/engine': r('../engine/src/index.ts'),
      '@cm/ai': r('../ai/src/index.ts'),
    },
  },
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
});
