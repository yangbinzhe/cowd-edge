import { defineConfig } from '@playwright/test';

const gatewayUrl = process.env.COWD_E2E_GATEWAY_URL?.replace(/\/$/, '');

export default defineConfig({
  testDir: '.',
  testMatch: ['webui-next.e2e.spec.js'],
  testIgnore: ['*.live.e2e.spec.js'],
  use: {
    // The release gate supplies an isolated Gateway URL. Local development
    // keeps the Vite server for fast iteration, but it is not release proof.
    baseURL: gatewayUrl || 'http://127.0.0.1:9241',
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium',
    },
  },
  webServer: gatewayUrl ? undefined : {
    command: 'npm run dev -- --port 9241',
    url: 'http://127.0.0.1:9241/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
