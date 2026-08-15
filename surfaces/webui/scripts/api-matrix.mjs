import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const catalog = read('src/services/appCatalogClient.ts');
const bridge = read('src/apps/iframeBridge.ts');
const generated = read('src/generated/gateway-api.ts');
const protocolMeta = read('src/generated/app-protocol-meta.ts');
const main = read('src/main.ts');
const failures = [];
const requireText = (source, token, label) => { if (!source.includes(token)) failures.push(label); };

requireText(catalog, "'/api/apps'", 'Catalog client must use the canonical /api/apps endpoint');
requireText(catalog, "credentials: 'same-origin'", 'Catalog requests must preserve same-origin credentials');
requireText(bridge, '/api/apps/${encodeURIComponent(appId)}${path}', 'Bridge must bind relative requests to the selected application API prefix');
for (const kind of ['app_api_request', 'app_api_cancel', 'app_api_credit', 'host_api_headers', 'host_api_data', 'host_api_end']) {
  requireText(bridge, kind, `Bridge protocol is missing ${kind}`);
}
requireText(bridge, 'x-cowd-surface-id', 'Bridge requests must identify the Web surface');
requireText(bridge, 'APP_ACTIVATION_OVERLOADED', 'Bridge must expose bounded-concurrency overload');
for (const path of [
  '/api/apps',
  '/api/apps/{app_id}',
  '/api/apps/{app_id}/operations/{operation_id}/invoke',
  '/api/apps/{app_id}/operations/{operation_id}/stream',
  '/api/apps/{app_id}/receipts/{receipt_id}',
  '/api/apps/{app_id}/subscriptions/{subscription_id}',
  '/api/apps/{app_id}/subscriptions/{subscription_id}/ack',
  '/api/apps/{app_id}/tui/views/{view_id}/actions',
  '/api/apps/{app_id}/tui/views/{view_id}/open',
  '/api/apps/{app_id}/tui/views/{view_id}/stream',
]) requireText(generated, `    "${path}": {`, `Generated Gateway API is missing ${path}`);
if ((generated.match(/^    "\/api\/apps\/mfg/gim) || []).length) {
  failures.push('Generated Gateway API must contain zero legacy MFG APP paths');
}
for (const token of ['host_app_detail', 'detailPromise', 'authorizationValid', 'waitForCredit']) {
  requireText(bridge, token, `Bridge is missing ${token}`);
}
requireText(protocolMeta, 'APP_PROTOCOL_DIGEST', 'Generated APP protocol digest is missing');
requireText(main, "from './generated/app-protocol-meta'", 'WebUI bootstrap must consume the generated APP protocol digest');

console.log(JSON.stringify({ gate: 'generic-app-api-matrix', failures }, null, 2));
if (process.argv.includes('--gate') && failures.length) process.exit(1);
