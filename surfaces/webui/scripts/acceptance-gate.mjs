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

function range(prefix, start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}-${String(start + index).padStart(2, '0')}`);
}

const acceptanceClassifications = {
  UX: 6,
  LIVE: 7,
  G: 14,
  E: 6,
  M: 18,
  MC: 6,
  MR: 8,
  TUI: 8,
  MUX: 8,
  MLIVE: 9,
  STR: 11,
  S: 8,
  P: 8,
};
const expectedIds = Object.entries(acceptanceClassifications)
  .flatMap(([prefix, end]) => range(prefix, 1, end));
const allowedLevels = new Set(manifest.allowed_levels || []);
const failures = [];
const ids = new Set();

if (manifest.schema_version !== 2) failures.push('acceptance manifest schema_version must be 2');
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

const requiredSource = [
  ['frontend', 'surfaces/webui/src/App.vue', 'useCapabilitySection'],
  ['frontend', 'surfaces/webui/src/stores/projectionRegistry.ts', 'MAX_ACTIVE_PROJECTION_STREAMS'],
  ['frontend', 'surfaces/webui/src/stores/chatSessions.ts', 'MAX_ACTIVE_SESSION_STREAMS'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue', 'graphIsAggregated'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue', 'exportGraph'],
  ['frontend', 'surfaces/webui/src/components/evidence/EvidenceInspector.vue', 'evidenceDisplayState'],
  ['frontend', 'surfaces/webui/src/composables/useGraphQueryState.ts', 'cursor'],
  ['app-webui', 'components/mfg/MfgCockpitWorkspace.vue', 'beginDirectManipulation'],
  ['app-webui', 'components/mfg/MfgCockpitWorkspace.vue', 'saveAsCopy'],
  ['app-webui', 'stores/mfgCockpit.ts', 'refreshWidget'],
  ['app-webui', 'stores/mfgCockpit.ts', 'cancelWidgetRefresh'],
  ['app-webui', 'stores/mfgCockpit.ts', 'activeProjectionFilters'],
  ['app-webui', 'stores/mutationIntents.ts', 'retry_same_intent'],
  ['app-webui', 'components/mfg/RecoveryActions.vue', 'recovery_actions'],
  ['app-webui', 'components/mfg/MfgReportReviewDrawer.vue', 'mfgDecideReportReview'],
  ['app-webui', 'types/mfg.ts', 'MFG_GENERATED_CONTRACT_KIND'],
  ['app-webui', 'types/mfg.ts', 'MfgWireApiErrorV1'],
  ['app-webui', 'components/mfg/MfgFocusWorkspace.vue', 'conditionThreshold'],
  ['app-webui', 'components/mfg/MfgFocusWorkspace.vue', 'conditionWindowMinutes'],
  ['app-webui', 'components/mfg/MfgCollaborationWorkspace.vue', "command(assignment, 'unassign')"],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'validateSourcePack'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'planComputeJob'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'evaluateEvidenceQuality'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'recommendPlaybooks'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'recordExecutionFeedback'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'planAction'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'openIncidentFromReality'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'qualityDecision.required_actions'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'api.mfgReports'],
  ['app-webui', 'components/mfg/MfgDomainWorkspace.vue', 'reportDeliveryState.dead_lettered'],
  ['app-webui', 'MfgApp.vue', 'overflow: auto'],
  ['app-webui', 'adapters/graph/mfgDecisionTrace.ts', 'adaptMfgDecisionTrace'],
  ['frontend', 'surfaces/webui/src/components/workbench/DataTable.vue', 'pagedRows'],
  ['app-webui', 'api/mfgApi.ts', '/widgets/${encodeURIComponent(instanceId)}/projection'],
  ['app-webui', 'api/mfgApi.ts', 'withoutServerActor'],
  ['app', 'crates/app-mfg-contract/src/route.rs', '/api/apps/mfg/cockpit/profiles/:id/widgets/:instance_id/projection'],
  ['app', 'crates/app-mfg-adapter/src/lib.rs', '"revision_conflict"'],
  ['app', 'crates/app-mfg-core/src/cockpit.rs', 'mfg.cockpit.filters.widget_overrides.v1'],
  ['app', 'crates/app-mfg-core/src/cockpit.rs', 'retry_attempt_count'],
  ['app', 'crates/app-mfg-core/src/cockpit.rs', 'delivery_dead_lettered'],
  ['app', 'crates/app-mfg-core/src/repository.rs', 'effective_cockpit_profile'],
  ['app', 'crates/app-mfg-core/src/repository.rs', 'attention_matches_alert_condition'],
  ['app', 'crates/app-mfg-core/src/repository.rs', 'window_minutes'],
  ['app', 'crates/app-mfg-core/src/repository.rs', 'cockpit_projection_with_filters'],
  ['app', 'crates/app-mfg-core/src/repository.rs', 'legacy_four_widget_profile_migrates_losslessly_without_dual_write'],
  ['app', 'crates/app-mfg-contract/src/route.rs', '/api/apps/mfg/cockpit/reports'],
  ['app', 'crates/app-mfg-adapter/src/lib.rs', 'MfgActionExecutionIntent'],
  ['app', 'crates/app-mfg-adapter/src/lib.rs', 'cockpit_report_accessible_to'],
];

for (const [repository, file, needle] of requiredSource) {
  if (!repositorySource(repository, file).includes(needle)) failures.push(`required source wiring missing ${repository}:${file}:${needle}`);
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

const coreTodoFiles = [
  ['app-webui', 'components/mfg/MfgCockpitWorkspace.vue'],
  ['app-webui', 'stores/mfgCockpit.ts'],
  ['frontend', 'surfaces/webui/src/components/graph/GraphSurface.vue'],
  ['frontend', 'surfaces/webui/src/stores/projectionRegistry.ts'],
  ['frontend', 'surfaces/webui/src/stores/chatSessions.ts'],
];
for (const [repository, file] of coreTodoFiles) {
  const matches = repositorySource(repository, file).match(/\b(?:TODO|FIXME|HACK)\b[^\n]*/g) || [];
  for (const match of matches) failures.push(`unclassified core TODO in ${repository}:${file}: ${match}`);
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
