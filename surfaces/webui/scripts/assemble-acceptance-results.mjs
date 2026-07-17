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
  'backend-app-mfg-contract',
  'backend-app-mfg',
  'backend-auth-broker',
  'backend-gateway-mfg',
  'backend-tui-mfg',
  'backend-harness-strategy',
  'backend-check',
  'backend-clippy',
  'backend-test',
  'backend-version-gate',
  'edge-version-gate',
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
  'scenario-auth-profile',
  'scenario-mfg-surfaces',
  'scenario-auto-strategy',
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

const mfgSurfacePointerPath = path.join(context.backend.root, 'target/acceptance/latest-mfg-surface.json');
const mfgSurfacePointer = readJson(mfgSurfacePointerPath, 'MFG Surface artifact pointer');
const expectedMfgArtifactRoot = path.join(context.backend.root, 'target/acceptance');
const mfgSurfaceArtifactDir = path.resolve(mfgSurfacePointer.artifact_dir || '/missing');
if (!mfgSurfaceArtifactDir.startsWith(`${expectedMfgArtifactRoot}${path.sep}`)) {
  failures.push(`MFG Surface artifact directory escapes ${expectedMfgArtifactRoot}`);
}
const mfgSurfaceIndexPath = path.resolve(
  mfgSurfacePointer.index || path.join(mfgSurfaceArtifactDir, 'artifact-index.json'),
);
if (!mfgSurfaceIndexPath.startsWith(`${mfgSurfaceArtifactDir}${path.sep}`)) {
  failures.push('MFG Surface structured artifact index escapes its scenario directory');
}
const mfgSurfaceIndex = readJson(
  mfgSurfaceIndexPath,
  'MFG Surface structured artifact index',
);
if (mfgSurfaceIndex.producer !== 'mfg-surface-acceptance.v2'
  || mfgSurfacePointer.scenario_id !== mfgSurfaceIndex.scenario_id) {
  failures.push('MFG Surface artifact pointer is not bound to the v2 structured producer');
}
const mfgSurfaceInventory = Array.isArray(mfgSurfaceIndex.artifacts)
  ? mfgSurfaceIndex.artifacts
  : [];
if (mfgSurfaceInventory.length === 0) {
  failures.push('MFG Surface artifact inventory is empty or invalid');
}
const mfgSurfaceInventorySet = new Set();
for (const artifact of mfgSurfaceInventory) {
  if (typeof artifact !== 'string' || !artifact.trim()) {
    failures.push('MFG Surface artifact inventory contains a non-path entry');
    continue;
  }
  if (mfgSurfaceInventorySet.has(artifact)) {
    failures.push(`MFG Surface artifact inventory contains a duplicate: ${artifact}`);
    continue;
  }
  mfgSurfaceInventorySet.add(artifact);
  const artifactPath = path.resolve(mfgSurfaceArtifactDir, artifact);
  if (!artifactPath.startsWith(`${mfgSurfaceArtifactDir}${path.sep}`)) {
    failures.push(`MFG Surface artifact inventory escapes its scenario directory: ${artifact}`);
    continue;
  }
  requireFile(artifactPath, `MFG Surface inventory artifact ${artifact}`);
}
for (const [checkId, check] of Object.entries(mfgSurfaceIndex.checks || {})) {
  for (const artifact of check?.evidence || []) {
    if (!mfgSurfaceInventorySet.has(artifact)) {
      failures.push(`${checkId} evidence is absent from the MFG Surface artifact inventory: ${artifact}`);
    }
  }
}
const mfgSurfaceMetrics = readJson(
  path.join(mfgSurfaceArtifactDir, 'metrics.json'),
  'MFG Surface metrics',
);
const mfgSurfaceTuiA = readJson(
  path.join(mfgSurfaceArtifactDir, 'tui-a-state.json'),
  'MFG Surface TUI-A state',
);
const mfgSurfaceTuiB = readJson(
  path.join(mfgSurfaceArtifactDir, 'tui-b-state.json'),
  'MFG Surface TUI-B state',
);
const mfgSurfaceBrowser = readJson(
  path.join(mfgSurfaceArtifactDir, 'webui-browser.json'),
  'MFG Surface browser state',
);
const mfgSurfaceReport = readJson(
  path.join(mfgSurfaceArtifactDir, 'report-generate.json'),
  'MFG Surface generated report',
);
const mfgSurfaceFinalReport = readJson(
  path.join(mfgSurfaceArtifactDir, 'report-final.json'),
  'MFG Surface final report',
);
const mfgSurfaceReview = readJson(
  path.join(mfgSurfaceArtifactDir, 'report-review-request.json'),
  'MFG Surface report review',
);
const mfgSurfaceTuiABeforeRestart = readJson(
  path.join(mfgSurfaceArtifactDir, 'tui-a-before-restart.json'),
  'MFG Surface TUI-A pre-restart live state',
);
const mfgSurfaceTuiBBeforeRestart = readJson(
  path.join(mfgSurfaceArtifactDir, 'tui-b-before-restart.json'),
  'MFG Surface TUI-B pre-restart live state',
);
const mfgSurfaceTuiAAfterRestart = readJson(
  path.join(mfgSurfaceArtifactDir, 'tui-a-after-restart.json'),
  'MFG Surface TUI-A post-restart live state',
);
const mfgSurfaceTuiBAfterRestart = readJson(
  path.join(mfgSurfaceArtifactDir, 'tui-b-after-restart.json'),
  'MFG Surface TUI-B post-restart live state',
);
const mfgSurfaceWebuiBeforeRestart = readJson(
  path.join(mfgSurfaceArtifactDir, 'webui-before-restart.json'),
  'MFG Surface WebUI pre-restart state',
);
const mfgSurfaceWebuiAfterRestart = readJson(
  path.join(mfgSurfaceArtifactDir, 'webui-after-restart.json'),
  'MFG Surface WebUI post-restart state',
);
const mfgSurfaceProfileSnapshot = readJson(
  path.join(mfgSurfaceArtifactDir, 'snapshot-after-profile-change.json'),
  'MFG Surface recropped snapshot',
);
const mfgSurfaceRestartSnapshot = readJson(
  path.join(mfgSurfaceArtifactDir, 'snapshot-after-restart.json'),
  'MFG Surface post-restart snapshot',
);
const mfgSurfaceHiddenBefore = readJson(
  path.join(mfgSurfaceArtifactDir, 'hidden-backlog-before.json'),
  'MFG Surface hidden-backlog baseline',
);
const hiddenHeartbeatPath = path.join(mfgSurfaceArtifactDir, 'hidden-heartbeat-sse.log');
requireFile(hiddenHeartbeatPath, 'MFG Surface hidden-only heartbeat stream');
const hiddenHeartbeatPayloads = fs.existsSync(hiddenHeartbeatPath)
  ? fs.readFileSync(hiddenHeartbeatPath, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .map((frame) => frame.split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n'))
    .filter(Boolean)
    .map((data) => {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    })
  : [];
const convergedReportId = mfgSurfaceReport.report?.report_id;
const convergedReceiptId = mfgSurfaceReport._mfg_receipt?.receipt_id;
const convergedReport = mfgSurfaceFinalReport.report;
const convergedReview = mfgSurfaceReview.review;
const sorted = (items) => [...(items || [])].sort();
const convergedDeliveryIds = sorted(
  (convergedReport?.delivery_receipts || []).map((receipt) => receipt.delivery_id),
);
const surfaceHasExactReportReviewReceipt = (state) => (
  typeof convergedReportId === 'string'
  && typeof convergedReceiptId === 'string'
  && (state.reports || []).some((report) => (
    report.id === convergedReportId
    && report.revision === convergedReport?.revision
    && report.status === convergedReport?.status
    && JSON.stringify(sorted(report.delivery_receipt_ids)) === JSON.stringify(convergedDeliveryIds)
  ))
  && (state.reviews || []).some((review) => (
    review.id === convergedReview?.review_id
    && review.report_id === convergedReportId
    && review.revision === convergedReview?.revision
    && review.status === convergedReview?.status
  ))
  && (state.receipts || []).some((receipt) => receipt.id === convergedReceiptId)
);
const exactTerminalWebEvent = (mfgSurfaceBrowser.browser?.frames || []).some((frame) => (
  (frame.events || []).some((event) => (
    event.subject_ref === 'mfg:assignment:mfg-live-assignment-1'
    && event.revision === 2
  ))
));
const mfgSurfaceSemanticProof = {
  'MLIVE-01': () => (
    mfgSurfaceMetrics.observer_count === 3
    && (mfgSurfaceBrowser.console_errors || []).length === 0
    && mfgSurfaceMetrics.receipt_delivery_converged === true
    && convergedDeliveryIds.length >= 3
    && surfaceHasExactReportReviewReceipt(mfgSurfaceTuiA)
    && surfaceHasExactReportReviewReceipt(mfgSurfaceTuiB)
    && surfaceHasExactReportReviewReceipt({
      reports: mfgSurfaceBrowser.ui?.live?.reports,
      reviews: mfgSurfaceBrowser.ui?.live?.reviews,
      receipts: mfgSurfaceBrowser.ui?.live?.receipt_items,
    })
    && (mfgSurfaceBrowser.browser?.frames || []).some((frame) => (
      (frame.receipt_ids || []).includes(convergedReceiptId)
    ))
  ),
  'MLIVE-03': () => (
    mfgSurfaceMetrics.event_count >= 1000
    && mfgSurfaceMetrics.burst_assignment_count >= 1000
    && String(mfgSurfaceMetrics.queue?.observer_id || '').endsWith('-tui-b')
    && String(mfgSurfaceMetrics.queue?.pressure_connection_id || '').length > 0
    && mfgSurfaceMetrics.queue?.peak > 0
    && mfgSurfaceMetrics.queue?.peak <= mfgSurfaceMetrics.queue?.capacity
    && mfgSurfaceMetrics.queue?.event_peak >= 2
    && mfgSurfaceMetrics.queue?.event_peak <= mfgSurfaceMetrics.queue?.event_capacity
    && mfgSurfaceMetrics.queue?.coalesced > 0
    && mfgSurfaceMetrics.webui_interaction_latency_ms <= 2000
    && (mfgSurfaceBrowser.interaction_probes || []).some((probe) => (
      String(probe.id || '').endsWith('-webui-refresh-during-burst')
      && probe.status === 'passed'
      && probe.latency_ms <= 2000
    ))
  ),
  'MLIVE-04': () => (
    mfgSurfaceMetrics.slow_observer_resumed === true
    && String(mfgSurfaceMetrics.queue?.observer_id || '').endsWith('-tui-b')
    && String(mfgSurfaceMetrics.queue?.pressure_connection_id || '').length > 0
    && mfgSurfaceMetrics.release?.observer_id === mfgSurfaceMetrics.queue?.observer_id
    && String(mfgSurfaceMetrics.release?.connection_id || '').length > 0
    && mfgSurfaceMetrics.release?.receiver_closed === true
    && mfgSurfaceMetrics.webui_interaction_latency_ms <= 2000
    && (mfgSurfaceBrowser.interaction_probes || []).some((probe) => (
      String(probe.id || '').endsWith('-webui-refresh-during-burst')
      && probe.status === 'passed'
      && probe.latency_ms <= 2000
    ))
  ),
  'MLIVE-05': () => (
    mfgSurfaceMetrics.gateway_restart_epoch_stable === true
    && (mfgSurfaceBrowser.console_errors || []).length === 0
    && mfgSurfaceMetrics.webui_stream_request_count >= 2
    && mfgSurfaceMetrics.webui_snapshot_request_count > 1
    && (mfgSurfaceWebuiAfterRestart.browser?.requests || []).filter(
      (request) => request.url.endsWith('/api/apps/mfg/live/snapshot'),
    ).length > (mfgSurfaceWebuiBeforeRestart.browser?.requests || []).filter(
      (request) => request.url.endsWith('/api/apps/mfg/live/snapshot'),
    ).length
    && mfgSurfaceMetrics.tui_restart_installed_new_generation === true
    && mfgSurfaceTuiAAfterRestart.generation > mfgSurfaceTuiABeforeRestart.generation
    && mfgSurfaceTuiBAfterRestart.generation > mfgSurfaceTuiBBeforeRestart.generation
    && mfgSurfaceTuiAAfterRestart.cursor === mfgSurfaceRestartSnapshot.cursor
    && mfgSurfaceTuiBAfterRestart.cursor === mfgSurfaceRestartSnapshot.cursor
    && mfgSurfaceTuiAAfterRestart.view_epoch === mfgSurfaceRestartSnapshot.view_epoch
    && mfgSurfaceTuiBAfterRestart.view_epoch === mfgSurfaceRestartSnapshot.view_epoch
  ),
  'MLIVE-06': () => {
    const epoch = mfgSurfaceProfileSnapshot.view_epoch;
    return (
      typeof epoch === 'string'
      && (mfgSurfaceBrowser.console_errors || []).length === 0
      && mfgSurfaceMetrics.established_streams_rejected_after_profile_change === true
      && mfgSurfaceMetrics.webui_valid_session_403_recovered_in_same_document === true
      && mfgSurfaceBrowser.browser?.reauthentication_count >= 1
      && mfgSurfaceBrowser.browser?.reauthentication_method === 'mfg_recovery_button_settings_form_same_document'
      && mfgSurfaceBrowser.browser?.authorization_clear_observed === true
      && mfgSurfaceBrowser.browser?.forbidden_recovery_count === 1
      && mfgSurfaceBrowser.browser?.profile_reauthentication_count === 1
      && mfgSurfaceBrowser.browser?.same_document_recovery_count >= 2
      && (mfgSurfaceBrowser.browser?.consumer_generation_deltas || []).filter(
        (item) => item.delta === 1,
      ).length >= 2
      && (mfgSurfaceBrowser.interaction_probes || []).some((probe) => (
        probe.status === 'passed'
        && probe.authorization_error?.code === 'capability_denied'
        && probe.authorization_error?.http_status === 403
      ))
      && (mfgSurfaceBrowser.browser?.stream_errors || []).some((error) => (
        error.code === 'authentication_required' && error.http_status === 401
      ))
      && mfgSurfaceTuiA.live?.reauthentication_count >= 1
      && mfgSurfaceTuiB.live?.reauthentication_count >= 1
      && mfgSurfaceTuiA.live?.view_epoch === epoch
      && mfgSurfaceTuiB.live?.view_epoch === epoch
    );
  },
  'MLIVE-08': () => (
    mfgSurfaceMetrics.terminal_converged === true
    && exactTerminalWebEvent
    && [mfgSurfaceTuiA, mfgSurfaceTuiB].every((state) => (
      (state.assignments || []).some((assignment) => (
        assignment.id === 'mfg-live-assignment-1'
        && assignment.status === 'unassigned'
        && assignment.revision === 2
      ))
    ))
  ),
  'MLIVE-09': () => (
    mfgSurfaceMetrics.profile_change_view_epoch_changed === true
    && mfgSurfaceMetrics.profile_change_internal_epoch_stable === true
    && mfgSurfaceMetrics.old_profile_cursor_resynced === true
    && mfgSurfaceMetrics.hidden_backlog_payload_free_heartbeat === true
    && hiddenHeartbeatPayloads.length > 0
    && hiddenHeartbeatPayloads.every((payload) => (
      payload
      && payload.kind === 'heartbeat'
      && payload.view_epoch === mfgSurfaceHiddenBefore.view_epoch
      && Object.keys(payload).sort().join(',') === 'cursor,generated_at,kind,view_epoch'
    ))
    && hiddenHeartbeatPayloads.at(-1)?.cursor !== mfgSurfaceHiddenBefore.cursor
    && !fs.readFileSync(hiddenHeartbeatPath, 'utf8').includes('hidden-observer')
  ),
};

function commandLogIncludes(commandName, needle, label) {
  const logPath = commands[commandName]?.log_path;
  requireFile(logPath || '', `${label} log`);
  const content = logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  if (!content.includes(needle)) failures.push(`${label} did not execute ${needle}`);
  return logPath;
}

const mfgLiveUnitProof = {
  'MLIVE-02': {
    checks: ['old generation delta is rejected by both WebUI and TUI reducers'],
    artifacts: [
      vitestPath,
      commandLogIncludes(
        'backend-tui-mfg',
        'mfg_live_snapshot_delta_and_generation_guard_update_canonical_state',
        'MLIVE-02 TUI generation guard',
      ),
    ],
    valid: JSON.stringify(vitest).includes('resyncs with a new generation'),
  },
  'MLIVE-07': {
    checks: ['contract mismatch fails fast with a terminal and understandable error'],
    artifacts: [
      vitestPath,
      commandLogIncludes(
        'backend-tui-mfg',
        'mfg_contract_validation_fails_fast_on_version_role_route_or_action_drift',
        'MLIVE-07 TUI contract mismatch',
      ),
    ],
    valid: JSON.stringify(vitest).includes('fails fast on a live contract mismatch'),
  },
};
for (const [id, proof] of Object.entries(mfgLiveUnitProof)) {
  if (!proof.valid) failures.push(`${id} Vitest result lacks its named reducer/contract proof`);
}
const mfgHiddenHeartbeatLog = commandLogIncludes(
  'backend-gateway-mfg',
  'hidden_only_changes_advance_only_the_payload_free_heartbeat_cursor',
  'MLIVE-09 hidden heartbeat',
);

const autoStrategyPointerPath = path.join(
  context.backend.root,
  'target/acceptance/latest-auto-strategy.json',
);
const autoStrategyPointer = readJson(
  autoStrategyPointerPath,
  'automatic strategy artifact pointer',
);
const autoStrategyArtifactRoot = path.join(context.backend.root, 'target/acceptance');
const autoStrategyArtifactDir = path.resolve(autoStrategyPointer.artifact_dir || '/missing');
const autoStrategyReportPath = path.resolve(
  autoStrategyPointer.report || path.join(autoStrategyArtifactDir, 'auto-strategy-paired.json'),
);
if (autoStrategyPointer.producer !== 'auto-strategy-paired.v1'
  || autoStrategyPointer.backend_commit !== context.backend.commit
  || autoStrategyPointer.frontend_commit !== context.frontend.commit
  || !autoStrategyArtifactDir.startsWith(`${autoStrategyArtifactRoot}${path.sep}`)
  || !autoStrategyReportPath.startsWith(`${autoStrategyArtifactDir}${path.sep}`)) {
  failures.push('automatic strategy artifact pointer is not bound to the final commits and target/acceptance root');
}
const autoStrategy = readJson(autoStrategyReportPath, 'automatic strategy paired report');
const autoStrategyProvenance = autoStrategy.provenance || {};
if (autoStrategyProvenance.workspace_revision !== context.backend.commit
  || autoStrategyProvenance.frontend_workspace_revision !== context.frontend.commit
  || !/^[a-f0-9]{64}$/i.test(autoStrategyProvenance.binary_sha256 || '')
  || !/^[a-f0-9]{64}$/i.test(autoStrategyProvenance.backend_source_archive_sha256 || '')
  || !/^[a-f0-9]{64}$/i.test(autoStrategyProvenance.frontend_source_archive_sha256 || '')) {
  failures.push('automatic strategy report provenance is incomplete or not final-commit bound');
}

const scoredAutoSamples = (autoStrategy.samples || []).filter((sample) => (
  sample.condition === 'auto' && sample.warmup === false
));
const frozenRouting = new Map((autoStrategy.task_comparisons || [])
  .map((comparison) => [String(comparison.task_id || ''), String(comparison.expected_candidate || '')])
  .filter(([taskId, expected]) => taskId && expected));
function automaticRoutingEvidence(candidate) {
  const expectedTaskIds = [...frozenRouting.entries()]
    .filter(([, expected]) => expected === candidate)
    .map(([taskId]) => taskId);
  const expectedTaskSet = new Set(expectedTaskIds);
  const samples = scoredAutoSamples.filter((sample) => expectedTaskSet.has(String(sample.task_id || '')));
  const mismatches = samples.filter((sample) => (
    sample.status !== 'completed'
    || sample.selected_candidate !== frozenRouting.get(String(sample.task_id || ''))
  ));
  const perTaskPairs = expectedTaskIds.every((taskId) => {
    const comparison = (autoStrategy.task_comparisons || [])
      .find((item) => String(item.task_id || '') === taskId);
    return Number(comparison?.valid_pair_count || 0) >= 3;
  });
  return {
    candidate,
    expectedTaskIds,
    sampleCount: samples.length,
    mismatches,
    perTaskPairs,
    valid: expectedTaskIds.length > 0
      && samples.length >= expectedTaskIds.length * 3
      && mismatches.length === 0
      && perTaskPairs,
  };
}
function namedVitestProof(...needles) {
  const content = JSON.stringify(vitest);
  return needles.every((needle) => content.includes(needle));
}
function namedPlaywrightProof(...needles) {
  const content = JSON.stringify(playwright);
  return needles.every((needle) => content.includes(needle));
}
function namedCommandProof(commandName, ...needles) {
  const logPath = commands[commandName]?.log_path;
  const content = logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  return needles.every((needle) => content.includes(needle));
}

const strategySemanticProof = {
  'STR-01': () => automaticRoutingEvidence('direct').valid,
  'STR-02': () => automaticRoutingEvidence('parallel_tools').valid,
  'STR-03': () => {
    const evidence = automaticRoutingEvidence('team');
    const samples = scoredAutoSamples.filter((sample) => (
      evidence.expectedTaskIds.includes(String(sample.task_id || ''))
    ));
    return evidence.valid && samples.every((sample) => (
      sample.team_materialized === true
      && sample.team_agent_count >= 2
      && sample.team_child_count >= 1
      && sample.parent_merge_count === 1
    ));
  },
  'STR-04': () => namedCommandProof(
    'backend-test',
    'high_overlap_publishes_downgrade_with_visible_reason',
  ),
  'STR-05': () => namedCommandProof(
    'backend-test',
    'provider_constraint_publishes_monotonic_downgrade_and_retains_scope',
  ),
  'STR-06': () => namedCommandProof(
    'backend-test',
    'low_novelty_publishes_bounded_early_stop',
  ),
  'STR-07': () => (
    namedCommandProof(
      'backend-test',
      'explicit_team_negative_candidate_benefit_emits_surface_cost_warning',
    )
    && namedPlaywrightProof('explicit Team negative-benefit cost warning renders through real Gateway on all strategy surfaces')
  ),
  'STR-08': () => (
    autoStrategy.kind === 'harness_eval.auto_strategy_paired.v1'
    && autoStrategy.status === 'passed'
    && autoStrategy.gate?.passed === true
    && autoStrategy.gate?.claim_allowed === true
    && autoStrategy.gate?.provenance_complete === true
    && autoStrategy.gate?.budget_observation_complete === true
    && autoStrategy.gate?.routing_gate === true
    && autoStrategy.gate?.automatic_team_materialization_gate === true
    && autoStrategy.gate?.hard_budget_lease_gate === true
    && autoStrategy.budget?.observation_complete === true
    && autoStrategy.completeness_bp >= 9_000
  ),
  'STR-09': () => (
    namedVitestProof(
      'maps the shared canonical fixture without inferring fields',
      'shows nested strategy schema mismatch in Companion',
    )
    && namedPlaywrightProof('explicit Team negative-benefit cost warning renders through real Gateway on all strategy surfaces')
    && namedCommandProof(
      'backend-tui-mfg',
      'shared_projection_renders_decision_proof_outcome_and_backlinks',
      'matching_runtime_backlink_reuses_the_shared_strategy_projection_summary',
      'execution_projection_stream_generation_rejects_zombie_and_replayed_events',
    )
  ),
  'STR-10': () => namedCommandProof(
    'backend-test',
    'routes_simple_question_to_direct',
    'routes_parallel_research_to_explore_with_parallel_modifier',
    'routes_multi_agent_request_to_collaborate',
    'routes_bounded_write_to_execute_with_bounded_modifier',
  ),
  'STR-11': () => (
    namedVitestProof(
      'rejects a nested strategy schema mismatch',
      'keeps malicious legacy detail out of the real GraphSurface evidence inspector',
      'clears authorized full projection data when a later read is forbidden',
      'fails closed when Gateway revokes an already-open projection stream',
    )
    && namedCommandProof(
      'backend-test',
      'strategy_scope_projection_drops_paths_prompts_and_hidden_reasoning',
      'projection_scope_never_leaks_other_session_goals',
      'execution_read_scope_does_not_inherit_graph_resource_grants',
      'execution_commands_require_interactive_control_capability',
      'foreign_owner_is_rejected_before_runtime_or_lifecycle_activation',
    )
    && namedCommandProof(
      'backend-tui-mfg',
      'agents_are_linked_only_by_the_selected_team_execution_graph',
      'coincident_mfg_execution_id_never_selects_a_runtime_strategy',
    )
  ),
};

const artifactGroups = {
  visual: [visualPath, commands['visual-audit']?.log_path],
  vitest: [vitestPath, commands['frontend-vitest']?.log_path],
  playwright: [playwrightPath, commands.playwright?.log_path],
  performance: [performancePath, commands['performance-acceptance']?.log_path],
  mfg: [mfgPath, commands['matrix-mfg']?.log_path, commands['backend-app-mfg']?.log_path, commands['backend-gateway-mfg']?.log_path],
  backend: [commands['backend-check']?.log_path, commands['backend-clippy']?.log_path, commands['backend-test']?.log_path],
  contract: [commands['backend-app-mfg-contract']?.log_path, commands['backend-auth-broker']?.log_path],
  tuiMfg: [commands['backend-tui-mfg']?.log_path, commands['scenario-tui-smoke']?.log_path],
  strategy: [commands['backend-harness-strategy']?.log_path, commands['scenario-auto-strategy']?.log_path],
  authProfile: [commands['scenario-auth-profile']?.log_path],
  mfgSurfaces: [commands['scenario-mfg-surfaces']?.log_path],
  version: [commands['backend-version-gate']?.log_path, commands['edge-version-gate']?.log_path],
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
  backend: ['backend-check', 'backend-clippy', 'backend-test'],
  contract: ['backend-app-mfg-contract', 'backend-auth-broker'],
  tuiMfg: ['backend-tui-mfg', 'scenario-tui-smoke'],
  strategy: ['backend-harness-strategy', 'scenario-auto-strategy'],
  authProfile: ['scenario-auth-profile'],
  mfgSurfaces: ['scenario-mfg-surfaces'],
  version: ['backend-version-gate', 'edge-version-gate'],
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
  'STR-01': ['integration-local', ['strategy'], ['frozen simple/single-file corpus selects Direct']],
  'STR-02': ['integration-local', ['strategy'], ['frozen independent read batches select ParallelTools']],
  'STR-03': ['integration-local', ['strategy'], ['independent responsibility scopes select Team only when net benefit is positive']],
  'STR-04': ['integration-local', ['strategy'], ['measured overlap rejects or downgrades Team without hiding the reason']],
  'STR-05': ['integration-local', ['strategy'], ['provider resource constraints publish a monotonic downgrade and retained evidence scope']],
  'STR-06': ['integration-local', ['strategy'], ['low novelty publishes a bounded early-stop transition']],
  'STR-07': ['browser-real-gateway', ['strategy', 'playwright', 'gatewayWebui'], ['explicit Team execution renders its calibrated or assumed cost warning through a real Gateway']],
  'STR-08': ['performance', ['strategy', 'performance'], ['frozen paired real-model report satisfies registered speed, quality and cost thresholds']],
  'STR-09': ['cross-surface', ['strategy', 'vitest', 'backend', 'tuiMfg', 'tui'], ['the identical strategy fixture produces the same selected candidate and observed outcome in WebUI and TUI']],
  'STR-10': ['integration-local', ['strategy', 'backend'], ['the four registered V506 strategy scenarios remain passing']],
  'STR-11': ['cross-surface', ['strategy', 'vitest', 'backend', 'tuiMfg', 'tui'], ['projection and both surfaces exclude paths, hidden content, prompts and internal reasoning']],
};

const plannedProofClasses = {
  MC: ['integration-local', ['contract', 'mfg', 'version'], 'MFG contract, capability, error and recrop proof'],
  MR: ['browser-real-gateway', ['contract', 'mfg', 'playwright', 'mfgSurfaces'], 'manual review, effect, idempotency and recovery proof'],
  TUI: ['cross-surface', ['tuiMfg', 'mfgSurfaces'], 'real PTY MFG size, keyboard, action and capability proof'],
  MUX: ['browser-controlled', ['visual', 'playwright', 'performance'], 'MFG responsive, focus and partial-degraded proof'],
  MLIVE: ['cross-surface', ['mfgSurfaces', 'performance', 'tuiMfg'], 'MFG epoch, multi-observer, resync and hidden-scope proof'],
};
const plannedProofCounts = { MC: 6, MR: 8, TUI: 8, MUX: 8, MLIVE: 9 };
for (const [prefix, count] of Object.entries(plannedProofCounts)) {
  const [level, groups, check] = plannedProofClasses[prefix];
  for (let index = 1; index <= count; index += 1) {
    const id = `${prefix}-${String(index).padStart(2, '0')}`;
    proofMap[id] = [level, groups, [`${check}: ${id}`]];
  }
}

const now = new Date().toISOString();
const results = [];
for (const entry of manifest.entries || []) {
  const proof = proofMap[entry.id];
  if (!proof) {
    failures.push(`acceptance proof mapping is missing: ${entry.id}`);
    continue;
  }
  const [level, groups, checks] = proof;
  let resultArtifacts;
  let execution;
  let resultChecks = checks;
  if (entry.id.startsWith('MLIVE-')) {
    const scenarioCheck = mfgSurfaceIndex.checks?.[entry.id];
    const unitProof = mfgLiveUnitProof[entry.id];
    if (!scenarioCheck && !unitProof) {
      failures.push(`${entry.id} has neither structured scenario proof nor named unit proof`);
      resultArtifacts = [];
      execution = commandEvidence('mfgSurfaces');
    } else if (scenarioCheck) {
      if (scenarioCheck.status !== 'passed'
        || typeof scenarioCheck.assertion !== 'string'
        || !Array.isArray(scenarioCheck.evidence)
        || !scenarioCheck.evidence.length) {
        failures.push(`${entry.id} structured scenario proof is incomplete`);
      }
      if (!mfgSurfaceSemanticProof[entry.id]?.()) {
        failures.push(`${entry.id} structured evidence does not satisfy its semantic proof`);
      }
      const scenarioArtifacts = (scenarioCheck.evidence || []).map((file) => {
        const artifact = path.resolve(mfgSurfaceArtifactDir, file);
        if (!artifact.startsWith(`${mfgSurfaceArtifactDir}${path.sep}`)) {
          failures.push(`${entry.id} evidence escapes the scenario artifact directory: ${file}`);
        }
        return requireFile(artifact, `${entry.id} structured scenario evidence`);
      });
      resultArtifacts = [...new Set([
        ...scenarioArtifacts,
        commands['scenario-mfg-surfaces']?.log_path,
      ].filter(Boolean))];
      execution = commandEvidence('mfgSurfaces');
      resultChecks = [scenarioCheck.assertion];
    } else {
      resultArtifacts = [...new Set(unitProof.artifacts.filter(Boolean))];
      execution = commandEvidence('vitest', 'tuiMfg');
      resultChecks = unitProof.checks;
    }
    if (entry.id === 'MLIVE-09') {
      if (mfgHiddenHeartbeatLog) resultArtifacts.push(mfgHiddenHeartbeatLog);
    }
  } else if (entry.id.startsWith('STR-')) {
    const semanticProof = strategySemanticProof[entry.id];
    if (!semanticProof || !semanticProof()) {
      failures.push(`${entry.id} structured semantic proof is absent or false`);
    }
    if (['STR-01', 'STR-02', 'STR-03'].includes(entry.id)) {
      const candidate = entry.id === 'STR-01'
        ? 'direct'
        : entry.id === 'STR-02'
          ? 'parallel_tools'
          : 'team';
      const routing = automaticRoutingEvidence(candidate);
      resultChecks = [
        ...checks,
        `frozen task ids=${routing.expectedTaskIds.join(',')}; auto samples=${routing.sampleCount}; mismatches=${routing.mismatches.length}; paired repetitions>=3=${routing.perTaskPairs}`,
      ];
    }
    const allGroups = [...groups, 'build', 'openapi', 'global'];
    resultArtifacts = [...new Set([
      ...artifacts(...allGroups),
      autoStrategyPointerPath,
      autoStrategyReportPath,
    ].filter(Boolean))];
    execution = commandEvidence(...allGroups);
    resultChecks = [
      ...checks,
      `${entry.id} semantic predicate passed against named tests and structured paired report`,
    ];
  } else {
    const allGroups = [...groups, 'build', 'openapi', 'global'];
    resultArtifacts = artifacts(...allGroups);
    execution = commandEvidence(...allGroups);
  }
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
    checks: resultChecks,
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
