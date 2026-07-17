<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Activity, Database, FileCheck2, Play, RefreshCw, Send, Wrench } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiWriteError } from '../../api/client';
import { t } from '../../i18n';
import { useMfgCockpitStore } from '../../stores/mfgCockpit';
import { useProjectionRegistryStore } from '../../stores/projectionRegistry';
import { createMfgMutationIntent } from '../../stores/mutationIntents';
import { adaptEntityImpact } from '../../adapters/graph/entityImpact';
import { adaptMetricLineage } from '../../adapters/graph/metricLineage';
import { adaptMfgDecisionTrace } from '../../adapters/graph/mfgDecisionTrace';
import { resolveMfgRuntimeExecutionId } from '../../adapters/strategyDecision';
import DataTable from '../workbench/DataTable.vue';
import EmptyState from '../workbench/EmptyState.vue';
import EvidenceTrace from '../workbench/EvidenceTrace.vue';
import GraphSurface from '../graph/GraphSurface.vue';
import ObjectInspectorDrawer from '../workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../workbench/RequestReceipt.vue';
import MfgReportReviewDrawer from './MfgReportReviewDrawer.vue';
import RecoveryActions from './RecoveryActions.vue';
import StrategyDecisionSummary from '../runtime/StrategyDecisionSummary.vue';
import type { MfgApiErrorV1, MfgRecoveryAction } from '../../types/mfg';

const props = defineProps<{ section: 'data' | 'reality' | 'evidence' | 'operations' | 'skills' | 'reports' }>();
const route = useRoute();
const router = useRouter();
const cockpit = useMfgCockpitStore();
const projections = useProjectionRegistryStore();
const loading = ref(false);
const error = ref('');
const operationApiError = ref<MfgApiErrorV1 | null>(null);
const receipt = ref<any>(null);
const operationStatus = ref<'idle' | 'running' | 'succeeded' | 'failed'>('idle');
const operationName = ref('');
const operationUpdatedAt = ref('');
let operationEpoch = 0;
let inFlightOperations = 0;
let lastOperation: (() => Promise<unknown>) | null = null;
let lastOperationName = '';
const lastOperationRetryable = ref(false);
const health = ref<any>({});
const sourcePackId = ref('');
const sourceName = ref('');
const sourceOwner = ref('manufacturing-ops');
const sourceAccessMode = ref('file');
const sourceRefreshMode = ref('manual');
const sourceTable = ref('manufacturing_events');
const sourceEntity = ref('asset');
const matrixEntityType = ref('asset');
const sourceKeyField = ref('asset_id');
const factType = ref('manufacturing.event');
const metricKey = ref('manufacturing_event_count');
const dedupKey = ref('event_id');
const deltaSignature = ref('updated_at');
const connectorRunId = ref('');
const connectorResourceRef = ref('');
const connectorExpectedRows = ref<number | null>(null);
const computeJobId = ref('');
const triggerFactType = ref('manufacturing.event');
const factPayload = ref('');
const selectedEntityId = ref('');
const entityDisplayName = ref('');
const entityType = ref('asset');
const sourceSystem = ref('');
const sourceKey = ref('');
const relationTargetId = ref('');
const relationType = ref('depends_on');
const selectedMetricId = ref('');
const selectedAttentionId = ref('');
const evidenceId = ref('');
const qualityGateId = ref('');
const incidentTitle = ref('');
const selectedIncidentId = ref('');
const selectedSkillId = ref('');
const selectedSkillRunId = ref('');
const selectedActionId = ref('');
const executionId = ref('');
const executionMode = ref('dry_run');
const feedbackOutcome = ref('resolved');
const feedbackNote = ref('');
const feedbackMetricDelta = ref<number | null>(null);
const reportId = ref('');
const reviewOpen = ref(false);
const caseQuery = ref('');
const selectedCaseId = ref('');
const selectedPlaybookId = ref('');
const playbookPayload = ref('');
const data = ref<any>({ metrics: [], entities: [], changes: [], attention: [], incidents: [], skills: [], cases: [], reports: [], room: null, report: null, delivery: null, decisionTrace: null });

const titleKey = computed(() => `mfg.domain.${props.section}.title`);
const summaryKey = computed(() => `mfg.domain.${props.section}.summary`);
const operationStatusLabel = computed(() => ({
  idle: '',
  running: t('mfg.domain.operation.running'),
  succeeded: t('mfg.domain.operation.succeeded'),
  failed: t('mfg.domain.operation.failed'),
}[operationStatus.value]));
const entityGraph = computed(() => adaptEntityImpact(data.value.entityDetail, t('mfg.domain.entityGraph')));
const metricGraph = computed(() => adaptMetricLineage(data.value.metricDetail, t('mfg.domain.metricGraph')));
const decisionGraph = computed(() => adaptMfgDecisionTrace(data.value.decisionTrace, t('mfg.domain.operations.decisionTrace')));
const evidenceItems = computed(() => {
  const packet = data.value.evidence?.packet || data.value.evidence?.evidence_packet || data.value.evidence;
  const refs = Array.isArray(packet?.source_refs) ? packet.source_refs : Array.isArray(packet?.metric_evidence) ? packet.metric_evidence : [];
  return refs.map((ref: any, index: number) => ({ id: String(ref?.id || ref?.ref || ref || index), kind: String(ref?.kind || 'mfg.evidence'), status: String(ref?.status || 'observed'), summary: String(ref?.summary || ref?.label || ref), source: String(packet?.packet_id || evidenceId.value) }));
});
const recommendedActions = computed(() => data.value.room?.analysis?.recommended_actions || []);
const analysisId = computed(() => String(data.value.room?.analysis?.analysis_id || data.value.room?.operational_analysis?.analysis_id || ''));
const evidencePacket = computed(() => data.value.evidence?.packet?.packet || data.value.evidence?.packet?.evidence_packet || data.value.evidence?.packet || data.value.evidence || {});
const evidenceContextItem = computed(() => data.value.evidence?.context?.context_item || data.value.evidence?.context || {});
const qualityDecision = computed(() => data.value.qualityGate?.gate || data.value.qualityGate?.quality_gate || data.value.qualityGate || {});
const reportDeliveryState = computed(() => data.value.delivery?.delivery_state || data.value.delivery?.after_state || data.value.delivery || {});
const reportSnapshot = computed(() => data.value.report?.report || data.value.report || {});
// An execution selected in Runtime or Mission can be inspected in the MFG
// operations surface without fabricating an MFG receipt.  The explicit URL
// selection remains subject to the same Gateway projection authorization and
// registry fail-closed behavior as a receipt-derived execution.
const runtimeExecutionId = computed(() => routeString(route.query.execution_id).trim()
  || resolveMfgRuntimeExecutionId(receipt.value, data.value));
const runtimeProjection = computed(() => runtimeExecutionId.value
  ? projections.projectionFor(runtimeExecutionId.value)
  : null);
const canReviewReports = computed(() => cockpit.grantedCapabilities.has('mfg.report.review')
  && cockpit.grantedCapabilities.has('approval.respond'));
const canManageData = computed(() => cockpit.grantedCapabilities.has('mfg.data.manage'));
const canOperateIncidents = computed(() => cockpit.grantedCapabilities.has('mfg.incident.operate'));
const canManagePlaybooks = computed(() => cockpit.grantedCapabilities.has('mfg.playbook.manage'));
const canRunSkills = computed(() => cockpit.grantedCapabilities.has('mfg.skill.run'));
const canOperateExecution = computed(() => cockpit.grantedCapabilities.has('mfg.execution.operate'));
const canRecordFeedback = computed(() => cockpit.grantedCapabilities.has('mfg.execution.feedback'));
const canGenerateReports = computed(() => cockpit.grantedCapabilities.has('mfg.report.generate'));
const canDeliverReports = computed(() => cockpit.grantedCapabilities.has('mfg.report.deliver'));

function items(value: any, key: string) { return Array.isArray(value?.[key]) ? value[key] : Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []; }

function mutationIntent(
  actionId: string,
  resourceRef: string,
  payload: unknown,
  expectedRevision?: number,
  risk: 'low' | 'medium' | 'high' = 'medium',
) {
  return createMfgMutationIntent(actionId, resourceRef, payload, { expectedRevision, risk });
}

async function execute<T>(action: () => Promise<T>, name = props.section, retryable = false): Promise<T | null> {
  const epoch = ++operationEpoch;
  lastOperation = action;
  lastOperationName = name;
  lastOperationRetryable.value = retryable;
  operationName.value = name;
  operationStatus.value = 'running';
  operationUpdatedAt.value = new Date().toISOString();
  inFlightOperations += 1;
  loading.value = true;
  error.value = '';
  operationApiError.value = null;
  try {
    const result = await action();
    if (epoch === operationEpoch) {
      operationStatus.value = 'succeeded';
      operationUpdatedAt.value = new Date().toISOString();
    }
    return result;
  } catch (cause) {
    if (epoch === operationEpoch) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof ApiWriteError) {
        operationApiError.value = cause.apiError || {
          code: cause.code,
          message: cause.message,
          http_status: cause.status,
          details: cause.details,
          retryable: cause.retryable,
          recovery_actions: cause.recoveryActions,
          request_id: cause.requestId,
        };
        if (cause.status === 403) void cockpit.refresh();
      }
      operationStatus.value = 'failed';
      operationUpdatedAt.value = new Date().toISOString();
    }
    return null;
  } finally {
    inFlightOperations = Math.max(0, inFlightOperations - 1);
    loading.value = inFlightOperations > 0;
  }
}

async function refresh() {
  await execute(async () => {
    const [nextHealth, dataPlaneHealth, metrics, entities, changes, attention, incidents, skills, reports] = await Promise.all([api.mfgHealth(), api.mfgDataPlaneHealth(), api.mfgMetrics(), api.mfgEntities(), api.mfgChanges(), api.mfgAttentionHot(), api.mfgIncidents(), api.mfgSkills(), api.mfgReports(cockpit.selectedProfileId || undefined)]);
    health.value = nextHealth;
    data.value = { ...data.value, dataPlaneHealth, metrics: items(metrics, 'metrics'), entities: items(entities, 'entities'), changes: items(changes, 'changes'), attention: items(attention, 'items'), incidents: items(incidents, 'items'), skills: items(skills, 'items'), reports: items(reports, 'items') };
    if (!selectedIncidentId.value && data.value.incidents[0]) selectedIncidentId.value = data.value.incidents[0].incident_id;
  }, 'refresh', true);
}

async function retryLastOperation() {
  if (!lastOperation || !lastOperationRetryable.value) return;
  await execute(lastOperation, lastOperationName || props.section, true);
}

async function recoverOperation(action: MfgRecoveryAction) {
  if (action.kind === 'retry_same_intent' && lastOperation) {
    await execute(lastOperation, lastOperationName || props.section, true);
    return;
  }
  if (action.kind === 'reload' || action.kind === 'compare') {
    await refresh();
    return;
  }
  if (['reauthenticate', 'request_access'].includes(action.kind) && action.target) {
    window.location.assign(action.target);
  }
}

async function upsertSourcePack() {
  if (!sourcePackId.value.trim() || !canManageData.value) return;
  const payload = {
    source_pack_id: sourcePackId.value.trim(),
    source_name: sourceName.value.trim() || sourcePackId.value.trim(),
    owner: sourceOwner.value.trim(),
    access_mode: sourceAccessMode.value,
    refresh_mode: sourceRefreshMode.value,
    entity_mappings: sourceEntity.value.trim() && matrixEntityType.value.trim() && sourceKeyField.value.trim() ? [{ source_entity: sourceEntity.value.trim(), matrix_entity_type: matrixEntityType.value.trim(), source_key_field: sourceKeyField.value.trim() }] : [],
    fact_mappings: [{ source_table: sourceTable.value.trim(), fact_type: factType.value.trim(), metric_key: metricKey.value.trim(), entity_ref_fields: sourceKeyField.value.trim() ? [sourceKeyField.value.trim()] : [], measure_fields: [], dedup_key: dedupKey.value.trim(), delta_signature: deltaSignature.value.trim() }],
    reconciliation_rules: ['deduplicate_by_source_key'],
    quality_rules: ['required_identifiers_present'],
    metadata: { configured_by: 'webui-mfg' },
  };
  const intent = mutationIntent(
    'mfg.reality.source_pack.create',
    `mfg:source-pack:${sourcePackId.value.trim()}`,
    payload,
  );
  receipt.value = await execute(() => api.mfgSourcePackUpsert(payload, intent));
  if (!receipt.value) return;
  await refresh();
}

async function planDataPlaneIngest() {
  if (!sourcePackId.value.trim() || !factType.value.trim()) return;
  data.value = { ...data.value, sourcePackResult: await execute(() => api.mfgDataPlaneIngestPlan({ source_ref: `source-pack://${sourcePackId.value.trim()}`, fact_type: factType.value.trim(), metric_ids: selectedMetricId.value ? [selectedMetricId.value] : [] })) };
}

async function validateSourcePack() {
  if (!sourcePackId.value.trim()) return;
  data.value = { ...data.value, sourcePackResult: await execute(() => api.mfgSourcePackValidate(sourcePackId.value.trim()), 'source_pack.validate', true) };
}

async function inspectSourcePack() {
  if (!sourcePackId.value.trim()) return;
  data.value = { ...data.value, sourcePackResult: await execute(() => api.mfgSourcePack(sourcePackId.value.trim()), 'source_pack.inspect', true) };
}

async function initializeKernel() {
  if (!canManageData.value
    || !window.confirm('server-manufacturing domain and ontology kernel')) return;
  const domainIntent = mutationIntent('mfg.domain.server_manufacturing.seed', 'mfg:domain:server-manufacturing', {}, undefined, 'high');
  const ontologyIntent = mutationIntent('mfg.ontology.server_manufacturing.seed', 'mfg:ontology:server-manufacturing', {}, undefined, 'high');
  const result = await execute(() => Promise.all([
    api.mfgSeedDomain(domainIntent),
    api.mfgSeedOntology(ontologyIntent),
  ]));
  if (result) {
    receipt.value = { domain: result[0], ontology: result[1] };
    await refresh();
  }
}

async function planSourceDelta() {
  if (!sourcePackId.value.trim()) return;
  data.value = { ...data.value, sourcePackResult: await execute(() => api.mfgSourcePackDeltaPlan(sourcePackId.value.trim()), 'source_pack.delta_plan', true) };
}

async function planConnectorRun() {
  if (!sourcePackId.value.trim() || !connectorResourceRef.value.trim() || !canManageData.value) return;
  const payload = { resource_ref: connectorResourceRef.value.trim(), expected_rows: connectorExpectedRows.value || undefined };
  const intent = mutationIntent('mfg.reality.connector_run.plan', `mfg:source-pack:${sourcePackId.value.trim()}`, payload);
  const result = await execute(() => api.mfgSourcePackConnectorPlan(sourcePackId.value.trim(), payload, intent));
  if (!result) return;
  connectorRunId.value = String((result as any)?.run?.run_id || connectorRunId.value);
  data.value = { ...data.value, sourcePackResult: result };
}

async function runConnector() {
  if (!sourcePackId.value.trim() || !connectorResourceRef.value.trim() || !canManageData.value) return;
  if (!window.confirm(`${sourcePackId.value.trim()} → ${connectorResourceRef.value.trim()}`)) return;
  const payload = { resource_ref: connectorResourceRef.value.trim(), expected_rows: connectorExpectedRows.value || undefined };
  const intent = mutationIntent('mfg.reality.connector_run.execute', `mfg:source-pack:${sourcePackId.value.trim()}`, payload, undefined, 'high');
  const result = await execute(() => api.mfgSourcePackConnectorRun(sourcePackId.value.trim(), payload, intent));
  if (!result) return;
  connectorRunId.value = String((result as any)?.run?.run_id || connectorRunId.value);
  data.value = { ...data.value, sourcePackResult: result };
}

async function inspectConnectorRun() {
  if (!connectorRunId.value) return;
  data.value = { ...data.value, sourcePackResult: await execute(() => api.mfgConnectorRun(connectorRunId.value), 'connector.inspect', true) };
}

async function ingestFacts() {
  if (!canManageData.value) return;
  let facts: any[] = [];
  try { const parsed = JSON.parse(factPayload.value); facts = Array.isArray(parsed) ? parsed : [parsed]; } catch { error.value = t('mfg.domain.invalidJson'); return; }
  if (!window.confirm(`${sourcePackId.value.trim() || 'direct fact ingest'} · ${facts.length} facts`)) return;
  const sourcePack = sourcePackId.value.trim();
  const intent = mutationIntent(
    sourcePack ? 'mfg.reality.source_pack.ingest_file' : 'mfg.reality.fact.ingest',
    sourcePack ? `mfg:source-pack:${sourcePack}` : `mfg:fact-batch:${facts.length}`,
    facts,
    undefined,
    'high',
  );
  receipt.value = await execute(() => sourcePack
    ? api.mfgSourcePackIngestFile(sourcePack, facts, intent)
    : api.mfgIngestFact(facts, intent));
  if (!receipt.value) return;
  await refresh();
}

async function inspectEntity(entityId = selectedEntityId.value) {
  if (!entityId) return;
  selectedEntityId.value = entityId;
  const details = await execute(() => Promise.all([api.mfgEntity(entityId), api.mfgEntityRelations(entityId), api.mfgEntityImpactPath(entityId)]), 'entity.inspect', true);
  if (!details) return;
  const [entity, relations, impact] = details;
  data.value = { ...data.value, entityDetail: { entity, relations, impact } };
}

async function upsertEntity() {
  if (!selectedEntityId.value.trim() || !canManageData.value) return;
  const payload = { entity_id: selectedEntityId.value.trim(), canonical_key: selectedEntityId.value.trim(), display_name: entityDisplayName.value.trim() || selectedEntityId.value.trim(), entity_type: entityType.value };
  const existing = data.value.entities.find((entity: any) => entity.entity_id === selectedEntityId.value.trim());
  const intent = mutationIntent(
    existing ? 'mfg.reality.entity.update' : 'mfg.reality.entity.create',
    `mfg:entity:${selectedEntityId.value.trim()}`,
    payload,
    existing?.revision,
  );
  receipt.value = await execute(() => api.mfgEntityUpsert(payload, intent));
  if (receipt.value) await inspectEntity();
}

async function resolveEntity() {
  if (!sourceSystem.value.trim() || !sourceKey.value.trim()) return;
  data.value = { ...data.value, entityResolution: await execute(() => api.mfgEntityResolveSourceKey(sourceSystem.value.trim(), sourceKey.value.trim())) };
}

async function upsertRelation() {
  if (!selectedEntityId.value || !relationTargetId.value.trim() || !relationType.value.trim() || !canManageData.value) return;
  const payload = { relation_type: relationType.value.trim(), from_entity_id: selectedEntityId.value, to_entity_id: relationTargetId.value.trim() };
  const intent = mutationIntent('mfg.reality.relation.create', `mfg:relation:${selectedEntityId.value}:${relationType.value.trim()}:${relationTargetId.value.trim()}`, payload);
  receipt.value = await execute(() => api.mfgRelationUpsert(payload, intent));
  if (receipt.value) await inspectEntity();
}

async function inspectMetric(metricId = selectedMetricId.value) {
  if (!metricId) return;
  selectedMetricId.value = metricId;
  const details = await execute(() => Promise.all([api.mfgMetricDetail(metricId), api.mfgMetricLineage(metricId)]), 'metric.inspect', true);
  if (!details) return;
  const [detail, lineage] = details;
  data.value = { ...data.value, metricDetail: { detail, lineage } };
}

async function materializeMetricSnapshot() {
  if (!selectedMetricId.value || !canManageData.value) return;
  const payload = { metric_ids: [selectedMetricId.value], scope_ref: selectedEntityId.value || undefined };
  const intent = mutationIntent('mfg.reality.metric_snapshot.materialize', `mfg:metric:${selectedMetricId.value}`, payload);
  receipt.value = await execute(() => api.mfgMetricSnapshotMaterialize(payload.metric_ids, payload.scope_ref, intent));
}

async function planMetricAttention() {
  if (!triggerFactType.value.trim()) return;
  receipt.value = await execute(() => api.mfgAttentionPlan({ trigger_fact_type: triggerFactType.value.trim(), entity_scope: selectedEntityId.value || undefined, limit: 100 }));
}

async function planComputeJob() {
  if (!triggerFactType.value.trim() || !canManageData.value) return;
  const payload = { trigger_fact_type: triggerFactType.value.trim(), metric_ids: selectedMetricId.value ? [selectedMetricId.value] : [], entity_scope: selectedEntityId.value || undefined };
  const intent = mutationIntent('mfg.reality.compute_job.plan', `mfg:compute-plan:${triggerFactType.value.trim()}`, payload);
  const result = await execute(() => api.mfgComputeJobPlan(payload, intent));
  if (!result) return;
  computeJobId.value = String((result as any)?.job?.job_id || (result as any)?.plan?.job?.job_id || computeJobId.value);
  data.value = { ...data.value, computeResult: result };
}

async function runComputeJob() {
  if (!computeJobId.value || !canManageData.value) return;
  if (!window.confirm(`compute job ${computeJobId.value}`)) return;
  const intent = mutationIntent('mfg.reality.compute_job.execute', `mfg:compute-job:${computeJobId.value}`, {}, undefined, 'high');
  data.value = { ...data.value, computeResult: await execute(() => api.mfgComputeJobRun(computeJobId.value, intent)) };
  await refresh();
}

async function inspectComputeJob() {
  if (!computeJobId.value) return;
  data.value = { ...data.value, computeResult: await execute(() => api.mfgComputeJob(computeJobId.value), 'compute.inspect', true) };
}

async function recomputeMetrics() {
  if (!canManageData.value || !window.confirm(t('mfg.domain.reality.confirmRecompute'))) return;
  const intent = mutationIntent('mfg.reality.metric.recompute', 'mfg:metrics', {}, undefined, 'high');
  receipt.value = await execute(() => api.mfgMetricRecompute(intent));
  if (receipt.value) await refresh();
}

async function buildEvidence() {
  if (!selectedAttentionId.value || !canManageData.value) return;
  const payload = { attention_id: selectedAttentionId.value, problem_statement: incidentTitle.value || undefined };
  const intent = mutationIntent('mfg.reality.evidence.build', `mfg:attention:${selectedAttentionId.value}`, payload);
  receipt.value = await execute(() => api.mfgEvidenceBuild(payload, intent));
  if (!receipt.value) return;
  evidenceId.value = receipt.value?.packet?.packet_id || receipt.value?.evidence_packet?.packet_id || evidenceId.value;
  await inspectEvidence();
}

async function inspectEvidence() {
  if (!evidenceId.value) return;
  const details = await execute(() => Promise.all([api.mfgEvidence(evidenceId.value), api.mfgEvidenceContext(evidenceId.value)]), 'evidence.inspect', true);
  if (!details) return;
  const [packet, context] = details;
  data.value = { ...data.value, evidence: { packet, context } };
}

async function evaluateEvidenceQuality() {
  if (!evidenceId.value || !canManageData.value) return;
  const intent = mutationIntent('mfg.reality.evidence.quality_gate', `mfg:evidence:${evidenceId.value}`, {});
  const result = await execute(() => api.mfgEvidenceQualityGate(evidenceId.value, intent));
  if (!result) return;
  qualityGateId.value = String((result as any)?.quality_gate?.gate_id || (result as any)?.gate?.gate_id || qualityGateId.value);
  data.value = { ...data.value, qualityGate: result };
}

async function inspectQualityGate() {
  if (!qualityGateId.value) return;
  data.value = { ...data.value, qualityGate: await execute(() => api.mfgQualityGate(qualityGateId.value), 'quality_gate.inspect', true) };
}

async function openIncidentRoom() {
  if (!selectedIncidentId.value) return;
  const room = await execute(() => api.mfgIncidentRoom(selectedIncidentId.value), 'incident.room', true);
  if (room) {
    data.value = { ...data.value, room };
    await loadDecisionTrace();
  }
}

async function createIncident() {
  if (!incidentTitle.value.trim() || !canOperateIncidents.value) return;
  const payload = { title: incidentTitle.value.trim(), attention_id: selectedAttentionId.value || undefined };
  const intent = mutationIntent('mfg.incident.create', `mfg:incident-draft:${incidentTitle.value.trim()}`, payload);
  receipt.value = await execute(() => api.mfgCreateIncident(payload, intent));
  if (!receipt.value) return;
  selectedIncidentId.value = receipt.value?.incident?.incident_id || selectedIncidentId.value;
  await openIncidentRoom();
  await refresh();
}

async function openIncidentFromReality() {
  const subject = selectedEntityId.value || selectedMetricId.value || selectedAttentionId.value;
  if (!subject || !canOperateIncidents.value) return;
  incidentTitle.value = t('mfg.domain.reality.incidentTitle', { subject });
  const payload = { title: incidentTitle.value, attention_id: selectedAttentionId.value || undefined };
  const intent = mutationIntent('mfg.incident.create', `mfg:incident-draft:${subject}`, payload);
  const result = await execute(() => api.mfgCreateIncident(payload, intent));
  const incidentId = String((result as any)?.incident?.incident_id || '');
  if (!incidentId) return;
  await router.push({ path: '/apps/mfg', query: { ...route.query, section: 'operations', incident: incidentId, focus: `mfg:incident:${incidentId}` } });
}

async function analyzeIncident() {
  if (!selectedIncidentId.value || !canOperateIncidents.value) return;
  const intent = mutationIntent('mfg.incident.analyze', `mfg:incident:${selectedIncidentId.value}`, {});
  receipt.value = await execute(() => api.mfgAnalyzeIncident(selectedIncidentId.value, intent));
  if (!receipt.value) return;
  await openIncidentRoom();
}

async function recommendPlaybooks() {
  if (!selectedIncidentId.value) return;
  receipt.value = await execute(() => api.mfgRecommendPlaybooks(selectedIncidentId.value, 5));
  if (receipt.value) await openIncidentRoom();
}

async function planSkills() {
  if (!selectedIncidentId.value) return;
  receipt.value = await execute(() => api.mfgPlanSkills(selectedIncidentId.value, 5));
  if (!receipt.value) return;
  await openIncidentRoom();
}

async function runSkill() {
  if (!selectedIncidentId.value || !selectedSkillId.value || !canRunSkills.value) return;
  if (!window.confirm(`${selectedIncidentId.value} → ${selectedSkillId.value}`)) return;
  const intent = mutationIntent(
    'mfg.skill.run',
    `mfg:incident:${selectedIncidentId.value}:skill:${selectedSkillId.value}`,
    {},
    undefined,
    'high',
  );
  receipt.value = await execute(() => api.mfgRunSkill(selectedIncidentId.value, selectedSkillId.value, intent));
  if (!receipt.value) return;
  selectedSkillRunId.value = String(receipt.value?.skill_run?.run_id || receipt.value?.run_id || selectedSkillRunId.value);
  await openIncidentRoom();
}

async function inspectSkill() {
  if (!selectedSkillId.value) return;
  data.value = { ...data.value, skillDetail: await execute(() => api.mfgSkill(selectedSkillId.value), 'skill.inspect', true) };
}

async function inspectSkillRun() {
  if (!selectedSkillRunId.value) return;
  data.value = { ...data.value, skillRun: await execute(() => api.mfgSkillRun(selectedSkillRunId.value), 'skill_run.inspect', true) };
}

function actionGovernanceIntent() {
  return {
    actor_identity_ref: null,
    source_channel: 'channel://webui/mfg',
    session_id: selectedIncidentId.value || 'webui-mfg',
    requested_capability: 'channel.chat.send_text',
    provider_account: null,
    target_ref: selectedIncidentId.value ? `mfg:incident:${selectedIncidentId.value}` : null,
    resource_ref: executionId.value ? `mfg:execution:${executionId.value}` : null,
    risk: executionMode.value === 'commit' ? 'high' : 'medium',
    data_classification: 'internal',
    identity_trust: 'unknown',
  };
}

async function planAction() {
  if (!analysisId.value || !selectedActionId.value) return;
  const action = recommendedActions.value.find((item: any) => item.action_id === selectedActionId.value) || {};
  const result = await execute(() => Promise.all([
    api.crossPlanePolicySimulate(actionGovernanceIntent()),
    api.crossPlanePreflight(actionGovernanceIntent()),
  ]), 'action.preflight', true);
  if (!result) return;
  data.value = {
    ...data.value,
    actionLoop: {
      before: { incident_id: selectedIncidentId.value, analysis_id: analysisId.value, action, room_status: data.value.room?.incident?.status },
      policy: result[0],
      preflight: result[1],
      approval: { required: executionMode.value === 'commit' || action.governance !== 'automatic', status: 'not_requested' },
      after: data.value.actionLoop?.after || null,
    },
  };
}

async function executeAction() {
  if (!analysisId.value || !selectedActionId.value) return;
  if (executionMode.value === 'commit' && !canOperateExecution.value) return;
  if (executionMode.value === 'commit' && !window.confirm(t('mfg.domain.operations.confirmCommit'))) return;
  if (!data.value.actionLoop?.preflight) await planAction();
  const payload = { mode: executionMode.value, note: 'executed from WebUI MFG workspace' };
  const intent = mutationIntent(
    executionMode.value === 'commit' ? 'mfg.analysis.action.commit' : 'mfg.analysis.action.dry_run',
    `mfg:analysis:${analysisId.value}:action:${selectedActionId.value}`,
    payload,
    undefined,
    executionMode.value === 'commit' ? 'high' : 'low',
  );
  receipt.value = await execute(() => api.mfgExecuteAction(analysisId.value, selectedActionId.value, payload, intent));
  if (!receipt.value) return;
  executionId.value = String(receipt.value?.execution?.execution_id || executionId.value);
  const execution = executionId.value ? await execute(() => api.mfgExecution(executionId.value), 'action.execution', true) : null;
  data.value = { ...data.value, actionLoop: { ...(data.value.actionLoop || {}), approval: { required: executionMode.value === 'commit', status: executionMode.value === 'commit' ? 'pending_human_review' : 'not_required' }, after: execution || receipt.value } };
  await openIncidentRoom();
}

async function bridgeExecution() {
  if (!executionId.value) return;
  if (executionMode.value === 'commit' && !canOperateExecution.value) return;
  if (executionMode.value === 'commit' && !window.confirm(t('mfg.domain.operations.confirmCommit'))) return;
  const payload = { mode: executionMode.value, source_channel: 'channel://webui/mfg', requested_capability: 'channel.chat.send_text' };
  const intent = mutationIntent(
    executionMode.value === 'commit' ? 'mfg.execution.cross_plane.commit' : 'mfg.execution.cross_plane.dry_run',
    `mfg:execution:${executionId.value}`,
    payload,
    undefined,
    executionMode.value === 'commit' ? 'high' : 'low',
  );
  receipt.value = await execute(() => api.mfgExecutionBridge(executionId.value, payload, intent));
  if (receipt.value) {
    const execution = await execute(() => api.mfgExecution(executionId.value), 'action.bridge_result', true);
    data.value = { ...data.value, actionLoop: { ...(data.value.actionLoop || {}), after: execution || receipt.value } };
  }
}

async function recordExecutionFeedback() {
  if (!executionId.value || !feedbackNote.value.trim() || !canRecordFeedback.value) return;
  const payload = { outcome: feedbackOutcome.value, note: feedbackNote.value.trim(), metric_delta: feedbackMetricDelta.value };
  const intent = mutationIntent('mfg.execution.feedback.create', `mfg:execution:${executionId.value}`, payload);
  receipt.value = await execute(() => api.mfgExecutionFeedback(executionId.value, payload, intent));
  if (receipt.value) {
    const execution = await execute(() => api.mfgExecution(executionId.value), 'action.feedback_result', true);
    data.value = { ...data.value, actionLoop: { ...(data.value.actionLoop || {}), after: execution || receipt.value } };
    await loadDecisionTrace();
  }
}

async function promoteCase() {
  if (!selectedIncidentId.value || !canOperateIncidents.value) return;
  const intent = mutationIntent('mfg.incident.case.promote', `mfg:incident:${selectedIncidentId.value}`, {});
  receipt.value = await execute(() => api.mfgPromoteIncidentCase(selectedIncidentId.value, intent));
  selectedCaseId.value = String(receipt.value?.case?.case_id || receipt.value?.case_id || selectedCaseId.value);
}

async function inspectCase() {
  if (!selectedCaseId.value) return;
  data.value = { ...data.value, caseDetail: await execute(() => api.mfgCase(selectedCaseId.value), 'case.inspect', true) };
}

async function inspectPlaybook() {
  if (!selectedPlaybookId.value) return;
  data.value = { ...data.value, playbook: await execute(() => api.mfgPlaybook(selectedPlaybookId.value), 'playbook.inspect', true) };
}

async function upsertPlaybook() {
  if (!selectedPlaybookId.value || !canManagePlaybooks.value) return;
  let payload: Record<string, unknown>;
  try { payload = playbookPayload.value.trim() ? JSON.parse(playbookPayload.value) : {}; }
  catch { error.value = t('mfg.domain.invalidJson'); return; }
  const now = new Date().toISOString();
  const body = {
    domain: 'manufacturing',
    scenario: incidentTitle.value.trim() || selectedIncidentId.value || selectedPlaybookId.value,
    trigger_fact_types: [],
    metric_keys: [],
    recommended_steps: [],
    required_evidence: [],
    quality_gate_policy: 'evidence_quality_gate_required',
    cross_plane_policy: 'governed_execution_only',
    success_metrics: [],
    created_from_case_id: selectedCaseId.value || null,
    created_at: now,
    updated_at: now,
    ...payload,
    playbook_id: selectedPlaybookId.value,
  };
  const existing = data.value.playbook?.playbook || data.value.playbook;
  const intent = mutationIntent(
    existing?.playbook_id === selectedPlaybookId.value ? 'mfg.playbook.update' : 'mfg.playbook.create',
    `mfg:playbook:${selectedPlaybookId.value}`,
    body,
    existing?.revision,
  );
  receipt.value = await execute(() => api.mfgPlaybookUpsert(body, intent));
}

async function loadDecisionTrace() {
  const trace = await execute(() => api.mfgDecisionTrace({ incident_id: selectedIncidentId.value || undefined, report_id: reportId.value || undefined }), 'decision_trace.inspect', true);
  if (trace) data.value = { ...data.value, decisionTrace: trace };
}

async function generateReport() {
  if (!cockpit.selectedProfileId || !canGenerateReports.value) return;
  const payload = { report_id: reportId.value || undefined };
  const intent = mutationIntent('mfg.report.generate', `mfg:cockpit-profile:${cockpit.selectedProfileId}`, payload);
  receipt.value = await execute(() => api.mfgGenerateReport(cockpit.selectedProfileId, payload, intent));
  if (!receipt.value) return;
  reportId.value = receipt.value?.report?.report_id || reportId.value;
  await inspectReport();
  await refresh();
}

async function inspectReport() {
  if (!reportId.value) return;
  const report = await execute(() => Promise.all([api.mfgReport(reportId.value), api.mfgReportDeliveryState(reportId.value), api.surfaceOutbox('feishu'), api.surfaceOutbox('email'), api.surfaceOutbox('webhook')]), 'report.inspect', true);
  if (!report) return;
  data.value = { ...data.value, report: report[0], delivery: report[1], reportOutbox: { feishu: report[2], email: report[3], webhook: report[4] } };
  await loadDecisionTrace();
}

async function reviewUpdated() {
  await inspectReport();
  await cockpit.refresh();
}

async function deliverReport() {
  if (!reportId.value || !canDeliverReports.value) return;
  const payload = { mode: 'dry_run', source_channel: 'mfg.report.delivery' };
  const intent = mutationIntent('mfg.report.deliver.dry_run', `mfg:report:${reportId.value}`, payload, undefined, 'low');
  receipt.value = await execute(() => api.mfgDeliverReport(reportId.value, payload, intent));
  if (receipt.value) await inspectReport();
}

async function retryReport() {
  if (!reportId.value || !canDeliverReports.value) return;
  const payload = { mode: 'dry_run', source_channel: 'mfg.report.retry' };
  const intent = mutationIntent('mfg.report.delivery.retry_dry_run', `mfg:report:${reportId.value}`, payload, undefined, 'low');
  receipt.value = await execute(() => api.mfgRetryReportDelivery(reportId.value, payload, intent));
  if (receipt.value) await inspectReport();
}

async function runReportSchedule() {
  if (!canGenerateReports.value) return;
  const payload = { cadence: cockpit.selectedProfile?.cadence || 'daily', deliver: false, source_channel: 'webui.mfg' };
  const intent = mutationIntent('mfg.report.schedule.generate_only', 'mfg:report-schedule', payload);
  receipt.value = await execute(() => api.mfgRunReportSchedule(payload, intent));
  if (receipt.value) await refresh();
}

async function searchCases() {
  const result = await execute(() => api.mfgCaseSearch(caseQuery.value), 'case.search', true);
  if (result) data.value = { ...data.value, cases: items(result, 'cases') };
}

function routeString(value: unknown) { return typeof value === 'string' ? value : ''; }

function routeIncidentId() {
  const direct = routeString(route.query.incident);
  if (direct) return direct;
  const focus = routeString(route.query.focus);
  return focus.startsWith('mfg:incident:') ? focus.slice('mfg:incident:'.length) : '';
}

async function restoreSectionDeepLink() {
  const incidentId = props.section === 'operations' ? routeIncidentId() : '';
  if (incidentId) selectedIncidentId.value = incidentId;
  if (props.section === 'reports') {
    const requestedReport = routeString(route.query.report);
    if (requestedReport) reportId.value = requestedReport;
    if (routeString(route.query.review)) reviewOpen.value = true;
  }
  await refresh();
  if (incidentId) await openIncidentRoom();
  if (props.section === 'reports' && reportId.value) await inspectReport();
}

watch(
  [
    () => props.section,
    () => route.query.focus,
    () => route.query.incident,
    () => route.query.report,
    () => route.query.review,
    () => route.query.execution_id,
  ],
  () => { void restoreSectionDeepLink(); },
);
watch(runtimeExecutionId, (id) => {
  if (id) projections.acquire(id, 'mfg-domain-strategy', 'full');
  else projections.release('mfg-domain-strategy');
}, { immediate: true });
onMounted(() => { void restoreSectionDeepLink(); });
onUnmounted(() => projections.release('mfg-domain-strategy'));
</script>

<template>
  <section class="mfg-domain" :aria-label="t('mfg.domain.aria', { title: t(titleKey) })">
    <header class="mfg-workspace-header"><div><h2>{{ t(titleKey) }}</h2><p>{{ t(summaryKey) }}</p></div><div class="mfg-domain__operation"><span v-if="operationStatus !== 'idle'" role="status" :data-status="operationStatus">{{ operationStatusLabel }} · {{ operationName }}<small>{{ operationUpdatedAt }}</small></span><button v-if="operationStatus === 'failed' && lastOperationRetryable" class="ghost-action" type="button" @click="retryLastOperation">{{ t('mfg.domain.operation.retry') }}</button><button class="ghost-action" type="button" :disabled="loading" @click="refresh"><RefreshCw :size="15" />{{ t('mfg.domain.refresh') }}</button></div></header>
    <p v-if="error" class="settings-alert">{{ error }}</p>
    <RecoveryActions :error="operationApiError" @action="recoverOperation" />

    <div v-if="section === 'data'" class="mfg-domain__grid">
      <article class="mfg-domain__panel"><header><Database :size="16" /><h3>{{ t('mfg.domain.data.sourcePacks') }}</h3></header><dl class="mfg-kv"><dt>{{ t('mfg.domain.data.facts') }}</dt><dd>{{ health.fact_count || 0 }}</dd><dt>{{ t('mfg.domain.data.watermarks') }}</dt><dd>{{ health.data_plane_watermark_count || 0 }}</dd><dt>{{ t('mfg.domain.data.connectors') }}</dt><dd>{{ health.connector_run_count || 0 }}</dd><dt>{{ t('mfg.domain.data.dataPlane') }}</dt><dd>{{ data.dataPlaneHealth?.status || data.dataPlaneHealth?.kind || '—' }}</dd></dl><div class="mfg-domain__form-grid"><label class="mfg-field"><span>{{ t('mfg.domain.data.sourcePackId') }}</span><input v-model="sourcePackId" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.sourceName') }}</span><input v-model="sourceName" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.owner') }}</span><input v-model="sourceOwner" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.accessMode') }}</span><select v-model="sourceAccessMode"><option value="file">file</option><option value="api">api</option><option value="db_view">db_view</option><option value="manual">manual</option></select></label><label class="mfg-field"><span>{{ t('mfg.domain.data.refreshMode') }}</span><select v-model="sourceRefreshMode"><option value="manual">manual</option><option value="scheduled">scheduled</option><option value="incremental">incremental</option></select></label><label class="mfg-field"><span>{{ t('mfg.domain.data.sourceTable') }}</span><input v-model="sourceTable" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.factType') }}</span><input v-model="factType" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.metricKey') }}</span><input v-model="metricKey" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.dedupKey') }}</span><input v-model="dedupKey" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.deltaSignature') }}</span><input v-model="deltaSignature" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.sourceEntity') }}</span><input v-model="sourceEntity" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.matrixEntityType') }}</span><input v-model="matrixEntityType" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.sourceKeyField') }}</span><input v-model="sourceKeyField" /></label></div><div class="button-row"><button class="primary-action" type="button" :disabled="!canManageData" @click="upsertSourcePack"><Database :size="15" />{{ t('mfg.domain.data.saveSourcePack') }}</button><button class="ghost-action" type="button" @click="inspectSourcePack">{{ t('mfg.domain.data.inspectSourcePack') }}</button><button class="ghost-action" type="button" @click="validateSourcePack">{{ t('mfg.domain.data.validateSourcePack') }}</button><button class="ghost-action" type="button" @click="planSourceDelta">{{ t('mfg.domain.data.deltaPlan') }}</button><button class="ghost-action" type="button" @click="planDataPlaneIngest">{{ t('mfg.domain.data.ingestPlan') }}</button><button class="ghost-action" type="button" :disabled="!canManageData" @click="initializeKernel">{{ t('mfg.domain.data.seedKernel') }}</button></div><ObjectInspectorDrawer :title="t('mfg.domain.data.sourcePacks')" :data="data.sourcePackResult || data.dataPlaneHealth || {}" /></article>
      <article class="mfg-domain__panel"><header><Activity :size="16" /><h3>{{ t('mfg.domain.data.connectorRun') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.data.resourceRef') }}</span><input v-model="connectorResourceRef" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.expectedRows') }}</span><input v-model.number="connectorExpectedRows" type="number" min="0" /></label><label class="mfg-field"><span>{{ t('mfg.domain.data.runId') }}</span><input v-model="connectorRunId" /></label><div class="button-row"><button class="ghost-action" type="button" :disabled="!canManageData" @click="planConnectorRun">{{ t('mfg.domain.data.planConnector') }}</button><button class="primary-action" type="button" :disabled="!canManageData" @click="runConnector">{{ t('mfg.domain.data.runConnector') }}</button><button class="ghost-action" type="button" @click="inspectConnectorRun">{{ t('mfg.domain.data.inspectConnector') }}</button></div><ObjectInspectorDrawer :title="t('mfg.domain.data.connectors')" :data="data.sourcePackResult || {}" /></article>
      <article class="mfg-domain__panel mfg-domain__panel--wide"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.data.ingest') }}</h3></header><textarea v-model="factPayload" rows="9" class="json-input" :placeholder="t('mfg.domain.data.factPayload')" /><button class="primary-action" type="button" :disabled="!canManageData" @click="ingestFacts"><Send :size="15" />{{ t('mfg.domain.data.ingestFacts') }}</button><RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" /></article>
    </div>

    <div v-else-if="section === 'reality'" class="mfg-domain__grid">
      <article class="mfg-domain__panel"><header><Activity :size="16" /><h3>{{ t('mfg.domain.reality.metrics') }}</h3></header><DataTable v-if="data.metrics.length" :rows="data.metrics" :columns="['metric_id', 'name', 'unit', 'status']" row-key="metric_id" @row-click="inspectMetric($event.metric_id || '')" /><EmptyState v-else :title="t('mfg.domain.emptyMetrics')" /><GraphSurface v-if="metricGraph.nodes.length" :model="metricGraph" /></article>
      <article class="mfg-domain__panel"><header><Database :size="16" /><h3>{{ t('mfg.domain.reality.entities') }}</h3></header><DataTable v-if="data.entities.length" :rows="data.entities" :columns="['entity_id', 'entity_type', 'display_name', 'confidence']" row-key="entity_id" @row-click="inspectEntity($event.entity_id || '')" /><EmptyState v-else :title="t('mfg.domain.emptyEntities')" /><GraphSurface v-if="entityGraph.nodes.length" :model="entityGraph" /></article>
      <article class="mfg-domain__panel"><header><Database :size="16" /><h3>{{ t('mfg.domain.reality.entityOperations') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.reality.entityId') }}</span><input v-model="selectedEntityId" /></label><label class="mfg-field"><span>{{ t('mfg.domain.reality.displayName') }}</span><input v-model="entityDisplayName" /></label><label class="mfg-field"><span>{{ t('mfg.domain.reality.entityType') }}</span><input v-model="entityType" /></label><div class="button-row"><button class="primary-action" type="button" :disabled="!canManageData" @click="upsertEntity">{{ t('mfg.domain.reality.upsertEntity') }}</button><button class="ghost-action" type="button" @click="inspectEntity()">{{ t('mfg.domain.reality.inspectImpact') }}</button></div><label class="mfg-field"><span>{{ t('mfg.domain.reality.sourceSystem') }}</span><input v-model="sourceSystem" /></label><label class="mfg-field"><span>{{ t('mfg.domain.reality.sourceKey') }}</span><input v-model="sourceKey" /></label><button class="ghost-action" type="button" @click="resolveEntity">{{ t('mfg.domain.reality.resolveSourceKey') }}</button><label class="mfg-field"><span>{{ t('mfg.domain.reality.relationTarget') }}</span><input v-model="relationTargetId" /></label><label class="mfg-field"><span>{{ t('mfg.domain.reality.relationType') }}</span><input v-model="relationType" /></label><button class="ghost-action" type="button" :disabled="!canManageData" @click="upsertRelation">{{ t('mfg.domain.reality.upsertRelation') }}</button><ObjectInspectorDrawer :title="t('mfg.domain.reality.entityOperations')" :data="data.entityResolution || data.entityDetail || {}" /></article>
      <article class="mfg-domain__panel"><header><Activity :size="16" /><h3>{{ t('mfg.domain.reality.metricOperations') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.reality.metricId') }}</span><input v-model="selectedMetricId" /></label><label class="mfg-field"><span>{{ t('mfg.domain.reality.triggerFactType') }}</span><input v-model="triggerFactType" /></label><div class="button-row"><button class="ghost-action" type="button" @click="inspectMetric()">{{ t('mfg.domain.reality.inspectLineage') }}</button><button class="ghost-action" type="button" :disabled="!canManageData" @click="materializeMetricSnapshot">{{ t('mfg.domain.reality.materializeSnapshot') }}</button><button class="ghost-action" type="button" @click="planMetricAttention">{{ t('mfg.domain.reality.attentionPlan') }}</button><button class="ghost-action" type="button" :disabled="!canManageData" @click="recomputeMetrics">{{ t('mfg.domain.reality.recompute') }}</button></div><label class="mfg-field"><span>{{ t('mfg.domain.reality.computeJobId') }}</span><input v-model="computeJobId" /></label><div class="button-row"><button class="ghost-action" type="button" :disabled="!canManageData" @click="planComputeJob">{{ t('mfg.domain.reality.planCompute') }}</button><button class="primary-action" type="button" :disabled="!canManageData" @click="runComputeJob">{{ t('mfg.domain.reality.runCompute') }}</button><button class="ghost-action" type="button" @click="inspectComputeJob">{{ t('mfg.domain.reality.inspectJob') }}</button></div><ObjectInspectorDrawer :title="t('mfg.domain.reality.metricOperations')" :data="data.computeResult || data.metricDetail || {}" /></article>
      <article class="mfg-domain__panel mfg-domain__panel--wide"><header><Activity :size="16" /><h3>{{ t('mfg.domain.reality.attention') }}</h3></header><DataTable v-if="data.attention.length" :rows="data.attention" :columns="['attention_id', 'title', 'priority_score', 'severity', 'status']" row-key="attention_id" @row-click="selectedAttentionId = $event.attention_id || ''" /><EmptyState v-else :title="t('mfg.domain.emptyAttention')" /><button class="primary-action" type="button" :disabled="(!selectedEntityId && !selectedMetricId && !selectedAttentionId) || !canOperateIncidents" @click="openIncidentFromReality">{{ t('mfg.domain.reality.createIncident') }}</button></article>
      <article class="mfg-domain__panel mfg-domain__panel--wide"><header><Activity :size="16" /><h3>{{ t('mfg.domain.reality.changes') }}</h3></header><DataTable v-if="data.changes.length" :rows="data.changes" :columns="['change_id', 'metric_id', 'entity_ref', 'severity', 'status', 'updated_at']" row-key="change_id" /><EmptyState v-else :title="t('mfg.domain.reality.noChanges')" /></article>
    </div>

    <div v-else-if="section === 'evidence'" class="mfg-domain__grid">
      <article class="mfg-domain__panel"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.evidence.packet') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.evidence.attention') }}</span><select v-model="selectedAttentionId"><option value="">{{ t('mfg.domain.evidence.selectAttention') }}</option><option v-for="item in data.attention" :key="item.attention_id" :value="item.attention_id">{{ item.title || item.attention_id }}</option></select></label><label class="mfg-field"><span>{{ t('mfg.domain.evidence.packetId') }}</span><input v-model="evidenceId" /></label><button class="primary-action" type="button" :disabled="!canManageData" @click="buildEvidence">{{ t('mfg.domain.evidence.build') }}</button><button class="ghost-action" type="button" @click="inspectEvidence">{{ t('mfg.domain.evidence.inspect') }}</button></article>
      <article class="mfg-domain__panel"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.evidence.trace') }}</h3></header><EvidenceTrace :items="evidenceItems" :title="t('mfg.domain.evidence.trace')" /><dl v-if="evidencePacket.packet_id" class="mfg-kv"><dt>{{ t('mfg.domain.evidence.missingSources') }}</dt><dd>{{ (evidencePacket.missing_evidence || []).join(', ') || '—' }}</dd><dt>{{ t('mfg.domain.evidence.consumers') }}</dt><dd>{{ evidenceContextItem.kind || evidenceContextItem.type || '—' }}</dd><dt>{{ t('mfg.domain.evidence.confidence') }}</dt><dd>{{ evidencePacket.confidence ?? '—' }}</dd></dl><ObjectInspectorDrawer :title="t('mfg.domain.evidence.detail')" :data="data.evidence || {}" /></article>
      <article class="mfg-domain__panel mfg-domain__panel--wide"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.evidence.qualityGate') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.evidence.qualityGateId') }}</span><input v-model="qualityGateId" /></label><div class="button-row"><button class="primary-action" type="button" :disabled="!evidenceId || !canManageData" @click="evaluateEvidenceQuality">{{ t('mfg.domain.evidence.evaluateQuality') }}</button><button class="ghost-action" type="button" :disabled="!qualityGateId" @click="inspectQualityGate">{{ t('mfg.domain.evidence.inspectQuality') }}</button></div><dl v-if="qualityDecision.gate_id" class="mfg-kv"><dt>{{ t('mfg.domain.evidence.decision') }}</dt><dd>{{ qualityDecision.decision }}</dd><dt>{{ t('mfg.domain.evidence.remediation') }}</dt><dd>{{ (qualityDecision.required_actions || []).join(', ') || '—' }}</dd><dt>{{ t('mfg.domain.evidence.reasons') }}</dt><dd>{{ (qualityDecision.reasons || []).join(', ') || '—' }}</dd></dl><ObjectInspectorDrawer :title="t('mfg.domain.evidence.qualityGate')" :data="data.qualityGate || data.evidence?.context || {}" /></article>
    </div>

    <div v-else-if="section === 'operations'" class="mfg-domain__grid">
      <article class="mfg-domain__panel"><header><Activity :size="16" /><h3>{{ t('mfg.domain.operations.incidents') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.operations.incidentTitle') }}</span><textarea v-model="incidentTitle" rows="3" /></label><button class="primary-action" type="button" @click="createIncident">{{ t('mfg.domain.operations.createIncident') }}</button><label class="mfg-field"><span>{{ t('mfg.domain.operations.incident') }}</span><select v-model="selectedIncidentId" @change="openIncidentRoom"><option value="">{{ t('mfg.domain.operations.selectIncident') }}</option><option v-for="incident in data.incidents" :key="incident.incident_id" :value="incident.incident_id">{{ incident.title || incident.incident_id }}</option></select></label></article>
      <article class="mfg-domain__panel"><header><Wrench :size="16" /><h3>{{ t('mfg.domain.operations.actions') }}</h3></header><div class="button-row"><button class="ghost-action" type="button" @click="analyzeIncident">{{ t('mfg.domain.operations.analyze') }}</button><button class="ghost-action" type="button" @click="recommendPlaybooks">{{ t('mfg.domain.operations.recommendPlaybooks') }}</button><button class="ghost-action" type="button" @click="planSkills">{{ t('mfg.domain.operations.planSkills') }}</button><button class="ghost-action" type="button" @click="promoteCase">{{ t('mfg.domain.operations.promoteCase') }}</button></div><DataTable v-if="recommendedActions.length" :rows="recommendedActions" :columns="['action_id', 'title', 'risk', 'governance', 'status']" row-key="action_id" @row-click="selectedActionId = $event.action_id || ''" /><label class="mfg-field"><span>{{ t('mfg.domain.operations.executionMode') }}</span><select v-model="executionMode"><option value="dry_run">dry_run</option><option value="commit">commit</option></select></label><div class="button-row"><button class="ghost-action" type="button" :disabled="!selectedActionId" @click="planAction">{{ t('mfg.domain.operations.planPreflight') }}</button><button class="primary-action" type="button" :disabled="!selectedActionId" @click="executeAction">{{ t('mfg.domain.operations.executeAction') }}</button><button class="ghost-action" type="button" :disabled="!executionId" @click="bridgeExecution">{{ t('mfg.domain.operations.bridgeExecution') }}</button></div><label class="mfg-field"><span>{{ t('mfg.domain.operations.executionId') }}</span><input v-model="executionId" /></label><label class="mfg-field"><span>{{ t('mfg.domain.operations.feedbackOutcome') }}</span><select v-model="feedbackOutcome"><option value="resolved">resolved</option><option value="accepted">accepted</option><option value="rejected">rejected</option><option value="needs_followup">needs_followup</option></select></label><label class="mfg-field"><span>{{ t('mfg.domain.operations.feedbackNote') }}</span><input v-model="feedbackNote" /></label><label class="mfg-field"><span>{{ t('mfg.domain.operations.metricDelta') }}</span><input v-model.number="feedbackMetricDelta" type="number" step="any" /></label><button class="ghost-action" type="button" :disabled="!executionId || !feedbackNote" @click="recordExecutionFeedback">{{ t('mfg.domain.operations.recordFeedback') }}</button><RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" /><ObjectInspectorDrawer v-if="data.actionLoop" :title="t('mfg.domain.operations.actionLoop')" :data="data.actionLoop" /><ObjectInspectorDrawer :title="t('mfg.domain.operations.room')" :data="data.room || {}" /></article>
      <StrategyDecisionSummary
        v-if="runtimeProjection?.strategy"
        class="mfg-domain__panel--wide"
        :strategy="runtimeProjection.strategy"
        :agents="runtimeProjection.agents"
        :execution-id="runtimeExecutionId"
        :connection-state="projections.stateFor(runtimeExecutionId)"
        surface="mfg"
      />
      <article class="mfg-domain__panel mfg-domain__panel--wide"><header><Activity :size="16" /><h3>{{ t('mfg.domain.operations.decisionTrace') }}</h3></header><button class="ghost-action" type="button" @click="loadDecisionTrace">{{ t('mfg.domain.operations.refreshDecisionTrace') }}</button><GraphSurface v-if="decisionGraph.nodes.length" :model="decisionGraph" /><EmptyState v-else :title="t('mfg.domain.operations.noDecisionTrace')" /><ObjectInspectorDrawer :title="t('mfg.domain.operations.decisionTrace')" :data="data.decisionTrace || {}" /></article>
      <article class="mfg-domain__panel"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.operations.cases') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.operations.caseId') }}</span><input v-model="selectedCaseId" /></label><label class="mfg-field"><span>{{ t('mfg.domain.reports.caseSearch') }}</span><input v-model="caseQuery" /></label><div class="button-row"><button class="ghost-action" type="button" @click="inspectCase">{{ t('mfg.domain.operations.inspectCase') }}</button><button class="ghost-action" type="button" @click="searchCases">{{ t('mfg.domain.reports.searchCases') }}</button></div><DataTable v-if="data.cases.length" :rows="data.cases" :columns="['case_id', 'title', 'status', 'updated_at']" row-key="case_id" @row-click="selectedCaseId = $event.case_id || ''" /><ObjectInspectorDrawer :title="t('mfg.domain.operations.cases')" :data="data.caseDetail || {}" /></article>
      <article class="mfg-domain__panel"><header><Wrench :size="16" /><h3>{{ t('mfg.domain.operations.playbooks') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.operations.playbookId') }}</span><input v-model="selectedPlaybookId" /></label><textarea v-model="playbookPayload" rows="5" class="json-input" :placeholder="t('mfg.domain.operations.playbookPayload')" /><div class="button-row"><button class="ghost-action" type="button" @click="inspectPlaybook">{{ t('mfg.domain.operations.inspectPlaybook') }}</button><button class="primary-action" type="button" @click="upsertPlaybook">{{ t('mfg.domain.operations.savePlaybook') }}</button></div><ObjectInspectorDrawer :title="t('mfg.domain.operations.playbooks')" :data="data.playbook || {}" /></article>
    </div>

    <div v-else-if="section === 'skills'" class="mfg-domain__grid"><article class="mfg-domain__panel"><header><Play :size="16" /><h3>{{ t('mfg.domain.skills.available') }}</h3></header><DataTable v-if="data.skills.length" :rows="data.skills" :columns="['skill_id', 'name', 'risk', 'status']" row-key="skill_id" @row-click="selectedSkillId = $event.skill_id || ''" /><EmptyState v-else :title="t('mfg.domain.skills.empty')" /><button class="ghost-action" type="button" :disabled="!selectedSkillId" @click="inspectSkill">{{ t('mfg.domain.skills.inspect') }}</button><ObjectInspectorDrawer :title="t('mfg.domain.skills.available')" :data="data.skillDetail || {}" /></article><article class="mfg-domain__panel"><header><Play :size="16" /><h3>{{ t('mfg.domain.skills.execution') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.operations.incident') }}</span><select v-model="selectedIncidentId"><option value="">{{ t('mfg.domain.operations.selectIncident') }}</option><option v-for="incident in data.incidents" :key="incident.incident_id" :value="incident.incident_id">{{ incident.title || incident.incident_id }}</option></select></label><button class="ghost-action" type="button" @click="planSkills">{{ t('mfg.domain.operations.planSkills') }}</button><button class="primary-action" type="button" :disabled="!selectedSkillId" @click="runSkill"><Play :size="15" />{{ t('mfg.domain.skills.run') }}</button><label class="mfg-field"><span>{{ t('mfg.domain.skills.runId') }}</span><input v-model="selectedSkillRunId" /></label><button class="ghost-action" type="button" :disabled="!selectedSkillRunId" @click="inspectSkillRun">{{ t('mfg.domain.skills.inspectRun') }}</button><RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" /><ObjectInspectorDrawer :title="t('mfg.domain.skills.execution')" :data="data.skillRun || receipt || {}" /></article></div>

    <div v-else class="mfg-domain__grid">
      <article class="mfg-domain__panel">
        <header><Send :size="16" /><h3>{{ t('mfg.domain.reports.delivery') }}</h3></header>
        <p class="mfg-domain__note">{{ t('mfg.domain.reports.profile', { profile: cockpit.selectedProfile?.display_name || cockpit.selectedProfileId || '—' }) }}</p>
        <label class="mfg-field"><span>{{ t('mfg.domain.reports.reportId') }}</span><input v-model="reportId" /></label>
        <div class="button-row">
          <button class="primary-action" type="button" :disabled="!cockpit.selectedProfileId || !canGenerateReports" @click="generateReport"><Send :size="15" />{{ t('mfg.domain.reports.generate') }}</button>
          <button class="ghost-action" type="button" :disabled="!reportId" @click="inspectReport">{{ t('mfg.domain.reports.inspect') }}</button>
          <button class="ghost-action" type="button" :disabled="!reportId || !canDeliverReports" @click="deliverReport">{{ t('mfg.domain.reports.deliver') }}</button>
          <button class="ghost-action" type="button" :disabled="!reportId || !canDeliverReports || (reportDeliveryState.classification && !reportDeliveryState.retryable)" @click="retryReport">{{ t('mfg.domain.reports.retry') }}</button>
          <button class="ghost-action" type="button" :disabled="!reportId || !reportDeliveryState.dead_lettered || !canDeliverReports" @click="reviewOpen = true">Manual review</button>
          <button class="ghost-action" type="button" :disabled="!canGenerateReports" @click="runReportSchedule">{{ t('mfg.domain.reports.runSchedule') }}</button>
        </div>
        <RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" />
        <section v-if="reportDeliveryState.classification" class="object-inspector mfg-delivery-state" :data-status="reportDeliveryState.dead_lettered ? 'error' : reportDeliveryState.classification">
          <header><h3>{{ t('mfg.domain.reports.deliveryState') }}</h3><span>{{ reportDeliveryState.classification }}</span></header>
          <dl class="detail-list">
            <dt>{{ t('mfg.domain.reports.attempts') }}</dt><dd>{{ reportDeliveryState.attempt_count }}</dd>
            <dt>{{ t('mfg.domain.reports.retryAttempts') }}</dt><dd>{{ reportDeliveryState.retry_attempt_count || 0 }} / {{ reportDeliveryState.max_attempts || '—' }}</dd>
            <dt>{{ t('mfg.domain.reports.retryable') }}</dt><dd>{{ reportDeliveryState.retryable ? t('boolean.yes') : t('boolean.no') }}</dd>
            <dt>{{ t('mfg.domain.reports.deadLettered') }}</dt><dd>{{ reportDeliveryState.dead_lettered ? t('boolean.yes') : t('boolean.no') }}</dd>
            <dt>{{ t('mfg.domain.reports.recommendedMode') }}</dt><dd>{{ reportDeliveryState.recommended_mode || '—' }}</dd>
            <dt>{{ t('mfg.domain.reports.reasons') }}</dt><dd>{{ (reportDeliveryState.reasons || []).join(', ') || '—' }}</dd>
          </dl>
        </section>
      </article>
      <article class="mfg-domain__panel">
        <header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.reports.history') }}</h3></header>
        <DataTable v-if="data.reports.length" :rows="data.reports" :columns="['report_id', 'profile_id', 'cadence', 'status', 'created_at']" row-key="report_id" @row-click="reportId = $event.report_id || ''; inspectReport()" />
        <EmptyState v-else :title="t('mfg.domain.reports.historyEmpty')" :detail="t('mfg.domain.reports.historyDetail')" />
        <ObjectInspectorDrawer v-if="data.report" :title="t('mfg.domain.reports.history')" :data="{ report: data.report, delivery: data.delivery, surface_outbox_and_dead_letters: data.reportOutbox }" />
      </article>
      <article class="mfg-domain__panel mfg-domain__panel--wide">
        <header><Activity :size="16" /><h3>{{ t('mfg.domain.operations.decisionTrace') }}</h3></header>
        <GraphSurface v-if="decisionGraph.nodes.length" :model="decisionGraph" />
        <EmptyState v-else :title="t('mfg.domain.operations.noDecisionTrace')" />
      </article>
    </div>
    <MfgReportReviewDrawer
      v-if="reviewOpen && reportId"
      :report-id="reportId"
      :review-id="routeString(route.query.review)"
      :report-revision="Number(reportSnapshot.revision || 0)"
      :dead-lettered="Boolean(reportDeliveryState.dead_lettered)"
      :can-review="canReviewReports"
      @updated="reviewUpdated"
      @close="reviewOpen = false"
    />
  </section>
</template>

<style scoped>
.mfg-domain { display: grid; gap: 14px; }.mfg-workspace-header { display: flex; justify-content: space-between; gap: 16px; align-items: start; padding-bottom: 12px; border-bottom: 1px solid var(--border); }.mfg-workspace-header h2, .mfg-domain__panel h3 { margin: 0; color: var(--text); }.mfg-workspace-header h2 { font-size: 18px; }.mfg-workspace-header p, .mfg-domain__note { margin: 5px 0 0; color: var(--text-muted); font-size: 13px; }.mfg-domain__operation { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 7px; }.mfg-domain__operation span { display: grid; gap: 2px; color: var(--text-muted); font-size: 11px; text-align: right; }.mfg-domain__operation span[data-status="running"] { color: var(--info); }.mfg-domain__operation span[data-status="failed"] { color: var(--warn); }.mfg-domain__operation span[data-status="succeeded"] { color: var(--success); }.mfg-domain__operation small { color: var(--text-faint); font: 9px var(--font-mono); }.mfg-domain__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.mfg-domain__panel { min-width: 0; display: grid; align-content: start; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }.mfg-domain__panel--wide { grid-column: 1 / -1; }.mfg-domain__panel > header { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }.mfg-domain__panel h3 { font-size: 14px; }.mfg-domain__form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.mfg-kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; margin: 0; }.mfg-kv dt { color: var(--text-muted); }.mfg-kv dd { margin: 0; color: var(--text); font-variant-numeric: tabular-nums; }.mfg-field { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }.mfg-field input, .mfg-field select, .mfg-field textarea { min-width: 0; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 8px 9px; }.json-input { min-width: 0; width: 100%; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 9px; font-family: var(--font-mono); }.button-row { display: flex; flex-wrap: wrap; gap: 8px; }.mfg-delivery-state .detail-list dd { overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere; }@media (max-width: 820px) { .mfg-workspace-header { flex-direction: column; }.mfg-domain__operation { justify-content: flex-start; }.mfg-domain__operation span { text-align: left; }.mfg-domain__grid, .mfg-domain__form-grid { grid-template-columns: 1fr; } }
</style>
