import { defineConfig } from '@playwright/test';
import { gatewayRequestedCapabilities } from './e2e-release-contract.js';

const gatewayUrl = process.env.COWD_E2E_GATEWAY_URL?.replace(/\/$/, '');
const gatewayToken = process.env.COWD_E2E_GATEWAY_TOKEN;
const gatewayObserverId = process.env.COWD_E2E_OBSERVER_ID || 'webui:playwright-release';
const webUrl = process.env.COWD_E2E_WEB_URL?.replace(/\/$/, '') || 'http://127.0.0.1:9241';
const webPort = new URL(webUrl).port || '80';
const releaseEntry = process.env.COWD_E2E_RELEASE_ENTRY === '1';
const appLive = process.env.COWD_E2E_APP_LIVE === '1';
if (appLive && !gatewayUrl) throw new Error('APP live browser gate requires COWD_E2E_GATEWAY_URL');
if (releaseEntry && (!gatewayUrl || !process.env.COWD_E2E_GATEWAY_PROVENANCE)) {
  throw new Error('release browser entry requires an isolated Gateway URL and verified provenance');
}

export default defineConfig({
  testDir: '.',
  testMatch: [appLive ? 'reference-app.live.e2e.spec.js' : 'webui-next.e2e.spec.js'],
  testIgnore: appLive ? [] : ['*.live.e2e.spec.js'],
  use: {
    // The release gate supplies an isolated Gateway URL. Local development
    // keeps the Vite server for fast iteration, but it is not release proof.
    // Release proof always loads this checkout's freshly built assets. API
    // calls are proxied to the isolated real Gateway by Vite preview.
    baseURL: releaseEntry || appLive ? webUrl : (gatewayUrl || webUrl),
    extraHTTPHeaders: gatewayUrl
      ? {
        ...(gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {}),
        'x-cowd-surface-id': 'webui',
        // Do not install a context-wide observer header. Live transport binds
        // each subscription to `observer:tab:nonce` and must be able to send
        // that exact identity without Playwright overwriting it.
        'x-cowd-requested-capabilities': gatewayRequestedCapabilities,
      }
      : undefined,
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium',
    },
  },
  webServer: releaseEntry || appLive || !gatewayUrl ? {
    command: releaseEntry || appLive
      ? `npm run preview -- --port ${webPort}`
      : `npm run dev -- --port ${webPort}`,
    url: `${webUrl}/index.dev.html`,
    reuseExistingServer: !releaseEntry && !appLive && !process.env.CI,
    timeout: 20_000,
  } : undefined,
});
