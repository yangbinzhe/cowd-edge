import { execFileSync } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const gatewayUrl = (process.env.COWD_GATEWAY_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const specUrl = `${gatewayUrl}/api/gateway/openapi.json`;
const mfgContractUrl = `${gatewayUrl}/api/apps/mfg/contract`;
const output = process.env.COWD_GENERATED_API_OUTPUT
  ? resolve(process.env.COWD_GENERATED_API_OUTPUT)
  : resolve('src/generated/gateway-api.ts');
const liveContractOutput = process.env.COWD_GENERATED_LIVE_CONTRACT_OUTPUT
  ? resolve(process.env.COWD_GENERATED_LIVE_CONTRACT_OUTPUT)
  : resolve(dirname(output), 'live-contract-meta.ts');
function openApiPath(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function operationHasNamedSchema(operation) {
  const serialized = JSON.stringify({
    requestBody: operation?.requestBody,
    responses: operation?.responses,
  });
  return serialized.includes('"$ref":"#/components/schemas/');
}

function assertMfgCapabilitySchema(document, contract) {
  const activeRoutes = (contract?.routes || []).filter((route) => route.availability === 'active');
  if (activeRoutes.length === 0) {
    throw new Error('MFG contract does not expose any active routes');
  }
  const routeIds = activeRoutes.map((route) => route.route_id);
  const operationIds = activeRoutes.map(
    (route) => `${String(route.method || '').toUpperCase()} ${openApiPath(route.path || '')}`,
  );
  if (
    routeIds.some((routeId) => typeof routeId !== 'string' || routeId.length === 0)
    || new Set(routeIds).size !== routeIds.length
  ) {
    throw new Error('MFG contract contains a missing or duplicate active route ID');
  }
  if (
    activeRoutes.some(
      (route) => typeof route.method !== 'string'
        || route.method.length === 0
        || typeof route.path !== 'string'
        || !route.path.startsWith('/api/apps/mfg/'),
    )
    || new Set(operationIds).size !== operationIds.length
  ) {
    throw new Error('MFG contract contains a missing or duplicate active method/path operation');
  }
  const contractMissing = activeRoutes.flatMap((route) => {
    const path = openApiPath(route.path);
    const method = String(route.method || '').toLowerCase();
    return document.paths?.[path]?.[method] ? [] : [`${method.toUpperCase()} ${path}`];
  });
  if (contractMissing.length) {
    throw new Error(`Gateway OpenAPI is missing active contract operations: ${contractMissing.join(', ')}`);
  }
  const anonymous = activeRoutes.flatMap((route) => {
    const operation = document.paths?.[openApiPath(route.path)]?.[String(route.method || '').toLowerCase()];
    return operationHasNamedSchema(operation) ? [] : [route.route_id];
  });
  if (anonymous.length) {
    throw new Error(`MFG operations still use anonymous request/response schemas: ${anonymous.join(', ')}`);
  }
}

const requestHeaders = process.env.COWD_API_TOKEN
  ? {
    Authorization: `Bearer ${process.env.COWD_API_TOKEN}`,
    'x-cowd-surface-id': 'webui',
  }
  : undefined;
const [response, contractResponse] = await Promise.all([
  fetch(specUrl, { headers: requestHeaders }),
  fetch(mfgContractUrl, { headers: requestHeaders }),
]);
if (!response.ok) {
  throw new Error(`Gateway OpenAPI fetch failed (${response.status}) from ${specUrl}`);
}
const document = await response.json();
if (document?.openapi !== '3.1.0' || typeof document?.paths !== 'object') {
  throw new Error(`Gateway returned an invalid OpenAPI 3.1 document from ${specUrl}`);
}
if (!contractResponse.ok) {
  throw new Error(`MFG contract fetch failed (${contractResponse.status}) from ${mfgContractUrl}`);
}
const contract = await contractResponse.json();
assertMfgCapabilitySchema(document, contract);
const liveEnvelopeSchema = document?.components?.schemas?.LiveEnvelope;
const liveContractHash = liveEnvelopeSchema?.['x-cowd-schema-hash'];
const liveContractFixture = liveEnvelopeSchema?.example;
if (
  typeof liveContractHash !== 'string'
  || !/^[a-f0-9]{64}$/.test(liveContractHash)
  || liveContractFixture?.schema_version !== 1
  || liveContractFixture?.subscription_revision < 1
) {
  throw new Error('Gateway OpenAPI is missing the canonical LiveEnvelope schema hash or fixture');
}

await mkdir(dirname(output), { recursive: true });
await mkdir(dirname(liveContractOutput), { recursive: true });
const temporaryOutput = resolve(dirname(output), '.gateway-api.generated.ts');
const temporaryLiveContract = resolve(dirname(liveContractOutput), '.live-contract-meta.generated.ts');
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
try {
  execFileSync('npx', ['openapi-typescript', temporarySpec, '-o', temporaryOutput], {
    stdio: 'inherit',
  });
  await rename(temporaryOutput, output);
  await rename(temporaryLiveContract, liveContractOutput);
} finally {
  await rm(temporarySpec, { force: true });
  await rm(temporaryOutput, { force: true });
  await rm(temporaryLiveContract, { force: true });
}
