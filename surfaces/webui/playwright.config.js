import { defineConfig } from '@playwright/test';

const gatewayUrl = process.env.COWD_E2E_GATEWAY_URL?.replace(/\/$/, '');
const gatewayToken = process.env.COWD_E2E_GATEWAY_TOKEN;
const gatewayObserverId = process.env.COWD_E2E_OBSERVER_ID || 'webui:playwright-release';
const gatewayRequestedCapabilities = [
  'approval.respond',
  'definition.manage',
  'definition.default.set',
  'definition.rollback',
  'evolution.release.manage',
  'runtime.maintenance.manage',
  'runtime.outbox.retry',
  'mfg.read',
  'mfg.incident.operate',
  'mfg.playbook.manage',
  'mfg.alert.respond',
  'mfg.alert.manage',
  'mfg.assignment.manage',
  'mfg.assignment.lifecycle',
  'mfg.execution.operate',
  'mfg.execution.feedback',
  'mfg.report.generate',
  'mfg.report.deliver',
  'mfg.report.review',
  'mfg.skill.run',
  'mfg.cockpit.manage',
  'mfg.data.manage',
].join(',');
const webUrl = process.env.COWD_E2E_WEB_URL?.replace(/\/$/, '') || 'http://127.0.0.1:9241';
const webPort = new URL(webUrl).port || '80';
const releaseEntry = process.env.COWD_E2E_RELEASE_ENTRY === '1';
if (releaseEntry && (!gatewayUrl || !process.env.COWD_E2E_GATEWAY_PROVENANCE)) {
  throw new Error('release browser entry requires an isolated Gateway URL and verified provenance');
}

export default defineConfig({
  testDir: '.',
  testMatch: ['webui-next.e2e.spec.js'],
  testIgnore: ['*.live.e2e.spec.js'],
  use: {
    // The release gate supplies an isolated Gateway URL. Local development
    // keeps the Vite server for fast iteration, but it is not release proof.
    // Release proof always loads this checkout's freshly built assets. API
    // calls are proxied to the isolated real Gateway by Vite preview.
    baseURL: releaseEntry ? webUrl : (gatewayUrl || webUrl),
    extraHTTPHeaders: gatewayUrl
      ? {
        ...(gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {}),
        'x-cowd-surface-id': 'webui',
        'x-cowd-observer-id': gatewayObserverId,
        'x-cowd-requested-capabilities': gatewayRequestedCapabilities,
      }
      : undefined,
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium',
    },
  },
  webServer: releaseEntry || !gatewayUrl ? {
    command: releaseEntry
      ? `npm run preview -- --port ${webPort}`
      : `npm run dev -- --port ${webPort}`,
    url: `${webUrl}/index.dev.html`,
    reuseExistingServer: !releaseEntry && !process.env.CI,
    timeout: 20_000,
  } : undefined,
});
