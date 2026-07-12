import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const gatewayUrl = (process.env.COWD_GATEWAY_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const specUrl = `${gatewayUrl}/api/gateway/openapi.json`;
const output = resolve('src/generated/gateway-api.ts');

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
