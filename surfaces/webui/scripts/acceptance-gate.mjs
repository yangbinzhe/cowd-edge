import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceContext } from './evidence-context.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'evaluation/acceptance-manifest.json'), 'utf8'));
const failures = [];
const owners = new Set(manifest.edge_evidence_owners || []);
const delegatedIds = manifest.delegated_evidence_entries || [];
const delegated = new Set(delegatedIds);
const entries = manifest.entries.filter((entry) => owners.has(entry.owner) && !delegated.has(entry.id));
const ids = new Set();

if (manifest.schema_version !== 2) failures.push('Acceptance manifest schema_version must be 2');
if (!owners.size) failures.push('Acceptance manifest must declare Edge evidence owners');
if (!manifest.delegated_evidence_owners || !Object.keys(manifest.delegated_evidence_owners).length) {
  failures.push('Acceptance manifest must declare delegated application evidence ownership');
}
if (typeof manifest.delegated_evidence_entry_owner !== 'string' || !manifest.delegated_evidence_entry_owner) {
  failures.push('Acceptance manifest must identify the delegated entry evidence owner');
}
if (delegated.size !== delegatedIds.length) failures.push('Delegated acceptance entry IDs must be unique');
const allEntries = new Map(manifest.entries.map((entry) => [entry.id, entry]));
for (const id of delegated) {
  const entry = allEntries.get(id);
  if (!entry) failures.push(`Delegated acceptance entry does not exist: ${id}`);
  else if (!owners.has(entry.owner) && !manifest.delegated_evidence_owners[entry.owner]) {
    failures.push(`${id} has no delegated owner mapping for ${entry.owner}`);
  }
}
for (const entry of entries) {
  if (!entry.id || ids.has(entry.id)) failures.push(`Duplicate or empty acceptance id: ${entry.id || '<empty>'}`);
  ids.add(entry.id);
  if (!manifest.allowed_levels.includes(entry.min_evidence)) failures.push(`${entry.id} has an invalid evidence level`);
  if (!entry.requirement || !Array.isArray(entry.evidence) || !entry.evidence.length) failures.push(`${entry.id} has no auditable evidence contract`);
}
if (!entries.length) failures.push('No Edge-owned acceptance entries are selected');

if (process.argv.includes('--final')) {
  const context = evidenceContext('acceptance-gate', { final: true });
  const resultsPath = resolve(
    context.plan_root,
    'reports',
    context.version,
    `${context.version}-acceptance-results.json`,
  );
  if (!existsSync(resultsPath)) {
    failures.push(`Final acceptance results are missing: ${resultsPath}; run test:acceptance:assemble first`);
  } else {
    const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
    const provenanceMatches = results.provenance?.final === true
      && results.provenance?.version === context.version
      && results.provenance?.frontend?.commit === context.frontend.commit
      && results.provenance?.backend?.commit === context.backend.commit
      && results.provenance?.frontend?.dirty === false
      && results.provenance?.backend?.dirty === false;
    if (results.schema_version !== 2) failures.push('Final acceptance results schema_version must be 2');
    if (results.status !== 'pass' || (results.failures || []).length) {
      failures.push('Final acceptance results did not pass');
    }
    if (!provenanceMatches) failures.push('Final acceptance results do not bind the current clean release commits');
    for (const entry of entries) {
      const result = results.entries?.find((item) => item.id === entry.id);
      if (!result || result.status !== 'pass') failures.push(`${entry.id} lacks passing final evidence`);
    }
  }
}

console.log(JSON.stringify({ gate: 'edge-acceptance-ownership', selected_entries: entries.length, delegated_entries: delegated.size, delegated_owner: manifest.delegated_evidence_entry_owner, failures }, null, 2));
if (process.argv.includes('--gate') && failures.length) process.exit(1);
