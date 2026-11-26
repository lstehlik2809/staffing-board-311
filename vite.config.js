import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build works on GitHub Pages under any repository name.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
});
