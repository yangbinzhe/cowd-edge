<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { api } from '../api/client';
import { useAppStore } from '../stores/app';
import DataTable from '../components/workbench/DataTable.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import ApiStateBanner from '../components/workbench/ApiStateBanner.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import mfgWriteContracts from '../data/mfgWriteContracts.json';

const ChartPanel = defineAsyncComponent(() => import('../components/ChartPanel.vue'));
const store = useAppStore();
const loading = ref(false);
const error = ref('');
const state = ref<any>({});
const result = ref<any>(null);
const incidentTitle = ref('Line A torque deviation threatens QA-2026-0616 shipment');
const selectedIncidentId = ref('');
const selectedSkillId = ref('');
const selectedSkillRunId = ref('');
const selectedActionId = ref('');
const selectedCaseId = ref('');
const selectedPlaybookId = ref('webui-playbook');
const cockpitProfileId = ref('webui-manufacturing');
const cockpitOwnerRef = ref('user:webui-operator');
const cockpitReportId = ref('');
const sourcePackId = ref('webui-server-manufacturing');
const selectedMetricId = ref('torque_deviation_rate');
const selectedEntityId = ref('');
const relationTargetId = ref('');
const evidenceId = ref('');
const qualityGateId = ref('');
const computeJobId = ref('');
const connectorRunId = ref('');
const factPayload = ref('');
const dataPlaneResult = ref<any>(null);
const sourcePackResult = ref<any>(null);
const entityResult = ref<any>(null);
const metricResult = ref<any>(null);
const evidenceResult = ref<any>(null);
const mfgLiveQuarantine = true;
const contractsById = computed(() => Object.fromEntries((mfgWriteContracts as any[]).map((contract) => [contract.id, contract])));

function items(collection: any, key: string) {
  return Array.isArray(collection?.[key]) ? collection[key] : Array.isArray(collection?.items) ? collection.items : [];
}

const metricChart = computed(() => {
  const health = state.value?.health || {};
  return [
    { name: 'facts', value: Number(health.fact_count || 0) },
    { name: 'metrics', value: Number(health.metric_definition_count || 0) },
    { name: 'attention', value: Number(health.attention_count || 0) },
    { name: 'incidents', value: Number(health.incident_count || 0) },
    { name: 'executions', value: Number(health.execution_count || 0) },
  ];
});

const incidents = computed(() => items(state.value?.incidents, 'items'));
const metrics = computed(() => items(state.value?.metrics, 'metrics'));
const entities = computed(() => items(state.value?.entities, 'entities'));
const attention = computed(() => items(state.value?.attention, 'items'));
const skills = computed(() => items(state.value?.skills, 'items'));
const room = computed(() => state.value?.room || {});
const analysis = computed(() => room.value?.analysis || result.value?.analysis || result.value?.operational_analysis);
const recommendedActions = computed(() => analysis.value?.recommended_actions || []);
const skillRuns = computed(() => room.value?.skill_runs || room.value?.skills || []);
const contractSummary = computed(() => ({
  count: (mfgWriteContracts as any[]).length,
  domains: Array.from(new Set((mfgWriteContracts as any[]).map((contract) => displayContractDomain(contract.domain)))).join('、'),
  quarantined: (mfgWriteContracts as any[]).filter((contract) => String(contract.live_policy || '').includes('quarantined')).length,
}));

const contractDomainKeys: Record<string, string> = {
  'Data Plane': 'mfg.contract.domain.dataPlane',
  Facts: 'mfg.contract.domain.facts',
  Entities: 'mfg.contract.domain.entities',
  Metrics: 'mfg.contract.domain.metrics',
  Evidence: 'mfg.contract.domain.evidence',
  Incidents: 'mfg.contract.domain.incidents',
  Cockpit: 'mfg.contract.domain.cockpit',
};

function displayContractDomain(domain: string) {
  return t(contractDomainKeys[domain] || 'mfg.contract.domain.unknown', { domain });
}
const decisionTraceRows = computed(() => {
  const traceRows = items(state.value?.decisionTrace, 'rows');
  if (traceRows.length) return traceRows;
  const firstMetric = metrics.value[0] || {};
  const firstEntity = entities.value[0] || {};
  const firstAttention = attention.value[0] || {};
  const firstIncident = incidents.value[0] || {};
  const firstAction = recommendedActions.value[0] || {};
  const reportRef = cockpitReportId.value || result.value?.report?.report?.report_id || result.value?.report_id || '';
  return [
    {
      stage: 'source',
      ref: `source-pack://${sourcePackId.value}`,
      domain: 'Matrix data plane',
      signal: state.value?.dataPlane?.status || state.value?.dataPlane?.mode || 'configured',
      next: 'validate source pack / ingest plan',
    },
    {
      stage: 'fact',
      ref: state.value?.health?.fact_count ? `${state.value.health.fact_count} structured facts` : 'manufacturing_quality_event',
      domain: 'cowd structured core',
      signal: state.value?.health?.schema_version || 'schema pending',
      next: 'bind facts to entities and metrics',
    },
    {
      stage: 'entity',
      ref: firstEntity.entity_id || selectedEntityId.value || 'entity pending',
      domain: firstEntity.entity_type || 'Matrix entity graph',
      signal: firstEntity.canonical_key || firstEntity.display_name || 'resolution pending',
      next: 'trace relations and impact paths',
    },
    {
      stage: 'metric',
      ref: firstMetric.metric_id || selectedMetricId.value || 'metric pending',
      domain: 'Matrix metric engine',
      signal: firstMetric.status || firstMetric.name || 'lineage pending',
      next: 'materialize snapshot / attention plan',
    },
    {
      stage: 'attention',
      ref: firstAttention.attention_id || 'attention pending',
      domain: 'Matrix attention',
      signal: firstAttention.severity || firstAttention.reason || 'hot queue pending',
      next: 'build evidence packet',
    },
    {
      stage: 'evidence',
      ref: evidenceId.value || evidenceResult.value?.packet?.packet_id || 'evidence pending',
      domain: 'cowd context evidence',
      signal: qualityGateId.value || evidenceResult.value?.quality_gate?.status || 'quality gate pending',
      next: 'open incident room',
    },
    {
      stage: 'incident',
      ref: firstIncident.incident_id || selectedIncidentId.value || 'incident pending',
      domain: 'MFG application',
      signal: firstIncident.status || firstIncident.title || 'analysis pending',
      next: 'plan skills and actions',
    },
    {
      stage: 'action',
      ref: firstAction.action_id || selectedActionId.value || 'action pending',
      domain: 'MFG + cross-plane',
      signal: firstAction.title || result.value?.execution?.status || 'dry-run pending',
      next: 'receipt / feedback / report',
    },
    {
      stage: 'report',
      ref: reportRef || cockpitProfileId.value,
      domain: 'MFG cockpit',
      signal: cockpitReportId.value ? 'delivery trackable' : 'profile ready',
      next: 'delivery state / retry governance',
    },
  ];
});
const mfgContext = computed(() => [
  { label: t('script.pages.mfgpage.label.b291beb879'), value: 'MFG', tone: 'success' },
  { label: t('script.pages.mfgpage.label.0a5e7a0583'), value: 'mfg -> reality' },
  { label: t('script.pages.mfgpage.label.e730d6f3dc'), value: sourcePackId.value },
  { label: t('script.pages.mfgpage.label.08c257849b'), value: selectedIncidentId.value || incidents.value[0]?.incident_id || 'pending', tone: incidents.value.length ? 'warn' : 'default' },
]);
const mfgWorkflow = computed(() => [
  { id: 'data-plane', label: t('script.pages.mfgpage.label.6da13addb0'), status: sourcePackResult.value ? 'done' : 'idle', description: sourcePackId.value },
  { id: 'data-plane', label: t('script.pages.mfgpage.label.e0930077f2'), status: dataPlaneResult.value ? 'done' : 'idle', count: state.value?.health?.fact_count || 0 },
  { id: 'entities', label: t('script.pages.mfgpage.label.c7fb317725'), status: entities.value.length ? 'ready' : 'idle', count: entities.value.length },
  { id: 'metrics', label: t('script.pages.mfgpage.label.b2bb7604c8'), status: metrics.value.length ? 'ready' : 'idle', count: metrics.value.length },
  { id: 'evidence', label: t('script.pages.mfgpage.label.7ea014de7b'), status: evidenceResult.value ? 'active' : 'idle', description: evidenceId.value || 'pending' },
  { id: 'incident-room', label: t('script.pages.mfgpage.label.08c257849b'), status: incidents.value.length ? 'blocked' : 'idle', count: incidents.value.length },
  { id: 'actions', label: t('script.pages.mfgpage.label.97c89a4d66'), status: result.value?.execution ? 'active' : 'idle', description: selectedActionId.value || 'dry-run' },
  { id: 'reports', label: t('script.pages.mfgpage.label.ee45c30326'), status: cockpitReportId.value ? 'done' : 'idle', description: cockpitProfileId.value },
]);
const mfgLanes = computed(() => [
  {
    id: 'data-plane',
    title: t('script.pages.mfgpage.title.a50dea1bc7'),
    summary: t('script.pages.mfgpage.summary.ae62a02f5a'),
    health: sourcePackResult.value || dataPlaneResult.value ? 'active' : 'ready',
    count: state.value?.health?.fact_count || 0,
    target: '#data-plane',
  },
  {
    id: 'entities',
    title: t('script.pages.mfgpage.title.678d030bc9'),
    summary: t('script.pages.mfgpage.summary.e193f114b0'),
    health: entities.value.length || metrics.value.length ? 'ready' : 'idle',
    count: entities.value.length + metrics.value.length,
    target: '#entities',
  },
  {
    id: 'incident-room',
    title: t('script.pages.mfgpage.title.6e590d9512'),
    summary: t('script.pages.mfgpage.summary.422a8cfef7'),
    health: incidents.value.length ? 'blocked' : 'idle',
    count: incidents.value.length + recommendedActions.value.length,
    target: '#incident-room',
  },
  {
    id: 'reports',
    title: t('script.pages.mfgpage.title.87ea32c933'),
    summary: t('script.pages.mfgpage.summary.194357bd3f'),
    health: cockpitReportId.value ? 'done' : 'idle',
    count: cockpitReportId.value ? 1 : 0,
    target: '#reports',
  },
]);
const mfgEvidence = computed(() => [
  {
    id: sourcePackId.value,
    kind: 'mfg.source-pack',
    status: sourcePackResult.value?.status || state.value?.dataPlane?.status || 'ready',
    summary: `source-pack://${sourcePackId.value}`,
    source: 'mfg.reality.data-plane',
  },
  {
    id: selectedEntityId.value || entities.value[0]?.entity_id || 'entity-pending',
    kind: 'mfg.entity',
    status: entities.value.length ? 'ready' : 'idle',
    summary: entities.value[0]?.display_name || selectedEntityId.value || 'entity graph pending',
    source: 'mfg.reality.entities',
  },
  {
    id: selectedMetricId.value,
    kind: 'mfg.metric',
    status: metrics.value.length ? 'ready' : 'idle',
    summary: metrics.value[0]?.name || selectedMetricId.value,
    source: 'mfg.reality.metrics',
  },
  {
    id: evidenceId.value || evidenceResult.value?.packet_id || 'evidence-pending',
    kind: 'mfg.evidence',
    status: evidenceResult.value?.status || (evidenceResult.value ? 'active' : 'idle'),
    summary: evidenceResult.value?.summary || evidenceId.value || 'evidence packet pending',
    source: 'mfg.reality.evidence',
  },
  {
    id: selectedIncidentId.value || incidents.value[0]?.incident_id || 'incident-pending',
    kind: 'mfg.incident',
    status: incidents.value[0]?.status || (incidents.value.length ? 'blocked' : 'idle'),
    summary: incidents.value[0]?.title || incidentTitle.value,
    source: 'mfg.incident-room',
  },
  {
    id: selectedActionId.value || result.value?.execution?.execution_id || 'action-pending',
    kind: 'mfg.action',
    status: result.value?.execution?.status || (result.value ? 'active' : 'idle'),
    summary: selectedActionId.value || result.value?.summary || 'governed action pending',
    source: 'mfg.cross-plane',
  },
  {
    id: cockpitReportId.value || cockpitProfileId.value,
    kind: 'mfg.report',
    status: cockpitReportId.value ? 'ready' : 'idle',
    summary: cockpitReportId.value || cockpitProfileId.value,
    source: 'mfg.cockpit',
  },
]);

function quarantineReceipt(action: string, endpoint: string, payload: Record<string, unknown> = {}) {
  return {
    ok: false,
    endpoint,
    method: 'POST',
    status: 'quarantined',
    error: t('page.mfg.quarantine.message', { action }),
    payload_summary: JSON.stringify(payload).slice(0, 280),
    retryable: false,
  };
}

function contract(id: string) {
  return contractsById.value[id] || (mfgWriteContracts as any[])[0];
}

function defaultFact() {
  return {
    source_ref: `source-pack://${sourcePackId.value}`,
    fact_type: 'manufacturing_quality_event',
    entity_ref: selectedEntityId.value || 'line:A',
    metric_id: selectedMetricId.value || 'torque_deviation_rate',
    observed_at: new Date().toISOString(),
    measures: {
      deviation_rate: 0.12,
      affected_units: 8,
    },
  };
}

function parseFactPayloadOrDefault() {
  if (!factPayload.value.trim()) return [defaultFact()];
  try {
    const parsed = JSON.parse(factPayload.value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [defaultFact()];
  }
}

function sourcePackGovernedPayload() {
  return defaultSourcePack();
}

function factGovernedPayload() {
  return { facts: parseFactPayloadOrDefault() };
}

function entityGovernedPayload() {
  return {
    entity_id: selectedEntityId.value || undefined,
    entity_type: 'manufacturing_line',
    canonical_key: 'line:A',
    display_name: 'Line A',
    source_keys: [{ source_system: sourcePackId.value, source_key: 'line:A', source_ref: `source-pack://${sourcePackId.value}` }],
  };
}

function metricGovernedPayload() {
  return {
    job_id: computeJobId.value || undefined,
    metric_ids: [selectedMetricId.value || 'torque_deviation_rate'],
    entity_scope: selectedEntityId.value || undefined,
    trigger_fact_type: 'manufacturing_quality_event',
  };
}

function evidenceGovernedPayload() {
  return {
    evidence_id: evidenceId.value || undefined,
    attention_id: attention.value[0]?.attention_id,
    problem_statement: incidentTitle.value,
  };
}

function incidentGovernedPayload() {
  return {
    incident_id: selectedIncidentId.value || undefined,
    title: incidentTitle.value,
    selected_action_id: selectedActionId.value || undefined,
    mode: 'dry_run',
  };
}

function reportGovernedPayload() {
  return {
    profile_id: cockpitProfileId.value,
    owner_ref: cockpitOwnerRef.value,
    report_id: cockpitReportId.value || undefined,
    cadence: 'daily',
  };
}

async function planFactIngest() {
  try {
    dataPlaneResult.value = await api.structuredIngestPlan({
      source: 'mfg.governed_action',
      session_id: 'webui-mfg',
      ...factGovernedPayload(),
    });
  } catch (err) {
    result.value = quarantineReceipt(t('page.mfg.quarantine.factIngestPlan'), '/api/cowd/structured/ingest-plan', factGovernedPayload());
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function dryRunFactIngest() {
  dataPlaneResult.value = await api.structuredIngestPlan({
    source: 'mfg.governed_action.dry_run',
    session_id: 'webui-mfg',
    ...factGovernedPayload(),
  });
}

async function planEntityGovernance() {
  await resolveEntitySourceKey();
}

async function dryRunEntityGovernance() {
  entityResult.value = await api.mfgEntityMatchCandidate(selectedEntityId.value || 'line:A', relationTargetId.value || selectedEntityId.value || 'line:A');
}

async function planEvidenceGovernance() {
  if (evidenceId.value) await inspectEvidence();
  else await buildEvidencePacket();
}

async function dryRunEvidenceGovernance() {
  if (evidenceId.value) await inspectEvidence();
  else await planMetricAttention();
}

async function planIncidentGovernance() {
  if (selectedIncidentId.value) await planSkills();
  else result.value = quarantineReceipt(t('page.mfg.quarantine.incidentPlan'), '/api/apps/mfg/incidents/:id/skills/plan', incidentGovernedPayload());
}

async function dryRunIncidentGovernance() {
  if (selectedIncidentId.value) await recommendPlaybooks();
  else result.value = quarantineReceipt(t('page.mfg.quarantine.incidentDryRun'), '/api/apps/mfg/incidents/:id/playbooks/recommend', incidentGovernedPayload());
}

async function planActionGovernance() {
  if (selectedIncidentId.value) await analyzeIncident();
  else result.value = quarantineReceipt(t('page.mfg.quarantine.actionPlan'), '/api/apps/mfg/analyses/:analysis_id/actions/:action_id/execute', incidentGovernedPayload());
}

async function dryRunActionGovernance() {
  await executeAction();
}

async function planReportGovernance() {
  result.value = await api.mfgReportDeliveryState(cockpitReportId.value || 'pending-report');
}

async function dryRunReportGovernance() {
  result.value = quarantineReceipt(t('page.mfg.quarantine.cockpitReportDryRun'), '/api/apps/mfg/cockpit/profiles/:id/projection', reportGovernedPayload());
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [app, health, governance, dataPlane, commandCenter, live, metricsData, entitiesData, changes, attentionData, incidentsData, skillsData, decisionTrace] = await Promise.all([
      api.mfgApp(),
      api.mfgHealth(),
      api.mfgProductionGovernance(),
      api.mfgDataPlaneHealth(),
      api.mfgCommandCenter(),
      api.mfgCommandCenterLive(),
      api.mfgMetrics(),
      api.mfgEntities(),
      api.mfgChanges(),
      api.mfgAttentionHot(),
      api.mfgIncidents(),
      api.mfgSkills(),
      api.mfgDecisionTrace({ incident_id: selectedIncidentId.value || undefined, report_id: cockpitReportId.value || undefined }),
    ]);
    state.value = {
      app,
      health,
      governance,
      dataPlane,
      commandCenter,
      live,
      metrics: metricsData,
      entities: entitiesData,
      changes,
      attention: attentionData,
      incidents: incidentsData,
      skills: skillsData,
      decisionTrace,
      room: state.value?.room,
    };
    const firstIncident = items(incidentsData, 'items')[0]?.incident_id;
    if (!selectedIncidentId.value && firstIncident) {
      selectedIncidentId.value = firstIncident;
      await openIncidentRoom();
    }
    const firstSkill = items(skillsData, 'items')[0]?.skill_id;
    if (!selectedSkillId.value && firstSkill) selectedSkillId.value = firstSkill;
    const firstMetric = items(metricsData, 'metrics')[0]?.metric_id;
    if (!selectedMetricId.value && firstMetric) selectedMetricId.value = firstMetric;
    const firstEntity = items(entitiesData, 'entities')[0]?.entity_id;
    if (!selectedEntityId.value && firstEntity) selectedEntityId.value = firstEntity;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function planDataPlaneIngest() {
  dataPlaneResult.value = await api.mfgDataPlaneIngestPlan({
    source_ref: `source-pack://${sourcePackId.value}`,
    fact_type: 'manufacturing_quality_event',
    partition_ref: 'line:A',
    high_watermark: new Date().toISOString(),
    estimated_rows: 128,
    raw_checksum: 'sha256:webui-mfg-ingest-plan',
    metric_ids: [selectedMetricId.value || 'torque_deviation_rate'],
  });
}

function defaultSourcePack() {
  return {
    source_pack_id: sourcePackId.value,
    source_name: 'WebUI Server Manufacturing Pack',
    owner: 'webui-operator',
    access_mode: 'managed',
    refresh_mode: 'incremental',
    entity_mappings: [{
      source_entity: 'line',
      matrix_entity_type: 'manufacturing_line',
      source_key_field: 'line_id',
    }],
    fact_mappings: [{
      source_table: 'quality_events',
      fact_type: 'manufacturing_quality_event',
      metric_key: selectedMetricId.value || 'torque_deviation_rate',
      entity_ref_fields: ['line_id', 'station_id'],
      measure_fields: ['deviation_rate', 'affected_units'],
      dedup_key: 'batch_id',
      delta_signature: 'updated_at',
    }],
    reconciliation_rules: ['canonical_key=line_id'],
    quality_rules: ['deviation_rate must be >= 0'],
    freshness_sla: 'PT1H',
    security_policy: 'internal',
    metadata: { source: 'webui' },
  };
}

async function upsertSourcePack() {
  if (mfgLiveQuarantine) {
    sourcePackResult.value = quarantineReceipt(t('page.mfg.quarantine.sourcePackUpsert'), '/api/apps/mfg/reality/source-packs/upsert', defaultSourcePack());
    return;
  }
  sourcePackResult.value = await api.mfgSourcePackUpsert(defaultSourcePack());
  await refresh();
}

async function validateSourcePack() {
  sourcePackResult.value = await api.mfgSourcePackValidate(sourcePackId.value);
}

async function sourcePackDeltaPlan() {
  sourcePackResult.value = await api.mfgSourcePackDeltaPlan(sourcePackId.value);
}

async function planConnectorRun() {
  sourcePackResult.value = await api.mfgSourcePackConnectorPlan(sourcePackId.value, {
    source_pack_id: sourcePackId.value,
    mode: 'dry_run',
    requested_capability: 'service.read',
  });
  connectorRunId.value = sourcePackResult.value?.run?.run_id || connectorRunId.value;
}

async function executeConnectorRun() {
  if (mfgLiveQuarantine) {
    sourcePackResult.value = quarantineReceipt(t('page.mfg.quarantine.connectorRun'), `/api/apps/mfg/reality/source-packs/${sourcePackId.value}/connector-runs/run`, {
      source_pack_id: sourcePackId.value,
      mode: 'dry_run',
    });
    return;
  }
  sourcePackResult.value = await api.mfgSourcePackConnectorRun(sourcePackId.value, {
    source_pack_id: sourcePackId.value,
    mode: 'dry_run',
    requested_capability: 'service.read',
  });
  connectorRunId.value = sourcePackResult.value?.run?.run_id || connectorRunId.value;
}

async function getConnectorRun() {
  if (!connectorRunId.value) return;
  sourcePackResult.value = await api.mfgConnectorRun(connectorRunId.value);
}

async function upsertEntity() {
  if (mfgLiveQuarantine) {
    entityResult.value = quarantineReceipt(t('page.mfg.quarantine.entityUpsert'), '/api/apps/mfg/reality/entities/upsert', {
      entity_id: selectedEntityId.value || 'new',
      entity_type: 'manufacturing_line',
    });
    return;
  }
  entityResult.value = await api.mfgEntityUpsert({
    entity_id: selectedEntityId.value || undefined,
    entity_type: 'manufacturing_line',
    canonical_key: 'line:A',
    display_name: 'Line A',
    source_keys: [{ source_system: sourcePackId.value, source_key: 'line:A', source_ref: `source-pack://${sourcePackId.value}` }],
    attributes: { plant: 'webui-demo' },
    confidence: 0.98,
  });
  selectedEntityId.value = entityResult.value?.entity?.entity_id || selectedEntityId.value;
  await refresh();
}

async function inspectEntity() {
  if (!selectedEntityId.value) return;
  const [entity, relations, impact] = await Promise.all([
    api.mfgEntity(selectedEntityId.value),
    api.mfgEntityRelations(selectedEntityId.value),
    api.mfgEntityImpactPath(selectedEntityId.value),
  ]);
  entityResult.value = { entity, relations, impact };
}

async function resolveEntitySourceKey() {
  entityResult.value = await api.mfgEntityResolveSourceKey(sourcePackId.value, 'line:A');
}

async function upsertRelation() {
  if (!selectedEntityId.value || !relationTargetId.value) return;
  if (mfgLiveQuarantine) {
    entityResult.value = quarantineReceipt(t('page.mfg.quarantine.relationUpsert'), '/api/apps/mfg/reality/relations/upsert', {
      from_entity_id: selectedEntityId.value,
      to_entity_id: relationTargetId.value,
    });
    return;
  }
  entityResult.value = await api.mfgRelationUpsert({
    relation_type: 'feeds',
    from_entity_id: selectedEntityId.value,
    to_entity_id: relationTargetId.value,
    attributes: { source: 'webui' },
    confidence: 0.9,
  });
  await inspectEntity();
}

async function inspectMetric() {
  if (!selectedMetricId.value) return;
  const [detail, lineage] = await Promise.all([
    api.mfgMetricDetail(selectedMetricId.value),
    api.mfgMetricLineage(selectedMetricId.value),
  ]);
  metricResult.value = { detail, lineage };
}

async function materializeMetricSnapshot() {
  metricResult.value = await api.mfgMetricSnapshotMaterialize([selectedMetricId.value || 'torque_deviation_rate'], selectedEntityId.value || undefined);
}

async function planMetricAttention() {
  metricResult.value = await api.mfgAttentionPlan({
    trigger_fact_type: 'manufacturing_quality_event',
    entity_scope: selectedEntityId.value || undefined,
    period: 'latest',
    limit: 10,
  });
}

async function planComputeJob() {
  metricResult.value = await api.mfgComputeJobPlan({
    trigger_fact_type: 'manufacturing_quality_event',
    trigger_fact_refs: [],
    entity_scope: selectedEntityId.value || undefined,
    period: 'latest',
    metric_ids: [selectedMetricId.value || 'torque_deviation_rate'],
    priority: 0.8,
  });
  computeJobId.value = metricResult.value?.job?.job_id || metricResult.value?.plan?.job?.job_id || computeJobId.value;
}

async function runComputeJob() {
  if (!computeJobId.value) return;
  if (mfgLiveQuarantine) {
    metricResult.value = quarantineReceipt(t('page.mfg.quarantine.computeJobRun'), `/api/apps/mfg/reality/compute/jobs/${computeJobId.value}/run`, {
      job_id: computeJobId.value,
    });
    return;
  }
  metricResult.value = await api.mfgComputeJobRun(computeJobId.value);
}

async function recomputeMetrics() {
  metricResult.value = await api.mfgMetricRecompute();
  await refresh();
}

async function buildEvidencePacket() {
  evidenceResult.value = await api.mfgEvidenceBuild({
    attention_id: attention.value[0]?.attention_id,
    problem_statement: incidentTitle.value,
  });
  evidenceId.value = evidenceResult.value?.packet?.packet_id || evidenceResult.value?.evidence_packet?.packet_id || evidenceId.value;
}

async function inspectEvidence() {
  if (!evidenceId.value) return;
  const [packet, context] = await Promise.all([
    api.mfgEvidence(evidenceId.value),
    api.mfgEvidenceContext(evidenceId.value),
  ]);
  evidenceResult.value = { packet, context };
}

async function evaluateEvidenceQuality() {
  if (!evidenceId.value) return;
  evidenceResult.value = await api.mfgEvidenceQualityGate(evidenceId.value);
  qualityGateId.value = evidenceResult.value?.quality_gate?.quality_gate_id || evidenceResult.value?.gate?.quality_gate_id || qualityGateId.value;
}

async function inspectQualityGate() {
  if (!qualityGateId.value) return;
  evidenceResult.value = await api.mfgQualityGate(qualityGateId.value);
}

async function initializeManufacturingKernel() {
  if (mfgLiveQuarantine) {
    result.value = {
      domain: quarantineReceipt(t('page.mfg.quarantine.domainSeed'), '/api/apps/mfg/domain/server-manufacturing/seed'),
      ontology: quarantineReceipt(t('page.mfg.quarantine.ontologySeed'), '/api/apps/mfg/ontology/server-manufacturing/seed'),
    };
    return;
  }
  result.value = {
    domain: await api.mfgSeedDomain(),
    ontology: await api.mfgSeedOntology(),
  };
  await refresh();
}

async function ingestManufacturingFacts() {
  if (!factPayload.value.trim()) {
    error.value = t('page.mfg.error.factPayloadRequired');
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(factPayload.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    return;
  }
  const facts = Array.isArray(parsed) ? parsed : [parsed];
  const invalid = facts.some((fact: any) => !fact?.source_ref || !fact?.fact_type);
  if (invalid) {
    error.value = t('page.mfg.error.factPayloadFieldsRequired');
    return;
  }
  if (mfgLiveQuarantine) {
    result.value = quarantineReceipt(t('page.mfg.quarantine.manufacturingFactIngest'), '/api/apps/mfg/reality/facts/ingest', { facts });
    return;
  }
  result.value = await api.mfgIngestFact(facts as Record<string, unknown>[]);
  await refresh();
}

async function createIncident() {
  result.value = await api.mfgCreateIncident({
    title: incidentTitle.value,
    session_id: store.activeSessionId || 'webui-mfg',
  });
  selectedIncidentId.value = result.value?.incident?.incident_id || selectedIncidentId.value;
  await openIncidentRoom();
  await refresh();
}

async function openIncidentRoom() {
  if (!selectedIncidentId.value) return;
  const nextRoom = await api.mfgIncidentRoom(selectedIncidentId.value);
  state.value = { ...(state.value || {}), room: nextRoom };
  selectedActionId.value = (nextRoom as any).analysis?.recommended_actions?.[0]?.action_id || selectedActionId.value;
}

async function analyzeIncident() {
  if (!selectedIncidentId.value) return;
  result.value = await api.mfgAnalyzeIncident(selectedIncidentId.value);
  await openIncidentRoom();
}

async function recommendPlaybooks() {
  if (!selectedIncidentId.value) return;
  result.value = await api.mfgRecommendPlaybooks(selectedIncidentId.value, 5);
  await openIncidentRoom();
}

async function promoteCase() {
  if (!selectedIncidentId.value) return;
  result.value = await api.mfgPromoteIncidentCase(selectedIncidentId.value);
  selectedCaseId.value = result.value?.case?.case_id || result.value?.case_id || selectedCaseId.value;
  await openIncidentRoom();
}

async function inspectCase() {
  if (!selectedCaseId.value) return;
  result.value = await api.mfgCase(selectedCaseId.value);
}

async function searchCases() {
  result.value = await api.mfgCaseSearch(incidentTitle.value);
}

async function inspectPlaybook() {
  if (!selectedPlaybookId.value) return;
  result.value = await api.mfgPlaybook(selectedPlaybookId.value);
}

async function upsertPlaybook() {
  result.value = await api.mfgPlaybookUpsert({
    playbook_id: selectedPlaybookId.value,
    title: t('script.pages.mfgpage.title.eccb702859'),
    domain: 'server_manufacturing',
    steps: ['confirm metric lineage', 'open incident room', 'plan governed action'],
    risk: 'medium',
  });
}

async function planSkills() {
  if (!selectedIncidentId.value) return;
  result.value = await api.mfgPlanSkills(selectedIncidentId.value, 3);
  selectedSkillId.value = result.value?.plan?.selected_skills?.[0]?.skill_id || selectedSkillId.value;
  await openIncidentRoom();
}

async function runSkill() {
  if (!selectedIncidentId.value || !selectedSkillId.value) return;
  result.value = await api.mfgRunSkill(selectedIncidentId.value, selectedSkillId.value);
  selectedSkillRunId.value = result.value?.skill_run?.run_id || result.value?.run_id || selectedSkillRunId.value;
  await openIncidentRoom();
}

async function inspectSkillRun() {
  if (!selectedSkillRunId.value) return;
  result.value = await api.mfgSkillRun(selectedSkillRunId.value);
}

async function executeAction() {
  const analysisId = analysis.value?.analysis_id;
  if (!analysisId || !selectedActionId.value) return;
  result.value = await api.mfgExecuteAction(analysisId, selectedActionId.value, {
    mode: 'dry_run',
    operator_id: 'webui-operator',
    note: 'executed from WebUI MFG workbench',
  });
  await openIncidentRoom();
}

async function bridgeExecution() {
  const executionId = result.value?.execution?.execution_id || room.value?.executions?.[0]?.execution_id;
  if (!executionId) return;
  if (mfgLiveQuarantine) {
    result.value = quarantineReceipt(t('page.mfg.quarantine.crossPlaneExecutionBridge'), `/api/apps/mfg/executions/${executionId}/cross-plane/execute`, {
      mode: 'dry_run',
      requested_capability: 'channel.chat.send_text',
    });
    return;
  }
  result.value = await api.mfgExecutionBridge(executionId, {
    mode: 'dry_run',
    actor_principal: 'webui-operator',
    source_channel: 'channel://webui/mfg',
    requested_capability: 'channel.chat.send_text',
  });
  await openIncidentRoom();
}

async function generateReport() {
  const profile = await api.mfgUpsertProfile({
    profile_id: cockpitProfileId.value,
    owner_ref: cockpitOwnerRef.value,
    display_name: 'WebUI Manufacturing Cockpit',
    focus_refs: ['line:A', 'station:torque-03'],
    focus_metric_ids: ['torque_deviation_rate', 'station_quality_escape'],
    thresholds: { torque_deviation_rate: 0.08, station_quality_escape: 0 },
    cadence: 'daily',
  });
  const report = await api.mfgGenerateReport(cockpitProfileId.value, {
    report_id: cockpitReportId.value || undefined,
    cadence: 'daily',
    delivery_ref: 'channel://chat/user/webui-operator',
    note: 'generated from WebUI MFG workbench',
  });
  cockpitReportId.value = report?.report?.report_id || cockpitReportId.value;
  result.value = { profile, report };
  await refresh();
}

async function retryReportDelivery() {
  if (!cockpitReportId.value) return;
  if (mfgLiveQuarantine) {
    result.value = quarantineReceipt(t('page.mfg.quarantine.reportDeliveryRetry'), `/api/apps/mfg/cockpit/reports/${cockpitReportId.value}/delivery/retry`, {
      mode: 'dry_run',
      report_id: cockpitReportId.value,
    });
    return;
  }
  result.value = await api.mfgRetryReportDelivery(cockpitReportId.value, {
    mode: 'dry_run',
    force: true,
    actor_principal: 'webui-operator',
    source_channel: 'mfg.report.retry',
  });
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page mfg-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.mfg.page.text.16727ae948') }}</h1>
        <p>{{ t('page.mfg.page.text.4d4870537c') }}</p>
      </div>
      <div class="button-row">
        <button class="primary-action" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" />
          {{ loading ? t('page.mfg.page.inline.067a22a92c') : t('page.mfg.page.inline.f38b6f9334') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <ApiStateBanner
      v-if="mfgLiveQuarantine"
      status="degraded"
      :title="t('page.mfg.page.title.c04f860563')"
      :detail="t('page.mfg.page.detail.0ce99abd6b')"
      endpoint="/api/apps/mfg/*"
    />
    <PrimaryContextBar :items="mfgContext" />
    <WorkflowStrip :steps="mfgWorkflow" :title="t('page.mfg.page.title.19a9d42267')" />

    <section class="mfg-lanes" :aria-label="t('page.mfg.page.aria-label.916bf99d57')">
      <a v-for="lane in mfgLanes" :key="lane.id" class="mfg-lane" :href="lane.target" :data-status="lane.health">
        <span>{{ lane.title }}</span>
        <strong>{{ lane.count }}</strong>
        <p>{{ lane.summary }}</p>
      </a>
    </section>

    <section class="metric-row" :aria-label="t('page.mfg.page.aria-label.5cf0cb320e')">
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.mfg.page.text.e79dc9aac0') }}</span>
        <strong>{{ state?.health?.fact_count || 0 }}</strong>
        <small>{{ state?.health?.schema_version || t('page.mfg.page.inline.6f681c0a14') }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.mfg.page.text.1a2c57323f') }}</span>
        <strong>{{ metrics.length }}</strong>
        <small>{{ formatCount('entities', entities.length) }}</small>
      </article>
      <article class="metric-card" data-tone="warn">
        <span>{{ t('page.mfg.page.text.ab81a58faf') }}</span>
        <strong>{{ incidents.length }}</strong>
        <small>{{ attention.length }} attention items</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.mfg.page.text.e7946cc912') }}</span>
        <strong>{{ skills.length }}</strong>
        <small>{{ room?.skill_runs?.length || 0 }} room runs</small>
      </article>
    </section>

    <section class="management-grid mfg-workbench">
      <ChartPanel data-section="overview" :title="t('page.mfg.page.title.12fb034e94')" kind="bar" :data="metricChart" />

      <article class="management-panel mfg-command-panel" data-section="overview">
        <header>
          <h2>{{ t('page.mfg.page.text.07a633c300') }}</h2>
          <span>{{ state?.health?.status || t('page.mfg.page.inline.51a32dd32d') }}</span>
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.mfg.page.text.f2580d8506') }}</dt>
          <dd>{{ state?.health?.schema_version || t('page.mfg.page.inline.51a32dd32d') }}</dd>
          <dt>{{ t('page.mfg.page.text.dc3f3b6a51') }}</dt>
          <dd>{{ state?.health?.capabilities?.length || 0 }}</dd>
          <dt>{{ t('page.mfg.page.text.cc9914053f') }}</dt>
          <dd>{{ state?.commandCenter?.risk_queue?.length || 0 }}</dd>
          <dt>{{ t('page.mfg.page.text.a70612ba8a') }}</dt>
          <dd>{{ state?.live?.action_queue?.length || 0 }}</dd>
        </dl>
      </article>

      <article class="management-panel" data-section="overview">
        <header>
          <h2>{{ t('page.mfg.page.text.a3a65020ae') }}</h2>
          <span>{{ formatCount('contracts', contractSummary.count) }}</span>
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.mfg.page.text.316dcc8a09') }}</dt>
          <dd>/api/apps/mfg/reality/*</dd>
          <dt>{{ t('page.mfg.page.text.0dbeba2a7e') }}</dt>
          <dd>{{ contractSummary.domains }}</dd>
          <dt>{{ t('page.mfg.page.text.fc11dc83ab') }}</dt>
          <dd>{{ contractSummary.quarantined }}</dd>
          <dt>{{ t('page.mfg.page.text.456ba8b299') }}</dt>
          <dd>{{ t('page.mfg.page.text.c5ede2d774') }}</dd>
        </dl>
      </article>

      <article class="management-panel mfg-trace-panel wide" data-section="overview">
        <header>
          <h2>{{ t('page.mfg.page.text.84988005b0') }}</h2>
          <span>{{ t('page.mfg.decisionTrace.chainLabel') }}</span>
        </header>
        <p class="panel-note">{{ t('page.mfg.page.text.8d61d2ebc3') }}</p>
        <p class="panel-note">{{ t('page.mfg.decisionTrace.source') }}: {{ state?.decisionTrace?.kind || t('page.mfg.page.inline.0f9fa91718') }} / {{ state?.decisionTrace?.chain || t('page.mfg.decisionTrace.chainLabel') }}</p>
        <DataTable :rows="decisionTraceRows" :columns="['stage', 'ref', 'domain', 'signal', 'next']" />
        <EvidenceTrace :items="mfgEvidence" :title="t('page.mfg.page.title.3d3887d1d7')" />
      </article>

      <article id="data-plane" class="management-panel" data-section="data-plane">
        <header>
          <h2>{{ t('page.mfg.page.text.3f43ee8666') }}</h2>
          <span>{{ state?.dataPlane?.status || t('page.mfg.page.inline.51a32dd32d') }}</span>
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.mfg.page.text.37ca559655') }}</dt>
          <dd>{{ state?.dataPlane?.provider || t('page.mfg.page.inline.51a32dd32d') }}</dd>
          <dt>{{ t('page.mfg.page.text.90b142e0a4') }}</dt>
          <dd>{{ state?.dataPlane?.mode || t('page.mfg.page.inline.51a32dd32d') }}</dd>
          <dt>{{ t('page.mfg.page.text.cde1dbdf25') }}</dt>
          <dd>{{ state?.dataPlane?.watermark_count || 0 }}</dd>
          <dt>{{ t('page.mfg.page.text.025af3e6bd') }}</dt>
          <dd>{{ state?.governance?.status || state?.governance?.kind || t('page.mfg.page.inline.51a32dd32d') }}</dd>
        </dl>
        <label class="field-line">
          {{ t('page.mfg.field.sourcePackId') }}
          <input v-model="sourcePackId" type="text" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="planDataPlaneIngest">{{ t('page.mfg.page.text.dad35a136a') }}</button>
          <button class="primary-action mfg-live-quarantined" data-mfg-risk="mfgSourcePackUpsert" type="button" @click="upsertSourcePack">{{ t('page.mfg.page.text.db1dd806a8') }}</button>
          <button class="ghost-action" type="button" @click="validateSourcePack">{{ t('page.mfg.page.text.ddbca47834') }}</button>
        </div>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="sourcePackDeltaPlan">{{ t('page.mfg.page.text.37ccf61a79') }}</button>
          <button class="ghost-action" type="button" @click="planConnectorRun">{{ t('page.mfg.page.text.3679544938') }}</button>
          <button class="ghost-action mfg-live-quarantined" type="button" @click="executeConnectorRun">{{ t('page.mfg.page.text.7af7a76287') }}</button>
        </div>
        <label class="field-line">
          {{ t('template.pages.mfgpage.d5328ab27f') }}
          <input v-model="connectorRunId" type="text" @keydown.enter.prevent="getConnectorRun" />
        </label>
        <RequestReceipt :receipt="sourcePackResult" :title="t('page.mfg.page.title.1edecc488b')" />
        <GovernedActionPanel
          :contract="contract('source-pack-upsert')"
          :payload="sourcePackGovernedPayload()"
          :receipt="sourcePackResult"
          @plan="sourcePackDeltaPlan"
          @dry-run="validateSourcePack"
          @live="upsertSourcePack"
        />
        <GovernedActionPanel
          :contract="contract('connector-run')"
          :payload="{ source_pack_id: sourcePackId, mode: 'dry_run', requested_capability: 'service.read' }"
          :receipt="sourcePackResult"
          @plan="planConnectorRun"
          @dry-run="planConnectorRun"
          @live="executeConnectorRun"
        />
        <RawPayload :title="t('page.mfg.page.title.dae0c08c0d')" :data="{ data_plane: dataPlaneResult, source_pack: sourcePackResult }" />
      </article>

      <article class="management-panel" data-section="source-pack">
        <header>
          <h2>{{ t('page.mfg.page.text.c31a87bcc5') }}</h2>
          <span>{{ formatCount('metrics', metrics.length) }}</span>
        </header>
        <p class="panel-note">{{ t('page.mfg.page.text.2edd1bcb34') }}</p>
        <textarea v-model="factPayload" class="json-input" rows="8" placeholder='[{"fact_type":"...","source_ref":"source-pack://..."}]' />
        <div class="button-row">
          <button class="ghost-action mfg-live-quarantined" data-mfg-risk="mfgSeedDomain" type="button" @click="initializeManufacturingKernel">{{ t('page.mfg.page.text.f584acc284') }}</button>
          <span class="sr-only mfg-live-quarantined" data-mfg-risk="mfgSeedOntology">{{ t('page.mfg.page.text.9e762a9515') }}</span>
          <button class="primary-action mfg-live-quarantined" data-mfg-risk="mfgIngestFact" type="button" @click="ingestManufacturingFacts">{{ t('page.mfg.page.text.9131c47a17') }}</button>
        </div>
        <GovernedActionPanel
          :contract="contract('fact-ingest')"
          :payload="factGovernedPayload()"
          :receipt="dataPlaneResult || result"
          @plan="planFactIngest"
          @dry-run="dryRunFactIngest"
          @live="ingestManufacturingFacts"
        />
        <DataTable v-if="metrics.length" :rows="metrics.slice(0, 8)" :columns="['metric_id', 'name', 'unit', 'status']" />
        <RawPayload :title="t('page.mfg.page.title.cd2cc28173')" :data="{ metrics: state?.metrics, attention: state?.attention, changes: state?.changes }" />
      </article>

      <article id="entities" class="management-panel" data-section="entities">
        <header>
          <h2>{{ t('page.mfg.page.text.e7fdeee24b') }}</h2>
          <span>{{ formatCount('entities', entities.length) }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.mfgpage.acf9148cce') }}
          <input v-model="selectedEntityId" type="text" @keydown.enter.prevent="inspectEntity" />
        </label>
        <label class="field-line">
          {{ t('template.pages.mfgpage.aea84c643c') }}
          <input v-model="relationTargetId" type="text" />
        </label>
        <div class="button-row">
          <button class="primary-action mfg-live-quarantined" data-mfg-risk="mfgEntityUpsert" type="button" @click="upsertEntity">{{ t('page.mfg.page.text.f0c04ec37f') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedEntityId" @click="inspectEntity">{{ t('page.mfg.page.text.80543724ec') }}</button>
          <button class="ghost-action" type="button" @click="resolveEntitySourceKey">{{ t('page.mfg.page.text.72e19f1838') }}</button>
        </div>
        <button class="ghost-action mfg-live-quarantined" data-mfg-risk="mfgRelationUpsert" type="button" :disabled="!selectedEntityId || !relationTargetId" @click="upsertRelation">{{ t('page.mfg.page.text.e91fcaef8f') }}</button>
        <DataTable v-if="entities.length" :rows="entities.slice(0, 8)" :columns="['entity_id', 'entity_type', 'canonical_key', 'display_name']" />
        <RequestReceipt :receipt="entityResult" :title="t('page.mfg.page.title.d69adeadb8')" />
        <GovernedActionPanel
          :contract="contract('entity-upsert')"
          :payload="entityGovernedPayload()"
          :receipt="entityResult"
          @plan="planEntityGovernance"
          @dry-run="dryRunEntityGovernance"
          @live="upsertEntity"
        />
        <GovernedActionPanel
          :contract="contract('relation-upsert')"
          :payload="{ from_entity_id: selectedEntityId, to_entity_id: relationTargetId, relation_type: 'feeds' }"
          :receipt="entityResult"
          @plan="inspectEntity"
          @dry-run="inspectEntity"
          @live="upsertRelation"
        />
        <RawPayload :title="t('page.mfg.page.title.7634a13f8b')" :data="entityResult || {}" />
      </article>

      <article class="management-panel" data-section="metrics">
        <header>
          <h2>{{ t('page.mfg.page.text.ca57911109') }}</h2>
          <span>{{ formatCount('metrics', metrics.length) }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.mfgpage.8060f09c45') }}
          <input v-model="selectedMetricId" type="text" @keydown.enter.prevent="inspectMetric" />
        </label>
        <label class="field-line">
          {{ t('template.pages.mfgpage.c9119bf5a0') }}
          <input v-model="computeJobId" type="text" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="inspectMetric">{{ t('page.mfg.page.text.057509672b') }}</button>
          <button class="ghost-action" type="button" @click="materializeMetricSnapshot">{{ t('page.mfg.page.text.4573da14a4') }}</button>
          <button class="ghost-action" type="button" @click="planMetricAttention">{{ t('page.mfg.page.text.5f72680451') }}</button>
        </div>
        <div class="button-row">
          <button class="primary-action" type="button" @click="planComputeJob">{{ t('page.mfg.page.text.5d254efbc9') }}</button>
          <button class="ghost-action mfg-live-quarantined" data-mfg-risk="mfgComputeJobRun" type="button" :disabled="!computeJobId" @click="runComputeJob">{{ t('page.mfg.page.text.d67e6249c5') }}</button>
          <button class="ghost-action" type="button" @click="recomputeMetrics">{{ t('page.mfg.page.text.891d6b15bd') }}</button>
        </div>
        <RequestReceipt :receipt="metricResult" :title="t('page.mfg.page.title.0d0bf08469')" />
        <GovernedActionPanel
          :contract="contract('metric-compute-run')"
          :payload="metricGovernedPayload()"
          :receipt="metricResult"
          @plan="planComputeJob"
          @dry-run="planMetricAttention"
          @live="runComputeJob"
        />
        <RawPayload :title="t('page.mfg.page.title.f5626928d6')" :data="metricResult || {}" />
      </article>

      <article class="management-panel" data-section="evidence">
        <header>
          <h2>{{ t('page.mfg.page.text.5491ff5eb7') }}</h2>
          <span>{{ formatCount('packets', state?.health?.evidence_count || 0) }}</span>
        </header>
        <label class="field-line">
          {{ t('page.mfg.field.evidencePacketId') }}
          <input v-model="evidenceId" type="text" @keydown.enter.prevent="inspectEvidence" />
        </label>
        <label class="field-line">
          {{ t('page.mfg.field.qualityGateId') }}
          <input v-model="qualityGateId" type="text" @keydown.enter.prevent="inspectQualityGate" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="buildEvidencePacket">{{ t('page.mfg.page.text.ca872a4aa1') }}</button>
          <button class="ghost-action" type="button" :disabled="!evidenceId" @click="inspectEvidence">{{ t('page.mfg.page.text.e0e207718b') }}</button>
          <button class="ghost-action" type="button" :disabled="!evidenceId" @click="evaluateEvidenceQuality">{{ t('page.mfg.page.text.ae0d32cea5') }}</button>
        </div>
        <button class="ghost-action" type="button" :disabled="!qualityGateId" @click="inspectQualityGate">{{ t('page.mfg.page.text.c4ef3d5929') }}</button>
        <GovernedActionPanel
          :contract="contract('evidence-build')"
          :payload="evidenceGovernedPayload()"
          :receipt="evidenceResult"
          @plan="planEvidenceGovernance"
          @dry-run="dryRunEvidenceGovernance"
          @live="buildEvidencePacket"
        />
        <RawPayload :title="t('page.mfg.page.title.63c40635e0')" :data="evidenceResult || {}" />
      </article>

      <article id="incident-room" class="management-panel" data-section="incident-room">
        <header>
          <h2>{{ t('page.mfg.page.text.77fbd36078') }}</h2>
          <span>{{ incidents.length }} incidents</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.mfgpage.1d3f813051') }}
          <textarea v-model="incidentTitle" rows="3" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="createIncident">{{ t('page.mfg.page.text.f9045b3b92') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedIncidentId" @click="openIncidentRoom">{{ t('page.mfg.page.text.2b601a8397') }}</button>
        </div>
        <label class="field-line">
          {{ t('template.pages.mfgpage.77b32336ad') }}
          <select v-model="selectedIncidentId" @change="openIncidentRoom">
            <option value="">{{ t('page.mfg.page.text.8505a31972') }}</option>
            <option v-for="incident in incidents" :key="incident.incident_id" :value="incident.incident_id">
              {{ incident.title || incident.incident_id }}
            </option>
          </select>
        </label>
        <DataTable v-if="incidents.length" :rows="incidents.slice(0, 8)" :columns="['incident_id', 'title', 'severity', 'status']" />
        <GovernedActionPanel
          :contract="contract('incident-create-analyze')"
          :payload="incidentGovernedPayload()"
          :receipt="result"
          @plan="planIncidentGovernance"
          @dry-run="dryRunIncidentGovernance"
          @live="createIncident"
        />
        <RawPayload :title="t('page.mfg.page.title.22adafc937')" :data="{ room, entities: entities.slice(0, 8), attention: attention.slice(0, 8) }" />
      </article>

      <article class="management-panel" data-section="actions">
        <header>
          <h2>{{ t('page.mfg.page.text.73af29674f') }}</h2>
          <span>{{ formatCount('actions', recommendedActions.length) }}</span>
        </header>
        <div class="button-row">
          <button class="ghost-action" type="button" :disabled="!selectedIncidentId" @click="analyzeIncident">{{ t('page.mfg.page.text.b5a34e6218') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedIncidentId" @click="recommendPlaybooks">{{ t('page.mfg.page.text.0c0da9aa5a') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedIncidentId" @click="promoteCase">{{ t('page.mfg.page.text.293ea179f5') }}</button>
        </div>
        <div class="memory-form-row">
          <label class="field-line">
            {{ t('template.pages.mfgpage.1517e2c735') }}
            <input v-model="selectedCaseId" type="text" />
          </label>
          <label class="field-line">
            {{ t('template.pages.mfgpage.c423d049cc') }}
            <input v-model="selectedPlaybookId" type="text" />
          </label>
        </div>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="searchCases">{{ t('page.mfg.page.text.fd83a8d0a9') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedCaseId" @click="inspectCase">{{ t('page.mfg.page.text.f859139b7e') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedPlaybookId" @click="inspectPlaybook">{{ t('page.mfg.page.text.f025eb3ee9') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedPlaybookId" @click="upsertPlaybook">{{ t('page.mfg.page.text.4230284219') }}</button>
        </div>
        <label class="field-line">
          {{ t('template.pages.mfgpage.28fbb69071') }}
          <select v-model="selectedActionId">
            <option value="">{{ t('page.mfg.page.text.f1ed7f5d73') }}</option>
            <option v-for="action in recommendedActions" :key="action.action_id" :value="action.action_id">
              {{ action.title || action.action_id }}
            </option>
          </select>
        </label>
        <div class="button-row">
          <button class="primary-action mfg-live-quarantined" data-mfg-risk="mfgExecuteAction" type="button" :disabled="!selectedActionId" @click="executeAction">{{ t('page.mfg.page.text.f283d38d0f') }}</button>
          <button class="ghost-action mfg-live-quarantined" data-mfg-risk="mfgExecutionBridge" type="button" @click="bridgeExecution">{{ t('page.mfg.page.text.87bb6b109d') }}</button>
        </div>
        <GovernedActionPanel
          :contract="contract('action-execute-bridge')"
          :payload="incidentGovernedPayload()"
          :receipt="result"
          @plan="planActionGovernance"
          @dry-run="dryRunActionGovernance"
          @live="bridgeExecution"
        />
        <RequestReceipt :receipt="result" :title="t('page.mfg.page.title.61ddf695b3')" />
        <RawPayload :title="t('page.mfg.page.title.cfe2ae18f1')" :data="{ analysis, executions: room?.executions, playbooks: room?.playbooks, case_id: selectedCaseId, playbook_id: selectedPlaybookId }" />
      </article>

      <article class="management-panel" data-section="skills">
        <header>
          <h2>{{ t('page.mfg.page.text.a2460b2b6a') }}</h2>
          <span>{{ formatCount('skills', skills.length) }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.mfgpage.ec9f630c86') }}
          <select v-model="selectedSkillId">
            <option value="">{{ t('page.mfg.page.text.b7791a2344') }}</option>
            <option v-for="skill in skills" :key="skill.skill_id" :value="skill.skill_id">
              {{ skill.name || skill.skill_id }}
            </option>
          </select>
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" :disabled="!selectedIncidentId" @click="planSkills">{{ t('page.mfg.page.text.d987757ec9') }}</button>
          <button class="primary-action" type="button" :disabled="!selectedIncidentId || !selectedSkillId" @click="runSkill">{{ t('page.mfg.page.text.ff81a10442') }}</button>
        </div>
        <label class="field-line">
          {{ t('template.pages.mfgpage.68044552a2') }}
          <input v-model="selectedSkillRunId" type="text" />
        </label>
        <button class="ghost-action" type="button" :disabled="!selectedSkillRunId" @click="inspectSkillRun">{{ t('page.mfg.page.text.5e038b547e') }}</button>
        <DataTable v-if="skills.length" :rows="skills.slice(0, 8)" :columns="['skill_id', 'name', 'risk', 'status']" />
        <DataTable v-if="skillRuns.length" :rows="skillRuns.slice(0, 8)" />
        <RawPayload :title="t('page.mfg.page.title.8b3d8aa5ff')" :data="{ skills: state?.skills, skill_runs: skillRuns, result }" />
      </article>

      <article id="reports" class="management-panel" data-section="reports">
        <header>
          <h2>{{ t('page.mfg.page.text.041093433a') }}</h2>
          <span>{{ t('page.mfg.summary.deliveryRetry') }}</span>
        </header>
        <label class="field-line">
          {{ t('page.mfg.field.profileId') }}
          <input v-model="cockpitProfileId" type="text" />
        </label>
        <label class="field-line">
          {{ t('page.mfg.field.ownerRef') }}
          <input v-model="cockpitOwnerRef" type="text" />
        </label>
        <label class="field-line">
          {{ t('page.mfg.field.reportId') }}
          <input v-model="cockpitReportId" type="text" :placeholder="t('page.mfg.page.placeholder.47e472c3f8')" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="generateReport">{{ t('page.mfg.page.text.2170372da3') }}</button>
          <button class="ghost-action mfg-live-quarantined" data-mfg-risk="mfgRetryReportDelivery" type="button" :disabled="!cockpitReportId" @click="retryReportDelivery">{{ t('page.mfg.page.text.acc563d64d') }}</button>
        </div>
        <GovernedActionPanel
          :contract="contract('cockpit-report-generate')"
          :payload="reportGovernedPayload()"
          :receipt="result"
          @plan="planReportGovernance"
          @dry-run="dryRunReportGovernance"
          @live="generateReport"
        />
        <GovernedActionPanel
          :contract="contract('cockpit-report-retry')"
          :payload="reportGovernedPayload()"
          :receipt="result"
          @plan="planReportGovernance"
          @dry-run="dryRunReportGovernance"
          @live="retryReportDelivery"
        />
        <RequestReceipt :receipt="result" :title="t('page.mfg.page.title.1b6b271f1d')" />
        <RawPayload :title="t('page.mfg.page.title.5535fc9315')" :data="result || {}" />
      </article>
    </section>
  </section>
</template>
