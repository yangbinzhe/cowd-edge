<script setup lang="ts">
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
  { label: 'Session', value: sessionId.value },
  { label: 'Profile', value: profile.value },
  { label: 'Items', value: itemRows.value.length, tone: itemRows.value.length ? 'success' : 'warn' },
  { label: 'Envelope', value: envelopeId.value || 'pending' },
]);
const contextWorkflow = computed(() => [
  { id: 'packet', label: 'Packet', status: contextStatus.value, count: itemRows.value.length },
  { id: 'budget', label: 'Budget', status: envelope.value?.budget ? 'ready' : 'idle', description: envelope.value?.budget?.total || 'not reported' },
  { id: 'evidence', label: 'Evidence', status: evidence.value?.__offline ? 'blocked' : evidence.value?.kind ? 'ready' : 'idle', description: evidenceRef.value },
  { id: 'history', label: 'History', status: historyRows.value.length ? 'ready' : 'idle', count: historyRows.value.length },
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

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextEnvelope, nextHistory, nextRecommendations] = await Promise.all([
      api.contextCurrent(sessionId.value, query.value, profile.value),
      api.contextHistory(sessionId.value),
      api.contextRecommendations(sessionId.value),
    ]);
    envelope.value = nextEnvelope;
    history.value = nextHistory;
    recommendations.value = nextRecommendations;
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
        <h1>Context Builder</h1>
        <p>上下文包构建、历史包络、推荐动作和证据解析集中管理。</p>
      </div>
      <div class="button-row">
        <RouterLink class="ghost-action" :to="`/reality?section=fact-flow&session_id=${encodeURIComponent(sessionId)}`">Open Fact Flow</RouterLink>
        <button class="primary-action" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" />
          {{ loading ? 'Loading' : 'Build context' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <PrimaryContextBar :items="contextBar" />
    <WorkflowStrip :steps="contextWorkflow" title="Context assembly flow" />

    <section class="metric-row">
      <article class="metric-card">
        <span>Context items</span>
        <strong>{{ itemRows.length }}</strong>
        <small>{{ envelope.source || envelope.mode || 'current envelope' }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>History</span>
        <strong>{{ historyRows.length }}</strong>
        <small>stored envelopes</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>Recommendations</span>
        <strong>{{ recommendationRows.length }}</strong>
        <small>{{ sessionId }}</small>
      </article>
    </section>

    <section class="context-grid">
      <section class="management-panel context-panel wide">
        <header>
          <h2>Context builder</h2>
          <StatusPill :status="envelope.__offline ? 'offline' : 'ready'" />
        </header>
        <div class="context-builder-row">
          <label class="field-line">
            Query
            <input v-model="query" type="text" @keyup.enter="refresh" />
          </label>
          <label class="field-line">
            Profile
            <select v-model="profile">
              <option value="main_turn">main_turn</option>
              <option value="yolo_goal">yolo_goal</option>
              <option value="collaboration">collaboration</option>
            </select>
          </label>
        </div>
        <button class="primary-action" type="button" @click="refresh">
          <Search :size="15" />
          Build packet
        </button>
        <DataTable v-if="itemRows.length" :rows="itemRows" :columns="['role', 'source', 'authority', 'score', 'text']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No context items" detail="当前查询没有可展示的上下文项，或后端离线。" />
        <EvidenceTrace :items="contextEvidence" title="Context evidence trace" />
      </section>

      <section class="management-panel context-panel">
        <header>
          <h2>Evidence resolve</h2>
          <span>reference lookup</span>
        </header>
        <label class="field-line">
          Evidence ref
          <input v-model="evidenceRef" type="text" @keyup.enter="resolveEvidence" />
        </label>
        <button class="ghost-action" type="button" @click="resolveEvidence">Resolve evidence</button>
        <RequestReceipt :receipt="evidence" title="Lookup receipt" />
        <RawPayload title="Resolved evidence" :data="evidence" />
      </section>

      <section class="management-panel context-panel">
        <header>
          <h2>Recommendation actions</h2>
          <span>{{ envelopeId || 'no envelope' }}</span>
        </header>
        <label class="field-line">
          Recommendation note
          <textarea v-model="recommendationText" rows="3" />
        </label>
        <button class="primary-action" type="button" :disabled="!envelopeId" @click="acknowledgeRecommendation">
          <Check :size="15" />
          Acknowledge
        </button>
        <RequestReceipt :receipt="actionResult" title="Recommendation receipt" />
        <DataTable v-if="recommendationRows.length" :rows="recommendationRows" :columns="['id', 'action', 'count', 'status']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No recommendation stats" detail="推荐动作统计会在后端有历史数据时展示。" />
      </section>

      <section class="management-panel context-panel wide">
        <header>
          <h2>History and raw envelope</h2>
          <span>{{ historyRows.length }} history rows</span>
        </header>
        <DataTable v-if="historyRows.length" :rows="historyRows" :columns="['envelope', 'kind', 'created', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No context history" detail="持久化 session store 没有返回上下文历史。" />
        <DetailDrawer title="Context selected detail" :row="selectedDetail" @close="selectedDetail = null" />
        <RawPayload title="Current envelope" :data="envelope" />
        <RawPayload title="Action result" :data="actionResult || recommendations" />
      </section>
    </section>
  </section>
</template>
