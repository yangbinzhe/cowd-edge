import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(resolve(root, 'contracts/presentation/result-shape-v1.schema.json'), 'utf8'));
const types = readFileSync(resolve(root, 'src/apps/presentation/types.ts'), 'utf8');
const registry = readFileSync(resolve(root, 'src/apps/presentation/registry.ts'), 'utf8');
const digest = schema.schema_sha256;
const failures = [];

if (schema.contract_id !== 'cowd.presentation.result-shape.v1') failures.push('Presentation contract identifier is not canonical V1');
if (!types.includes(digest)) failures.push('Generated presentation types do not identify the frozen schema digest');
if (!registry.includes('renderer') || !registry.includes('kind')) failures.push('Presentation renderer registry is not typed by result kind');

console.log(JSON.stringify({ gate: 'core-presentation-contract', contract_id: schema.contract_id, digest, failures }, null, 2));
if (process.argv.includes('--gate') && failures.length) process.exit(1);
