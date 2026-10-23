import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the project site from /terpene-lab-synth/; preview mirrors it.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/terpene-lab-synth/' : '/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/tone') ? 'tone' : undefined),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
  },
}));
