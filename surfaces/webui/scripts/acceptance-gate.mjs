#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { appCheckoutRoot, appWebUiSourceRoot } from './app-source-paths.mjs';
import { evidenceContext, manifestPath, writeJsonReport } from './evidence-context.mjs';

const final = process.argv.includes('--final');
const gate = process.argv.includes('--gate') || final;
const context = evidenceContext('acceptance-gate', { final });
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const expectedIds = (manifest.entries || []).map((entry) => entry.id);
const allowedLevels = new Set(manifest.allowed_levels || []);
const failures = [];
const ids = new Set();

if (manifest.schema_version !== 2) failures.push('acceptance manifest schema_version must be 2');
for (const entry of manifest.entries || []) {
  if (!entry.id || ids.has(entry.id)) failures.push(`duplicate or missing acceptance id: ${entry.id || '<missing>'}`);
  ids.add(entry.id);
  if (!/^[A-Z]+-\d{2}$/.test(entry.id || '')) failures.push(`invalid acceptance id: ${entry.id || '<missing>'}`);
  if (!entry.requirement || !entry.owner || !entry.min_evidence || !Array.isArray(entry.evidence) || !entry.evidence.length) {
    failures.push(`${entry.id || '<missing>'} lacks requirement, owner, min_evidence, or evidence owner`);
  }
  if (!allowedLevels.has(entry.min_evidence)) failures.push(`${entry.id} uses unknown min evidence ${entry.min_evidence}`);
}
function source(root, relative) {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const sourceRoots = {
  frontend: context.frontend.root,
  backend: context.backend.root,
  'app-webui': appWebUiSourceRoot('mfg'),
  app: appCheckoutRoot('mfg'),
};

function repositorySource(repository, file) {
  const root = sourceRoots[repository];
  return root ? source(root, file) : '';
}

const forbiddenSource = [
  ['frontend', 'surfaces/webui/src/App.vue', /syncSectionVisibility|querySelectorAll\([^)]*data-section|\.hidden\s*=/, 'imperative section visibility'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue', /\.slice\(0,\s*220\)/, 'first-220 graph truncation'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue', /internal_reasoning|chain_of_thought/i, 'sensitive graph export field'],
  ['app', 'crates/app-mfg-adapter/src/lib.rs', /"team"\s*\|\s*"public"/, 'team widened to public visibility'],
  ['app', 'crates/app-mfg-core/src/cockpit.rs', /query_schema:[^\n]*additionalProperties"\s*:\s*true/, 'open cockpit query schema'],
  ['app', 'crates/app-mfg-core/src/repository.rs', /build_cockpit_projection/, 'legacy cockpit projection dual truth'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', /operator_id\s*:|actor_principal\s*:/, 'client supplied MFG effect actor'],
  ['frontend', 'surfaces/webui/src/pages/GatewayPage.vue', /actor_principal\s*:/, 'client supplied Gateway effect actor'],
  ['frontend', 'surfaces/webui/src/pages/ToolsPage.vue', /actor_principal\s*:/, 'client supplied Tools effect actor'],
];

for (const [repository, file, pattern, label] of forbiddenSource) {
  if (pattern.test(repositorySource(repository, file))) failures.push(`forbidden source returned: ${label} in ${repository}:${file}`);
}

function satisfiesLevel(actual, required) {
  if (required === 'cross-surface' || required === 'performance') return actual === required;
  const order = ['static', 'unit-mock', 'integration-local', 'browser-controlled', 'browser-real-gateway'];
  return order.indexOf(actual) >= order.indexOf(required);
}

let resultSummary = null;
if (final) {
  const resultsArg = process.argv.indexOf('--results');
  const resultsPath = resultsArg >= 0 ? process.argv[resultsArg + 1] : process.env.COWD_ACCEPTANCE_RESULTS;
  if (!resultsPath || !fs.existsSync(resultsPath)) {
    failures.push('final acceptance requires an existing --results file or COWD_ACCEPTANCE_RESULTS');
  } else {
    const resultsDocument = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    const results = Array.isArray(resultsDocument) ? resultsDocument : resultsDocument.results;
    if (!Array.isArray(results)) failures.push('acceptance results must be an array or { results: [] }');
    else {
      const accepted = [];
      for (const entry of manifest.entries) {
        const candidates = results.filter((result) => result.acceptance_id === entry.id);
        const result = candidates.find((candidate) => candidate.status === 'passed'
          && satisfiesLevel(candidate.level, entry.min_evidence)
          && candidate.version?.replace(/^v/, '') === context.version
          && candidate.frontend_commit === context.frontend.commit
          && candidate.backend_commit === context.backend.commit
          && candidate.command
          && candidate.started_at
          && candidate.finished_at
          && candidate.data_source
          && Array.isArray(candidate.checks)
          && candidate.checks.length
          && Array.isArray(candidate.artifacts)
          && candidate.artifacts.length
          && candidate.artifacts.every((artifact) => fs.existsSync(artifact)));
        if (!result) failures.push(`${entry.id} lacks a passed ${entry.min_evidence} result with matching provenance and artifacts`);
        else accepted.push({ id: entry.id, level: result.level, artifacts: result.artifacts });
      }
      const unknown = results.filter((result) => !ids.has(result.acceptance_id));
      if (unknown.length) failures.push(`results contain unknown acceptance ids: ${unknown.map((item) => item.acceptance_id).join(', ')}`);
      resultSummary = { path: path.resolve(resultsPath), supplied: results.length, accepted };
    }
  }
}

const reportPath = writeJsonReport(context, `${context.version}-acceptance-gate.json`, {
  status: failures.length ? 'fail' : (final ? 'passed' : 'prepared'),
  mandatory_count: expectedIds.length,
  manifest_count: manifest.entries?.length || 0,
  final,
  failures,
  results: resultSummary,
});

if (failures.length) {
  console.error(`Acceptance gate failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  if (gate) process.exit(1);
}
console.log(`Acceptance gate ${failures.length ? 'reported failures' : final ? 'passed' : 'prepared'}: ${reportPath}`);
