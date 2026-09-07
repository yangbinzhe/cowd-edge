import { defineConfig } from '@playwright/test';
import { gatewayRequestedCapabilities } from './e2e-release-contract.js';

const gateway = process.env.COWD_E2E_GATEWAY_URL?.replace(/\/$/, '');
const token = process.env.COWD_E2E_GATEWAY_TOKEN;
if (!gateway) throw new Error('COWD_E2E_GATEWAY_URL is required');

export default defineConfig({
  testDir: '.',
  testMatch: ['agentic-terminal.live.e2e.spec.js'],
  workers: 1,
  retries: 0,
  timeout: Number(process.env.COWD_AGENTIC_E2E_TIMEOUT_MS || 600_000),
  use: {
    baseURL: gateway,
    extraHTTPHeaders: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'x-cowd-surface-id': 'webui',
      'x-cowd-requested-capabilities': gatewayRequestedCapabilities,
    },
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium',
    },
  },
});
