<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ExternalLink, RefreshCw, Search } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import EvidenceObjectDetail from '../components/workbench/EvidenceObjectDetail.vue';
import TimelineList from '../components/workbench/TimelineList.vue';
import { useAppStore } from '../stores/app';
import type { EvidenceObject } from '../types/evidence';
import { displayStatus } from '../i18n/domain/status';

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
const selectedDetail = ref<Record<string, unknown> | null>(null);
const fallbackManagement = [
  {
    id: 'overview',
    label: t('script.pages.realitycorepage.label.76a2e57120'),
    mode: 'read',
    owner: 'gateway.reality',
    route: '/reality?section=overview',
    scope: 'System health, engine readiness, contracts, latest growth event, and latest promotion receipt.',
    api: ['/api/reality/status', '/api/reality/static'],
  },
  {
    id: 'memory',
    label: t('script.pages.realitycorepage.label.b6981f17cb'),
    mode: 'read-write',
    owner: 'gateway.memory',
    route: '/memory',
    scope: 'Memory layers, recall, fact checks, symbol links, maintenance candidates, and memory packets.',
    api: ['/api/memory/status', '/api/memory/layers', '/api/memory/search', '/api/memory/maintenance', '/api/memory/packet'],
  },
  {
    id: 'matrix',
    label: t('script.pages.realitycorepage.label.478106eb6e'),
    mode: 'read-write',
    owner: 'gateway.matrix',
    route: '/reality?section=matrix',
    scope: 'Structured source packs, facts, entities, relations, metrics, evidence, quality gates, and lineage.',
    api: ['/api/matrix/*'],
  },
  {
    id: 'growth',
    label: t('script.pages.realitycorepage.label.4017442548'),
    mode: 'read',
    owner: 'gateway.growth',
    route: '/reality?section=fact-flow',
    scope: 'Runtime growth events, promotion decisions, Memory/Matrix targets, and held conflict boundaries.',
    api: ['/api/growth/status', '/api/growth/events', '/api/reality/flow', '/api/reality/promotions'],
  },
  {
    id: 'context',
    label: t('script.pages.realitycorepage.label.429a27ab05'),
    mode: 'read-write',
    owner: 'gateway.context',
    route: '/context',
    scope: 'Current context packets, evidence routing, budget pressure, and session recommendations.',
    api: ['/api/context/current', '/api/evidence/resolve', '/api/sessions/:id/context/recommendations'],
  },
  {
    id: 'audit',
    label: t('script.pages.realitycorepage.label.79b847480b'),
    mode: 'read',
    owner: 'gateway.audit',
    route: '/audit',
    scope: 'Approval history, risk receipts, cross-plane audit, runtime executions, and release gates.',
    api: ['/api/audit/*', '/api/approval/*', '/api/cross-plane/audit', '/api/cowd/release-gate'],
  },
  {
    id: 'gateway',
    label: t('script.pages.realitycorepage.label.16175710a6'),
    mode: 'read-write',
    owner: 'gateway.system',
    route: '/gateway',
    scope: 'Surfaces, connector health, platform channels, runtime service contracts, and backend readiness.',
    api: ['/api/surfaces/*', '/api/connectors/*', '/api/platforms', '/api/runtime/control-plane'],
  },
];

const activeSessionId = computed(() => sessionFilter.value.trim() || store.activeSessionId || '');
const activeSection = computed(() => String(route.query.section || 'overview'));
const sectionTabs = [
  { id: 'overview', label: t('script.pages.realitycorepage.label.0efc2e6be4') },
  { id: 'memory', label: t('script.pages.realitycorepage.label.89c8a2851d') },
  { id: 'matrix', label: t('script.pages.realitycorepage.label.58947ebc8f') },
  { id: 'context-runtime', label: t('reality.contextRuntime.label') },
  { id: 'fact-flow', label: t('script.pages.realitycorepage.label.33f62e7cc6') },
  { id: 'evidence', label: t('script.pages.realitycorepage.label.7ea014de7b') },
  { id: 'audit', label: t('script.pages.realitycorepage.label.fa1703dd78') },
];
const realityContext = computed(() => [
  { label: t('script.pages.realitycorepage.label.f7f1997c6c'), value: activeSessionId.value || 'global' },
  { label: t('script.pages.realitycorepage.label.7f5d63aa39'), value: engineRows.value.length, tone: engineRows.value.length ? 'success' : 'warn' },
  { label: t('script.pages.realitycorepage.label.afd4fd7ec0'), value: factFlowRows.value.length },
  { label: t('script.pages.realitycorepage.label.086e09b4b6'), value: promotionRows.value.length },
]);
const realityWorkflow = computed(() => [
  { id: 'overview', label: t('script.pages.realitycorepage.label.7f5d63aa39'), status: engineRows.value.length ? 'ready' : 'idle', count: engineRows.value.length },
  { id: 'core-map', label: t('script.pages.realitycorepage.label.e6cb603ee1'), status: coreRows.value.length ? 'ready' : 'idle', count: coreRows.value.length },
  { id: 'context-runtime', label: t('reality.contextRuntime.label'), status: status.value?.context_runtime?.envelope_status || 'idle', description: status.value?.context_runtime?.latest_envelope_id || status.value?.context_runtime?.degraded_reason || '-' },
  { id: 'fact-flow', label: t('script.pages.realitycorepage.label.33f62e7cc6'), status: factFlowRows.value.length ? 'active' : 'idle', count: factFlowRows.value.length },
  { id: 'evidence', label: t('script.pages.realitycorepage.label.7ea014de7b'), status: evidenceRows.value.length ? 'ready' : 'idle', count: evidenceRows.value.length },
  { id: 'promotions', label: t('script.pages.realitycorepage.label.550ae25c2e'), status: promotionRows.value.length ? 'done' : 'idle', count: promotionRows.value.length },
  { id: 'boundaries', label: t('script.pages.realitycorepage.label.0a5e7a0583'), status: boundaryRows.value.length ? 'ready' : 'idle', count: boundaryRows.value.length },
]);
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
const contextRuntime = computed(() => status.value?.context_runtime || {});
const knowledgeRecallQuality = computed(() => status.value?.engines?.knowledge_fabric?.recall_quality || {});
const knowledgeRecallRows = computed(() => {
  const quality = knowledgeRecallQuality.value;
  const warnings = Array.isArray(quality.cross_project_contamination_warnings)
    ? quality.cross_project_contamination_warnings
    : [];
  return [
    {
      metric: t('memory.knowledgeGovernance.precision', { value: Math.round(Number(quality.precision_estimate ?? 1) * 100) }),
      status: warnings.length ? 'warn' : 'ready',
      value: Math.round(Number(quality.precision_estimate ?? 1) * 100),
      detail: quality.policy || '-',
    },
    {
      metric: t('memory.knowledgeGovernance.conflicts'),
      status: Array.isArray(quality.conflict_warnings) && quality.conflict_warnings.length ? 'warn' : 'ready',
      value: Array.isArray(quality.conflict_warnings) ? quality.conflict_warnings.length : 0,
      detail: Array.isArray(quality.conflict_warnings) ? quality.conflict_warnings.join(', ') || '-' : '-',
    },
    {
      metric: 'cross_project_contamination_warnings',
      status: warnings.length ? 'warn' : 'ready',
      value: warnings.length,
      detail: warnings.join(', ') || '-',
    },
    {
      metric: 'omitted_high_value_count',
      status: Number(quality.omitted_high_value_count || 0) ? 'warn' : 'ready',
      value: quality.omitted_high_value_count || 0,
      detail: t('reality.knowledgeRecall.omittedHighValueDetail'),
    },
  ];
});
const contextRuntimeRows = computed(() => {
  const runtime = contextRuntime.value;
  const omission = runtime.omission_summary || {};
  return [
    {
      metric: t('reality.contextRuntime.envelopeStatus'),
      status: runtime.envelope_status || '-',
      value: runtime.latest_envelope_id || '-',
      detail: runtime.latest_session_id || runtime.degraded_reason || '-',
    },
    {
      metric: t('reality.contextRuntime.compression'),
      status: runtime.compression_status || '-',
      value: runtime.latest_checkpoint || '-',
      detail: `used ${Math.round(Number(runtime.used_ratio || 0) * 100)}%`,
    },
    {
      metric: t('reality.contextRuntime.recallQuality'),
      status: runtime.recall_quality_status || '-',
      value: `${omission.selected_count || 0}/${omission.omitted_count || 0}`,
      detail: Array.isArray(omission.reasons) ? omission.reasons.join(', ') || '-' : '-',
    },
  ];
});
const managementRows = computed(() => {
  const rows = staticProjection.value?.management || fallbackManagement;
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
const factFlowTimeline = computed(() => factFlowRows.value.map((row: any, index: number) => ({
  id: `${row.kind}-${index}`,
  title: row.kind,
  status: row.status,
  detail: `${row.decision} · ${row.target} · ${row.summary}`,
})));
const selectedEvidence = computed<EvidenceObject | null>(() => {
  const row: any = selectedDetail.value;
  if (!row) return null;
  const source = row.owner || row.event || row.engine || row.kind || 'reality.core';
  const ref = String(row.reference || row.target_id || row.target || row.engine || row.boundary || row.id || source);
  return {
    ref,
    kind: row.kind || row.target || row.boundary || row.engine || 'reality.fact',
    source,
    status: row.status || row.decision || 'recorded',
    summary: row.summary || row.meaning || row.role || row.scope || row.detail || ref,
    session_id: activeSessionId.value || undefined,
    memory_id: String(row.memory_id || row.reference || '').startsWith('memory') ? String(row.memory_id || row.reference) : undefined,
    matrix_ref: row.matrix_ref || row.target,
    audit_ref: row.event,
    route: `/reality?section=${encodeURIComponent(activeSection.value)}${activeSessionId.value ? `&session_id=${encodeURIComponent(activeSessionId.value)}` : ''}`,
    raw: row,
  };
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
        <h1>{{ t('page.reality.core.page.text.7014b73d37') }}</h1>
        <p>{{ t('page.reality.core.page.text.37d6ce2100') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? t('page.reality.core.page.inline.186bff2dac') : t('page.reality.core.page.inline.4d0d2fe5c8') }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row tools-metrics">
      <article class="metric-card">
        <span>{{ t('page.reality.core.page.text.7014b73d37') }}</span>
        <strong>{{ displayStatus(status.reality_core?.status || 'unknown') }}</strong>
        <small>{{ status.reality_core?.degraded ? t('page.reality.core.page.inline.a4c5a4d346') : t('page.reality.core.page.inline.363d2a9470') }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.reality.core.page.text.73f7e04f25') }}</span>
        <strong>{{ flow.stage_count ?? factFlowRows.length }}</strong>
        <small>{{ activeSessionId || t('page.reality.core.page.inline.22ddb1b03c') }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.reality.core.page.text.4ac54a90f5') }}</span>
        <strong>{{ promotions.total ?? promotionRows.length }}</strong>
        <small>{{ t('page.reality.core.page.text.3c1743ffc3') }}</small>
      </article>
      <article class="metric-card" data-tone="warn">
        <span>{{ t('page.reality.core.page.text.0f3007656f') }}</span>
        <strong>{{ boundaryRows.length }}</strong>
        <small>{{ t('page.reality.core.page.text.671008b6fc') }}</small>
      </article>
    </section>

    <section class="reality-toolbar">
      <nav class="reality-tabs" :aria-label="t('page.reality.core.page.aria-label.7dfb806b21')">
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
        {{ t('page.reality.core.field.sessionFilter') }}
        <input v-model="sessionFilter" type="text" :placeholder="t('page.reality.core.page.placeholder.0f3b345aac')" @keyup.enter="refresh" />
      </label>
      <button class="ghost-action" type="button" @click="refresh">
        <Search :size="15" />
        {{ t('page.reality.core.action.loadFactFlow') }}
      </button>
      <StatusPill :status="status.reality_core?.status || status.__state || 'ready'" />
    </section>

    <section class="reality-grid">
      <section class="management-panel reality-panel wide" data-section="management">
        <header>
          <h2>{{ t('page.reality.core.page.text.dac90c69e6') }}</h2>
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
              {{ t('template.pages.realitycorepage.cf9b77061f') }}
              <ExternalLink :size="14" />
            </RouterLink>
          </article>
        </div>
        <EmptyState v-else :title="t('page.reality.core.page.title.9ff8fab91b')" :detail="t('page.reality.core.page.detail.127f3dd76a')" />
      </section>

      <section class="management-panel reality-panel wide" data-section="core-map">
        <header>
          <h2>{{ t('page.reality.core.page.text.0f6a4d9cbb') }}</h2>
          <span>{{ t('page.reality.core.page.text.d2b98161a7') }}</span>
        </header>
        <DataTable v-if="coreRows.length" :rows="coreRows" :columns="['engine', 'status', 'writes', 'api', 'role']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.reality.core.page.title.c2bff56680')" :detail="t('page.reality.core.page.detail.af5a795207')" />
      </section>

      <section class="management-panel reality-panel" data-section="overview">
        <header>
          <h2>{{ t('page.reality.core.page.text.cb151a9a1c') }}</h2>
          <span>{{ status.generated_at || t('page.reality.core.page.inline.e049bd1422') }}</span>
        </header>
        <DataTable v-if="engineRows.length" :rows="engineRows" :columns="['engine', 'status', 'service', 'operation', 'detail']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.reality.core.page.title.552e99583f')" :detail="t('page.reality.core.page.detail.e82982ba71')" />
      </section>

      <section class="management-panel reality-panel wide" data-section="context-runtime">
        <header>
          <h2>{{ t('reality.contextRuntime.label') }}</h2>
          <span>{{ contextRuntime.latest_envelope_id || t('memory.contextEnvelope.noEnvelope') }}</span>
        </header>
        <div class="metric-row compact">
          <article class="metric-card" :data-tone="contextRuntime.envelope_status === 'ready' ? 'success' : 'warn'">
            <span>{{ t('reality.contextRuntime.envelopeStatus') }}</span>
            <strong>{{ displayStatus(contextRuntime.envelope_status || '-') }}</strong>
            <small>{{ contextRuntime.latest_session_id || contextRuntime.degraded_reason || '-' }}</small>
          </article>
          <article class="metric-card" data-tone="warn">
            <span>{{ t('reality.contextRuntime.compression') }}</span>
            <strong>{{ displayStatus(contextRuntime.compression_status || '-') }}</strong>
            <small>{{ t('memory.contextEnvelope.used', { value: `${Math.round(Number(contextRuntime.used_ratio || 0) * 100)}%` }) }}</small>
          </article>
          <article class="metric-card" data-tone="info">
            <span>{{ t('reality.contextRuntime.recallQuality') }}</span>
            <strong>{{ displayStatus(contextRuntime.recall_quality_status || '-') }}</strong>
            <small>{{ contextRuntime.omission_summary?.selected_count || 0 }} / {{ contextRuntime.omission_summary?.omitted_count || 0 }}</small>
          </article>
        </div>
        <DataTable v-if="contextRuntimeRows.length" :rows="contextRuntimeRows" :columns="['metric', 'status', 'value', 'detail']" @row-click="selectedDetail = $event" />
        <DataTable v-if="knowledgeRecallRows.length" :rows="knowledgeRecallRows" :columns="['metric', 'status', 'value', 'detail']" @row-click="selectedDetail = $event" />
        <ObjectInspectorDrawer :title="t('memory.contextEnvelope.raw')" :data="contextRuntime" />
        <ObjectInspectorDrawer :title="t('memory.knowledgeGovernance.recallQuality')" :data="knowledgeRecallQuality" />
      </section>

      <section class="management-panel reality-panel wide" data-section="fact-flow">
        <header>
          <h2>{{ t('page.reality.core.page.text.608ba31424') }}</h2>
          <span>{{ flow.source || 'growth.promotions' }}</span>
        </header>
        <TimelineList v-if="factFlowTimeline.length" :items="factFlowTimeline" />
        <DataTable v-if="factFlowRows.length" :rows="factFlowRows" :columns="['kind', 'status', 'decision', 'target', 'confidence', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.reality.core.page.title.615c073377')" :detail="t('page.reality.core.page.detail.2d3cb4ec7e')" />
      </section>

      <section class="management-panel reality-panel wide" data-section="evidence">
        <header>
          <h2>{{ t('page.reality.core.page.text.826db23211') }}</h2>
          <span>{{ formatCount('refs', evidenceRows.length) }}</span>
        </header>
        <DataTable v-if="evidenceRows.length" :rows="evidenceRows" :columns="['event', 'reference', 'kind', 'confidence', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.reality.core.page.title.df8254f898')" :detail="t('page.reality.core.page.detail.050f3da73d')" />
      </section>

      <section class="management-panel reality-panel" data-section="promotions">
        <header>
          <h2>{{ t('page.reality.core.page.text.e788169274') }}</h2>
          <span>{{ formatCount('receipts', promotionRows.length) }}</span>
        </header>
        <DataTable v-if="promotionRows.length" :rows="promotionRows" :columns="['target', 'status', 'target_id', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.reality.core.page.title.af22a6d0ae')" :detail="t('page.reality.core.page.detail.b421d2b906')" />
      </section>

      <section class="management-panel reality-panel" data-section="boundaries">
        <header>
          <h2>{{ t('page.reality.core.page.text.64c93e07da') }}</h2>
          <span>{{ t('page.reality.core.page.text.23dc486a98') }}</span>
        </header>
        <DataTable v-if="boundaryRows.length" :rows="boundaryRows" :columns="['boundary', 'count', 'meaning']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.reality.core.page.title.dfb99d9f9d')" :detail="t('page.reality.core.page.detail.e7a1423ec3')" />
      </section>

      <section class="management-panel reality-panel">
        <header>
          <h2>{{ t('page.reality.core.page.text.c5f7cc32f7') }}</h2>
          <span>{{ t('page.reality.core.page.text.388c716ffc') }}</span>
        </header>
        <EvidenceObjectDetail :title="t('page.reality.core.page.title.a231752f0c')" :evidence="selectedEvidence" @close="selectedDetail = null" />
        <ObjectInspectorDrawer :title="t('page.reality.core.page.title.b0bbf3767e')" :data="status" />
      </section>
    </section>
  </section>
</template>
