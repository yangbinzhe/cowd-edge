#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { evidenceContext, manifestPath, writeJsonReport } from './evidence-context.mjs';

const context = evidenceContext('assemble-acceptance-results', { final: true });
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const reportDir = path.join(context.plan_root, 'reports', context.version);
const testDir = path.join(context.plan_root, 'test-reports', context.version);
const resultsPath = path.join(reportDir, `${context.version}-acceptance-results.json`);
const failures = [];

function requireFile(file, label) {
  if (!fs.existsSync(file)) failures.push(`${label} is missing: ${file}`);
  return file;
}

function readJson(file, label) {
  requireFile(file, label);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${label} is not valid JSON: ${error.message}`);
    return {};
  }
}

function sameProvenance(provenance, label) {
  if (provenance?.version !== context.version
    || provenance?.frontend?.commit !== context.frontend.commit
    || provenance?.backend?.commit !== context.backend.commit
    || provenance?.frontend?.dirty
    || provenance?.backend?.dirty
    || provenance?.final !== true) {
    failures.push(`${label} does not bind final clean ${context.version} frontend/backend commits`);
  }
}

const commands = {};
for (const name of [
  'frontend-vitest',
  'frontend-gates',
  'frontend-build',
  'backend-app-mfg',
  'backend-gateway-mfg',
  'backend-check',
  'backend-test',
  'gateway-global-env',
  'openapi-generation',
  'visual-audit',
  'performance-acceptance',
  'matrix-mfg',
  'playwright',
  'scenario-gateway-webui',
  'scenario-same-session',
  'scenario-runtime-surface',
  'scenario-tui-smoke',
  'scenario-full-product',
]) {
  const metadata = readJson(path.join(testDir, `${name}.json`), `${name} command evidence`);
  commands[name] = metadata;
  if (metadata.status !== 'passed' || metadata.exit_code !== 0) failures.push(`${name} command did not pass`);
  if (!metadata.started_at || !metadata.finished_at || !Array.isArray(metadata.command) || !metadata.command.length) {
    failures.push(`${name} command metadata is incomplete`);
  }
  sameProvenance(metadata.provenance, `${name} command evidence`);
  requireFile(metadata.log_path || '', `${name} command log`);
}

const vitestPath = path.join(testDir, 'vitest.json');
const vitest = readJson(vitestPath, 'Vitest JSON report');
if ((vitest.numFailedTests ?? -1) !== 0 || (vitest.numPassedTests ?? 0) < 96) {
  failures.push(`Vitest report is not a clean 96+ test pass: passed=${vitest.numPassedTests} failed=${vitest.numFailedTests}`);
}

// Keep the Playwright reporter payload separate from the command-evidence
// envelope (`playwright.json`). The recorder writes that envelope after the
// child exits, so sharing a path would silently overwrite the test results.
const playwrightPath = path.join(testDir, 'playwright-results.json');
const playwright = readJson(playwrightPath, 'Playwright JSON report');
if ((playwright.stats?.unexpected ?? -1) !== 0
  || (playwright.stats?.skipped ?? -1) !== 0
  || (playwright.stats?.expected ?? 0) < 15) {
  failures.push(`Playwright report is not a clean unskipped 15+ test pass: expected=${playwright.stats?.expected} unexpected=${playwright.stats?.unexpected} skipped=${playwright.stats?.skipped}`);
}

const visualPath = path.join(reportDir, `${context.version}-visual-audit.md`);
requireFile(visualPath, 'full visual audit');
const visual = fs.existsSync(visualPath) ? fs.readFileSync(visualPath, 'utf8') : '';
const visualRows = visual.split('\n').filter((line) => /^\| [^|]+ \| [^|]+ \| (?:pass|review|fail) \|/.test(line)).length;
if (!visual.includes('Mode: full') || !visual.includes('Status: pass') || visualRows !== 1953
  || !visual.includes(`Frontend commit: ${context.frontend.commit}`)
  || !visual.includes(`Backend commit: ${context.backend.commit}`)
  || !visual.includes('- No failing layout gate observed.')) {
  failures.push(`visual audit is not the final 1953-case zero-failure matrix: rows=${visualRows}`);
}

const performancePath = path.join(reportDir, `${context.version}-browser-performance-acceptance.json`);
const performance = readJson(performancePath, 'browser performance report');
sameProvenance(performance.provenance, 'browser performance report');
const performanceIds = new Set((performance.results || []).filter((row) => row.status === 'passed').map((row) => row.acceptance_id));
for (const id of ['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06', 'P-07', 'P-08', 'LIVE-01']) {
  if (!performanceIds.has(id)) failures.push(`browser performance report lacks passed ${id}`);
}
if (performance.status !== 'passed') failures.push('browser performance report did not pass');

const mfgPath = path.join(reportDir, `${context.version}-matrix-mfg-live-smoke.json`);
const mfg = readJson(mfgPath, 'Matrix/MFG real Gateway report');
sameProvenance(mfg.provenance, 'Matrix/MFG real Gateway report');
const mfgSteps = new Set((mfg.steps || []).filter((step) => step.status === 'pass').map((step) => step.step));
for (const step of [
  'forecast available and unavailable truth',
  'evidence quality gate',
  'forged action actor rejected',
  'assignment unassign',
  'cockpit stale revision rejected',
  'single widget projection',
  'cockpit report generate',
  'cockpit delivery state probe',
  'cockpit delivery retry',
  'decision trace aggregate',
]) if (!mfgSteps.has(step)) failures.push(`Matrix/MFG real Gateway report lacks passed step: ${step}`);
if (mfg.status !== 'pass' || mfg.degraded_count !== 0 || (mfg.steps || []).length < 61) {
  failures.push(`Matrix/MFG report is incomplete: status=${mfg.status} degraded=${mfg.degraded_count} steps=${mfg.steps?.length}`);
}

const artifactGroups = {
  visual: [visualPath, commands['visual-audit']?.log_path],
  vitest: [vitestPath, commands['frontend-vitest']?.log_path],
  playwright: [playwrightPath, commands.playwright?.log_path],
  performance: [performancePath, commands['performance-acceptance']?.log_path],
  mfg: [mfgPath, commands['matrix-mfg']?.log_path, commands['backend-app-mfg']?.log_path, commands['backend-gateway-mfg']?.log_path],
  backend: [commands['backend-check']?.log_path, commands['backend-test']?.log_path],
  global: [commands['gateway-global-env']?.log_path],
  openapi: [commands['openapi-generation']?.log_path],
  gatewayWebui: [commands['scenario-gateway-webui']?.log_path],
  sameSession: [commands['scenario-same-session']?.log_path],
  runtimeSurface: [commands['scenario-runtime-surface']?.log_path],
  tui: [commands['scenario-tui-smoke']?.log_path],
  fullProduct: [commands['scenario-full-product']?.log_path],
  build: [commands['frontend-build']?.log_path, commands['frontend-gates']?.log_path],
};

const commandGroups = {
  visual: ['visual-audit'],
  vitest: ['frontend-vitest'],
  playwright: ['playwright'],
  performance: ['performance-acceptance'],
  mfg: ['matrix-mfg', 'backend-app-mfg', 'backend-gateway-mfg'],
  backend: ['backend-check', 'backend-test'],
  global: ['gateway-global-env'],
  openapi: ['openapi-generation'],
  gatewayWebui: ['scenario-gateway-webui'],
  sameSession: ['scenario-same-session'],
  runtimeSurface: ['scenario-runtime-surface'],
  tui: ['scenario-tui-smoke'],
  fullProduct: ['scenario-full-product'],
  build: ['frontend-build', 'frontend-gates'],
};

function artifacts(...groups) {
  return [...new Set(groups.flatMap((group) => artifactGroups[group] || []).filter(Boolean))];
}

function commandEvidence(...groups) {
  const metadata = [...new Set(groups.flatMap((group) => commandGroups[group] || []))]
    .map((name) => commands[name])
    .filter(Boolean);
  return {
    command: metadata.map((entry) => entry.command_text).join(' && '),
    started_at: metadata.map((entry) => entry.started_at).sort()[0],
    finished_at: metadata.map((entry) => entry.finished_at).sort().at(-1),
    data_source: metadata.map((entry) => entry.data_source).join(','),
  };
}

const proofMap = {
  'UX-01': ['browser-controlled', ['visual', 'playwright'], ['360x800 and 390x844 routes/actions are reachable']],
  'UX-02': ['browser-controlled', ['visual'], ['768x1024 section, graph, table and drawer layout gates']],
  'UX-03': ['browser-controlled', ['visual', 'playwright'], ['1179/1180 breakpoint matrix preserves one visible section']],
  'UX-04': ['browser-controlled', ['visual'], ['1440/1920 hierarchy and scroll ownership matrix']],
  'UX-05': ['browser-controlled', ['playwright', 'vitest'], ['route query and history restoration tests']],
  'UX-06': ['browser-controlled', ['visual'], ['200 percent zoom and long-content matrix']],
  'LIVE-01': ['browser-controlled', ['performance'], ['three isolated browser sessions']],
  'LIVE-02': ['browser-controlled', ['vitest', 'visual'], ['independent execution projection selection and stream state']],
  'LIVE-03': ['integration-local', ['vitest'], ['reference-counted shared projection stream release']],
  'LIVE-04': ['cross-surface', ['sameSession', 'tui'], ['same session converges through WebUI/Gateway/TUI observers']],
  'LIVE-05': ['cross-surface', ['runtimeSurface', 'fullProduct'], ['external Surface protocol progress and terminal convergence']],
  'LIVE-06': ['browser-real-gateway', ['playwright', 'sameSession', 'gatewayWebui'], ['real Gateway reconnect and durable terminal path']],
  'LIVE-07': ['performance', ['performance'], ['connection budget overflow is explicitly degraded']],
  'G-01': ['browser-controlled', ['vitest', 'visual'], ['execution DAG adapter integrity and rendered graph route']],
  'G-02': ['browser-controlled', ['vitest', 'visual'], ['Mission and Team topology contract and rendered routes']],
  'G-03': ['browser-controlled', ['vitest', 'visual'], ['runtime timeline correlation and rendered route']],
  'G-04': ['browser-controlled', ['vitest', 'visual'], ['context selection/omission/budget/history graph']],
  'G-05': ['browser-controlled', ['vitest', 'visual'], ['memory graph focus/filter/pagination contract']],
  'G-06': ['browser-controlled', ['vitest', 'visual'], ['Reality source-to-promotion flow contract']],
  'G-07': ['browser-controlled', ['vitest', 'visual'], ['entity impact direction/depth/cycle contract']],
  'G-08': ['browser-controlled', ['vitest', 'visual'], ['metric lineage dependency/version/quality contract']],
  'G-09': ['browser-controlled', ['vitest', 'visual'], ['Evolution signal-to-gate graph contract']],
  'G-10': ['browser-controlled', ['vitest', 'visual'], ['cross-plane identity/grant/action/audit graph']],
  'G-11': ['browser-controlled', ['vitest', 'visual'], ['tool plan/transaction/checkpoint/risk graph']],
  'G-12': ['browser-controlled', ['vitest', 'visual'], ['Surface delivery/retry/DLQ/replay graph']],
  'G-13': ['browser-real-gateway', ['vitest', 'visual', 'gatewayWebui'], ['Harness Eval graph and real Gateway capability contract']],
  'G-14': ['browser-real-gateway', ['mfg', 'playwright', 'visual'], ['MFG decision trace real API plus rendered workflow graph']],
  'E-01': ['browser-controlled', ['vitest', 'visual'], ['typed evidence inspector for graph objects']],
  'E-02': ['integration-local', ['performance', 'vitest'], ['100 refs resolve through one deduplicated batch']],
  'E-03': ['browser-controlled', ['vitest', 'visual'], ['evidence source/backlink/compare relationships']],
  'E-04': ['browser-real-gateway', ['vitest', 'playwright', 'gatewayWebui'], ['redacted, missing and expired states remain distinct']],
  'E-05': ['browser-controlled', ['vitest', 'visual'], ['shared evidence fact is normalized without per-message duplication']],
  'E-06': ['cross-surface', ['sameSession', 'runtimeSurface'], ['evidence binding converges across session surfaces']],
  'M-01': ['browser-real-gateway', ['mfg', 'playwright'], ['focus/profile state persists through real Gateway']],
  'M-02': ['browser-real-gateway', ['mfg', 'playwright'], ['alert create/list and command lifecycle']],
  'M-03': ['browser-real-gateway', ['mfg', 'playwright'], ['available/unavailable forecast truth contract']],
  'M-04': ['browser-real-gateway', ['mfg', 'playwright'], ['cockpit edit, clone, widget and save operations']],
  'M-05': ['browser-real-gateway', ['mfg', 'playwright'], ['dual-observer 409 conflict without overwrite']],
  'M-06': ['browser-real-gateway', ['mfg', 'playwright'], ['scope/share permission crop through real Gateway']],
  'M-07': ['browser-real-gateway', ['mfg', 'playwright', 'performance'], ['isolated cancellable widget refresh']],
  'M-08': ['browser-real-gateway', ['mfg', 'playwright', 'vitest'], ['URL-restored cockpit drilldown filters']],
  'M-09': ['browser-real-gateway', ['mfg', 'playwright', 'visual'], ['metric analysis lineage/evidence/action workspace']],
  'M-10': ['browser-real-gateway', ['mfg', 'playwright', 'visual'], ['entity impact/attention/incident/task workspace']],
  'M-11': ['browser-real-gateway', ['mfg', 'playwright'], ['evidence quality gate and remediation state']],
  'M-12': ['browser-real-gateway', ['mfg', 'playwright'], ['incident command room and live state']],
  'M-13': ['browser-real-gateway', ['mfg', 'playwright'], ['assignment command lifecycle with receipts']],
  'M-14': ['cross-surface', ['mfg', 'sameSession', 'runtimeSurface'], ['canonical MFG task convergence across surfaces']],
  'M-15': ['browser-real-gateway', ['mfg', 'playwright'], ['plan/preflight/execute/feedback/after-state loop']],
  'M-16': ['browser-real-gateway', ['mfg', 'playwright', 'vitest'], ['report history/delivery/retry state and dead-letter semantics']],
  'M-17': ['browser-real-gateway', ['mfg', 'playwright'], ['source pack, connector and compute job lifecycle']],
  'M-18': ['integration-local', ['mfg'], ['lossless legacy four-widget migration test']],
  'S-01': ['browser-real-gateway', ['mfg', 'playwright'], ['principal capability crop and forbidden states']],
  'S-02': ['integration-local', ['mfg'], ['forged actor/command rejection']],
  'S-03': ['integration-local', ['mfg', 'backend'], ['idempotent command and delivery replay']],
  'S-04': ['integration-local', ['mfg'], ['stale profile/assignment/alert revision conflicts']],
  'S-05': ['browser-real-gateway', ['mfg', 'playwright'], ['governed action preflight/confirm/receipt/audit']],
  'S-06': ['browser-real-gateway', ['playwright', 'vitest', 'gatewayWebui'], ['identity-cropped export without hidden payload']],
  'S-07': ['integration-local', ['mfg'], ['widget schema, scope, rate and capability validation']],
  'S-08': ['browser-controlled', ['visual', 'vitest'], ['escaped long and malicious content remains bounded']],
  'P-01': ['performance', ['performance'], ['50/200/500 graph responsiveness']],
  'P-02': ['performance', ['performance'], ['delta batching without full relayout']],
  'P-03': ['performance', ['performance'], ['20-widget interaction and cancellation']],
  'P-04': ['performance', ['performance'], ['100-ref single-batch evidence resolution']],
  'P-05': ['performance', ['performance'], ['SSE/tab budget and reference release']],
  'P-06': ['performance', ['performance'], ['500-row stable pagination fallback']],
  'P-07': ['performance', ['performance'], ['local timeout degradation with responsive shell']],
  'P-08': ['performance', ['performance'], ['long-task state and wait reason visibility']],
};

const now = new Date().toISOString();
const results = [];
for (const entry of manifest.entries || []) {
  const proof = proofMap[entry.id];
  if (!proof) {
    failures.push(`acceptance proof mapping is missing: ${entry.id}`);
    continue;
  }
  const [level, groups, checks] = proof;
  const allGroups = [...groups, 'build', 'openapi', 'global'];
  const resultArtifacts = artifacts(...allGroups);
  const execution = commandEvidence(...allGroups);
  for (const artifact of resultArtifacts) requireFile(artifact, `${entry.id} artifact`);
  results.push({
    acceptance_id: entry.id,
    status: 'passed',
    level,
    version: context.version,
    frontend_commit: context.frontend.commit,
    backend_commit: context.backend.commit,
    command: execution.command,
    started_at: execution.started_at || now,
    finished_at: execution.finished_at || now,
    data_source: execution.data_source,
    checks,
    artifacts: resultArtifacts,
  });
}

if (failures.length) {
  const failurePath = writeJsonReport(context, `${context.version}-acceptance-assembly-failures.json`, {
    status: 'failed',
    failures,
  });
  console.error(`Acceptance result assembly failed: ${failurePath}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(resultsPath, `${JSON.stringify({
  provenance: context,
  status: 'passed',
  result_count: results.length,
  results,
}, null, 2)}\n`);
console.log(`Acceptance results assembled: ${resultsPath}`);
