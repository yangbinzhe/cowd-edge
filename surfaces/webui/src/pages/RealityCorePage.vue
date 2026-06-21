<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ExternalLink, RefreshCw, Search } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const route = useRoute();
const loading = ref(false);
const error = ref('');
const status = ref<any>({});
const staticProjection = ref<any>({});
const flow = ref<any>({});
const promotions = ref<any>({});
const boundaries = ref<any>({});
const sessionFilter = ref('');

const activeSessionId = computed(() => sessionFilter.value.trim() || store.activeSessionId || '');
const activeSection = computed(() => String(route.query.section || 'overview'));
const sectionTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'memory', label: 'Memory' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'fact-flow', label: 'Fact Flow' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'audit', label: 'Audit' },
];
const engineRows = computed(() => {
  const engines = status.value?.engines || {};
  return Object.entries(engines).map(([id, value]: [string, any]) => ({
    engine: id,
    status: value?.status || value?.projection?.status || '-',
    service: value?.envelope?.service || '-',
    operation: value?.envelope?.operation || '-',
    detail: value?.role || value?.projection?.degraded_reason || value?.projection?.message || '-',
  }));
});
const coreRows = computed(() => {
  const rows = staticProjection.value?.core_map || [];
  return (Array.isArray(rows) ? rows : []).map((item: any) => ({
    engine: item.label || item.id,
    status: item.status || '-',
    writes: item.writes ? 'write owner' : 'read / rule',
    api: item.api || 'internal',
    role: item.role || '-',
  }));
});
const factFlowRows = computed(() => {
  const rows = flow.value?.stages || [];
  return (Array.isArray(rows) ? rows : []).slice(0, 80).map((stage: any) => ({
    kind: stage.kind || '-',
    status: stage.status || '-',
    decision: stage.decision || '-',
    target: stage.target_ref || '-',
    confidence: stage.confidence_bp ?? '-',
    summary: stage.summary || stage.reason || '-',
  }));
});
const promotionRows = computed(() => {
  const rows = promotions.value?.promotions || flow.value?.promotions || [];
  return (Array.isArray(rows) ? rows : []).slice(0, 80).map((promotion: any) => ({
    target: promotion.target || '-',
    status: promotion.status || '-',
    target_id: promotion.target_id || '-',
    summary: promotion.summary || promotion.reason || '-',
  }));
});
const boundaryRows = computed(() => {
  const rows = boundaries.value?.boundaries || [];
  return (Array.isArray(rows) ? rows : []).map((boundary: any) => ({
    boundary: boundary.label || boundary.id,
    count: boundary.count ?? 0,
    meaning: boundary.meaning || '-',
  }));
});
const managementRows = computed(() => {
  const rows = staticProjection.value?.management || [];
  return (Array.isArray(rows) ? rows : []).map((item: any) => ({
    id: item.id || '-',
    label: item.label || item.id || '-',
    mode: item.mode || 'read',
    owner: item.owner || '-',
    route: item.route || '/reality',
    scope: item.scope || '-',
    api: Array.isArray(item.api) ? item.api.join(', ') : item.api || '-',
  }));
});
const evidenceRows = computed(() => {
  const events = Array.isArray(flow.value?.events) ? flow.value.events : [];
  return events
    .flatMap((event: any) => {
      const evidence = Array.isArray(event?.evidence_refs) ? event.evidence_refs : [];
      return evidence.map((item: any) => ({
        event: event.id || '-',
        reference: item.reference || item.ref || '-',
        kind: item.kind || event.source_event_kind || '-',
        confidence: event.confidence_bp ?? '-',
        summary: item.summary || '-',
      }));
    })
    .slice(0, 120);
});

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextStatus, nextStatic, nextFlow, nextPromotions, nextBoundaries] = await Promise.all([
      api.realityStatus(),
      api.realityStatic(),
      api.realityFlow(activeSessionId.value || undefined, 80),
      api.realityPromotions({ sessionId: activeSessionId.value || undefined, limit: 120 }),
      api.realityBoundaries(),
    ]);
    status.value = nextStatus;
    staticProjection.value = nextStatic;
    flow.value = nextFlow;
    promotions.value = nextPromotions;
    boundaries.value = nextBoundaries;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  const routedSession = typeof route.query.session_id === 'string' ? route.query.session_id : '';
  if (routedSession) sessionFilter.value = routedSession;
  refresh();
});
</script>

<template>
  <section class="capability-page reality-page">
    <header class="page-header">
      <div>
        <h1>Reality Core</h1>
        <p>事实语义、证据、晋升、Memory、Matrix、Context 和 Audit 的只读总览。</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? 'Loading' : 'Refresh Reality Core' }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row tools-metrics">
      <article class="metric-card">
        <span>Reality Core</span>
        <strong>{{ status.reality_core?.status || 'unknown' }}</strong>
        <small>{{ status.reality_core?.degraded ? 'degraded' : 'projection ready' }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>Fact Flow stages</span>
        <strong>{{ flow.stage_count ?? factFlowRows.length }}</strong>
        <small>{{ activeSessionId || 'all sessions' }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>Promotions</span>
        <strong>{{ promotions.total ?? promotionRows.length }}</strong>
        <small>growth receipts</small>
      </article>
      <article class="metric-card" data-tone="warn">
        <span>Boundaries</span>
        <strong>{{ boundaryRows.length }}</strong>
        <small>observed / inferred / held</small>
      </article>
    </section>

    <section class="reality-toolbar">
      <nav class="reality-tabs" aria-label="Reality Core secondary navigation">
        <RouterLink
          v-for="tab in sectionTabs"
          :key="tab.id"
          class="ghost-action"
          :class="{ active: activeSection === tab.id }"
          :to="`/reality?section=${tab.id}${activeSessionId ? `&session_id=${encodeURIComponent(activeSessionId)}` : ''}`"
        >
          {{ tab.label }}
        </RouterLink>
      </nav>
      <label class="field-line">
        Session filter
        <input v-model="sessionFilter" type="text" placeholder="current session or all sessions" @keyup.enter="refresh" />
      </label>
      <button class="ghost-action" type="button" @click="refresh">
        <Search :size="15" />
        Load Fact Flow
      </button>
      <StatusPill :status="status.reality_core?.status || (status.__offline ? 'offline' : 'ready')" />
    </section>

    <section class="reality-grid">
      <section class="management-panel reality-panel wide" data-section="management">
        <header>
          <h2>Reality Core management</h2>
          <span>{{ managementRows.length }} control lanes</span>
        </header>
        <div v-if="managementRows.length" class="reality-management-lanes">
          <article v-for="lane in managementRows" :key="lane.id" class="reality-lane">
            <div>
              <h3>{{ lane.label }}</h3>
              <p>{{ lane.scope }}</p>
              <small>{{ lane.owner }} · {{ lane.mode }}</small>
            </div>
            <RouterLink class="ghost-action" :to="lane.route">
              Open
              <ExternalLink :size="14" />
            </RouterLink>
          </article>
        </div>
        <EmptyState v-else title="No management contract" detail="Reality Core 静态投影尚未返回二级管理入口。" />
      </section>

      <section class="management-panel reality-panel wide" data-section="core-map">
        <header>
          <h2>Core map</h2>
          <span>read-only service boundary</span>
        </header>
        <DataTable v-if="coreRows.length" :rows="coreRows" :columns="['engine', 'status', 'writes', 'api', 'role']" />
        <EmptyState v-else title="No core map" detail="Reality Core 静态投影暂不可用。" />
      </section>

      <section class="management-panel reality-panel" data-section="overview">
        <header>
          <h2>Engine status</h2>
          <span>{{ status.generated_at || 'not loaded' }}</span>
        </header>
        <DataTable v-if="engineRows.length" :rows="engineRows" :columns="['engine', 'status', 'service', 'operation', 'detail']" />
        <EmptyState v-else title="No engine status" detail="Gateway 离线或 RealityService 尚未返回数据。" />
      </section>

      <section class="management-panel reality-panel wide" data-section="fact-flow">
        <header>
          <h2>Fact Flow</h2>
          <span>{{ flow.source || 'growth.promotions' }}</span>
        </header>
        <DataTable v-if="factFlowRows.length" :rows="factFlowRows" :columns="['kind', 'status', 'decision', 'target', 'confidence', 'summary']" />
        <EmptyState v-else title="No Fact Flow stages" detail="当前 session 还没有可展示的 growth/promotion 轨迹。" />
      </section>

      <section class="management-panel reality-panel wide" data-section="evidence">
        <header>
          <h2>Evidence</h2>
          <span>{{ evidenceRows.length }} refs</span>
        </header>
        <DataTable v-if="evidenceRows.length" :rows="evidenceRows" :columns="['event', 'reference', 'kind', 'confidence', 'summary']" />
        <EmptyState v-else title="No evidence refs" detail="当前 Fact Flow 没有返回证据引用，或 Gateway 处于离线降级状态。" />
      </section>

      <section class="management-panel reality-panel" data-section="promotions">
        <header>
          <h2>Promotion trace</h2>
          <span>{{ promotionRows.length }} receipts</span>
        </header>
        <DataTable v-if="promotionRows.length" :rows="promotionRows" :columns="['target', 'status', 'target_id', 'summary']" />
        <EmptyState v-else title="No promotions" detail="Growth Channel 还没有持久化晋升回执。" />
      </section>

      <section class="management-panel reality-panel" data-section="boundaries">
        <header>
          <h2>Reality boundaries</h2>
          <span>Fact state</span>
        </header>
        <DataTable v-if="boundaryRows.length" :rows="boundaryRows" :columns="['boundary', 'count', 'meaning']" />
        <EmptyState v-else title="No boundary projection" detail="边界统计暂不可用。" />
      </section>

      <section class="management-panel reality-panel">
        <header>
          <h2>Raw projection</h2>
          <span>debug</span>
        </header>
        <RawPayload title="Reality status" :data="status" />
      </section>
    </section>
  </section>
</template>
