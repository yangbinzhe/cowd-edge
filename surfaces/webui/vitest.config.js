import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const webuiRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@cowd/webui-host', replacement: resolve(webuiRoot, 'src/apps/host.ts') },
      { find: /^@cowd\/app-mfg-webui$/, replacement: resolve(webuiRoot, '.cowd/apps/mfg/webui/src/index.ts') },
      { find: /^@cowd\/app-mfg-webui\/(.+)$/, replacement: resolve(webuiRoot, '.cowd/apps/mfg/webui/src/$1') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    clearMocks: true,
    setupFiles: ['./src/testSetup.ts'],
    include: ['src/**/*.test.ts', '.cowd/apps/*/webui/src/**/*.test.ts'],
    exclude: ['**/*.e2e.spec.js', '**/node_modules/**'],
  },
});
