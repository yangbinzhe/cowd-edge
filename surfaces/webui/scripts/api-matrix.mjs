import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const catalog = read('src/services/appCatalogClient.ts');
const bridge = read('src/apps/iframeBridge.ts');
const failures = [];
const requireText = (source, token, label) => { if (!source.includes(token)) failures.push(label); };

requireText(catalog, "'/api/apps'", 'Catalog client must use the canonical /api/apps endpoint');
requireText(catalog, "credentials: 'same-origin'", 'Catalog requests must preserve same-origin credentials');
requireText(bridge, '/api/apps/${encodeURIComponent(appId)}', 'Bridge must confine requests to the selected application API prefix');
for (const kind of ['app_api_request', 'app_api_cancel', 'app_api_credit', 'host_api_headers', 'host_api_data', 'host_api_end']) {
  requireText(bridge, kind, `Bridge protocol is missing ${kind}`);
}
requireText(bridge, 'x-cowd-surface-id', 'Bridge requests must identify the Web surface');
requireText(bridge, 'APP_ACTIVATION_OVERLOADED', 'Bridge must expose bounded-concurrency overload');

console.log(JSON.stringify({ gate: 'generic-app-api-matrix', failures }, null, 2));
if (process.argv.includes('--gate') && failures.length) process.exit(1);
