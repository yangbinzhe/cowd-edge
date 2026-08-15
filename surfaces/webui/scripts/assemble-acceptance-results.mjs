#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { evidenceContext, manifestPath } from './evidence-context.mjs';

const context = evidenceContext('assemble-acceptance-results', { final: true });
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const edgeOwners = new Set(manifest.edge_evidence_owners || []);
const delegatedOwners = new Set(Object.keys(manifest.delegated_evidence_owners || {}));
const delegatedEntries = new Set(manifest.delegated_evidence_entries || []);
const testDir = path.join(context.plan_root, 'test-reports', context.version);
const reportDir = path.join(context.plan_root, 'reports', context.version);
const failures = [];
const claims = new Map();

function matchingProvenance(provenance) {
  return provenance?.final === true
    && provenance.version === context.version
    && provenance.frontend?.commit === context.frontend.commit
    && provenance.backend?.commit === context.backend.commit
    && provenance.frontend?.dirty === false
    && provenance.backend?.dirty === false;
}

for (const name of fs.existsSync(testDir) ? fs.readdirSync(testDir).filter((item) => item.endsWith('.json')) : []) {
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(path.join(testDir, name), 'utf8')); } catch { continue; }
  if (metadata.schema_version !== 1 || metadata.status !== 'passed' || metadata.exit_code !== 0) continue;
  if (!matchingProvenance(metadata.provenance) || !fs.existsSync(metadata.log_path || '')) continue;
  for (const claim of metadata.claims || []) {
    if (typeof claim !== 'string' || !claim) continue;
    const owners = claims.get(claim) || [];
    owners.push({ name: metadata.name, log_path: metadata.log_path });
    claims.set(claim, owners);
  }
}

const entries = manifest.entries.map((entry) => {
  if (!edgeOwners.has(entry.owner) || delegatedEntries.has(entry.id)) {
    const delegated = delegatedOwners.has(entry.owner) || delegatedEntries.has(entry.id);
    if (!delegated) failures.push(`${entry.id} has neither Edge nor delegated evidence ownership`);
    return { id: entry.id, owner: entry.owner, status: 'delegated', evidence: [], delegated };
  }
  const missing = entry.evidence.filter((claim) => !claims.has(claim));
  if (missing.length) failures.push(`${entry.id} is missing recorded evidence claims: ${missing.join(', ')}`);
  return {
    id: entry.id,
    owner: entry.owner,
    status: missing.length ? 'fail' : 'pass',
    evidence: entry.evidence.flatMap((claim) => (claims.get(claim) || []).map((item) => ({ claim, ...item }))),
  };
});

const report = {
  schema_version: 2,
  provenance: context,
  generated_at: new Date().toISOString(),
  status: failures.length ? 'fail' : 'pass',
  entries,
  failures,
};
fs.mkdirSync(reportDir, { recursive: true });
const output = path.join(reportDir, `${context.version}-acceptance-results.json`);
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, status: report.status, edge_entries: entries.filter((entry) => entry.status !== 'delegated').length, delegated_entries: entries.filter((entry) => entry.status === 'delegated').length, failures }, null, 2));
if (failures.length) process.exit(1);
