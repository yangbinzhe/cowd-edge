import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'evaluation/acceptance-manifest.json'), 'utf8'));
const failures = [];
const owners = new Set(manifest.edge_evidence_owners || []);
const entries = manifest.entries.filter((entry) => owners.has(entry.owner));
const ids = new Set();

if (manifest.schema_version !== 2) failures.push('Acceptance manifest schema_version must be 2');
if (!owners.size) failures.push('Acceptance manifest must declare Edge evidence owners');
if (!manifest.delegated_evidence_owners || !Object.keys(manifest.delegated_evidence_owners).length) {
  failures.push('Acceptance manifest must declare delegated application evidence ownership');
}
for (const entry of entries) {
  if (!entry.id || ids.has(entry.id)) failures.push(`Duplicate or empty acceptance id: ${entry.id || '<empty>'}`);
  ids.add(entry.id);
  if (!manifest.allowed_levels.includes(entry.min_evidence)) failures.push(`${entry.id} has an invalid evidence level`);
  if (!entry.requirement || !Array.isArray(entry.evidence) || !entry.evidence.length) failures.push(`${entry.id} has no auditable evidence contract`);
}
if (!entries.length) failures.push('No Edge-owned acceptance entries are selected');

if (process.argv.includes('--final')) {
  const results = JSON.parse(readFileSync(resolve(root, 'evaluation/acceptance-results.json'), 'utf8'));
  for (const entry of entries) {
    const result = results.entries?.find((item) => item.id === entry.id);
    if (!result || result.status !== 'pass') failures.push(`${entry.id} lacks passing final evidence`);
  }
}

console.log(JSON.stringify({ gate: 'edge-acceptance-ownership', selected_entries: entries.length, failures }, null, 2));
if (process.argv.includes('--gate') && failures.length) process.exit(1);
