<script setup lang="ts">
import { t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { Check, RefreshCw, Search } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const loading = ref(false);
const error = ref('');
const query = ref('Summarize current task evidence and runtime constraints');
const profile = ref('main_turn');
const evidenceRef = ref('workspace://changed-file/README.md');
const envelope = ref<any>({});
const history = ref<any>({});
const recommendations = ref<any>({});
const evidence = ref<any>({});
const actionResult = ref<any>(null);
const recommendationText = ref('Context recommendation acknowledged from WebUI.');
const selectedDetail = ref<Record<string, unknown> | null>(null);
const sessionId = computed(() => store.activeSessionId || 'api-context');
const contextItems = computed(() => {
  const direct = envelope.value?.envelope?.items || envelope.value?.items || envelope.value?.context?.items;
  return Array.isArray(direct) ? direct : [];
});
const itemRows = computed(() => contextItems.value.slice(0, 16).map((item: any) => ({
  role: item.role || item.kind || '-',
  source: item.source_kind || item.source || '-',
  authority: item.authority || '-',
  score: item.score ?? '-',
  text: item.text || item.content || item.summary || '-',
})));
const historyRows = computed(() => {
  const rows = history.value?.summaries || history.value?.events || history.value?.contexts || [];
  return (Array.isArray(rows) ? rows : []).slice(0, 14).map((item: any) => ({
    envelope: item.envelope_id || item.id || '-',
    kind: item.kind || item.event_kind || '-',
    created: item.created_at || item.created_at_ms || '-',
    summary: item.summary || item.detail || item.source || '-',
  }));
});
const recommendationRows = computed(() => {
  const rows = recommendations.value?.recommendations || recommendations.value?.items || recommendations.value?.stats || [];
  return (Array.isArray(rows) ? rows : []).slice(0, 12).map((item: any) => ({
    id: item.envelope_id || item.id || '-',
    action: item.action || item.recommendation || '-',
    count: item.count || item.total || '-',
    status: item.status || '-',
  }));
});
const envelopeId = computed(() => envelope.value?.envelope_id || envelope.value?.envelope?.id || historyRows.value[0]?.envelope || '');
const contextStatus = computed(() => envelope.value?.__offline ? 'blocked' : itemRows.value.length ? 'ready' : 'idle');
const contextBar = computed(() => [
  { label: t('script.pages.contextpage.label.f7f1997c6c'), value: sessionId.value },
  { label: t('script.pages.contextpage.label.ff4fc0276e'), value: profile.value },
  { label: t('script.pages.contextpage.label.44d25b5d1b'), value: itemRows.value.length, tone: itemRows.value.length ? 'success' : 'warn' },
  { label: t('script.pages.contextpage.label.7f4a2c89d8'), value: envelopeId.value || 'pending' },
]);
const contextWorkflow = computed(() => [
  { id: 'packet', label: t('script.pages.contextpage.label.83c6d723cb'), status: contextStatus.value, count: itemRows.value.length },
  { id: 'budget', label: t('script.pages.contextpage.label.7aeba4cd15'), status: envelope.value?.budget ? 'ready' : 'idle', description: envelope.value?.budget?.total || t('store.app.string.18eb606335') },
  { id: 'evidence', label: t('script.pages.contextpage.label.7ea014de7b'), status: evidence.value?.__offline ? 'blocked' : evidence.value?.kind ? 'ready' : 'idle', description: evidenceRef.value },
  { id: 'history', label: t('script.pages.contextpage.label.90ccd64974'), status: historyRows.value.length ? 'ready' : 'idle', count: historyRows.value.length },
]);
const contextEvidence = computed(() => [
  ...itemRows.value.slice(0, 4).map((row) => ({
    id: String(row.source || row.role || ''),
    kind: String(row.role || 'context item'),
    status: row.score !== '-' ? 'ready' : 'recorded',
    summary: String(row.text || '-'),
    source: String(row.source || row.authority || 'context'),
  })),
  ...(evidence.value && !evidence.value.__offline ? [{
    id: evidenceRef.value,
    kind: evidence.value.kind || 'resolved evidence',
    status: evidence.value.status || 'ready',
    summary: evidence.value.summary || evidence.value.ref || evidenceRef.value,
    source: evidence.value.source || 'gateway.evidence',
  }] : []),
]);
const executionProjection = computed(() => store.currentExecutionProjection);
const projectionContextRows = computed(() => (executionProjection.value?.context || []).map((item: any) => ({
  id: item.id || '-',
  kind: item.kind || '-',
  status: item.status || '-',
  summary: item.summary || '-',
  evidence: Array.isArray(item.evidence_refs) ? item.evidence_refs.length : 0,
})));
const projectionUsageRows = computed(() => (executionProjection.value?.usage || []).map((item: any) => ({
  id: item.id || '-',
  kind: item.kind || '-',
  status: item.status || '-',
  summary: item.summary || '-',
})));

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextEnvelope, nextHistory, nextRecommendations, nextTimeline] = await Promise.all([
      api.contextCurrent(sessionId.value, query.value, profile.value),
      api.contextHistory(sessionId.value),
      api.contextRecommendations(sessionId.value),
      api.runtimeTimeline(sessionId.value).catch(() => ({})),
    ]);
    envelope.value = nextEnvelope;
    history.value = nextHistory;
    recommendations.value = nextRecommendations;
    const executionId = nextTimeline?.execution_graph_summary?.latest?.graph_id;
    if (executionId) store.connectExecutionProjection(String(executionId));
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function resolveEvidence() {
  evidence.value = await api.resolveEvidence(evidenceRef.value);
}

async function acknowledgeRecommendation() {
  if (!envelopeId.value) return;
  actionResult.value = await api.recordContextRecommendation(sessionId.value, envelopeId.value, recommendationText.value, 'acknowledged');
  recommendations.value = await api.contextRecommendations(sessionId.value);
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page context-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.context.page.text.6ce2dbc303') }}</h1>
        <p>{{ t('page.context.page.text.6441b42fdb') }}</p>
      </div>
      <div class="button-row">
        <RouterLink class="ghost-action" :to="`/reality?section=fact-flow&session_id=${encodeURIComponent(sessionId)}`">{{ t('page.context.page.text.3c3d442579') }}</RouterLink>
        <button class="primary-action" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" />
          {{ loading ? t('page.context.page.inline.a63207a5aa') : t('page.context.page.inline.a7ad534cc2') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <PrimaryContextBar :items="contextBar" density="compact" :max-visible="4" />
    <WorkflowStrip :steps="contextWorkflow" :title="t('page.context.page.title.eaa4662226')" density="compact" />

    <section class="metric-row" data-section="budget">
      <article class="metric-card">
        <span>{{ t('page.context.page.text.2109fa7d46') }}</span>
        <strong>{{ itemRows.length }}</strong>
        <small>{{ envelope.source || envelope.mode || t('page.context.page.inline.a7b40b78ae') }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.context.page.text.13b7b37aae') }}</span>
        <strong>{{ historyRows.length }}</strong>
        <small>{{ t('page.context.page.text.d124adbe4d') }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.context.page.text.122092ecb1') }}</span>
        <strong>{{ recommendationRows.length }}</strong>
        <small>{{ sessionId }}</small>
      </article>
    </section>

    <section class="context-grid">
      <section class="management-panel context-panel wide" data-section="packet">
        <header>
          <h2>{{ t('page.context.page.text.00bcbce604') }}</h2>
          <StatusPill :status="envelope.__offline ? 'offline' : 'ready'" />
        </header>
        <div class="context-builder-row">
          <label class="field-line">
            {{ t('template.pages.contextpage.a618b4be8d') }}
            <input v-model="query" type="text" @keyup.enter="refresh" />
          </label>
          <label class="field-line">
            {{ t('template.pages.contextpage.ff4fc0276e') }}
            <select v-model="profile">
              <option value="main_turn">main_turn</option>
              <option value="yolo_goal">yolo_goal</option>
              <option value="collaboration">collaboration</option>
            </select>
          </label>
        </div>
        <button class="primary-action" type="button" @click="refresh">
          <Search :size="15" />
          {{ t('template.pages.contextpage.2e16e8d2e9') }}
        </button>
        <DataTable v-if="itemRows.length" searchable copyable :rows="itemRows" :columns="['role', 'source', 'authority', 'score', 'text']" @row-click="selectedDetail = $event" />
        <DataTable v-if="projectionContextRows.length" searchable copyable row-key="id" :rows="projectionContextRows" :columns="['id', 'kind', 'status', 'summary', 'evidence']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.context.page.title.3e00f7b727')" :detail="t('page.context.page.detail.0f6e3d1ebe')" />
        <EvidenceTrace :items="contextEvidence" :title="t('page.context.page.title.97f9320e36')" />
      </section>

      <section class="management-panel context-panel" data-section="evidence">
        <header>
          <h2>{{ t('page.context.page.text.a8dd41fa22') }}</h2>
          <span>{{ t('page.context.page.text.08cb9c66d5') }}</span>
        </header>
        <label class="field-line">
          {{ t('page.context.field.evidenceRef') }}
          <input v-model="evidenceRef" type="text" @keyup.enter="resolveEvidence" />
        </label>
        <button class="ghost-action" type="button" @click="resolveEvidence">{{ t('page.context.page.text.7dc8932461') }}</button>
        <RequestReceipt :receipt="evidence" :title="t('page.context.page.title.e3b3e3081c')" />
        <RawPayload :title="t('page.context.page.title.5f71074cfb')" :data="evidence" />
      </section>

      <section class="management-panel context-panel" data-section="budget">
        <header>
          <h2>{{ t('page.context.page.text.92f813f7b1') }}</h2>
          <span>{{ envelopeId || t('page.context.page.inline.46721d3741') }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.contextpage.35d0a081f5') }}
          <textarea v-model="recommendationText" rows="3" />
        </label>
        <button class="primary-action" type="button" :disabled="!envelopeId" @click="acknowledgeRecommendation">
          <Check :size="15" />
          {{ t('template.pages.contextpage.9beb96dac8') }}
        </button>
        <RequestReceipt :receipt="actionResult" :title="t('page.context.page.title.ea2c090ac6')" />
        <DataTable v-if="projectionUsageRows.length" searchable copyable row-key="id" :rows="projectionUsageRows" :columns="['id', 'kind', 'status', 'summary']" @row-click="selectedDetail = $event" />
        <DataTable v-if="recommendationRows.length" searchable copyable :rows="recommendationRows" :columns="['id', 'action', 'count', 'status']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.context.page.title.e62d3fb566')" :detail="t('page.context.page.detail.dcd7576e63')" />
      </section>

      <section class="management-panel context-panel wide" data-section="history">
        <header>
          <h2>{{ t('page.context.page.text.397af08f0b') }}</h2>
          <span>{{ historyRows.length }} history rows</span>
        </header>
        <DataTable v-if="historyRows.length" searchable copyable :rows="historyRows" :columns="['envelope', 'kind', 'created', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.context.page.title.fae4d2126c')" :detail="t('page.context.page.detail.56aba34430')" />
        <DetailDrawer :title="t('page.context.page.title.66cb55e17d')" :row="selectedDetail" @close="selectedDetail = null" />
        <RawPayload :title="t('page.context.page.title.b8176568a4')" :data="executionProjection || envelope" />
        <RawPayload :title="t('page.context.page.title.49b5f508d1')" :data="actionResult || recommendations" />
      </section>
    </section>
  </section>
</template>
