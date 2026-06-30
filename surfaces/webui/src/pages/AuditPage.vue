<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import EvidenceObjectDetail from '../components/workbench/EvidenceObjectDetail.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import type { EvidenceObject } from '../types/evidence';

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
  tools: report.tool_calls || 0,
  scenarios: report.scenario_count || 0,
  elapsed_ms: report.total_elapsed_ms || 0,
})));
const harnessEvalRunRows = computed(() => harnessEvalRuns.value.slice(0, 8).map((run: any) => ({
  id: run.run_id,
  level: run.level,
  status: run.status,
  tokens: run.total_tokens || 0,
  tools: run.tool_calls || 0,
  report: run.report_id || '-',
})));
const harnessEvalScenarioRows = computed(() => harnessEvalScenarios.value.slice(0, 8).map((scenario: any) => ({
  id: scenario.id,
  kind: scenario.kind,
  fake: scenario.fake_provider_gate ? 'yes' : 'no',
  real: scenario.real_provider_gate ? 'yes' : 'no',
  evidence: Array.isArray(scenario.required_evidence) ? scenario.required_evidence.join(', ') : '-',
})));
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
    };
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function runHarnessEvalSmoke() {
  evalActionResult.value = await api.harnessEvalRunSmoke();
  await refresh();
}

async function openHarnessEvalReport(row: Record<string, unknown>) {
  const id = String(row.id || '');
  if (!id) return;
  evalReportDetail.value = await api.harnessEvalReport(id);
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
    <PrimaryContextBar :items="auditContext" />
    <WorkflowStrip :steps="auditWorkflow" :title="t('page.audit.page.title.79a1baef6a')" />

    <section class="metric-row">
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.audit.page.text.a4105efeb4') }}</span>
        <strong>{{ auditRecords.length }}</strong>
        <small>{{ state.audit?.source || source }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.audit.page.text.f5e060a458') }}</span>
        <strong>{{ state.usage?.tokens?.total || 0 }}</strong>
        <small>{{ state.usage?.message_count || 0 }} messages</small>
      </article>
      <article class="metric-card" data-tone="warn">
        <span>{{ t('page.audit.page.text.d4317d5cbf') }}</span>
        <strong>{{ releaseChecks.length }}</strong>
        <small>{{ releaseSurface }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.audit.page.text.c2a8e12d35') }}</span>
        <strong>{{ state.harnessEvalLatest?.report?.status || 'empty' }}</strong>
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
        <DataTable v-if="globalTimelineRows.length" :rows="globalTimelineRows" :columns="['source', 'session', 'agent', 'tool', 'evidence', 'approval', 'surface', 'status', 'timestamp', 'summary']" @row-click="selectedDetail = $event" />
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
        <DataTable v-if="auditRows.length" :rows="auditRows" :columns="['source', 'id', 'summary', 'timestamp']" @row-click="selectedDetail = { ...$event, source: 'audit', evidence: $event.id }" />
        <EmptyState v-else :title="t('page.audit.page.title.534295d677')" :detail="t('page.audit.page.detail.6b368c2a44')" />
        <EvidenceTrace :items="auditEvidence" :title="t('page.audit.page.title.69b367b2b4')" />
      </section>

      <section class="management-panel gateway-panel" data-section="usage">
        <header>
          <h2>{{ t('page.audit.page.text.c3d8bf1440') }}</h2>
          <span>{{ state.usage?.status || 'usage' }}</span>
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
        <DataTable v-if="releaseRows.length" :rows="releaseRows" :columns="['name', 'status', 'detail']" @row-click="selectedDetail = { ...$event, source: 'release', evidence: $event.name, summary: $event.detail }" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="harness-eval">
        <header>
          <h2>{{ t('page.audit.page.text.c2a8e12d35') }}</h2>
          <span>{{ state.harnessEvalLatest?.status || 'reports' }}</span>
        </header>
        <div class="button-row">
          <button class="primary-action" type="button" @click="runHarnessEvalSmoke">{{ t('page.audit.page.text.96e9252cbf') }}</button>
          <button class="ghost-action" type="button" @click="refresh">{{ t('page.audit.page.text.95dd535531') }}</button>
        </div>
        <dl class="detail-list">
          <dt>{{ t('page.audit.page.text.f1b114ace3') }}</dt>
          <dd>{{ state.harnessEvalLatest?.report?.id || 'none' }}</dd>
          <dt>{{ t('page.audit.page.text.9e51188c8e') }}</dt>
          <dd>{{ state.harnessEvalLatest?.report?.status || state.harnessEvalLatest?.status || 'empty' }}</dd>
          <dt>{{ t('page.audit.page.text.e60fd065c9') }}</dt>
          <dd>{{ state.harnessEvalLatest?.report?.total_tokens || 0 }}</dd>
          <dt>{{ t('page.audit.page.text.a61ad14bd4') }}</dt>
          <dd>{{ state.harnessEvalLatest?.report?.tool_calls || 0 }}</dd>
        </dl>
        <DataTable v-if="harnessEvalRows.length" :rows="harnessEvalRows" :columns="['id', 'level', 'status', 'tokens', 'tools', 'scenarios', 'elapsed_ms']" @row-click="openHarnessEvalReport" />
        <EmptyState v-else :title="t('page.audit.page.title.6d80665780')" :detail="t('page.audit.page.detail.64a90473e7')" />
        <RequestReceipt v-if="evalActionResult" :receipt="evalActionResult" :title="t('page.audit.page.title.7e07abe625')" />
        <RawPayload v-if="evalReportDetail" :title="t('page.audit.page.title.052bb3b0c7')" :data="evalReportDetail" />
      </section>

      <section class="management-panel gateway-panel" data-section="harness-eval-runs">
        <header>
          <h2>{{ t('page.audit.page.text.4444545e37') }}</h2>
          <span>{{ formatCount('runs', harnessEvalRuns.length) }}</span>
        </header>
        <DataTable v-if="harnessEvalRunRows.length" :rows="harnessEvalRunRows" :columns="['id', 'level', 'status', 'tokens', 'tools', 'report']" @row-click="selectedDetail = { ...$event, source: 'harness-eval', evidence: $event.id, status: $event.status }" />
        <EmptyState v-else :title="t('page.audit.page.title.2029dfea2e')" :detail="t('page.audit.page.detail.d6935f4575')" />
      </section>

      <section class="management-panel gateway-panel" data-section="harness-eval-scenarios">
        <header>
          <h2>{{ t('page.audit.page.text.171edf1adf') }}</h2>
          <span>{{ formatCount('scenarios', harnessEvalScenarios.length) }}</span>
        </header>
        <DataTable v-if="harnessEvalScenarioRows.length" :rows="harnessEvalScenarioRows" :columns="['id', 'kind', 'fake', 'real', 'evidence']" @row-click="selectedDetail = { ...$event, source: 'harness-eval', evidence: $event.id, summary: $event.evidence }" />
        <EmptyState v-else :title="t('page.audit.page.title.1d4e669193')" :detail="t('page.audit.page.detail.4976a6366c')" />
      </section>

      <section class="management-panel gateway-panel" data-section="approvals">
        <header>
          <h2>{{ t('page.audit.page.text.c9312c41ba') }}</h2>
          <span>{{ t('common.shownCount', { count: approvalRows.length, unit: t('unit.records') }) }}</span>
        </header>
        <DataTable v-if="approvalRows.length" :rows="approvalRows" :columns="['id', 'command', 'decision', 'resolved']" @row-click="selectedDetail = { ...$event, source: 'approval', evidence: $event.id, status: $event.decision, summary: $event.command }" />
        <EmptyState v-else :title="t('page.audit.page.title.292a2d77e6')" :detail="t('page.audit.page.detail.abb458c609')" />
      </section>

      <section class="management-panel gateway-panel" data-section="cross-plane">
        <header>
          <h2>{{ t('page.audit.page.text.02318ae2d0') }}</h2>
          <span>{{ formatCount('records', crossPlaneRows.length) }}</span>
        </header>
        <DataTable v-if="crossPlaneRows.length" :rows="crossPlaneRows" :columns="['id', 'result', 'capability', 'summary']" @row-click="selectedDetail = { ...$event, source: 'cross-plane', evidence: $event.id, status: $event.result }" />
        <EmptyState v-else :title="t('page.audit.page.title.8f881836e9')" :detail="t('page.audit.page.detail.bc95f49231')" />
      </section>

      <section class="management-panel gateway-panel" data-section="cross-plane">
        <header>
          <h2>{{ t('page.audit.page.text.4e1a860d2d') }}</h2>
          <span>{{ formatCount('receipts', executionRows.length) }}</span>
        </header>
        <DataTable v-if="executionRows.length" :rows="executionRows" :columns="['id', 'status', 'dispatch', 'mode']" @row-click="selectedDetail = { ...$event, source: 'execution', evidence: $event.id }" />
        <EvidenceObjectDetail :title="t('page.audit.page.title.f699e4008c')" :evidence="selectedEvidence" @close="selectedDetail = null" />
        <RawPayload :title="t('page.audit.page.title.ad0dea9223')" :data="{ capabilities: state.capabilities, projection: state.projection, surfaces: state.surfaces }" />
      </section>
    </section>
  </section>
</template>
