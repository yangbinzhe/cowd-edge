<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import EvidenceObjectDetail from '../components/workbench/EvidenceObjectDetail.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import type { EvidenceObject } from '../types/evidence';
import { displayStatus } from '../i18n/domain/status';

const ChartPanel = defineAsyncComponent(() => import('../components/ChartPanel.vue'));
const loading = ref(false);
const error = ref('');
const state = ref<any>({});
const source = ref('all');
const limit = ref(50);
const offset = ref(0);
const releaseSurface = ref('webui');
const timelineSource = ref('all');
const timelineStatus = ref('all');
const timelineSession = ref('');
const timelineEvidence = ref('');
const timelineSurface = ref('');
const selectedDetail = ref<Record<string, unknown> | null>(null);
const evalReportDetail = ref<any>(null);
const evalActionResult = ref<any>(null);
const evalLevel = ref<'quick' | 'full' | 'deep-real'>('quick');
const evalProvider = ref('');
const evalBudget = ref('low');
const evalAllowRealModel = ref(false);
const evolutionActionResult = ref<any>(null);
const evolutionDraft = ref<any>(null);
const selectedEvolutionProposalId = ref('');
const selectedEvolutionCandidateId = ref('');
const selectedEvolutionReviewId = ref('');
const selectedEvaluationPolicyReviewId = ref('');
const reviewReason = ref('');

function items(collection: any, key: string) {
  return Array.isArray(collection?.[key]) ? collection[key] : Array.isArray(collection) ? collection : [];
}

const auditRecords = computed(() => items(state.value.audit, 'records'));
const approvalHistory = computed(() => items(state.value.approvalHistory, 'history'));
const crossPlaneRecords = computed(() => items(state.value.crossPlaneAudit, 'records'));
const executions = computed(() => items(state.value.executions, 'executions'));
const releaseChecks = computed(() => items(state.value.releaseGate, 'checks'));
const harnessEvalReports = computed(() => items(state.value.harnessEvalReports, 'reports'));
const harnessEvalRuns = computed(() => items(state.value.harnessEvalRuns, 'runs'));
const harnessEvalScenarios = computed(() => items(state.value.harnessEvalScenarios, 'scenarios'));
const evolutionSignals = computed(() => items(state.value.evolutionSignals, 'signals'));
const evolutionDiagnoses = computed(() => items(state.value.evolutionDiagnoses, 'diagnoses'));
const evolutionMissions = computed(() => items(state.value.evolutionMissions, 'missions'));
const evolutionProposals = computed(() => items(state.value.evolutionProposals, 'proposals'));
const evolutionCandidates = computed(() => items(state.value.evolutionCandidates, 'candidates'));
const evolutionReviews = computed(() => items(state.value.evolutionReviews, 'reviews'));
const evaluationPolicy = computed(() => state.value.evaluationPolicy || {});
const evaluationPolicyReviews = computed(() => items(state.value.evaluationPolicyReviews, 'reviews'));
const auditRows = computed(() => auditRecords.value.slice(0, 18).map((record: any) => ({
  source: record.source || '-',
  id: record.id || '-',
  summary: record.summary || '-',
  timestamp: record.timestamp || '-',
})));
const approvalRows = computed(() => approvalHistory.value.slice(0, 12).map((item: any) => ({
  id: item.id,
  command: item.command || item.summary || '-',
  decision: item.decision || item.status || '-',
  resolved: item.resolved_at || '-',
})));
const crossPlaneRows = computed(() => crossPlaneRecords.value.slice(0, 12).map((record: any) => ({
  id: record.id,
  result: record.result || record.status || '-',
  capability: record.capability || record.requested_capability || '-',
  summary: record.summary || '-',
})));
const executionRows = computed(() => executions.value.slice(0, 12).map((execution: any) => ({
  id: execution.execution_id || execution.id,
  status: execution.status,
  dispatch: execution.dispatch_status,
  mode: execution.mode,
})));
const globalTimelineRows = computed(() => {
  const rows = [
    ...auditRecords.value.map((record: any) => ({
      source: record.source || 'audit',
      session: record.session_id || record.session || '-',
      agent: record.agent_id || record.agent || '-',
      tool: record.tool || record.command || '-',
      evidence: record.evidence_ref || record.evidence || record.id || '-',
      approval: record.approval_id || '-',
      surface: record.surface_id || record.surface || '-',
      status: record.status || record.result || 'recorded',
      timestamp: record.timestamp || record.created_at || '-',
      summary: record.summary || record.message || record.id || '-',
      raw: record,
    })),
    ...approvalHistory.value.map((item: any) => ({
      source: 'approval',
      session: item.session_id || '-',
      agent: item.agent_id || '-',
      tool: item.tool || item.command || '-',
      evidence: item.evidence_ref || item.id || '-',
      approval: item.id || item.approval_id || '-',
      surface: item.surface_id || '-',
      status: item.decision || item.status || 'recorded',
      timestamp: item.resolved_at || item.created_at || '-',
      summary: item.summary || item.command || item.reason || '-',
      raw: item,
    })),
    ...crossPlaneRecords.value.map((record: any) => ({
      source: 'cross-plane',
      session: record.session_id || '-',
      agent: record.agent_id || '-',
      tool: record.capability || record.requested_capability || '-',
      evidence: record.evidence_ref || record.id || '-',
      approval: record.approval_id || '-',
      surface: record.source_channel || record.surface_id || '-',
      status: record.result || record.status || 'recorded',
      timestamp: record.timestamp || record.created_at || '-',
      summary: record.summary || record.capability || record.requested_capability || '-',
      raw: record,
    })),
    ...executions.value.map((execution: any) => ({
      source: 'execution',
      session: execution.session_id || '-',
      agent: execution.agent_id || '-',
      tool: execution.capability || execution.requested_capability || '-',
      evidence: execution.execution_id || execution.id || '-',
      approval: execution.approval_id || '-',
      surface: execution.dispatch_target || execution.source_channel || '-',
      status: execution.status || execution.dispatch_status || '-',
      timestamp: execution.created_at || execution.timestamp || '-',
      summary: execution.summary || execution.mode || '-',
      raw: execution,
    })),
  ];
  return rows
    .filter((row) => timelineSource.value === 'all' || row.source === timelineSource.value)
    .filter((row) => timelineStatus.value === 'all' || String(row.status).toLowerCase() === timelineStatus.value.toLowerCase())
    .filter((row) => !timelineSession.value.trim() || String(row.session).includes(timelineSession.value.trim()))
    .filter((row) => !timelineEvidence.value.trim() || String(row.evidence).includes(timelineEvidence.value.trim()))
    .filter((row) => !timelineSurface.value.trim() || String(row.surface).includes(timelineSurface.value.trim()))
    .slice(0, 120);
});
const selectedEvidence = computed<EvidenceObject | null>(() => {
  const row: any = selectedDetail.value;
  if (!row) return null;
  return {
    ref: String(row.evidence || row.id || row.execution_id || row.approval || row.source || 'audit'),
    kind: row.source || row.kind || 'audit.record',
    source: row.source || 'audit',
    status: row.status || row.result || row.decision || 'recorded',
    summary: row.summary || row.command || row.capability || row.id || '-',
    session_id: row.session !== '-' ? row.session : row.session_id,
    turn_id: row.turn_id,
    audit_ref: row.approval !== '-' ? row.approval : row.approval_id,
    route: '/audit',
    raw: row.raw || row,
  };
});
const releaseRows = computed(() => releaseChecks.value.slice(0, 12).map((check: any) => ({
  name: check.name || check.id || check.kind,
  status: check.status || (check.passed ? 'pass' : 'review'),
  detail: check.detail || check.summary || '-',
})));
const harnessEvalRows = computed(() => harnessEvalReports.value.slice(0, 12).map((report: any) => ({
  id: report.id,
  level: report.level,
  status: report.status,
  tokens: report.total_tokens || 0,
  rounds: report.provider_rounds || 0,
  tools: report.tool_calls || 0,
  scenarios: report.scenario_count || 0,
  elapsed_ms: report.total_elapsed_ms || 0,
})));
const harnessEvalRunRows = computed(() => harnessEvalRuns.value.slice(0, 8).map((run: any) => ({
  id: run.run_id,
  level: run.level,
  status: run.status,
  tokens: run.total_tokens || 0,
  rounds: run.provider_rounds || 0,
  tools: run.tool_calls || 0,
  report: run.report_id || '-',
  finished: run.finished_at_ms ? 'yes' : 'no',
  message: run.message || '-',
})));
const cancellableHarnessEvalRuns = computed(() => harnessEvalRunRows.value.filter((run) => (
  ['queued', 'running', 'cancel_requested'].includes(String(run.status))
)));
const harnessEvalScenarioRows = computed(() => harnessEvalScenarios.value.slice(0, 8).map((scenario: any) => ({
  id: scenario.id,
  kind: scenario.kind,
  fake: scenario.fake_provider_gate ? 'yes' : 'no',
  real: scenario.real_provider_gate ? 'yes' : 'no',
  evidence: Array.isArray(scenario.required_evidence) ? scenario.required_evidence.join(', ') : '-',
})));
const evolutionSignalRows = computed(() => evolutionSignals.value.slice(0, 10).map((signal: any) => ({
  id: signal.signal_id,
  type: signal.signal_type,
  severity: signal.severity,
  owner: signal.source?.owner || '-',
  continue: signal.immediate_task_can_continue ? 'yes' : 'no',
  summary: signal.summary,
})));
const evolutionDiagnosisRows = computed(() => evolutionDiagnoses.value.slice(0, 10).map((diagnosis: any) => ({
  id: diagnosis.diagnosis_id,
  cause: diagnosis.root_cause_kind,
  owner: diagnosis.affected_owner,
  recurrence: diagnosis.recurrence,
  candidate: diagnosis.recommended_candidate_kind,
  gates: Array.isArray(diagnosis.acceptance_gates) ? diagnosis.acceptance_gates.length : 0,
  impact: diagnosis.impact,
})));
const evolutionMissionRows = computed(() => evolutionMissions.value.slice(0, 10).map((mission: any) => ({
  id: mission.mission_id,
  status: mission.status,
  owner: mission.owner,
  goals: Array.isArray(mission.goal_ids) ? mission.goal_ids.join(', ') : '-',
  signals: mission.signal_count ?? 0,
  proposals: mission.proposal_count ?? 0,
  candidates: mission.candidate_count ?? 0,
})));
const evolutionProposalRows = computed(() => evolutionProposals.value.slice(0, 10).map((proposal: any) => ({
  id: proposal.proposal_id,
  kind: proposal.kind,
  diagnosis: proposal.diagnosis_id || '-',
  owner: proposal.target_owner || '-',
  status: proposal.status,
  risk: proposal.risk?.level || '-',
  approval: proposal.risk?.approval_required ? 'yes' : 'no',
  benefit: proposal.expected_benefit,
})));
const evolutionCandidateRows = computed(() => evolutionCandidates.value.slice(0, 10).map((candidate: any) => ({
  id: candidate.candidate_id,
  subject: candidate.subject?.kind === 'agent_definition'
    ? `${candidate.subject?.revision_ref?.definition_id || '-'}@${candidate.subject?.revision_ref?.revision || '-'}`
    : `${candidate.subject?.revision_ref?.template_id || '-'}@${candidate.subject?.revision_ref?.revision || '-'}`,
  lifecycle: candidate.lifecycle,
  baseline: candidate.baseline_revision,
  contract: candidate.evaluation_contract_digest,
  report: candidate.comparison_report_ref || '-',
  canary: candidate.canary_review_ref || '-',
  stable: candidate.stable_review_ref || '-',
})));
const selectedEvolutionProposal = computed(() => evolutionProposalRows.value.find((row: any) => row.id === selectedEvolutionProposalId.value) || null);
const selectedEvolutionCandidate = computed(() => evolutionCandidateRows.value.find((row: any) => row.id === selectedEvolutionCandidateId.value) || null);
const evolutionReviewRows = computed(() => evolutionReviews.value.slice(0, 12).map((review: any) => ({
  id: review.review_id,
  class: review.class,
  action: review.action,
  status: review.status,
  candidate: review.candidate_id || '-',
  approval: review.approval_id,
  observation: review.observation_report_ref || '-',
})));
const selectedEvolutionReview = computed(() => evolutionReviewRows.value.find((row: any) => row.id === selectedEvolutionReviewId.value) || null);
const evaluationPolicyReviewRows = computed(() => evaluationPolicyReviews.value.slice(0, 12).map((review: any) => ({
  id: review.review_id,
  status: review.status,
  policy: review.proposed_policy?.policy_id || '-',
  revision: review.proposed_policy?.revision ?? '-',
  approval: review.approval_id || '-',
  reason: review.reason || '-',
})));
const selectedEvaluationPolicyReview = computed(() => evaluationPolicyReviewRows.value.find((row: any) => row.id === selectedEvaluationPolicyReviewId.value) || null);
const evolutionDraftSummary = computed(() => {
  if (!evolutionDraft.value || typeof evolutionDraft.value !== 'object') return null;
  const draft = evolutionDraft.value as Record<string, any>;
  return {
    proposal: draft.proposal_id || draft.id || '-',
    status: draft.status || '-',
    skill: draft.skill_ref || draft.skill_id || '-',
    version: draft.version || draft.revision || '-',
    evidence: Array.isArray(draft.evidence_refs) ? draft.evidence_refs.length : 0,
  };
});
const usageChart = computed(() => {
  const byPlatform = state.value.usage?.by_platform || {};
  const points = Object.entries(byPlatform).map(([name, value]: [string, any]) => ({
    name,
    value: Number(value.total_tokens || value.message_count || value.session_count || 0),
  }));
  const total = Number(state.value.usage?.tokens?.total || 0);
  return points.length ? points : total > 0 ? [{ name: 'usage', value: total }] : [];
});
const releaseChart = computed(() => releaseRows.value.length
  ? releaseRows.value.map((check) => ({ name: check.name || 'check', value: check.status === 'pass' ? 100 : 25 }))
  : []);
const auditContext = computed(() => [
  { label: t('script.pages.auditpage.label.e11faea4e5'), value: auditRecords.value.length },
  { label: t('script.pages.auditpage.label.deb9d03cf0'), value: approvalHistory.value.length },
  { label: t('script.pages.auditpage.label.392e6000a4'), value: crossPlaneRecords.value.length },
  { label: t('script.pages.auditpage.label.1a211031f5'), value: harnessEvalReports.value.length, tone: harnessEvalReports.value.length ? 'success' : 'default' },
  { label: t('script.pages.auditpage.label.018514a3d5'), value: globalTimelineRows.value.length },
  { label: t('script.pages.auditpage.label.db65a642a7'), value: releaseChecks.value.length, tone: releaseChecks.value.length ? 'warn' : 'default' },
]);
const auditWorkflow = computed(() => [
  { id: 'logs', label: t('script.pages.auditpage.label.f3e4fadb9e'), status: auditRows.value.length ? 'ready' : 'idle', count: auditRows.value.length },
  { id: 'usage', label: t('script.pages.auditpage.label.0bb18642b7'), status: usageChart.value.length ? 'ready' : 'idle', count: usageChart.value.length },
  { id: 'release', label: t('script.pages.auditpage.label.d41f56cea1'), status: releaseRows.value.some((row) => row.status !== 'pass') ? 'blocked' : 'ready', count: releaseRows.value.length },
  { id: 'approvals', label: t('script.pages.auditpage.label.8cc047ac17'), status: approvalRows.value.length ? 'ready' : 'idle', count: approvalRows.value.length },
  { id: 'cross-plane', label: t('script.pages.auditpage.label.392e6000a4'), status: crossPlaneRows.value.length ? 'ready' : 'idle', count: crossPlaneRows.value.length },
  { id: 'harness-eval', label: t('script.pages.auditpage.label.1a211031f5'), status: state.value.harnessEvalLatest?.report?.status || 'idle', count: harnessEvalReports.value.length },
  { id: 'evolution', label: t('page.audit.evolution.title'), status: evolutionProposals.value.length ? 'ready' : 'idle', count: evolutionSignals.value.length },
  { id: 'global-timeline', label: t('script.pages.auditpage.label.018514a3d5'), status: globalTimelineRows.value.length ? 'ready' : 'idle', count: globalTimelineRows.value.length },
]);
const auditEvidence = computed(() => [
  ...auditRows.value.slice(0, 3).map((row) => ({
    id: String(row.id || ''),
    kind: `audit:${row.source || 'record'}`,
    status: 'recorded',
    summary: String(row.summary || row.id || '-'),
    source: 'gateway.audit',
  })),
  ...approvalRows.value.slice(0, 2).map((row) => ({
    id: String(row.id || ''),
    kind: 'approval',
    status: String(row.decision || 'recorded'),
    summary: String(row.command || row.id || '-'),
    source: 'gateway.approval',
  })),
  ...crossPlaneRows.value.slice(0, 2).map((row) => ({
    id: String(row.id || ''),
    kind: 'cross-plane',
    status: String(row.result || 'recorded'),
    summary: String(row.summary || row.capability || '-'),
    source: 'gateway.cross-plane',
  })),
]);
const evalReport = computed(() => evalReportDetail.value?.detail?.report || evalReportDetail.value?.report || null);
const evalReportSummary = computed(() => evalReportDetail.value?.detail?.summary || evalReportDetail.value?.summary || null);
const evalReportGateItems = computed(() => items(evalReport.value?.report_gate, 'items'));
const evalArtifacts = computed(() => items(evalReportDetail.value?.detail, 'artifacts'));
const evalArtifactRows = computed(() => evalArtifacts.value.map((path: string, index: number) => ({ index, path })));
const evalProviderRounds = computed(() => items(evalReport.value?.execution_trace, 'rounds'));
const evalRunModes = computed(() => [
  { id: 'quick', label: t('page.audit.harnessEval.mode.quick'), detail: t('page.audit.harnessEval.mode.quickDetail') },
  { id: 'full', label: t('page.audit.harnessEval.mode.full'), detail: t('page.audit.harnessEval.mode.fullDetail') },
  { id: 'deep-real', label: t('page.audit.harnessEval.mode.deepReal'), detail: t('page.audit.harnessEval.mode.deepRealDetail') },
]);

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [
      audit,
      usage,
      capabilities,
      projection,
      surfaces,
      releaseGate,
      approvalHistoryData,
      crossPlaneAudit,
      executionsData,
      harnessEvalLatest,
      harnessEvalReportsData,
      harnessEvalRunsData,
      harnessEvalScenariosData,
      evolutionSignalsData,
      evolutionDiagnosesData,
      evolutionMissionsData,
      evolutionProposalsData,
      evolutionCandidatesData,
      evolutionReviewsData,
      evaluationPolicyData,
      evaluationPolicyReviewsData,
    ] = await Promise.all([
      api.auditExport(source.value, limit.value, offset.value),
      api.usageSummary(),
      api.cowdCapabilities(),
      api.cowdProjection(releaseSurface.value),
      api.cowdSurfaces(),
      api.cowdReleaseGate(),
      api.approvalHistory(),
      api.crossPlaneAudit(),
      api.crossPlaneExecutions(),
      api.harnessEvalLatestReport(),
      api.harnessEvalReports(),
      api.harnessEvalRuns(),
      api.harnessEvalScenarios(),
      api.evolutionSignals(),
      api.evolutionDiagnoses(),
      api.evolutionMissionsSummary(),
      api.evolutionProposals(),
      api.evolutionCandidates(),
      api.evolutionReviews(),
      api.evolutionEvaluationPolicy(),
      api.evolutionEvaluationPolicyReviews(),
    ]);
    state.value = {
      audit,
      usage,
      capabilities,
      projection,
      surfaces,
      releaseGate,
      approvalHistory: approvalHistoryData,
      crossPlaneAudit,
      executions: executionsData,
      harnessEvalLatest,
      harnessEvalReports: harnessEvalReportsData,
      harnessEvalRuns: harnessEvalRunsData,
      harnessEvalScenarios: harnessEvalScenariosData,
      evolutionSignals: evolutionSignalsData,
      evolutionDiagnoses: evolutionDiagnosesData,
      evolutionMissions: evolutionMissionsData,
      evolutionProposals: evolutionProposalsData,
      evolutionCandidates: evolutionCandidatesData,
      evolutionReviews: evolutionReviewsData,
      evaluationPolicy: evaluationPolicyData,
      evaluationPolicyReviews: evaluationPolicyReviewsData,
    };
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function runHarnessEvalSmoke() {
  evalLevel.value = 'quick';
  evalBudget.value = 'low';
  evalAllowRealModel.value = false;
  evalActionResult.value = await api.harnessEvalRunSmoke();
  await refresh();
}

async function runHarnessEval() {
  const level = evalLevel.value;
  evalActionResult.value = await api.harnessEvalStartRun({
    level,
    provider: evalProvider.value.trim() || undefined,
    budget: evalBudget.value.trim() || (level === 'quick' ? 'low' : 'full'),
    allow_real_model: level === 'deep-real' ? evalAllowRealModel.value : false,
    objective: `webui requested ${level} harness evaluation`,
  });
  await refresh();
}

async function openHarnessEvalReport(row: Record<string, unknown>) {
  const id = String(row.id || '');
  if (!id) return;
  evalReportDetail.value = await api.harnessEvalReport(id);
}

async function cancelHarnessEvalRun(row: Record<string, unknown>) {
  const id = String(row.id || row.run_id || '');
  if (!id) return;
  evalActionResult.value = await api.harnessEvalCancelRun(id);
  await refresh();
}

async function createEvolutionSignal() {
  evolutionActionResult.value = await api.evolutionCreateSignal({
    signal_type: 'slow_progress',
    source: {
      owner: 'webui.audit',
      session_id: null,
      agent_id: null,
      team_id: null,
      run_id: null,
    },
    evidence_refs: ['webui:audit:evolution'],
    severity: 'warning',
    summary: t('page.audit.evolution.signalSummary'),
    suggested_action: 'create proposal and sandbox evaluation before adoption',
    immediate_task_can_continue: true,
  });
  await refresh();
}

async function createEvolutionProposal() {
  evolutionActionResult.value = await api.evolutionCreateProposal([]);
  await refresh();
}

async function createEvolutionDiagnosis() {
  evolutionActionResult.value = await api.evolutionCreateDiagnosis([]);
  await refresh();
}

async function openEvolutionDraft(row: Record<string, unknown>) {
  const id = String(row.id || '');
  if (!id) return;
  selectedEvolutionProposalId.value = id;
  evolutionDraft.value = await api.evolutionSkillDraft(id);
}

function selectEvolutionCandidate(row: Record<string, unknown>) {
  selectedEvolutionCandidateId.value = String(row.id || '');
  selectedDetail.value = { ...row, source: 'evolution.candidate', evidence: row.id, status: row.status };
}

async function requestEvolutionCanaryReview(row: Record<string, unknown>) {
  const id = String(row.id || '');
  if (!id) return;
  evolutionActionResult.value = await api.evolutionCandidateCanaryReview(id);
  await refresh();
}

async function requestEvolutionStableReview(row: Record<string, unknown>) {
  const id = String(row.id || '');
  if (!id) return;
  evolutionActionResult.value = await api.evolutionCandidateStableReview(id);
  await refresh();
}

function selectEvolutionReview(row: Record<string, unknown>) {
  selectedEvolutionReviewId.value = String(row.id || '');
  reviewReason.value = '';
  selectedDetail.value = { ...row, source: 'evolution.release_review', evidence: row.id, status: row.status };
}

async function decideEvolutionReview(row: Record<string, unknown>, decision: 'approve' | 'reject' | 'revise') {
  const id = String(row.id || '');
  if (!id) return;
  const fallbackReason = decision === 'approve'
    ? t('page.audit.evolution.reviewReason.approve')
    : decision === 'reject'
      ? t('page.audit.evolution.reviewReason.reject')
      : t('page.audit.evolution.reviewReason.revise');
  const reason = reviewReason.value.trim() || fallbackReason;
  evolutionActionResult.value = await api.evolutionReviewDecision(id, decision, reason);
  await refresh();
}

function selectEvaluationPolicyReview(row: Record<string, unknown>) {
  selectedEvaluationPolicyReviewId.value = String(row.id || '');
  reviewReason.value = '';
  selectedDetail.value = { ...row, source: 'evolution.evaluation_policy_review', evidence: row.id, status: row.status };
}

async function decideEvaluationPolicyReview(row: Record<string, unknown>, decision: 'approve' | 'reject') {
  const id = String(row.id || '');
  if (!id) return;
  const fallbackReason = decision === 'approve'
    ? t('page.audit.evaluationPolicy.reviewReason.approve')
    : t('page.audit.evaluationPolicy.reviewReason.reject');
  const reason = reviewReason.value.trim() || fallbackReason;
  evolutionActionResult.value = await api.evolutionEvaluationPolicyReviewDecision(id, decision, reason);
  await refresh();
}

async function decideEvolutionProposal(row: Record<string, unknown>, decision: 'approved' | 'rejected' | 'archived') {
  const id = String(row.id || '');
  if (!id) return;
  evolutionActionResult.value = await api.evolutionProposalDecision(id, decision);
  await refresh();
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page audit-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.audit.page.text.e991f8e72d') }}</h1>
        <p>{{ t('page.audit.page.text.8a31977702') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? t('page.audit.page.inline.4433376a54') : t('page.audit.page.inline.9b2111e9a9') }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row">
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.audit.page.text.a4105efeb4') }}</span>
        <strong>{{ auditRecords.length }}</strong>
        <small>{{ state.audit?.source || source }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.audit.page.text.f5e060a458') }}</span>
        <strong>{{ state.usage?.tokens?.total || 0 }}</strong>
        <small>{{ t('page.audit.summary.messageCount', { count: state.usage?.message_count || 0 }) }}</small>
      </article>
      <article class="metric-card" data-tone="warn">
        <span>{{ t('page.audit.page.text.d4317d5cbf') }}</span>
        <strong>{{ releaseChecks.length }}</strong>
        <small>{{ releaseSurface }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.audit.page.text.c2a8e12d35') }}</span>
        <strong>{{ displayStatus(state.harnessEvalLatest?.report?.status || 'empty') }}</strong>
        <small>{{ formatCount('reports', harnessEvalReports.length) }}</small>
      </article>
    </section>

    <section class="gateway-grid">
      <section class="management-panel gateway-panel wide" data-section="global-timeline">
        <header>
          <h2>{{ t('page.audit.page.text.1604763dcd') }}</h2>
          <span>{{ t('page.audit.summary.correlatedRecords', { count: globalTimelineRows.length }) }}</span>
        </header>
        <div class="button-row">
          <label class="field-line">
            {{ t('page.audit.filter.source') }}
            <select v-model="timelineSource">
              <option value="all">{{ t('page.audit.page.text.3990bceb49') }}</option>
              <option value="audit">{{ t('page.audit.page.text.eaa321f5e5') }}</option>
              <option value="approval">{{ t('page.audit.page.text.b42bf53c1f') }}</option>
              <option value="cross-plane">{{ t('page.audit.source.crossPlane') }}</option>
              <option value="execution">{{ t('page.audit.source.execution') }}</option>
            </select>
          </label>
          <label class="field-line">
            {{ t('page.audit.filter.status') }}
            <select v-model="timelineStatus">
              <option value="all">{{ t('page.audit.page.text.3990bceb49') }}</option>
              <option value="recorded">{{ t('page.audit.page.text.75a6ecb297') }}</option>
              <option value="approved">{{ t('page.audit.page.text.a70836e34a') }}</option>
              <option value="denied">{{ t('page.audit.page.text.c1546fc5fc') }}</option>
              <option value="ready">{{ t('page.audit.page.text.e407ec7655') }}</option>
              <option value="failed">{{ t('page.audit.page.text.ac323c75d3') }}</option>
            </select>
          </label>
          <label class="field-line">
            {{ t('page.audit.filter.session') }}
            <input v-model="timelineSession" type="search" :placeholder="t('page.audit.page.placeholder.1f51e2acee')" />
          </label>
          <label class="field-line">
            {{ t('page.audit.filter.evidence') }}
            <input v-model="timelineEvidence" type="search" :placeholder="t('page.audit.page.placeholder.d6e0c1b499')" />
          </label>
          <label class="field-line">
            {{ t('page.audit.filter.surface') }}
            <input v-model="timelineSurface" type="search" :placeholder="t('page.audit.placeholder.surfaceChannel')" />
          </label>
        </div>
        <DataTable v-if="globalTimelineRows.length" searchable copyable :rows="globalTimelineRows" :columns="['source', 'session', 'agent', 'tool', 'evidence', 'approval', 'surface', 'status', 'timestamp', 'summary']" row-key="evidence" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.audit.page.title.c8ee651d5f')" :detail="t('page.audit.page.detail.79d5d32b7b')" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="logs">
        <header>
          <h2>{{ t('page.audit.page.text.5ea6f2de3b') }}</h2>
          <span>{{ t('common.totalCount', { count: state.audit?.total || 0 }) }}</span>
        </header>
        <div class="button-row">
          <label class="field-line">
            {{ t('template.pages.auditpage.6da13addb0') }}
            <select v-model="source" @change="refresh">
              <option value="all">{{ t('page.audit.page.text.3990bceb49') }}</option>
              <option value="approval">{{ t('page.audit.page.text.b42bf53c1f') }}</option>
              <option value="memory">{{ t('page.audit.page.text.8d6c20ac46') }}</option>
            </select>
          </label>
          <label class="field-line">
            {{ t('template.pages.auditpage.24d948e4bd') }}
            <input v-model.number="limit" type="number" min="1" max="500" @change="refresh" />
          </label>
          <label class="field-line">
            {{ t('template.pages.auditpage.ce66771654') }}
            <input v-model.number="offset" type="number" min="0" @change="refresh" />
          </label>
        </div>
        <DataTable v-if="auditRows.length" searchable copyable :rows="auditRows" :columns="['source', 'id', 'summary', 'timestamp']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'audit', evidence: $event.id }" />
        <EmptyState v-else :title="t('page.audit.page.title.534295d677')" :detail="t('page.audit.page.detail.6b368c2a44')" />
        <EvidenceTrace :items="auditEvidence" :title="t('page.audit.page.title.69b367b2b4')" />
      </section>

      <section class="management-panel gateway-panel" data-section="usage">
        <header>
          <h2>{{ t('page.audit.page.text.c3d8bf1440') }}</h2>
          <span>{{ displayStatus(state.usage?.status || 'usage') }}</span>
        </header>
        <ChartPanel v-if="usageChart.length" :title="t('page.audit.page.title.cc6c932771')" kind="bar" :data="usageChart" />
        <EmptyState v-else :title="t('page.audit.page.title.0b5fa8afd6')" :detail="t('page.audit.page.detail.f250d3c233')" />
        <dl class="detail-list">
          <dt>{{ t('page.audit.page.text.3ed4b0e016') }}</dt>
          <dd>{{ state.usage?.message_count || 0 }}</dd>
          <dt>{{ t('page.audit.page.text.e60fd065c9') }}</dt>
          <dd>{{ state.usage?.tokens?.total || 0 }}</dd>
          <dt>{{ t('page.audit.page.text.50bf6ad542') }}</dt>
          <dd>{{ Number(state.usage?.estimated_cost_usd || 0).toFixed(6) }}</dd>
        </dl>
      </section>

      <section class="management-panel gateway-panel" data-section="release">
        <header>
          <h2>{{ t('page.audit.page.text.052c0ae46a') }}</h2>
          <span>{{ releaseSurface }}</span>
        </header>
        <label class="field-line">
          {{ t('page.audit.filter.surface') }}
          <select v-model="releaseSurface" @change="refresh">
            <option value="webui">webui</option>
            <option value="tui">tui</option>
            <option value="cli">cli</option>
          </select>
        </label>
        <ChartPanel v-if="releaseChart.length" :title="t('page.audit.page.title.e79ee7c0be')" kind="radar" :data="releaseChart" />
        <EmptyState v-else :title="t('page.audit.page.title.b7e0b61c96')" :detail="t('page.audit.page.detail.27b53763a7')" />
        <DataTable v-if="releaseRows.length" searchable copyable :rows="releaseRows" :columns="['name', 'status', 'detail']" row-key="name" @row-click="selectedDetail = { ...$event, source: 'release', evidence: $event.name, summary: $event.detail }" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="harness-eval">
        <header>
          <h2>{{ t('page.audit.page.text.c2a8e12d35') }}</h2>
          <span>{{ displayStatus(state.harnessEvalLatest?.status || 'reports') }}</span>
        </header>
        <div class="eval-control-grid">
          <label v-for="mode in evalRunModes" :key="mode.id" class="eval-mode-option" :class="{ active: evalLevel === mode.id }">
            <input v-model="evalLevel" type="radio" :value="mode.id" />
            <strong>{{ mode.label }}</strong>
            <small>{{ mode.detail }}</small>
          </label>
          <label class="field-line">
            {{ t('page.audit.harnessEval.provider') }}
            <input v-model="evalProvider" type="text" placeholder="deepseek-v4-flash" />
          </label>
          <label class="field-line">
            {{ t('page.audit.harnessEval.budget') }}
            <input v-model="evalBudget" type="text" :placeholder="t('page.audit.harnessEval.budgetPlaceholder')" />
          </label>
          <label class="field-line inline-check">
            <input v-model="evalAllowRealModel" type="checkbox" :disabled="evalLevel !== 'deep-real'" />
            {{ t('page.audit.harnessEval.allowRealModel') }}
          </label>
        </div>
        <div class="button-row">
          <button class="primary-action" type="button" @click="runHarnessEval">{{ t('page.audit.harnessEval.startEval') }}</button>
          <button class="primary-action" type="button" @click="runHarnessEvalSmoke">{{ t('page.audit.page.text.96e9252cbf') }}</button>
          <button class="ghost-action" type="button" @click="refresh">{{ t('page.audit.page.text.95dd535531') }}</button>
        </div>
        <dl class="detail-list">
          <dt>{{ t('page.audit.page.text.f1b114ace3') }}</dt>
          <dd>{{ state.harnessEvalLatest?.report?.id || t('common.none') }}</dd>
          <dt>{{ t('page.audit.page.text.9e51188c8e') }}</dt>
          <dd>{{ displayStatus(state.harnessEvalLatest?.report?.status || state.harnessEvalLatest?.status || 'empty') }}</dd>
          <dt>{{ t('page.audit.page.text.e60fd065c9') }}</dt>
          <dd>{{ state.harnessEvalLatest?.report?.total_tokens || 0 }}</dd>
          <dt>{{ t('page.audit.harnessEval.providerRounds') }}</dt>
          <dd>{{ state.harnessEvalLatest?.report?.provider_rounds || 0 }}</dd>
          <dt>{{ t('page.audit.page.text.a61ad14bd4') }}</dt>
          <dd>{{ state.harnessEvalLatest?.report?.tool_calls || 0 }}</dd>
        </dl>
        <DataTable v-if="harnessEvalRows.length" searchable copyable :rows="harnessEvalRows" :columns="['id', 'level', 'status', 'tokens', 'rounds', 'tools', 'scenarios', 'elapsed_ms']" row-key="id" @row-click="openHarnessEvalReport" />
        <EmptyState v-else :title="t('page.audit.page.title.6d80665780')" :detail="t('page.audit.page.detail.64a90473e7')" />
        <RequestReceipt v-if="evalActionResult" :receipt="evalActionResult" :title="t('page.audit.page.title.7e07abe625')" />
        <section v-if="evalReportDetail" class="eval-report-drilldown">
          <header>
            <h3>{{ evalReportSummary?.id || t('page.audit.harnessEval.reportTitle') }}</h3>
            <span>{{ displayStatus(evalReport?.report_gate?.status || evalReportSummary?.status || 'unknown') }}</span>
          </header>
          <div class="metric-row compact">
            <article class="metric-card">
              <span>{{ t('page.audit.harnessEval.providerRounds') }}</span>
              <strong>{{ evalReport?.execution_trace?.provider_rounds || 0 }}</strong>
              <small>{{ t('page.audit.harnessEval.roundSummaryCount', { count: evalProviderRounds.length }) }}</small>
            </article>
            <article class="metric-card">
              <span>{{ t('page.audit.harnessEval.tokens') }}</span>
              <strong>{{ evalReport?.execution_trace?.total_usage?.total_tokens || evalReportSummary?.total_tokens || 0 }}</strong>
              <small>{{ evalReport?.execution_trace?.total_usage?.usage_source || '-' }}</small>
            </article>
            <article class="metric-card">
              <span>{{ t('page.audit.harnessEval.reportGate') }}</span>
              <strong>{{ displayStatus(evalReport?.report_gate?.status || 'unknown') }}</strong>
              <small>{{ formatCount('items', evalReportGateItems.length) }}</small>
            </article>
            <article class="metric-card">
              <span>{{ t('page.audit.harnessEval.artifacts') }}</span>
              <strong>{{ evalArtifacts.length }}</strong>
              <small>{{ t('page.audit.harnessEval.packageFiles') }}</small>
            </article>
          </div>
          <DataTable v-if="evalReportGateItems.length" searchable copyable :rows="evalReportGateItems" :columns="['name', 'status', 'required', 'evidence', 'repair_hint']" row-key="name" />
          <DataTable v-if="evalProviderRounds.length" searchable copyable :rows="evalProviderRounds" :columns="['round_index', 'name', 'model', 'status', 'elapsed_ms', 'text_delta_count', 'tool_use_count', 'request_summary', 'response_summary', 'detail_path']" row-key="detail_path" />
          <DataTable v-if="evalArtifactRows.length" searchable copyable :rows="evalArtifactRows" :columns="['index', 'path']" row-key="path" />
          <ObjectInspectorDrawer :title="t('page.audit.page.title.052bb3b0c7')" :data="evalReportDetail" />
        </section>
      </section>

      <section class="management-panel gateway-panel" data-section="harness-eval-runs">
        <header>
          <h2>{{ t('page.audit.page.text.4444545e37') }}</h2>
          <span>{{ formatCount('runs', harnessEvalRuns.length) }}</span>
        </header>
        <DataTable v-if="harnessEvalRunRows.length" searchable copyable :rows="harnessEvalRunRows" :columns="['id', 'level', 'status', 'finished', 'tokens', 'rounds', 'tools', 'report', 'message']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'harness-eval', evidence: $event.id, status: $event.status }" />
        <div v-if="cancellableHarnessEvalRuns.length" class="button-row">
          <button class="ghost-action" type="button" @click="cancelHarnessEvalRun(cancellableHarnessEvalRuns[0])">{{ t('page.audit.harnessEval.cancelLatest') }}</button>
        </div>
        <EmptyState v-else :title="t('page.audit.page.title.2029dfea2e')" :detail="t('page.audit.page.detail.d6935f4575')" />
      </section>

      <section class="management-panel gateway-panel" data-section="harness-eval-scenarios">
        <header>
          <h2>{{ t('page.audit.page.text.171edf1adf') }}</h2>
          <span>{{ formatCount('scenarios', harnessEvalScenarios.length) }}</span>
        </header>
        <DataTable v-if="harnessEvalScenarioRows.length" searchable copyable :rows="harnessEvalScenarioRows" :columns="['id', 'kind', 'fake', 'real', 'evidence']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'harness-eval', evidence: $event.id, summary: $event.evidence }" />
        <EmptyState v-else :title="t('page.audit.page.title.1d4e669193')" :detail="t('page.audit.page.detail.4976a6366c')" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="evolution">
        <header>
          <h2>{{ t('page.audit.evolution.title') }}</h2>
          <span>{{ t('page.audit.evolution.summary', { signals: evolutionSignals.length, diagnoses: evolutionDiagnoses.length, proposals: evolutionProposals.length, candidates: evolutionCandidates.length }) }}</span>
        </header>
        <div class="button-row">
          <button class="primary-action" type="button" @click="createEvolutionSignal">{{ t('page.audit.evolution.createSignal') }}</button>
          <button class="primary-action" type="button" @click="createEvolutionDiagnosis">{{ t('page.audit.evolution.createDiagnosis') }}</button>
          <button class="primary-action" type="button" @click="createEvolutionProposal">{{ t('page.audit.evolution.createProposal') }}</button>
          <button class="ghost-action" type="button" @click="refresh">{{ t('page.audit.page.text.95dd535531') }}</button>
        </div>
        <div class="metric-row compact">
          <article class="metric-card">
            <span>{{ t('page.audit.evolution.signals') }}</span>
            <strong>{{ evolutionSignals.length }}</strong>
            <small>{{ t('page.audit.evolution.runtimeOwned') }}</small>
          </article>
          <article class="metric-card">
            <span>{{ t('page.audit.evolution.diagnoses') }}</span>
            <strong>{{ evolutionDiagnoses.length }}</strong>
            <small>{{ t('page.audit.evolution.rootCause') }}</small>
          </article>
          <article class="metric-card">
            <span>{{ t('page.audit.evolution.proposals') }}</span>
            <strong>{{ evolutionProposals.length }}</strong>
            <small>{{ t('page.audit.evolution.approvalBoundary') }}</small>
          </article>
          <article class="metric-card">
            <span>{{ t('page.audit.evolution.candidates') }}</span>
            <strong>{{ evolutionCandidates.length }}</strong>
            <small>{{ t('page.audit.evolution.adoptionGate') }}</small>
          </article>
          <article class="metric-card">
            <span>{{ t('page.audit.evolution.receipt') }}</span>
            <strong>{{ evolutionReviews.length }}</strong>
            <small>{{ t('page.audit.evolution.approvalBoundary') }}</small>
          </article>
          <article class="metric-card" data-tone="success">
            <span>{{ t('page.audit.evolution.runtimeOwned') }}</span>
            <strong>{{ evolutionReviews.filter((review: any) => review.status === 'approved').length }}</strong>
            <small>{{ t('page.audit.evolution.noMainlineWrite') }}</small>
          </article>
        </div>
        <DataTable v-if="evolutionSignalRows.length" searchable copyable :rows="evolutionSignalRows" :columns="['id', 'type', 'severity', 'owner', 'continue', 'summary']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'evolution.signal', evidence: $event.id, status: $event.severity, summary: $event.summary }" />
        <DataTable v-if="evolutionDiagnosisRows.length" searchable copyable :rows="evolutionDiagnosisRows" :columns="['id', 'cause', 'owner', 'recurrence', 'candidate', 'gates', 'impact']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'evolution.diagnosis', evidence: $event.id, status: $event.cause, summary: $event.impact }" />
        <DataTable v-if="evolutionMissionRows.length" searchable copyable :rows="evolutionMissionRows" :columns="['id', 'status', 'owner', 'goals', 'signals', 'proposals', 'candidates']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'evolution.mission', evidence: $event.id, status: $event.status }" />
        <DataTable v-if="evolutionProposalRows.length" searchable copyable :rows="evolutionProposalRows" :columns="['id', 'kind', 'diagnosis', 'owner', 'status', 'risk', 'approval', 'benefit']" row-key="id" @row-click="openEvolutionDraft" />
        <div v-if="evolutionProposalRows.length" class="button-row">
          <button class="ghost-action" type="button" :disabled="!selectedEvolutionProposal" @click="selectedEvolutionProposal && decideEvolutionProposal(selectedEvolutionProposal, 'approved')">{{ t('page.audit.evolution.approve') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedEvolutionProposal" @click="selectedEvolutionProposal && decideEvolutionProposal(selectedEvolutionProposal, 'archived')">{{ t('page.audit.evolution.archive') }}</button>
        </div>
        <DataTable v-if="evolutionCandidateRows.length" searchable copyable :rows="evolutionCandidateRows" :columns="['id', 'subject', 'lifecycle', 'baseline', 'contract', 'report', 'canary', 'stable']" row-key="id" @row-click="selectEvolutionCandidate" />
        <div v-if="evolutionCandidateRows.length" class="button-row">
          <button class="ghost-action" type="button" :disabled="!selectedEvolutionCandidate" @click="selectedEvolutionCandidate && requestEvolutionCanaryReview(selectedEvolutionCandidate)">{{ t('page.audit.evolution.requestCanaryReview') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedEvolutionCandidate" @click="selectedEvolutionCandidate && requestEvolutionStableReview(selectedEvolutionCandidate)">{{ t('page.audit.evolution.requestStableReview') }}</button>
        </div>
        <DataTable v-if="evolutionReviewRows.length" searchable copyable :rows="evolutionReviewRows" :columns="['id', 'class', 'action', 'status', 'candidate', 'approval', 'observation']" row-key="id" @row-click="selectEvolutionReview" />
        <div v-if="evolutionReviewRows.length" class="button-row">
          <label class="field-line review-reason-field">
            {{ t('page.audit.evolution.reviewReason') }}
            <input v-model="reviewReason" type="text" :placeholder="t('page.audit.evolution.reviewReasonPlaceholder')" />
          </label>
          <button class="ghost-action" type="button" :disabled="!selectedEvolutionReview || selectedEvolutionReview.status !== 'pending'" @click="selectedEvolutionReview && decideEvolutionReview(selectedEvolutionReview, 'approve')">{{ t('page.audit.evolution.approve') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedEvolutionReview || selectedEvolutionReview.status !== 'pending'" @click="selectedEvolutionReview && decideEvolutionReview(selectedEvolutionReview, 'reject')">{{ t('page.audit.evolution.reject') }}</button>
        </div>
        <EmptyState v-if="!evolutionSignalRows.length && !evolutionDiagnosisRows.length && !evolutionProposalRows.length && !evolutionCandidateRows.length" :title="t('page.audit.evolution.emptyTitle')" :detail="t('page.audit.evolution.emptyDetail')" />
        <RequestReceipt v-if="evolutionActionResult" :receipt="evolutionActionResult" :title="t('page.audit.evolution.receipt')" />
        <section v-if="evolutionDraftSummary" class="inline-management-section">
          <header>
            <h3>{{ t('page.audit.evolution.skillDraft') }}</h3>
            <span>{{ evolutionDraftSummary.proposal }}</span>
          </header>
          <DataTable :rows="[evolutionDraftSummary]" :columns="['proposal', 'status', 'skill', 'version', 'evidence']" row-key="proposal" />
        </section>
      </section>

      <section class="management-panel gateway-panel wide" data-section="evaluation-policy">
          <header>
            <h2>{{ t('page.audit.evaluationPolicy.title') }}</h2>
            <span>{{ evaluationPolicy.policy_id || '-' }}@{{ evaluationPolicy.revision || '-' }}</span>
          </header>
          <p class="section-note">{{ t('page.audit.evaluationPolicy.detail') }}</p>
          <DataTable v-if="evaluationPolicy.policy_id" searchable copyable :rows="[evaluationPolicy]" :columns="['policy_id', 'revision', 'minimum_paired_samples', 'minimum_confidence_milli', 'require_protected_metrics', 'require_hard_gate', 'require_target_improvement']" row-key="policy_id" @row-click="selectedDetail = $event" />
          <h3>{{ t('page.audit.evaluationPolicy.reviews') }}</h3>
          <DataTable v-if="evaluationPolicyReviewRows.length" searchable copyable :rows="evaluationPolicyReviewRows" :columns="['id', 'status', 'policy', 'revision', 'approval', 'reason']" row-key="id" @row-click="selectEvaluationPolicyReview" />
          <div v-if="evaluationPolicyReviewRows.length" class="button-row">
            <label class="field-line review-reason-field">
              {{ t('page.audit.evaluationPolicy.reviewReason') }}
              <input v-model="reviewReason" type="text" :placeholder="t('page.audit.evaluationPolicy.reviewReasonPlaceholder')" />
            </label>
            <button class="ghost-action" type="button" :disabled="!selectedEvaluationPolicyReview || selectedEvaluationPolicyReview.status !== 'pending'" @click="selectedEvaluationPolicyReview && decideEvaluationPolicyReview(selectedEvaluationPolicyReview, 'approve')">{{ t('page.audit.evaluationPolicy.approve') }}</button>
            <button class="ghost-action" type="button" :disabled="!selectedEvaluationPolicyReview || selectedEvaluationPolicyReview.status !== 'pending'" @click="selectedEvaluationPolicyReview && decideEvaluationPolicyReview(selectedEvaluationPolicyReview, 'reject')">{{ t('page.audit.evaluationPolicy.reject') }}</button>
          </div>
      </section>

      <section class="management-panel gateway-panel" data-section="approvals">
        <header>
          <h2>{{ t('page.audit.page.text.c9312c41ba') }}</h2>
          <span>{{ t('common.shownCount', { count: approvalRows.length, unit: t('unit.records') }) }}</span>
        </header>
        <DataTable v-if="approvalRows.length" searchable copyable :rows="approvalRows" :columns="['id', 'command', 'decision', 'resolved']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'approval', evidence: $event.id, status: $event.decision, summary: $event.command }" />
        <EmptyState v-else :title="t('page.audit.page.title.292a2d77e6')" :detail="t('page.audit.page.detail.abb458c609')" />
      </section>

      <section class="management-panel gateway-panel" data-section="cross-plane">
        <header>
          <h2>{{ t('page.audit.page.text.02318ae2d0') }}</h2>
          <span>{{ formatCount('records', crossPlaneRows.length) }}</span>
        </header>
        <DataTable v-if="crossPlaneRows.length" searchable copyable :rows="crossPlaneRows" :columns="['id', 'result', 'capability', 'summary']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'cross-plane', evidence: $event.id, status: $event.result }" />
        <EmptyState v-else :title="t('page.audit.page.title.8f881836e9')" :detail="t('page.audit.page.detail.bc95f49231')" />
      </section>

      <section class="management-panel gateway-panel" data-section="cross-plane">
        <header>
          <h2>{{ t('page.audit.page.text.4e1a860d2d') }}</h2>
          <span>{{ formatCount('receipts', executionRows.length) }}</span>
        </header>
        <DataTable v-if="executionRows.length" searchable copyable :rows="executionRows" :columns="['id', 'status', 'dispatch', 'mode']" row-key="id" @row-click="selectedDetail = { ...$event, source: 'execution', evidence: $event.id }" />
        <EvidenceObjectDetail :title="t('page.audit.page.title.f699e4008c')" :evidence="selectedEvidence" @close="selectedDetail = null" />
        <ObjectInspectorDrawer :title="t('page.audit.page.title.ad0dea9223')" :data="{ capabilities: state.capabilities, projection: state.projection, surfaces: state.surfaces }" />
      </section>
    </section>
  </section>
</template>
