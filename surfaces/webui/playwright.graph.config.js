import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'graph-workbench.e2e.spec.js', workers: 1, timeout: 60000,
  outputDir: '/tmp/cowd-v2-u-browser-artifacts',
  reporter: [['list'], ['json', { outputFile: '/tmp/cowd-v2-u-browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:9253', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium' } },
  webServer: { command: 'npm run dev -- --port 9253', url: 'http://127.0.0.1:9253/e2e/graph-workbench.html', reuseExistingServer: false, timeout: 20000 },
});
