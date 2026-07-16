import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/testSetup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.e2e.spec.js', '**/node_modules/**'],
  },
});
