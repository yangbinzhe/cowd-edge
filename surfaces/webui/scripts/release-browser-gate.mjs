#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(resolve(root, 'src/apps/fixtures/catalog-single.json'), 'utf8'));
const distRoot = resolve(root, 'dist');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);
let releaseServer;
let baseUrl = process.env.COWD_WEBUI_URL?.replace(/\/$/, '');
if (!baseUrl) {
  const indexPath = resolve(distRoot, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`Release WebUI is not built: ${indexPath}`);
  releaseServer = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const candidate = resolve(distRoot, `.${pathname}`);
      const withinDist = candidate === distRoot || candidate.startsWith(`${distRoot}${sep}`);
      const filePath = withinDist && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : indexPath;
      response.writeHead(200, {
        'Content-Type': contentTypes.get(extname(filePath)) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(readFileSync(filePath));
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    releaseServer.once('error', rejectListen);
    releaseServer.listen(0, '127.0.0.1', resolveListen);
  });
  const address = releaseServer.address();
  if (!address || typeof address === 'string') throw new Error('Release WebUI server did not expose a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
}
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
  if (releaseServer) await new Promise((resolveClose, rejectClose) => {
    releaseServer.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

console.log(JSON.stringify({ gate: 'generic-application-release-browser', base_url: baseUrl, failures }, null, 2));
if (failures.length) process.exit(1);
