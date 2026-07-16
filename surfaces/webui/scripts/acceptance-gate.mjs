#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { evidenceContext, manifestPath, writeJsonReport } from './evidence-context.mjs';

const final = process.argv.includes('--final');
const gate = process.argv.includes('--gate') || final;
const context = evidenceContext('acceptance-gate', { final });
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function range(prefix, start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}-${String(start + index).padStart(2, '0')}`);
}

const expectedIds = [
  ...range('UX', 1, 6),
  ...range('LIVE', 1, 7),
  ...range('G', 1, 14),
  ...range('E', 1, 6),
  ...range('M', 1, 18),
  ...range('S', 1, 8),
  ...range('P', 1, 8),
];
const allowedLevels = new Set(manifest.allowed_levels || []);
const failures = [];
const ids = new Set();

if (manifest.schema_version !== 1) failures.push('acceptance manifest schema_version must be 1');
for (const entry of manifest.entries || []) {
  if (!entry.id || ids.has(entry.id)) failures.push(`duplicate or missing acceptance id: ${entry.id || '<missing>'}`);
  ids.add(entry.id);
  if (!entry.requirement || !entry.owner || !entry.min_evidence || !Array.isArray(entry.evidence) || !entry.evidence.length) {
    failures.push(`${entry.id || '<missing>'} lacks requirement, owner, min_evidence, or evidence owner`);
  }
  if (!allowedLevels.has(entry.min_evidence)) failures.push(`${entry.id} uses unknown min evidence ${entry.min_evidence}`);
}
for (const id of expectedIds) if (!ids.has(id)) failures.push(`mandatory acceptance id is missing: ${id}`);
for (const id of ids) if (!expectedIds.includes(id)) failures.push(`unexpected acceptance id is not classified: ${id}`);

function source(root, relative) {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const requiredSource = [
  ['frontend', 'surfaces/webui/src/App.vue', 'useCapabilitySection'],
  ['frontend', 'surfaces/webui/src/stores/projectionRegistry.ts', 'MAX_ACTIVE_PROJECTION_STREAMS'],
  ['frontend', 'surfaces/webui/src/stores/chatSessions.ts', 'MAX_ACTIVE_SESSION_STREAMS'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue', 'graphIsAggregated'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue', 'exportGraph'],
  ['frontend', 'surfaces/webui/src/components/evidence/EvidenceInspector.vue', 'evidenceDisplayState'],
  ['frontend', 'surfaces/webui/src/composables/useGraphQueryState.ts', 'cursor'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgCockpitWorkspace.vue', 'beginDirectManipulation'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgCockpitWorkspace.vue', 'saveAsCopy'],
  ['frontend', 'surfaces/webui/src/stores/mfgCockpit.ts', 'refreshWidget'],
  ['frontend', 'surfaces/webui/src/stores/mfgCockpit.ts', 'cancelWidgetRefresh'],
  ['frontend', 'surfaces/webui/src/stores/mfgCockpit.ts', 'activeProjectionFilters'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgFocusWorkspace.vue', 'conditionThreshold'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgFocusWorkspace.vue', 'conditionWindowMinutes'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgCollaborationWorkspace.vue', "command(assignment, 'unassign')"],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'validateSourcePack'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'planComputeJob'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'evaluateEvidenceQuality'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'recommendPlaybooks'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'recordExecutionFeedback'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'planAction'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'openIncidentFromReality'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'qualityDecision.required_actions'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'api.mfgReports'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', 'reportDeliveryState.dead_lettered'],
  ['frontend', 'surfaces/webui/src/pages/MfgPage.vue', 'overflow: auto'],
  ['frontend', 'surfaces/webui/src/adapters/graph/mfgDecisionTrace.ts', 'adaptMfgDecisionTrace'],
  ['frontend', 'surfaces/webui/src/components/workbench/DataTable.vue', 'pagedRows'],
  ['frontend', 'surfaces/webui/src/api/client.ts', '/widgets/${encodeURIComponent(instanceId)}/projection'],
  ['frontend', 'surfaces/webui/src/api/client.ts', 'withoutServerActor'],
  ['backend', 'crates/gateway/src/api_routes/mfg_routes.rs', '/api/apps/mfg/cockpit/profiles/:id/widgets/:instance_id/projection'],
  ['backend', 'crates/gateway/src/api_routes/mfg_routes/cockpit.rs', 'mfg_revision_conflict'],
  ['backend', 'crates/app-mfg/src/cockpit.rs', 'mfg.cockpit.filters.widget_overrides.v1'],
  ['backend', 'crates/app-mfg/src/cockpit.rs', 'retry_attempt_count'],
  ['backend', 'crates/app-mfg/src/cockpit.rs', 'delivery_dead_lettered'],
  ['backend', 'crates/app-mfg/src/repository.rs', 'effective_cockpit_profile'],
  ['backend', 'crates/app-mfg/src/repository.rs', 'attention_matches_alert_condition'],
  ['backend', 'crates/app-mfg/src/repository.rs', 'window_minutes'],
  ['backend', 'crates/app-mfg/src/repository.rs', 'cockpit_projection_with_filters'],
  ['backend', 'crates/app-mfg/src/repository.rs', 'legacy_four_widget_profile_migrates_losslessly_without_dual_write'],
  ['backend', 'crates/gateway/src/api_routes/mfg_routes.rs', '/api/apps/mfg/cockpit/reports'],
  ['backend', 'crates/gateway/src/api_routes/mfg_routes.rs', 'MfgActionExecutionIntent'],
  ['backend', 'crates/gateway/src/api_routes/mfg_routes/cockpit.rs', 'cockpit_report_accessible_to'],
];

for (const [repository, file, needle] of requiredSource) {
  const root = repository === 'frontend' ? context.frontend.root : context.backend.root;
  if (!source(root, file).includes(needle)) failures.push(`required source wiring missing ${repository}:${file}:${needle}`);
}

const forbiddenSource = [
  ['frontend', 'surfaces/webui/src/App.vue', /syncSectionVisibility|querySelectorAll\([^)]*data-section|\.hidden\s*=/, 'imperative section visibility'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue', /\.slice\(0,\s*220\)/, 'first-220 graph truncation'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue', /internal_reasoning|chain_of_thought/i, 'sensitive graph export field'],
  ['backend', 'crates/gateway/src/api_routes/mfg_routes/cockpit.rs', /"team"\s*\|\s*"public"/, 'team widened to public visibility'],
  ['backend', 'crates/app-mfg/src/cockpit.rs', /query_schema:[^\n]*additionalProperties"\s*:\s*true/, 'open cockpit query schema'],
  ['backend', 'crates/app-mfg/src/repository.rs', /build_cockpit_projection/, 'legacy cockpit projection dual truth'],
  ['frontend', 'surfaces/webui/src/components/mfg/MfgDomainWorkspace.vue', /operator_id\s*:|actor_principal\s*:/, 'client supplied MFG effect actor'],
  ['frontend', 'surfaces/webui/src/pages/GatewayPage.vue', /actor_principal\s*:/, 'client supplied Gateway effect actor'],
  ['frontend', 'surfaces/webui/src/pages/ToolsPage.vue', /actor_principal\s*:/, 'client supplied Tools effect actor'],
];

for (const [repository, file, pattern, label] of forbiddenSource) {
  const root = repository === 'frontend' ? context.frontend.root : context.backend.root;
  if (pattern.test(source(root, file))) failures.push(`forbidden source returned: ${label} in ${repository}:${file}`);
}

const coreTodoFiles = [
  'surfaces/webui/src/components/mfg/MfgCockpitWorkspace.vue',
  'surfaces/webui/src/stores/mfgCockpit.ts',
  'surfaces/webui/src/components/graph/GraphSurface.vue',
  'surfaces/webui/src/stores/projectionRegistry.ts',
  'surfaces/webui/src/stores/chatSessions.ts',
];
for (const file of coreTodoFiles) {
  const matches = source(context.frontend.root, file).match(/\b(?:TODO|FIXME|HACK)\b[^\n]*/g) || [];
  for (const match of matches) failures.push(`unclassified core TODO in ${file}: ${match}`);
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
