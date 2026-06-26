<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
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

function items(collection: any, key: string) {
  return Array.isArray(collection?.[key]) ? collection[key] : Array.isArray(collection) ? collection : [];
}

const auditRecords = computed(() => items(state.value.audit, 'records'));
const approvalHistory = computed(() => items(state.value.approvalHistory, 'history'));
const crossPlaneRecords = computed(() => items(state.value.crossPlaneAudit, 'records'));
const executions = computed(() => items(state.value.executions, 'executions'));
const releaseChecks = computed(() => items(state.value.releaseGate, 'checks'));
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
  { label: 'Audit records', value: auditRecords.value.length },
  { label: 'Approvals', value: approvalHistory.value.length },
  { label: 'Cross-plane', value: crossPlaneRecords.value.length },
  { label: 'Timeline', value: globalTimelineRows.value.length },
  { label: 'Release checks', value: releaseChecks.value.length, tone: releaseChecks.value.length ? 'warn' : 'default' },
]);
const auditWorkflow = computed(() => [
  { id: 'logs', label: 'Export', status: auditRows.value.length ? 'ready' : 'idle', count: auditRows.value.length },
  { id: 'usage', label: 'Usage', status: usageChart.value.length ? 'ready' : 'idle', count: usageChart.value.length },
  { id: 'release', label: 'Release', status: releaseRows.value.some((row) => row.status !== 'pass') ? 'blocked' : 'ready', count: releaseRows.value.length },
  { id: 'approvals', label: 'Approval', status: approvalRows.value.length ? 'ready' : 'idle', count: approvalRows.value.length },
  { id: 'cross-plane', label: 'Cross-plane', status: crossPlaneRows.value.length ? 'ready' : 'idle', count: crossPlaneRows.value.length },
  { id: 'global-timeline', label: 'Timeline', status: globalTimelineRows.value.length ? 'ready' : 'idle', count: globalTimelineRows.value.length },
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
    const [audit, usage, capabilities, projection, surfaces, releaseGate, approvalHistoryData, crossPlaneAudit, executionsData] = await Promise.all([
      api.auditExport(source.value, limit.value, offset.value),
      api.usageSummary(),
      api.cowdCapabilities(),
      api.cowdProjection(releaseSurface.value),
      api.cowdSurfaces(),
      api.cowdReleaseGate(),
      api.approvalHistory(),
      api.crossPlaneAudit(),
      api.crossPlaneExecutions(),
    ]);
    state.value = { audit, usage, capabilities, projection, surfaces, releaseGate, approvalHistory: approvalHistoryData, crossPlaneAudit, executions: executionsData };
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page audit-page">
    <header class="page-header">
      <div>
        <h1>Audit and Governance</h1>
        <p>审计导出、使用统计、发布门禁、审批历史和跨平面回执集中核查。</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? 'Loading' : 'Refresh audit' }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <PrimaryContextBar :items="auditContext" />
    <WorkflowStrip :steps="auditWorkflow" title="Evidence flow" />

    <section class="metric-row">
      <article class="metric-card" data-tone="info">
        <span>Audit records</span>
        <strong>{{ auditRecords.length }}</strong>
        <small>{{ state.audit?.source || source }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>Usage tokens</span>
        <strong>{{ state.usage?.tokens?.total || 0 }}</strong>
        <small>{{ state.usage?.message_count || 0 }} messages</small>
      </article>
      <article class="metric-card" data-tone="warn">
        <span>Release checks</span>
        <strong>{{ releaseChecks.length }}</strong>
        <small>{{ releaseSurface }}</small>
      </article>
    </section>

    <section class="gateway-grid">
      <section class="management-panel gateway-panel wide" data-section="global-timeline">
        <header>
          <h2>GlobalTimeline</h2>
          <span>{{ globalTimelineRows.length }} correlated records</span>
        </header>
        <div class="button-row">
          <label class="field-line">
            Source
            <select v-model="timelineSource">
              <option value="all">all</option>
              <option value="audit">audit</option>
              <option value="approval">approval</option>
              <option value="cross-plane">cross-plane</option>
              <option value="execution">execution</option>
            </select>
          </label>
          <label class="field-line">
            Status
            <select v-model="timelineStatus">
              <option value="all">all</option>
              <option value="recorded">recorded</option>
              <option value="approved">approved</option>
              <option value="denied">denied</option>
              <option value="ready">ready</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label class="field-line">
            Session
            <input v-model="timelineSession" type="search" placeholder="session id" />
          </label>
          <label class="field-line">
            Evidence
            <input v-model="timelineEvidence" type="search" placeholder="evidence ref" />
          </label>
          <label class="field-line">
            Surface
            <input v-model="timelineSurface" type="search" placeholder="surface/channel" />
          </label>
        </div>
        <DataTable v-if="globalTimelineRows.length" :rows="globalTimelineRows" :columns="['source', 'session', 'agent', 'tool', 'evidence', 'approval', 'surface', 'status', 'timestamp', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No global timeline records" detail="当前过滤条件没有匹配记录，或 Gateway 尚未返回审计数据。" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="logs">
        <header>
          <h2>Audit export</h2>
          <span>{{ state.audit?.total || 0 }} total</span>
        </header>
        <div class="button-row">
          <label class="field-line">
            Source
            <select v-model="source" @change="refresh">
              <option value="all">all</option>
              <option value="approval">approval</option>
              <option value="memory">memory</option>
            </select>
          </label>
          <label class="field-line">
            Limit
            <input v-model.number="limit" type="number" min="1" max="500" @change="refresh" />
          </label>
          <label class="field-line">
            Offset
            <input v-model.number="offset" type="number" min="0" @change="refresh" />
          </label>
        </div>
        <DataTable v-if="auditRows.length" :rows="auditRows" :columns="['source', 'id', 'summary', 'timestamp']" @row-click="selectedDetail = { ...$event, source: 'audit', evidence: $event.id }" />
        <EmptyState v-else title="No audit records" detail="审批或记忆审计产生后会在这里展示。" />
        <EvidenceTrace :items="auditEvidence" title="Audit evidence trace" />
      </section>

      <section class="management-panel gateway-panel" data-section="usage">
        <header>
          <h2>Usage summary</h2>
          <span>{{ state.usage?.status || 'usage' }}</span>
        </header>
        <ChartPanel v-if="usageChart.length" title="Usage by platform" kind="bar" :data="usageChart" />
        <EmptyState v-else title="No usage data" detail="后端返回使用统计后再展示平台分布图。" />
        <dl class="detail-list">
          <dt>Messages</dt>
          <dd>{{ state.usage?.message_count || 0 }}</dd>
          <dt>Tokens</dt>
          <dd>{{ state.usage?.tokens?.total || 0 }}</dd>
          <dt>Cost</dt>
          <dd>{{ Number(state.usage?.estimated_cost_usd || 0).toFixed(6) }}</dd>
        </dl>
      </section>

      <section class="management-panel gateway-panel" data-section="release">
        <header>
          <h2>Release gate</h2>
          <span>{{ releaseSurface }}</span>
        </header>
        <label class="field-line">
          Surface
          <select v-model="releaseSurface" @change="refresh">
            <option value="webui">webui</option>
            <option value="tui">tui</option>
            <option value="cli">cli</option>
          </select>
        </label>
        <ChartPanel v-if="releaseChart.length" title="Release gate coverage" kind="radar" :data="releaseChart" />
        <EmptyState v-else title="No release checks" detail="发布门禁返回检查项后再展示覆盖图。" />
        <DataTable v-if="releaseRows.length" :rows="releaseRows" :columns="['name', 'status', 'detail']" @row-click="selectedDetail = { ...$event, source: 'release', evidence: $event.name, summary: $event.detail }" />
      </section>

      <section class="management-panel gateway-panel" data-section="approvals">
        <header>
          <h2>Approval history</h2>
          <span>{{ approvalRows.length }} shown</span>
        </header>
        <DataTable v-if="approvalRows.length" :rows="approvalRows" :columns="['id', 'command', 'decision', 'resolved']" @row-click="selectedDetail = { ...$event, source: 'approval', evidence: $event.id, status: $event.decision, summary: $event.command }" />
        <EmptyState v-else title="No approvals" detail="审批记录为空或 approval gate 未启用。" />
      </section>

      <section class="management-panel gateway-panel" data-section="cross-plane">
        <header>
          <h2>Governance evidence</h2>
          <span>{{ crossPlaneRows.length }} records</span>
        </header>
        <DataTable v-if="crossPlaneRows.length" :rows="crossPlaneRows" :columns="['id', 'result', 'capability', 'summary']" @row-click="selectedDetail = { ...$event, source: 'cross-plane', evidence: $event.id, status: $event.result }" />
        <EmptyState v-else title="No cross-plane audit" detail="跨平面动作执行后会产生治理证据。" />
      </section>

      <section class="management-panel gateway-panel" data-section="cross-plane">
        <header>
          <h2>Execution receipts</h2>
          <span>{{ executionRows.length }} receipts</span>
        </header>
        <DataTable v-if="executionRows.length" :rows="executionRows" :columns="['id', 'status', 'dispatch', 'mode']" @row-click="selectedDetail = { ...$event, source: 'execution', evidence: $event.id }" />
        <EvidenceObjectDetail title="Audit selected evidence" :evidence="selectedEvidence" @close="selectedDetail = null" />
        <RawPayload title="Governance payload" :data="{ capabilities: state.capabilities, projection: state.projection, surfaces: state.surfaces }" />
      </section>
    </section>
  </section>
</template>
