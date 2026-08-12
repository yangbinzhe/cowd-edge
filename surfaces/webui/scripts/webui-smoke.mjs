#!/usr/bin/env node
// Browser-level smoke gate: every route must render, every referenced asset
// must be served, and no console/page errors may occur. This is the minimum
// front-end scenario test that must run before a release is deployed.
import { chromium } from '@playwright/test';

const baseUrl = process.env.COWD_E2E_WEB_URL?.replace(/\/$/, '') || 'http://127.0.0.1:8642';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/snap/bin/chromium';
const routes = [
  '/#/chat', '/#/mission', '/#/runtime', '/#/context', '/#/memory',
  '/#/reality', '/#/agents', '/#/tools', '/#/surfaces', '/#/gateway',
  '/#/audit', '/#/settings',
];

const browser = await chromium.launch({ executablePath, headless: true });
const gatewayToken = process.env.COWD_E2E_GATEWAY_TOKEN;
const page = await browser.newPage({
  extraHTTPHeaders: gatewayToken
    ? { Authorization: `Bearer ${gatewayToken}` }
    : undefined,
});
const errors = [];
const bad = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('response', (response) => {
  if (response.status() >= 400) bad.push(`${response.status()} ${response.url()}`);
});

const results = [];
for (const route of routes) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(2_500);
  const rendered = await page.evaluate(
    () => document.getElementById('app')?.innerHTML?.length || 0,
  );
  results.push({ route, rendered });
}

// Static release integrity: every reference from index.html must resolve to a
// non-empty asset, and the compiled bundle must still expose the P12 anchors.
// This guards the "pages cannot open because dist assets were removed" class.
const releaseIndex = await fetch(`${baseUrl}/index.html`).then(async (response) => ({
  status: response.status,
  body: await response.text(),
}));
if (releaseIndex.status !== 200 || !releaseIndex.body.length) {
  throw new Error(`webui smoke FAILED: /index.html is not served (${releaseIndex.status})`);
}
const assetRefs = [...releaseIndex.body.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((ref) => /\.(js|css|svg|png|woff2?)(\?|$)/.test(ref));
const distIntegrity = [];
for (const ref of assetRefs) {
  const url = new URL(ref, `${baseUrl}/index.html`).toString();
  const response = await fetch(url);
  const body = await response.text();
  distIntegrity.push({ ref, status: response.status, bytes: body.length });
  if (response.status !== 200 || !body.length) {
    throw new Error(`webui smoke FAILED: dist reference ${ref} returned ${response.status} with ${body.length} bytes`);
  }
}
const mainJs = distIntegrity
  .filter((item) => item.ref.endsWith('.js'))
  .sort((a, b) => b.bytes - a.bytes)[0];
if (!mainJs) throw new Error('webui smoke FAILED: no JavaScript bundle referenced by index.html');
const bundle = await fetch(new URL(mainJs.ref, `${baseUrl}/index.html`).toString()).then((response) => response.text());
const anchors = ['message-copy-link', 'answer-branch-link'];
const missingAnchors = anchors.filter((anchor) => !bundle.includes(anchor));
if (missingAnchors.length) {
  throw new Error(`webui smoke FAILED: compiled bundle missing P12 anchors: ${missingAnchors.join(', ')}`);
}

await browser.close();

const failedRoutes = results.filter((result) => result.rendered < 1000);
const report = {
  results,
  distIntegrity,
  bundleAnchors: anchors.filter((anchor) => bundle.includes(anchor)),
  errors: errors.slice(0, 8),
  httpErrors: bad.slice(0, 12),
};
console.log(JSON.stringify(report, null, 1));
if (failedRoutes.length || errors.length || bad.length) {
  console.error(`webui smoke FAILED: routes=${failedRoutes.length}, errors=${errors.length}, http>=400=${bad.length}`);
  process.exit(1);
}
console.log(`webui smoke PASS: ${results.length} routes rendered`);
