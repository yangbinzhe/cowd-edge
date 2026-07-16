<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Activity, Database, FileCheck2, Play, RefreshCw, Send, Wrench } from 'lucide-vue-next';
import { api } from '../../api/client';
import { t } from '../../i18n';
import { useMfgCockpitStore } from '../../stores/mfgCockpit';
import { adaptEntityImpact } from '../../adapters/graph/entityImpact';
import { adaptMetricLineage } from '../../adapters/graph/metricLineage';
import DataTable from '../workbench/DataTable.vue';
import EmptyState from '../workbench/EmptyState.vue';
import EvidenceTrace from '../workbench/EvidenceTrace.vue';
import GraphSurface from '../graph/GraphSurface.vue';
import ObjectInspectorDrawer from '../workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../workbench/RequestReceipt.vue';

const props = defineProps<{ section: 'data' | 'reality' | 'evidence' | 'operations' | 'skills' | 'reports' }>();
const cockpit = useMfgCockpitStore();
const loading = ref(false);
const error = ref('');
const receipt = ref<any>(null);
const health = ref<any>({});
const sourcePackId = ref('');
const factPayload = ref('');
const selectedEntityId = ref('');
const selectedMetricId = ref('');
const selectedAttentionId = ref('');
const evidenceId = ref('');
const incidentTitle = ref('');
const selectedIncidentId = ref('');
const selectedSkillId = ref('');
const selectedActionId = ref('');
const executionId = ref('');
const reportId = ref('');
const caseQuery = ref('');
const data = ref<any>({ metrics: [], entities: [], attention: [], incidents: [], skills: [], cases: [], room: null, report: null, delivery: null });

const titleKey = computed(() => `mfg.domain.${props.section}.title`);
const summaryKey = computed(() => `mfg.domain.${props.section}.summary`);
const entityGraph = computed(() => adaptEntityImpact(data.value.entityDetail, t('mfg.domain.entityGraph')));
const metricGraph = computed(() => adaptMetricLineage(data.value.metricDetail, t('mfg.domain.metricGraph')));
const evidenceItems = computed(() => {
  const packet = data.value.evidence?.packet || data.value.evidence?.evidence_packet || data.value.evidence;
  const refs = Array.isArray(packet?.source_refs) ? packet.source_refs : Array.isArray(packet?.metric_evidence) ? packet.metric_evidence : [];
  return refs.map((ref: any, index: number) => ({ id: String(ref?.id || ref?.ref || ref || index), kind: String(ref?.kind || 'mfg.evidence'), status: String(ref?.status || 'observed'), summary: String(ref?.summary || ref?.label || ref), source: String(packet?.packet_id || evidenceId.value) }));
});
const recommendedActions = computed(() => data.value.room?.analysis?.recommended_actions || []);
const analysisId = computed(() => String(data.value.room?.analysis?.analysis_id || data.value.room?.operational_analysis?.analysis_id || ''));

function items(value: any, key: string) { return Array.isArray(value?.[key]) ? value[key] : Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []; }

async function execute<T>(action: () => Promise<T>): Promise<T | null> {
  loading.value = true;
  error.value = '';
  try { return await action(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return null; }
  finally { loading.value = false; }
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextHealth, metrics, entities, attention, incidents, skills] = await Promise.all([api.mfgHealth(), api.mfgMetrics(), api.mfgEntities(), api.mfgAttentionHot(), api.mfgIncidents(), api.mfgSkills()]);
    health.value = nextHealth;
    data.value = { ...data.value, metrics: items(metrics, 'metrics'), entities: items(entities, 'entities'), attention: items(attention, 'items'), incidents: items(incidents, 'items'), skills: items(skills, 'items') };
    if (!selectedIncidentId.value && data.value.incidents[0]) selectedIncidentId.value = data.value.incidents[0].incident_id;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { loading.value = false; }
}

async function upsertSourcePack() {
  if (!sourcePackId.value.trim()) return;
  receipt.value = await execute(() => api.mfgSourcePackUpsert({ source_pack_id: sourcePackId.value.trim() }));
  if (!receipt.value) return;
  await refresh();
}

async function ingestFacts() {
  let facts: any[] = [];
  try { const parsed = JSON.parse(factPayload.value); facts = Array.isArray(parsed) ? parsed : [parsed]; } catch { error.value = t('mfg.domain.invalidJson'); return; }
  receipt.value = await execute(() => api.mfgIngestFact(facts));
  if (!receipt.value) return;
  await refresh();
}

async function inspectEntity(entityId = selectedEntityId.value) {
  if (!entityId) return;
  selectedEntityId.value = entityId;
  const details = await execute(() => Promise.all([api.mfgEntity(entityId), api.mfgEntityRelations(entityId), api.mfgEntityImpactPath(entityId)]));
  if (!details) return;
  const [entity, relations, impact] = details;
  data.value = { ...data.value, entityDetail: { entity, relations, impact } };
}

async function inspectMetric(metricId = selectedMetricId.value) {
  if (!metricId) return;
  selectedMetricId.value = metricId;
  const details = await execute(() => Promise.all([api.mfgMetricDetail(metricId), api.mfgMetricLineage(metricId)]));
  if (!details) return;
  const [detail, lineage] = details;
  data.value = { ...data.value, metricDetail: { detail, lineage } };
}

async function buildEvidence() {
  if (!selectedAttentionId.value) return;
  receipt.value = await execute(() => api.mfgEvidenceBuild({ attention_id: selectedAttentionId.value, problem_statement: incidentTitle.value || undefined }));
  if (!receipt.value) return;
  evidenceId.value = receipt.value?.packet?.packet_id || receipt.value?.evidence_packet?.packet_id || evidenceId.value;
  await inspectEvidence();
}

async function inspectEvidence() {
  if (!evidenceId.value) return;
  const details = await execute(() => Promise.all([api.mfgEvidence(evidenceId.value), api.mfgEvidenceContext(evidenceId.value)]));
  if (!details) return;
  const [packet, context] = details;
  data.value = { ...data.value, evidence: { packet, context } };
}

async function openIncidentRoom() {
  if (!selectedIncidentId.value) return;
  const room = await execute(() => api.mfgIncidentRoom(selectedIncidentId.value));
  if (room) data.value = { ...data.value, room };
}

async function createIncident() {
  if (!incidentTitle.value.trim()) return;
  receipt.value = await execute(() => api.mfgCreateIncident({ title: incidentTitle.value.trim(), attention_id: selectedAttentionId.value || undefined }));
  if (!receipt.value) return;
  selectedIncidentId.value = receipt.value?.incident?.incident_id || selectedIncidentId.value;
  await openIncidentRoom();
  await refresh();
}

async function analyzeIncident() {
  if (!selectedIncidentId.value) return;
  receipt.value = await execute(() => api.mfgAnalyzeIncident(selectedIncidentId.value));
  if (!receipt.value) return;
  await openIncidentRoom();
}

async function planSkills() {
  if (!selectedIncidentId.value) return;
  receipt.value = await execute(() => api.mfgPlanSkills(selectedIncidentId.value, 5));
  if (!receipt.value) return;
  await openIncidentRoom();
}

async function runSkill() {
  if (!selectedIncidentId.value || !selectedSkillId.value) return;
  receipt.value = await execute(() => api.mfgRunSkill(selectedIncidentId.value, selectedSkillId.value));
  if (!receipt.value) return;
  await openIncidentRoom();
}

async function executeAction() {
  if (!analysisId.value || !selectedActionId.value) return;
  receipt.value = await execute(() => api.mfgExecuteAction(analysisId.value, selectedActionId.value, { mode: 'dry_run', operator_id: 'webui-operator', note: 'executed from WebUI MFG workspace' }));
  if (!receipt.value) return;
  executionId.value = String(receipt.value?.execution?.execution_id || executionId.value);
  await openIncidentRoom();
}

async function bridgeExecution() {
  if (!executionId.value) return;
  receipt.value = await execute(() => api.mfgExecutionBridge(executionId.value, { mode: 'dry_run', actor_principal: 'webui-operator', source_channel: 'channel://webui/mfg', requested_capability: 'channel.chat.send_text' }));
}

async function promoteCase() {
  if (!selectedIncidentId.value) return;
  receipt.value = await execute(() => api.mfgPromoteIncidentCase(selectedIncidentId.value));
}

async function generateReport() {
  if (!cockpit.selectedProfileId) return;
  receipt.value = await execute(() => api.mfgGenerateReport(cockpit.selectedProfileId, { report_id: reportId.value || undefined }));
  if (!receipt.value) return;
  reportId.value = receipt.value?.report?.report_id || reportId.value;
  await inspectReport();
}

async function inspectReport() {
  if (!reportId.value) return;
  const report = await execute(() => Promise.all([api.mfgReport(reportId.value), api.mfgReportDeliveryState(reportId.value)]));
  if (!report) return;
  data.value = { ...data.value, report: report[0], delivery: report[1] };
}

async function deliverReport() {
  if (!reportId.value) return;
  receipt.value = await execute(() => api.mfgDeliverReport(reportId.value, { mode: 'dry_run', actor_principal: 'webui-operator', source_channel: 'mfg.report.delivery' }));
  if (receipt.value) await inspectReport();
}

async function retryReport() {
  if (!reportId.value) return;
  receipt.value = await execute(() => api.mfgRetryReportDelivery(reportId.value, { mode: 'dry_run', force: true, actor_principal: 'webui-operator', source_channel: 'mfg.report.retry' }));
  if (receipt.value) await inspectReport();
}

async function runReportSchedule() {
  receipt.value = await execute(() => api.mfgRunReportSchedule({ cadence: cockpit.selectedProfile?.cadence || 'daily', deliver: false, actor_identity_ref: 'webui-operator', source_channel: 'webui.mfg' }));
}

async function searchCases() {
  const result = await execute(() => api.mfgCaseSearch(caseQuery.value));
  if (result) data.value = { ...data.value, cases: items(result, 'cases') };
}

watch(() => props.section, () => { void refresh(); });
onMounted(() => { void refresh(); });
</script>

<template>
  <section class="mfg-domain" :aria-label="t('mfg.domain.aria', { title: t(titleKey) })">
    <header class="mfg-workspace-header"><div><h2>{{ t(titleKey) }}</h2><p>{{ t(summaryKey) }}</p></div><button class="ghost-action" type="button" :disabled="loading" @click="refresh"><RefreshCw :size="15" />{{ t('mfg.domain.refresh') }}</button></header>
    <p v-if="error" class="settings-alert">{{ error }}</p>

    <div v-if="section === 'data'" class="mfg-domain__grid">
      <article class="mfg-domain__panel"><header><Database :size="16" /><h3>{{ t('mfg.domain.data.sourcePacks') }}</h3></header><dl class="mfg-kv"><dt>{{ t('mfg.domain.data.facts') }}</dt><dd>{{ health.fact_count || 0 }}</dd><dt>{{ t('mfg.domain.data.watermarks') }}</dt><dd>{{ health.data_plane_watermark_count || 0 }}</dd><dt>{{ t('mfg.domain.data.connectors') }}</dt><dd>{{ health.connector_run_count || 0 }}</dd></dl><label class="mfg-field"><span>{{ t('mfg.domain.data.sourcePackId') }}</span><input v-model="sourcePackId" /></label><button class="primary-action" type="button" @click="upsertSourcePack"><Database :size="15" />{{ t('mfg.domain.data.saveSourcePack') }}</button></article>
      <article class="mfg-domain__panel"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.data.ingest') }}</h3></header><textarea v-model="factPayload" rows="9" class="json-input" :placeholder="t('mfg.domain.data.factPayload')" /><button class="primary-action" type="button" @click="ingestFacts"><Send :size="15" />{{ t('mfg.domain.data.ingestFacts') }}</button><RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" /></article>
    </div>

    <div v-else-if="section === 'reality'" class="mfg-domain__grid">
      <article class="mfg-domain__panel"><header><Activity :size="16" /><h3>{{ t('mfg.domain.reality.metrics') }}</h3></header><DataTable v-if="data.metrics.length" :rows="data.metrics" :columns="['metric_id', 'name', 'unit', 'status']" row-key="metric_id" @row-click="inspectMetric($event.metric_id || '')" /><EmptyState v-else :title="t('mfg.domain.emptyMetrics')" /><GraphSurface v-if="metricGraph.nodes.length" :model="metricGraph" /></article>
      <article class="mfg-domain__panel"><header><Database :size="16" /><h3>{{ t('mfg.domain.reality.entities') }}</h3></header><DataTable v-if="data.entities.length" :rows="data.entities" :columns="['entity_id', 'entity_type', 'display_name', 'confidence']" row-key="entity_id" @row-click="inspectEntity($event.entity_id || '')" /><EmptyState v-else :title="t('mfg.domain.emptyEntities')" /><GraphSurface v-if="entityGraph.nodes.length" :model="entityGraph" /></article>
      <article class="mfg-domain__panel mfg-domain__panel--wide"><header><Activity :size="16" /><h3>{{ t('mfg.domain.reality.attention') }}</h3></header><DataTable v-if="data.attention.length" :rows="data.attention" :columns="['attention_id', 'title', 'priority_score', 'severity', 'status']" row-key="attention_id" @row-click="selectedAttentionId = $event.attention_id || ''" /><EmptyState v-else :title="t('mfg.domain.emptyAttention')" /></article>
    </div>

    <div v-else-if="section === 'evidence'" class="mfg-domain__grid">
      <article class="mfg-domain__panel"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.evidence.packet') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.evidence.attention') }}</span><select v-model="selectedAttentionId"><option value="">{{ t('mfg.domain.evidence.selectAttention') }}</option><option v-for="item in data.attention" :key="item.attention_id" :value="item.attention_id">{{ item.title || item.attention_id }}</option></select></label><label class="mfg-field"><span>{{ t('mfg.domain.evidence.packetId') }}</span><input v-model="evidenceId" /></label><button class="primary-action" type="button" @click="buildEvidence">{{ t('mfg.domain.evidence.build') }}</button><button class="ghost-action" type="button" @click="inspectEvidence">{{ t('mfg.domain.evidence.inspect') }}</button></article>
      <article class="mfg-domain__panel"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.evidence.trace') }}</h3></header><EvidenceTrace :items="evidenceItems" :title="t('mfg.domain.evidence.trace')" /><ObjectInspectorDrawer :title="t('mfg.domain.evidence.detail')" :data="data.evidence || {}" /></article>
    </div>

    <div v-else-if="section === 'operations'" class="mfg-domain__grid">
      <article class="mfg-domain__panel"><header><Activity :size="16" /><h3>{{ t('mfg.domain.operations.incidents') }}</h3></header><label class="mfg-field"><span>{{ t('mfg.domain.operations.incidentTitle') }}</span><textarea v-model="incidentTitle" rows="3" /></label><button class="primary-action" type="button" @click="createIncident">{{ t('mfg.domain.operations.createIncident') }}</button><label class="mfg-field"><span>{{ t('mfg.domain.operations.incident') }}</span><select v-model="selectedIncidentId" @change="openIncidentRoom"><option value="">{{ t('mfg.domain.operations.selectIncident') }}</option><option v-for="incident in data.incidents" :key="incident.incident_id" :value="incident.incident_id">{{ incident.title || incident.incident_id }}</option></select></label></article>
      <article class="mfg-domain__panel"><header><Wrench :size="16" /><h3>{{ t('mfg.domain.operations.actions') }}</h3></header><div class="button-row"><button class="ghost-action" type="button" @click="analyzeIncident">{{ t('mfg.domain.operations.analyze') }}</button><button class="ghost-action" type="button" @click="planSkills">{{ t('mfg.domain.operations.planSkills') }}</button><button class="ghost-action" type="button" @click="promoteCase">{{ t('mfg.domain.operations.promoteCase') }}</button></div><DataTable v-if="recommendedActions.length" :rows="recommendedActions" :columns="['action_id', 'title', 'risk', 'status']" row-key="action_id" @row-click="selectedActionId = $event.action_id || ''" /><div class="button-row"><button class="primary-action" type="button" :disabled="!selectedActionId" @click="executeAction">{{ t('mfg.domain.operations.executeAction') }}</button><button class="ghost-action" type="button" :disabled="!executionId" @click="bridgeExecution">{{ t('mfg.domain.operations.bridgeExecution') }}</button></div><RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" /><ObjectInspectorDrawer :title="t('mfg.domain.operations.room')" :data="data.room || {}" /></article>
    </div>

    <div v-else-if="section === 'skills'" class="mfg-domain__grid"><article class="mfg-domain__panel"><header><Play :size="16" /><h3>{{ t('mfg.domain.skills.available') }}</h3></header><DataTable v-if="data.skills.length" :rows="data.skills" :columns="['skill_id', 'name', 'risk', 'status']" row-key="skill_id" @row-click="selectedSkillId = $event.skill_id || ''" /><EmptyState v-else :title="t('mfg.domain.skills.empty')" /></article><article class="mfg-domain__panel"><header><Play :size="16" /><h3>{{ t('mfg.domain.skills.execution') }}</h3></header><button class="ghost-action" type="button" @click="planSkills">{{ t('mfg.domain.operations.planSkills') }}</button><button class="primary-action" type="button" :disabled="!selectedSkillId" @click="runSkill"><Play :size="15" />{{ t('mfg.domain.skills.run') }}</button><RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" /></article></div>

    <div v-else class="mfg-domain__grid"><article class="mfg-domain__panel"><header><Send :size="16" /><h3>{{ t('mfg.domain.reports.delivery') }}</h3></header><p class="mfg-domain__note">{{ t('mfg.domain.reports.profile', { profile: cockpit.selectedProfile?.display_name || cockpit.selectedProfileId || '—' }) }}</p><label class="mfg-field"><span>{{ t('mfg.domain.reports.reportId') }}</span><input v-model="reportId" /></label><div class="button-row"><button class="primary-action" type="button" :disabled="!cockpit.selectedProfileId" @click="generateReport"><Send :size="15" />{{ t('mfg.domain.reports.generate') }}</button><button class="ghost-action" type="button" :disabled="!reportId" @click="inspectReport">{{ t('mfg.domain.reports.inspect') }}</button><button class="ghost-action" type="button" :disabled="!reportId" @click="deliverReport">{{ t('mfg.domain.reports.deliver') }}</button><button class="ghost-action" type="button" :disabled="!reportId" @click="retryReport">{{ t('mfg.domain.reports.retry') }}</button><button class="ghost-action" type="button" @click="runReportSchedule">{{ t('mfg.domain.reports.runSchedule') }}</button></div><RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" /></article><article class="mfg-domain__panel"><header><FileCheck2 :size="16" /><h3>{{ t('mfg.domain.reports.history') }}</h3></header><ObjectInspectorDrawer v-if="data.report" :title="t('mfg.domain.reports.history')" :data="{ report: data.report, delivery: data.delivery }" /><EmptyState v-else :title="t('mfg.domain.reports.historyEmpty')" :detail="t('mfg.domain.reports.historyDetail')" /><label class="mfg-field"><span>{{ t('mfg.domain.reports.caseSearch') }}</span><input v-model="caseQuery" /></label><button class="ghost-action" type="button" @click="searchCases">{{ t('mfg.domain.reports.searchCases') }}</button><DataTable v-if="data.cases.length" :rows="data.cases" :columns="['case_id', 'title', 'status', 'updated_at']" row-key="case_id" /></article></div>
  </section>
</template>

<style scoped>
.mfg-domain { display: grid; gap: 14px; }.mfg-workspace-header { display: flex; justify-content: space-between; gap: 16px; align-items: start; padding-bottom: 12px; border-bottom: 1px solid var(--border); }.mfg-workspace-header h2, .mfg-domain__panel h3 { margin: 0; color: var(--text); }.mfg-workspace-header h2 { font-size: 18px; }.mfg-workspace-header p, .mfg-domain__note { margin: 5px 0 0; color: var(--text-muted); font-size: 13px; }.mfg-domain__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.mfg-domain__panel { min-width: 0; display: grid; align-content: start; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }.mfg-domain__panel--wide { grid-column: 1 / -1; }.mfg-domain__panel > header { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }.mfg-domain__panel h3 { font-size: 14px; }.mfg-kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; margin: 0; }.mfg-kv dt { color: var(--text-muted); }.mfg-kv dd { margin: 0; color: var(--text); font-variant-numeric: tabular-nums; }.mfg-field { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }.mfg-field input, .mfg-field select, .mfg-field textarea { min-width: 0; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 8px 9px; }.json-input { min-width: 0; width: 100%; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 9px; font-family: var(--font-mono); }.button-row { display: flex; flex-wrap: wrap; gap: 8px; }@media (max-width: 820px) { .mfg-domain__grid { grid-template-columns: 1fr; } }
</style>
