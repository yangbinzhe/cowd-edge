#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'src/apps/fixtures/catalog-single.json'), 'utf8'));
const baseUrl = (process.env.COWD_WEBUI_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const systemBrowser = [process.env.COWD_CHROMIUM_PATH, '/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(systemBrowser ? { executablePath: systemBrowser } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

try {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/apps', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) }));
  await page.route('**/api/auth/verify', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, auth_required: true }) }));
  await page.route('**/api/approval/pending**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approvals: [] }) }));
  await page.route('**/apps/reference-app/index.html', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Reference Application</title><main id="reference-ready">ready</main>',
  }));
  await page.goto(`${baseUrl}/#/chat`, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15_000 });
  check(await page.locator('.rail-button[aria-label="Reference Application"]').count() === 1,
    'Catalog application is not projected exactly once into navigation');

  await page.goto(`${baseUrl}/#/apps/reference-app/reports/daily`, { waitUntil: 'domcontentloaded' });
  const frame = page.locator('iframe.app-page__surface');
  await frame.waitFor({ state: 'visible', timeout: 10_000 });
  check((await frame.getAttribute('sandbox')) === 'allow-scripts allow-forms allow-downloads',
    'Application iframe sandbox differs from the frozen host policy');
  check((await frame.getAttribute('src'))?.includes('#/reports/daily'), 'Deep link was not forwarded to the application surface');
  check(await page.locator('text=reference.read').count() > 0, 'Effective Catalog capabilities are not visible');

  await page.goBack();
  await page.goForward();
  check(page.url().includes('#/apps/reference-app/reports/daily'), 'Browser history did not restore the application deep link');
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

console.log(JSON.stringify({ gate: 'generic-application-release-browser', base_url: baseUrl, failures }, null, 2));
if (failures.length) process.exit(1);
