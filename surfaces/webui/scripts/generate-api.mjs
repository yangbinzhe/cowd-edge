import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const gatewayUrl = (process.env.COWD_GATEWAY_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const specUrl = `${gatewayUrl}/api/gateway/openapi.json`;
const output = resolve('src/generated/gateway-api.ts');
const requiredMfgOperations = {
  '/api/apps/mfg/cockpit/profiles': ['get'],
  '/api/apps/mfg/cockpit/profiles/upsert': ['post'],
  '/api/apps/mfg/cockpit/profiles/{id}': ['get', 'delete'],
  '/api/apps/mfg/cockpit/profiles/{id}/clone': ['post'],
  '/api/apps/mfg/cockpit/profiles/{id}/share': ['post'],
  '/api/apps/mfg/cockpit/widget-catalog': ['get'],
  '/api/apps/mfg/cockpit/profiles/{id}/projection': ['get'],
  '/api/apps/mfg/cockpit/profiles/{id}/widgets/{instance_id}/projection': ['get'],
  '/api/apps/mfg/focus/alert-rules': ['get', 'post'],
  '/api/apps/mfg/focus/alerts': ['get'],
  '/api/apps/mfg/focus/alert-subscriptions': ['get', 'post'],
  '/api/apps/mfg/focus/alerts/{id}/command': ['post'],
  '/api/apps/mfg/focus/forecasts': ['get'],
  '/api/apps/mfg/assignments': ['get', 'post'],
  '/api/apps/mfg/assignments/{id}': ['get'],
  '/api/apps/mfg/assignments/{id}/command': ['post'],
  '/api/apps/mfg/live': ['get'],
};

function assertMfgCapabilitySchema(document) {
  const missing = Object.entries(requiredMfgOperations).flatMap(([route, methods]) => methods
    .filter((method) => !document.paths?.[route]?.[method])
    .map((method) => `${method.toUpperCase()} ${route}`));
  if (missing.length) {
    throw new Error(`Gateway OpenAPI is missing revisioned MFG operations: ${missing.join(', ')}`);
  }
}

const response = await fetch(specUrl, {
  headers: process.env.COWD_API_TOKEN
    ? { Authorization: `Bearer ${process.env.COWD_API_TOKEN}` }
    : undefined,
});
if (!response.ok) {
  throw new Error(`Gateway OpenAPI fetch failed (${response.status}) from ${specUrl}`);
}
const document = await response.json();
if (document?.openapi !== '3.1.0' || typeof document?.paths !== 'object') {
  throw new Error(`Gateway returned an invalid OpenAPI 3.1 document from ${specUrl}`);
}
assertMfgCapabilitySchema(document);

await mkdir(dirname(output), { recursive: true });
const temporarySpec = resolve('.gateway-openapi.generated.json');
await writeFile(temporarySpec, `${JSON.stringify(document, null, 2)}\n`);
try {
  execFileSync('npx', ['openapi-typescript', temporarySpec, '-o', output], {
    stdio: 'inherit',
  });
} finally {
  await rm(temporarySpec, { force: true });
}
