import { execFileSync } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const gatewayUrl = (process.env.COWD_GATEWAY_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const specUrl = `${gatewayUrl}/api/gateway/openapi.json`;
const output = process.env.COWD_GENERATED_API_OUTPUT
  ? resolve(process.env.COWD_GENERATED_API_OUTPUT)
  : resolve('src/generated/gateway-api.ts');
const liveContractOutput = process.env.COWD_GENERATED_LIVE_CONTRACT_OUTPUT
  ? resolve(process.env.COWD_GENERATED_LIVE_CONTRACT_OUTPUT)
  : resolve(dirname(output), 'live-contract-meta.ts');
const projectionGoldenOutput = process.env.COWD_GENERATED_PROJECTION_GOLDEN_OUTPUT
  ? resolve(process.env.COWD_GENERATED_PROJECTION_GOLDEN_OUTPUT)
  : resolve(dirname(output), 'projection-v2-golden.ts');
const projectionContractOutput = process.env.COWD_GENERATED_PROJECTION_CONTRACT_OUTPUT
  ? resolve(process.env.COWD_GENERATED_PROJECTION_CONTRACT_OUTPUT)
  : resolve(dirname(output), 'projection-contract-meta.ts');
const appProtocolOutput = process.env.COWD_GENERATED_APP_PROTOCOL_OUTPUT
  ? resolve(process.env.COWD_GENERATED_APP_PROTOCOL_OUTPUT)
  : resolve(dirname(output), 'app-protocol-meta.ts');
const requestHeaders = process.env.COWD_API_TOKEN
  ? {
    Authorization: `Bearer ${process.env.COWD_API_TOKEN}`,
    'x-cowd-surface-id': 'webui',
  }
  : undefined;
const response = await fetch(specUrl, { headers: requestHeaders });
if (!response.ok) {
  throw new Error(`Gateway OpenAPI fetch failed (${response.status}) from ${specUrl}`);
}
const document = await response.json();
if (document?.openapi !== '3.1.0' || typeof document?.paths !== 'object') {
  throw new Error(`Gateway returned an invalid OpenAPI 3.1 document from ${specUrl}`);
}
if (document.paths['/api/skills/install']) {
  throw new Error('Gateway OpenAPI still exposes the unreviewed one-step Skill install route');
}
const requiredAppRoutes = new Map([
  ['/api/apps', ['get']],
  ['/api/apps/{app_id}', ['get']],
  ['/api/apps/{app_id}/logs', ['get']],
  ['/api/apps/{app_id}/restart', ['post']],
  ['/api/apps/{app_id}/operations/{operation_id}/invoke', ['post']],
  ['/api/apps/{app_id}/operations/{operation_id}/stream', ['post']],
  ['/api/apps/{app_id}/receipts/{receipt_id}', ['get']],
  ['/api/apps/{app_id}/subscriptions/{subscription_id}', ['delete']],
  ['/api/apps/{app_id}/subscriptions/{subscription_id}/ack', ['post']],
  ['/api/apps/{app_id}/tui/views/{view_id}/actions', ['post']],
  ['/api/apps/{app_id}/tui/views/{view_id}/open', ['post']],
  ['/api/apps/{app_id}/tui/views/{view_id}/stream', ['post']],
]);
const actualAppRoutes = Object.entries(document.paths)
  .filter(([path]) => path === '/api/apps' || path.startsWith('/api/apps/'));
const unexpectedAppRoutes = actualAppRoutes.filter(([path, item]) => {
  const methods = Object.keys(item || {}).filter((key) => ['get', 'post', 'put', 'patch', 'delete', 'head'].includes(key)).sort();
  return !requiredAppRoutes.has(path)
    || JSON.stringify(methods) !== JSON.stringify(requiredAppRoutes.get(path));
});
const missingAppRoutes = [...requiredAppRoutes].filter(([path, methods]) => {
  const item = document.paths[path];
  return !item || methods.some((method) => !item[method]);
});
if (missingAppRoutes.length || unexpectedAppRoutes.length) {
  throw new Error(`Gateway APP route contract mismatch: missing=${JSON.stringify(missingAppRoutes.map(([path]) => path))} unexpected=${JSON.stringify(unexpectedAppRoutes.map(([path]) => path))}`);
}
const serializedDocument = JSON.stringify(document);
if (/\/api\/apps\/mfg(?:\/|\")/i.test(serializedDocument)) {
  throw new Error('Gateway OpenAPI still contains a legacy MFG APP path');
}
const catalogResponse = await fetch(`${gatewayUrl}/api/apps`, { headers: requestHeaders });
if (!catalogResponse.ok) throw new Error(`Gateway APP Catalog fetch failed (${catalogResponse.status})`);
const catalog = await catalogResponse.json();
if (catalog?.schema_version !== 1 || catalog?.protocol_revision !== 1
  || typeof catalog?.protocol_digest !== 'string'
  || !/^sha256:[a-f0-9]{64}$/.test(catalog.protocol_digest)) {
  throw new Error('Gateway APP Catalog is missing the canonical protocol digest');
}
const liveEnvelopeSchema = document?.components?.schemas?.LiveEnvelope;
const liveContractHash = liveEnvelopeSchema?.['x-cowd-schema-hash'];
const liveContractFixture = liveEnvelopeSchema?.example;
const projectionGolden = document?.['x-cowd-projection-v2-golden'];
if (
  typeof liveContractHash !== 'string'
  || !/^[a-f0-9]{64}$/.test(liveContractHash)
  || liveContractFixture?.schema_version !== 1
  || liveContractFixture?.subscription_revision < 1
) {
  throw new Error('Gateway OpenAPI is missing the canonical LiveEnvelope schema hash or fixture');
}
if (
  projectionGolden?.initial?.schema_version !== 2
  || projectionGolden?.delta?.schema_version !== 2
  || projectionGolden?.delta?.reducer_version !== 2
  || projectionGolden?.expected?.schema_version !== 2
) {
  throw new Error('Gateway OpenAPI is missing the canonical projection v2 golden corpus');
}

await mkdir(dirname(output), { recursive: true });
await mkdir(dirname(liveContractOutput), { recursive: true });
await mkdir(dirname(projectionGoldenOutput), { recursive: true });
await mkdir(dirname(projectionContractOutput), { recursive: true });
await mkdir(dirname(appProtocolOutput), { recursive: true });
const temporaryOutput = resolve(dirname(output), '.gateway-api.generated.ts');
const temporaryLiveContract = resolve(dirname(liveContractOutput), '.live-contract-meta.generated.ts');
const temporaryProjectionGolden = resolve(
  dirname(projectionGoldenOutput),
  '.projection-v2-golden.generated.ts',
);
const temporaryProjectionContract = resolve(
  dirname(projectionContractOutput),
  '.projection-contract-meta.generated.ts',
);
const temporaryAppProtocol = resolve(dirname(appProtocolOutput), '.app-protocol-meta.generated.ts');
const temporarySpec = resolve('.gateway-openapi.generated.json');
await writeFile(temporarySpec, `${JSON.stringify(document, null, 2)}\n`);
await writeFile(
  temporaryLiveContract,
  [
    '// Generated from Gateway OpenAPI. Do not edit manually.',
    `export const LIVE_CONTRACT_SCHEMA_VERSION = ${JSON.stringify(liveContractFixture.schema_version)} as const;`,
    `export const LIVE_ENVELOPE_SCHEMA_HASH = ${JSON.stringify(liveContractHash)} as const;`,
    `export const LIVE_ENVELOPE_CANONICAL_FIXTURE = ${JSON.stringify(liveContractFixture, null, 2)} as const;`,
    '',
  ].join('\n'),
);
await writeFile(
  temporaryAppProtocol,
  [
    '// Generated from the live Gateway APP Catalog. Do not edit manually.',
    `export const APP_PROTOCOL_REVISION = ${catalog.protocol_revision} as const;`,
    `export const APP_PROTOCOL_DIGEST = ${JSON.stringify(catalog.protocol_digest)} as const;`,
    '',
  ].join('\n'),
);
await writeFile(
  temporaryProjectionGolden,
  [
    '// Generated from Gateway OpenAPI. Do not edit manually.',
    `export const PROJECTION_V2_GOLDEN = ${JSON.stringify(projectionGolden, null, 2)} as const;`,
    '',
  ].join('\n'),
);
await writeFile(
  temporaryProjectionContract,
  [
    '// Generated from Gateway OpenAPI. Do not edit manually.',
    `export const EXECUTION_PROJECTION_SCHEMA_VERSION = ${projectionGolden.delta.schema_version} as const;`,
    `export const EXECUTION_PROJECTION_REDUCER_VERSION = ${projectionGolden.delta.reducer_version} as const;`,
    '',
  ].join('\n'),
);
try {
  execFileSync('npx', ['openapi-typescript', temporarySpec, '-o', temporaryOutput], {
    stdio: 'inherit',
  });
  const generated = await (await import('node:fs/promises')).readFile(temporaryOutput, 'utf8');
  if ((generated.match(/^    "\/api\/apps\/mfg/gm) || []).length !== 0) {
    throw new Error('Generated Gateway API still contains a legacy MFG APP path');
  }
  for (const path of requiredAppRoutes.keys()) {
    if (!generated.includes(`    "${path}": {`)) {
      throw new Error(`Generated Gateway API is missing ${path}`);
    }
  }
  await rename(temporaryOutput, output);
  await rename(temporaryLiveContract, liveContractOutput);
  await rename(temporaryProjectionGolden, projectionGoldenOutput);
  await rename(temporaryProjectionContract, projectionContractOutput);
  await rename(temporaryAppProtocol, appProtocolOutput);
} finally {
  await rm(temporarySpec, { force: true });
  await rm(temporaryOutput, { force: true });
  await rm(temporaryLiveContract, { force: true });
  await rm(temporaryProjectionGolden, { force: true });
  await rm(temporaryProjectionContract, { force: true });
  await rm(temporaryAppProtocol, { force: true });
}
