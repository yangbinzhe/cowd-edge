<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';

const ChartPanel = defineAsyncComponent(() => import('../components/ChartPanel.vue'));
const loading = ref(false);
const error = ref('');
const state = ref<any>({});
const source = ref('all');
const limit = ref(50);
const offset = ref(0);
const releaseSurface = ref('webui');
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
  { label: 'Release checks', value: releaseChecks.value.length, tone: releaseChecks.value.length ? 'warn' : 'default' },
]);
const auditWorkflow = computed(() => [
  { id: 'logs', label: 'Export', status: auditRows.value.length ? 'ready' : 'idle', count: auditRows.value.length },
  { id: 'usage', label: 'Usage', status: usageChart.value.length ? 'ready' : 'idle', count: usageChart.value.length },
  { id: 'release', label: 'Release', status: releaseRows.value.some((row) => row.status !== 'pass') ? 'blocked' : 'ready', count: releaseRows.value.length },
  { id: 'approvals', label: 'Approval', status: approvalRows.value.length ? 'ready' : 'idle', count: approvalRows.value.length },
  { id: 'cross-plane', label: 'Cross-plane', status: crossPlaneRows.value.length ? 'ready' : 'idle', count: crossPlaneRows.value.length },
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
        <DataTable v-if="auditRows.length" :rows="auditRows" :columns="['source', 'id', 'summary', 'timestamp']" @row-click="selectedDetail = $event" />
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
        <DataTable v-if="releaseRows.length" :rows="releaseRows" :columns="['name', 'status', 'detail']" @row-click="selectedDetail = $event" />
      </section>

      <section class="management-panel gateway-panel" data-section="approvals">
        <header>
          <h2>Approval history</h2>
          <span>{{ approvalRows.length }} shown</span>
        </header>
        <DataTable v-if="approvalRows.length" :rows="approvalRows" :columns="['id', 'command', 'decision', 'resolved']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No approvals" detail="审批记录为空或 approval gate 未启用。" />
      </section>

      <section class="management-panel gateway-panel" data-section="cross-plane">
        <header>
          <h2>Governance evidence</h2>
          <span>{{ crossPlaneRows.length }} records</span>
        </header>
        <DataTable v-if="crossPlaneRows.length" :rows="crossPlaneRows" :columns="['id', 'result', 'capability', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No cross-plane audit" detail="跨平面动作执行后会产生治理证据。" />
      </section>

      <section class="management-panel gateway-panel" data-section="cross-plane">
        <header>
          <h2>Execution receipts</h2>
          <span>{{ executionRows.length }} receipts</span>
        </header>
        <DataTable v-if="executionRows.length" :rows="executionRows" :columns="['id', 'status', 'dispatch', 'mode']" @row-click="selectedDetail = $event" />
        <DetailDrawer title="Audit selected evidence" :row="selectedDetail" @close="selectedDetail = null" />
        <RawPayload title="Governance payload" :data="{ capabilities: state.capabilities, projection: state.projection, surfaces: state.surfaces }" />
      </section>
    </section>
  </section>
</template>
