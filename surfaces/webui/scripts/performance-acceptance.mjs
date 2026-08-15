#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'src/apps/fixtures/catalog-single.json'), 'utf8'));
const baseUrl = (process.env.COWD_WEBUI_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const limitMs = Number(process.env.COWD_APP_ROUTE_LIMIT_MS || 5_000);
const systemBrowser = [process.env.COWD_CHROMIUM_PATH, '/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(systemBrowser ? { executablePath: systemBrowser } : {}) });
const page = await browser.newPage();
let elapsedMs = Number.POSITIVE_INFINITY;
let failure = '';

try {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/apps', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) }));
  await page.route('**/api/auth/verify', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, auth_required: true }) }));
  await page.route('**/api/approval/pending**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approvals: [] }) }));
  await page.route('**/apps/reference-app/index.html', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><main>reference ready</main>',
  }));
  const started = performance.now();
  await page.goto(`${baseUrl}/#/apps/reference-app`, { waitUntil: 'domcontentloaded' });
  await page.locator('iframe.app-page__surface').waitFor({ state: 'visible', timeout: limitMs });
  elapsedMs = performance.now() - started;
  if (elapsedMs > limitMs) failure = `Application route became visible in ${elapsedMs.toFixed(1)}ms; limit is ${limitMs}ms`;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
}

console.log(JSON.stringify({ gate: 'generic-application-route-performance', elapsed_ms: elapsedMs, limit_ms: limitMs, failure }, null, 2));
if (failure) process.exit(1);
