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
  '/api/apps/mfg/cockpit/profiles/{id}/reports/generate': ['post'],
  '/api/apps/mfg/cockpit/reports': ['get'],
  '/api/apps/mfg/cockpit/reports/{id}': ['get'],
  '/api/apps/mfg/cockpit/reports/{id}/deliver': ['post'],
  '/api/apps/mfg/cockpit/reports/{id}/delivery-state': ['get'],
  '/api/apps/mfg/cockpit/reports/{id}/delivery/retry': ['post'],
  '/api/apps/mfg/cockpit/reports/schedules/run': ['post'],
  '/api/apps/mfg/focus/alert-rules': ['get', 'post'],
  '/api/apps/mfg/focus/alerts': ['get'],
  '/api/apps/mfg/focus/alert-subscriptions': ['get', 'post'],
  '/api/apps/mfg/focus/alerts/{id}/command': ['post'],
  '/api/apps/mfg/focus/forecasts': ['get'],
  '/api/apps/mfg/assignments': ['get', 'post'],
  '/api/apps/mfg/assignments/{id}': ['get'],
  '/api/apps/mfg/assignments/{id}/command': ['post'],
  '/api/apps/mfg/reality/source-packs/upsert': ['post'],
  '/api/apps/mfg/reality/source-packs/{id}': ['get'],
  '/api/apps/mfg/reality/source-packs/{id}/validate': ['post'],
  '/api/apps/mfg/reality/source-packs/{id}/delta-plan': ['post'],
  '/api/apps/mfg/reality/source-packs/{id}/connector-runs/plan': ['post'],
  '/api/apps/mfg/reality/source-packs/{id}/connector-runs/run': ['post'],
  '/api/apps/mfg/reality/connector-runs/{id}': ['get'],
  '/api/apps/mfg/reality/compute/jobs/plan': ['post'],
  '/api/apps/mfg/reality/compute/jobs/{id}': ['get'],
  '/api/apps/mfg/reality/compute/jobs/{id}/run': ['post'],
  '/api/apps/mfg/reality/evidence/build': ['post'],
  '/api/apps/mfg/reality/evidence/{id}': ['get'],
  '/api/apps/mfg/reality/evidence/{id}/quality-gate': ['post'],
  '/api/apps/mfg/reality/evidence/{id}/context': ['get'],
  '/api/apps/mfg/incidents': ['get', 'post'],
  '/api/apps/mfg/incidents/{id}/room': ['get'],
  '/api/apps/mfg/incidents/{id}/analyze': ['post'],
  '/api/apps/mfg/analyses/{analysis_id}/actions/{action_id}/execute': ['post'],
  '/api/apps/mfg/executions/{id}': ['get'],
  '/api/apps/mfg/executions/{id}/cross-plane/execute': ['post'],
  '/api/apps/mfg/executions/{id}/feedback': ['post'],
  '/api/apps/mfg/decision-trace': ['get'],
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
