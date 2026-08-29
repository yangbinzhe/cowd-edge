#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const files = [
  'scripts/acceptance-gate.mjs',
  'scripts/assemble-acceptance-results.mjs',
  'scripts/capability-parity.mjs',
  'scripts/raw-payload-audit.mjs',
  'scripts/release-browser-gate.mjs',
  'evaluation/acceptance-manifest.json',
  'webui-next.e2e.spec.js',
  'package.json',
];
const source = files.map((file) => `${file}\n${fs.readFileSync(path.join(root, file), 'utf8')}`).join('\n');
const failures = [];
const releaseScripts = JSON.parse(fs.readFileSync(path.resolve(root, '../..', 'package.json'), 'utf8')).scripts || {};

for (const [pattern, label] of [
  [/\b0\.9\.529\b/, 'historical release fixture'],
  [/\bV506\b/, 'historical strategy release'],
  [/fact_kernel_is_consumed_by_memory_and_matrix_engines/, 'backend test-name coupling'],
  [/gateway_route_source_architecture/, 'retired backend source-shape test'],
  [/\brequiredSource\b/, 'private source symbol allow-list'],
  [/visualRows\s*!==\s*\d+/, 'fixed visual row count'],
  [/\(application\.steps\s*\|\|\s*\[\]\)\.length\s*[<>]=?\s*\d+/, 'fixed application step count'],
  [/path\.join\(workspaceRoot,\s*'dev-iacc'\)/, 'retired backend checkout fallback'],
  [/crates\/cowd-cli/, 'retired CLI source fallback'],
  [/\bpageRequirements\b/, 'private page implementation inventory'],
  [/tool-operations-gate|command-actions-gate/, 'duplicated source-shape gate'],
  [/\bplannedProofClasses\b/, 'prefix-wide acceptance proof substitution'],
  [/\bnamed(?:Command|Vitest|Playwright)Proof\b/, 'test-title or function-name evidence coupling'],
  [/\.rail-button[^;\n]*toHaveCount\(\d+\)/, 'fixed desktop navigation count'],
  [/\.mobile-nav-menu[^;\n]*toHaveCount\(\d+\)/, 'fixed mobile navigation count'],
  [/\.section-row[^;\n]*toHaveCount\([1-9]\d*\)/, 'fixed capability section count'],
  [/\.filter-row select[^;\n]*toHaveCount\([1-9]\d*\)/, 'fixed filter control count'],
  [/\.metric-card[^;\n]*toHaveCount\([1-9]\d*\)/, 'fixed metric card count'],
  [/evaluation\/acceptance-results\.json/, 'repository-local final acceptance result'],
]) {
  if (pattern.test(source)) failures.push(label);
}

const releaseCommand = releaseScripts['test:release'] || '';
const buildIndex = releaseCommand.indexOf('build:webui');
const assembleIndex = releaseCommand.indexOf('test:acceptance:assemble');
const finalIndex = releaseCommand.indexOf('test:acceptance:final');
const browserIndex = releaseCommand.indexOf('test:e2e:release');
if (!(buildIndex >= 0 && assembleIndex > buildIndex && finalIndex > assembleIndex && browserIndex > finalIndex)) {
  failures.push('release command must build, assemble, validate, then browser-test final evidence');
}
if (!source.includes("releaseServer.listen(0, '127.0.0.1'")) {
  failures.push('release browser gate must self-host the built WebUI on an ephemeral loopback port');
}

for (const retired of [
  'scripts/tool-operations-gate.mjs',
  'scripts/command-actions-gate.mjs',
]) {
  if (fs.existsSync(path.join(root, retired))) failures.push(`retired gate returned: ${retired}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'evaluation/acceptance-manifest.json'), 'utf8'));
const ids = (manifest.entries || []).map((entry) => entry.id);
if (new Set(ids).size !== ids.length) failures.push('duplicate acceptance ids');
if (!ids.length || ids.some((id) => !/^[A-Z]+-\d{2}$/.test(id))) {
  failures.push('invalid or empty acceptance manifest');
}
const edgeOwners = new Set(manifest.edge_evidence_owners || []);
const delegatedOwners = new Set(Object.keys(manifest.delegated_evidence_owners || {}));
const delegatedEntries = new Set(manifest.delegated_evidence_entries || []);
for (const entry of manifest.entries || []) {
  if (!edgeOwners.has(entry.owner) && !delegatedOwners.has(entry.owner) && !delegatedEntries.has(entry.id)) {
    failures.push(`acceptance requirement has no evidence owner: ${entry.id}`);
  }
}

if (failures.length) {
  console.error(`WebUI test governance failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(`WebUI test governance passed: ${ids.length} self-described acceptance requirements`);
