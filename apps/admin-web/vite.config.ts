import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { mockApiPlugin } from './mock-api.js';

const surface = process.env.VITE_SURFACE === 'platform' ? 'platform' : 'tenant';

export default defineConfig({
  base: '/console/',
  plugins: [react(), mockApiPlugin()],
  build: {
    outDir: surface === 'platform' ? 'dist-platform' : 'dist-tenant',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    testTimeout: 20000,
  },
});
