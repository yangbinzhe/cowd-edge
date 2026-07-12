<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Database, GitBranch, Network, RefreshCw, Search, ShieldCheck } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import EvidenceObjectDetail from '../components/workbench/EvidenceObjectDetail.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import { useAppStore } from '../stores/app';
import type { EvidenceObject } from '../types/evidence';
import { displayStatus } from '../i18n/domain/status';

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const loading = ref(false);
const error = ref('');
const status = ref<any>({});
const stats = ref<any>({});
const layers = ref<any>({});
const selectedLayer = ref('L2');
const layerEntries = ref<any>({});
const selectedEntryId = ref('');
const query = ref('');
const symbolQuery = ref('');
const searchResult = ref<any>({});
const recallExplain = ref<any>({});
const packet = ref<any>({});
const links = ref<any>({});
const clusters = ref<any>({});
const entities = ref<any>({});
const triples = ref<any>({});
const symbolLinks = ref<any>({});
const maintenance = ref<any>({});
const lifecycle = ref<any>({});
const maintenanceScan = ref<any>(null);
const performance = ref<any>({});
const runtime = ref<any>({});
const contextEnvelope = ref<any>({});
const knowledge = ref<any>({});
const knowledgeNamespaces = ref<any>({});
const knowledgeConflicts = ref<any>({});
const knowledgeMaintenance = ref<any>({});
const structured = ref<any>({});
const structuredPlan = ref<any>(null);
const actionResult = ref<any>(null);
const selectedDetail = ref<Record<string, unknown> | null>(null);

const entryTitle = ref('');
const entryContent = ref('');
const entryTags = ref('');
const entryPriority = ref('normal');
const sourceRef = ref('');
const factType = ref('');

const layerItems = computed(() => Array.isArray(layers.value?.layers) ? layers.value.layers : []);
const entries = computed(() => Array.isArray(layerEntries.value?.entries) ? layerEntries.value.entries : []);
const selectedEntry = computed(() => entries.value.find((entry: any) => entry.id === selectedEntryId.value) || null);
const recallRows = computed(() => (Array.isArray(recallExplain.value?.results) ? recallExplain.value.results : []).map((item: any) => ({
  title: item.title || item.id,
  layer: item.source_layer || item.layer,
  priority: item.priority,
  score: item.score,
  snippet: item.snippet || item.content,
})));
const packetRows = computed(() => (Array.isArray(packet.value?.items) ? packet.value.items : []).slice(0, 12).map((item: any) => ({
  id: item.id || item.ref || item.title || '-',
  kind: item.kind || item.role || 'context.packet',
  source: item.source || item.layer || '-',
  score: item.score ?? item.authority ?? '-',
  summary: item.summary || item.text || item.content || item.title || '-',
})));
const entityRows = computed(() => Array.isArray(entities.value?.entities) ? entities.value.entities.slice(0, 12) : []);
const tripleRows = computed(() => Array.isArray(triples.value?.triples) ? triples.value.triples.slice(0, 12) : []);
const symbolRows = computed(() => {
  const rows = Array.isArray(symbolLinks.value?.links) ? symbolLinks.value.links : Array.isArray(symbolLinks.value?.items) ? symbolLinks.value.items : [];
  return rows.slice(0, 12).map((item: any) => ({
    symbol: item.symbol || item.source || symbolQuery.value,
    target: item.target || item.ref || item.memory_id || '-',
    kind: item.kind || item.type || 'symbol.link',
    confidence: item.confidence ?? item.score ?? '-',
    summary: item.summary || item.reason || item.path || '-',
  }));
});
const structuredRows = computed(() => {
  const facts = Array.isArray(structured.value?.facts?.facts) ? structured.value.facts.facts : Array.isArray(structured.value?.facts?.items) ? structured.value.facts.items : [];
  const sources = Array.isArray(structured.value?.sources?.sources) ? structured.value.sources.sources : [];
  return [
    ...sources.slice(0, 6).map((source: any) => ({
      id: source.id || source.source_ref || source.name || '-',
      kind: 'structured.source',
      status: source.status || '-',
      owner: source.owner || source.system || '-',
      summary: source.summary || source.description || source.path || '-',
      raw: source,
    })),
    ...facts.slice(0, 8).map((fact: any) => ({
      id: fact.id || fact.fact_id || fact.source_ref || '-',
      kind: fact.fact_type || 'structured.fact',
      status: fact.status || '-',
      owner: fact.source_ref || '-',
      summary: fact.summary || fact.value || fact.title || '-',
      raw: fact,
    })),
  ];
});
const candidateRows = computed(() => [
  ...(Array.isArray(maintenance.value?.candidates) ? maintenance.value.candidates : []),
  ...(Array.isArray(knowledgeMaintenance.value?.maintenance_candidates) ? knowledgeMaintenance.value.maintenance_candidates : []),
]);
const namespaceRows = computed(() => Array.isArray(knowledgeNamespaces.value?.namespace_tree) ? knowledgeNamespaces.value.namespace_tree : []);
const knowledgeConflictRows = computed(() => {
  const projection = knowledgeConflicts.value?.conflict_projection || knowledge.value?.projection?.conflict_projection || {};
  return Array.isArray(projection.conflicts) ? projection.conflicts : [];
});
const knowledgeMaintenanceRows = computed(() => Array.isArray(knowledgeMaintenance.value?.maintenance_candidates) ? knowledgeMaintenance.value.maintenance_candidates : []);
const activationPolicyRows = computed(() => Array.isArray(knowledgeNamespaces.value?.activation_policy_distribution) ? knowledgeNamespaces.value.activation_policy_distribution : []);
const governanceRows = computed(() => Array.isArray(knowledgeNamespaces.value?.governance_distribution) ? knowledgeNamespaces.value.governance_distribution : []);
const recallQuality = computed(() => knowledgeMaintenance.value?.recall_quality || knowledge.value?.projection?.recall_quality || {});
const linkCount = computed(() => Number(links.value?.total || links.value?.links?.length || 0));
const healthLevel = computed(() => status.value?.kernel_health?.degraded ? 'degraded' : (status.value?.status || 'unknown'));
const memoryContext = computed(() => [
  { label: t('script.pages.memorypage.label.c1f65ddb75'), value: 'Reality Core / Memory' },
  { label: t('script.pages.memorypage.label.3703cd2168'), value: healthLevel.value, tone: healthLevel.value === 'ready' ? 'success' : 'warn' },
  { label: t('memory.contextEnvelope.label'), value: contextEnvelope.value?.status || status.value?.context_envelope_projection?.status || 'unknown', tone: (contextEnvelope.value?.status || status.value?.context_envelope_projection?.status) === 'ready' ? 'success' : 'warn' },
  { label: t('script.pages.memorypage.label.4343635cf2'), value: selectedLayer.value },
  { label: t('script.pages.memorypage.label.014bcd654c'), value: linkCount.value },
]);
const memoryWorkflow = computed(() => [
  { id: 'layers', label: t('script.pages.memorypage.label.4343635cf2'), status: entries.value.length ? 'ready' : 'idle', count: entries.value.length },
  { id: 'recall', label: t('script.pages.memorypage.label.3f7e1fd914'), status: recallRows.value.length ? 'active' : 'idle', count: recallRows.value.length },
  { id: 'context-envelope', label: t('memory.contextEnvelope.label'), status: contextEnvelope.value?.status || 'idle', description: contextEnvelope.value?.latest_envelope_id || contextEnvelope.value?.degraded_reason || '-' },
  { id: 'knowledge-governance', label: t('memory.knowledgeGovernance.label'), status: knowledge.value?.capability_status || 'idle', count: namespaceRows.value.length },
  { id: 'recall', label: t('script.pages.memorypage.label.83c6d723cb'), status: packet.value?.items?.length ? 'ready' : 'idle', description: query.value },
  { id: 'graph', label: t('script.pages.memorypage.label.c7fb317725'), status: entityRows.value.length ? 'ready' : 'idle', count: entityRows.value.length },
  { id: 'maintenance', label: t('script.pages.memorypage.label.94de303bbe'), status: candidateRows.value.length ? 'blocked' : 'ready', count: candidateRows.value.length },
  { id: 'structured-core', label: t('script.pages.memorypage.label.550ae25c2e'), status: structuredPlan.value ? 'active' : 'idle', description: factType.value },
]);
const memoryEvidence = computed(() => [
  ...recallRows.value.slice(0, 4).map((row: any) => ({
    id: String(row.title || ''),
    kind: 'memory.recall',
    status: row.score !== undefined ? 'ready' : 'recorded',
    summary: row.snippet || row.title || 'recall result',
    source: row.layer || 'memory',
  })),
  ...((Array.isArray(packet.value?.items) ? packet.value.items : []) as any[]).slice(0, 3).map((item: any) => ({
    id: String(item.id || item.ref || item.title || ''),
    kind: item.kind || 'context.packet',
    status: item.status || 'ready',
    summary: item.summary || item.text || item.content || item.title || 'packet item',
    source: item.source || item.layer || 'memory.packet',
  })),
  ...candidateRows.value.slice(0, 3).map((candidate: any) => ({
    id: String(candidate.id || candidate.memory_id || ''),
    kind: candidate.kind || 'memory.maintenance',
    status: candidate.status || candidate.decision || 'candidate',
    summary: candidate.summary || candidate.description || candidate.reason || 'maintenance candidate',
    source: candidate.source || 'memory.maintenance',
  })),
  ...(structuredPlan.value ? [{
    id: String(structuredPlan.value.plan_id || structuredPlan.value.id || factType.value),
    kind: 'structured.ingest.plan',
    status: structuredPlan.value.status || 'planned',
    summary: structuredPlan.value.summary || sourceRef.value,
    source: 'cowd.structured',
  }] : []),
].filter((item) => item.id || item.summary));
const selectedEvidence = computed<EvidenceObject | null>(() => {
  const row: any = selectedDetail.value || selectedEntry.value;
  if (!row) return null;
  const ref = String(row.id || row.memory_id || row.title || row.source_ref || row.fact_type || row.kind || 'memory');
  return {
    ref,
    kind: row.kind || row.fact_type || row.category || 'memory.object',
    source: row.source || row.source_layer || row.layer || 'memory',
    status: row.status || row.priority || row.decision || 'recorded',
    summary: row.summary || row.snippet || row.content || row.description || row.title || ref,
    memory_id: row.memory_id || row.id,
    matrix_ref: row.matrix_ref || row.source_ref || row.fact_type,
    route: row.layer ? `/memory?layer=${encodeURIComponent(String(row.layer))}` : '/memory',
    raw: row,
  };
});
const contextEnvelopeRows = computed(() => (Array.isArray(contextEnvelope.value?.summaries) ? contextEnvelope.value.summaries : []).map((item: any) => ({
  envelope_id: item.envelope_id || '-',
  session_id: item.session_id || '-',
  profile: item.profile || '-',
  pressure_bp: item.pressure_bp ?? '-',
  selected: item.selected_count ?? 0,
  omitted: item.omitted_count ?? 0,
})));
const contextEnvelopeStatus = computed(() => contextEnvelope.value?.status || status.value?.context_envelope_projection?.status || 'unknown');
const contextEnvelopeRatio = computed(() => {
  const ratio = Number(contextEnvelope.value?.used_ratio ?? status.value?.context_envelope_projection?.used_ratio ?? 0);
  return `${Math.round(ratio * 100)}%`;
});

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [
      nextStatus,
      nextStats,
      nextLayers,
      nextLinks,
      nextClusters,
      nextEntities,
      nextTriples,
      nextMaintenance,
      nextPerformance,
      nextRuntime,
      nextContextEnvelope,
      nextKnowledge,
      nextKnowledgeNamespaces,
      nextKnowledgeConflicts,
      nextKnowledgeMaintenance,
      sources,
      facts,
      evidence,
      watermarks,
    ] = await Promise.all([
      api.memoryStatus(),
      api.memoryStats(),
      api.memoryLayers(),
      api.memoryLinks(),
      api.memoryClusters(),
      api.memoryEntities(),
      api.memoryTriples(),
      api.memoryMaintenance(),
      api.memoryPerformance(),
      api.memoryRuntime(),
      api.memoryContextEnvelope('', 20),
      api.memoryKnowledge(),
      api.memoryKnowledgeNamespaces(),
      api.memoryKnowledgeConflicts(),
      api.memoryKnowledgeMaintenance(),
      api.structuredSources(),
      api.structuredFacts(),
      api.structuredEvidence(),
      api.structuredWatermarks(),
    ]);
    status.value = nextStatus;
    stats.value = nextStats;
    layers.value = nextLayers;
    links.value = nextLinks;
    clusters.value = nextClusters;
    entities.value = nextEntities;
    triples.value = nextTriples;
    maintenance.value = nextMaintenance;
    performance.value = nextPerformance;
    runtime.value = nextRuntime;
    contextEnvelope.value = nextContextEnvelope;
    knowledge.value = nextKnowledge;
    knowledgeNamespaces.value = nextKnowledgeNamespaces;
    knowledgeConflicts.value = nextKnowledgeConflicts;
    knowledgeMaintenance.value = nextKnowledgeMaintenance;
    structured.value = { sources, facts, evidence, watermarks };
    await loadLayer();
    await runRecall();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function loadLayer() {
  layerEntries.value = await api.memoryLayer(selectedLayer.value);
  if (!entries.value.some((entry: any) => entry.id === selectedEntryId.value)) selectedEntryId.value = '';
}

async function runRecall() {
  const recallQuery = query.value.trim();
  const symbol = symbolQuery.value.trim();
  const [search, explain, nextPacket, nextSymbolLinks] = await Promise.all([
    recallQuery ? api.memorySearch(recallQuery) : Promise.resolve({ results: [] }),
    recallQuery ? api.memoryRecallExplain(recallQuery, 12) : Promise.resolve({ results: [], total: 0 }),
    recallQuery ? api.memoryPacket(recallQuery, 12, 2000) : Promise.resolve({ items: [] }),
    symbol ? api.memorySymbolLinks(symbol) : Promise.resolve({ links: [] }),
  ]);
  searchResult.value = search;
  recallExplain.value = explain;
  packet.value = nextPacket;
  symbolLinks.value = nextSymbolLinks;
}

async function createEntry() {
  actionResult.value = await api.createMemoryEntry(selectedLayer.value, {
    title: entryTitle.value,
    content: entryContent.value,
    category: 'reference',
    priority: entryPriority.value,
    tags: entryTags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
  });
  await Promise.all([loadLayer(), refresh()]);
}

async function updateEntry() {
  if (!selectedEntry.value?.id) return;
  actionResult.value = await api.updateMemoryEntry(selectedEntry.value.id, {
    content: entryContent.value,
    priority: entryPriority.value,
    tags: entryTags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
  });
  await loadLayer();
}

async function inspectLifecycle() {
  if (!selectedEntry.value?.id) return;
  lifecycle.value = await api.memoryLifecycle(selectedEntry.value.id);
}

async function deleteEntry() {
  if (!selectedEntry.value?.id) return;
  actionResult.value = await api.deleteMemoryEntry(selectedLayer.value, selectedEntry.value.id);
  await loadLayer();
}

async function scanMaintenance() {
  maintenanceScan.value = await api.scanMemoryMaintenance({ max_candidates: 40 });
  maintenance.value = maintenanceScan.value;
}

async function markCandidate(id: string, nextStatus: string) {
  actionResult.value = await api.updateMemoryMaintenance(id, nextStatus);
  maintenance.value = await api.memoryMaintenance();
}

async function planStructuredIngest() {
  if (!sourceRef.value.trim() || !factType.value.trim()) {
    error.value = t('page.memory.error.structuredInputRequired');
    return;
  }
  structuredPlan.value = await api.structuredIngestPlan({
    source_ref: sourceRef.value,
    fact_type: factType.value,
  });
}

function summarize(value: any, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value).slice(0, 160);
}

function selectStructuredRow(row: Record<string, unknown>) {
  selectedDetail.value = (row.raw as Record<string, unknown> | undefined) || row;
}

async function selectMemorySection(sectionId: string) {
  store.selectSection('memory', sectionId);
  await router.replace({ query: { ...route.query, section: sectionId } });
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(`[data-section="${sectionId}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page memory-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.memory.page.text.7f069c1bfc') }}</h1>
        <p>{{ t('page.memory.page.text.137bebc37b') }}</p>
      </div>
      <div class="button-row">
        <RouterLink class="ghost-action" to="/reality">{{ t('page.memory.page.text.070fef7b51') }}</RouterLink>
        <button class="primary-action" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" />
          {{ loading ? t('page.memory.page.inline.9b1b07427e') : t('page.memory.page.inline.d4514909be') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row memory-overview">
      <article class="metric-card">
        <span>{{ t('page.memory.page.text.b18fa8ad53') }}</span>
        <strong>{{ displayStatus(healthLevel) }}</strong>
        <small>{{ status.enabled === false ? t('page.memory.page.inline.4838a2ce38') : `${stats.total_entries || 0} entries` }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.memory.page.text.967669c6b7') }}</span>
        <strong>{{ stats.entity_count || 0 }}/{{ stats.triple_count || 0 }}</strong>
        <small>{{ t('page.memory.page.text.0d351f6cb3') }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.memory.page.text.4dc077cd38') }}</span>
        <strong>{{ linkCount }}</strong>
        <small>{{ t('page.memory.summary.indexedVectors', { count: stats.vector_count || 0 }) }}</small>
      </article>
      <article class="metric-card" :data-tone="contextEnvelopeStatus === 'ready' ? 'success' : 'warn'">
        <span>{{ t('memory.contextEnvelope.label') }}</span>
        <strong>{{ displayStatus(contextEnvelopeStatus) }}</strong>
        <small>{{ t('memory.contextEnvelope.used', { value: contextEnvelopeRatio }) }}</small>
      </article>
    </section>

    <section class="memory-workbench">
      <nav class="memory-sections" :aria-label="t('page.memory.page.aria-label.6f075355c0')">
        <button type="button" @click="selectMemorySection('layers')"><Database :size="15" />{{ t('page.memory.page.text.da827dc4ae') }}</button>
        <button type="button" @click="selectMemorySection('recall')"><Search :size="15" />{{ t('page.memory.page.text.58e722778f') }}</button>
        <button type="button" @click="selectMemorySection('context-envelope')"><Network :size="15" />{{ t('memory.contextEnvelope.label') }}</button>
        <button type="button" @click="selectMemorySection('knowledge-governance')"><ShieldCheck :size="15" />{{ t('memory.knowledgeGovernance.label') }}</button>
        <button type="button" @click="selectMemorySection('graph')"><GitBranch :size="15" />{{ t('page.memory.page.text.c676fc9eca') }}</button>
        <button type="button" @click="selectMemorySection('maintenance')"><ShieldCheck :size="15" />{{ t('page.memory.page.text.44500c4e90') }}</button>
        <button type="button" @click="selectMemorySection('structured-core')"><Network :size="15" />{{ t('page.memory.page.text.23d5f43eb0') }}</button>
      </nav>

      <main class="memory-main">
        <section id="memory-layers" class="management-panel memory-panel wide" data-section="layers">
          <header>
            <h2>{{ t('page.memory.page.text.59a9b03328') }}</h2>
            <span>{{ formatCount('entries', entries.length) }}</span>
          </header>
          <div class="memory-split">
            <aside class="memory-list">
              <div class="filter-row">
                <select v-model="selectedLayer" @change="loadLayer">
                  <option v-for="layer in ['L0', 'L1', 'L2', 'L3', 'L4']" :key="layer" :value="layer">{{ layer }}</option>
                </select>
                <StatusPill :status="layerEntries.enabled === false ? 'offline' : 'ready'" />
              </div>
              <button
                v-for="entry in entries"
                :key="entry.id"
                class="memory-entry-row"
                :class="{ active: selectedEntryId === entry.id }"
                type="button"
                @click="selectedEntryId = entry.id; selectedDetail = entry"
              >
                <strong>{{ entry.title || entry.id }}</strong>
                <span>{{ entry.content || entry.summary || entry.id }}</span>
                <small>{{ entry.category || '-' }} · {{ entry.priority || '-' }}</small>
              </button>
              <EmptyState v-if="!entries.length" :title="t('page.memory.page.title.178f22a6d0')" :detail="t('page.memory.page.detail.085528ade1')" />
            </aside>
            <article class="memory-detail">
              <dl class="detail-list">
                <dt>{{ t('common.id') }}</dt>
                <dd>{{ selectedEntry?.id || '-' }}</dd>
                <dt>{{ t('page.memory.page.text.e5cc96a4d2') }}</dt>
                <dd>{{ selectedEntry?.layer || selectedLayer }}</dd>
                <dt>{{ t('page.memory.page.text.cc8c1c2057') }}</dt>
                <dd>{{ selectedEntry?.scope || '-' }}</dd>
                <dt>{{ t('page.memory.page.text.e811ec8276') }}</dt>
                <dd>{{ (selectedEntry?.tags || []).join(', ') || '-' }}</dd>
              </dl>
              <label class="field-line">
                {{ t('page.memory.field.title') }}
                <input v-model="entryTitle" type="text" />
              </label>
              <label class="field-line">
                {{ t('page.memory.field.content') }}
                <textarea v-model="entryContent" rows="5" />
              </label>
              <div class="memory-form-row">
                <label class="field-line">
                  {{ t('page.memory.field.priority') }}
                  <select v-model="entryPriority">
                    <option value="critical">{{ t('priority.critical') }}</option>
                    <option value="high">{{ t('priority.high') }}</option>
                    <option value="normal">{{ t('priority.normal') }}</option>
                    <option value="low">{{ t('priority.low') }}</option>
                  </select>
                </label>
                <label class="field-line">
                  {{ t('page.memory.field.tags') }}
                  <input v-model="entryTags" type="text" />
                </label>
              </div>
              <div class="button-row">
                <button class="primary-action" type="button" @click="createEntry">{{ t('page.memory.page.text.ca1c3fc9cf') }}</button>
                <button class="ghost-action" type="button" :disabled="!selectedEntry" @click="updateEntry">{{ t('page.memory.page.text.9644fbecf5') }}</button>
                <button class="ghost-action" type="button" :disabled="!selectedEntry" @click="inspectLifecycle">{{ t('page.memory.page.text.239620d0a8') }}</button>
                <button class="ghost-action" type="button" :disabled="!selectedEntry" @click="deleteEntry">{{ t('page.memory.page.text.a81ea49866') }}</button>
              </div>
              <RequestReceipt :receipt="actionResult" :title="t('page.memory.page.title.6f17a86ac0')" />
              <ObjectInspectorDrawer :title="t('page.memory.page.title.d8ff01b6d7')" :data="lifecycle" />
            </article>
          </div>
        </section>

        <section id="memory-recall" class="management-panel memory-panel" data-section="recall">
          <header>
            <h2>{{ t('page.memory.page.text.74f1596f5e') }}</h2>
            <span>{{ formatCount('matches', recallExplain.total || 0) }}</span>
          </header>
          <label class="search-field">
            <Search :size="15" />
            <input v-model="query" type="search" :placeholder="t('page.memory.page.placeholder.ecaadc67df')" @keyup.enter="runRecall" />
          </label>
          <div class="button-row">
            <button class="primary-action" type="button" @click="runRecall">{{ t('page.memory.page.text.215fe6c40a') }}</button>
          </div>
          <DataTable v-if="recallRows.length" searchable copyable :rows="recallRows" :columns="['title', 'layer', 'priority', 'score', 'snippet']" @row-click="selectedDetail = $event" />
          <EmptyState v-else :title="t('page.memory.page.title.7ba084d974')" :detail="t('page.memory.page.detail.31896020e4')" />
          <DataTable v-if="packetRows.length" searchable copyable :rows="packetRows" :columns="['id', 'kind', 'source', 'score', 'summary']" @row-click="selectedDetail = $event" />
          <ObjectInspectorDrawer :title="t('page.memory.page.title.7ea35b5ba8')" :data="packet" />
        </section>

        <section id="memory-context-envelope" class="management-panel memory-panel wide" data-section="context-envelope">
          <header>
            <h2>{{ t('memory.contextEnvelope.label') }}</h2>
            <span>{{ contextEnvelope.latest_envelope_id || t('memory.contextEnvelope.noEnvelope') }}</span>
          </header>
          <div class="metric-row compact">
            <article class="metric-card">
              <span>{{ t('memory.contextEnvelope.status') }}</span>
              <strong>{{ displayStatus(contextEnvelopeStatus) }}</strong>
              <small>{{ contextEnvelope.degraded_reason || contextEnvelope.restore_pointer || '-' }}</small>
            </article>
            <article class="metric-card" data-tone="info">
              <span>{{ t('memory.contextEnvelope.budget') }}</span>
              <strong>{{ contextEnvelope.used_tokens || 0 }}/{{ contextEnvelope.token_budget || 0 }}</strong>
              <small>{{ t('memory.contextEnvelope.used', { value: contextEnvelopeRatio }) }}</small>
            </article>
            <article class="metric-card" data-tone="warn">
              <span>{{ t('memory.contextEnvelope.compression') }}</span>
              <strong>{{ displayStatus(contextEnvelope.compression_status || '-') }}</strong>
              <small>{{ t('memory.contextEnvelope.threshold', { value: Math.round(Number(contextEnvelope.compression_threshold || 0.7) * 100) }) }}</small>
            </article>
            <article class="metric-card" data-tone="success">
              <span>{{ t('memory.contextEnvelope.recallQuality') }}</span>
              <strong>{{ displayStatus(contextEnvelope.recall_quality_status || '-') }}</strong>
              <small>{{ contextEnvelope.selected_count || 0 }} / {{ contextEnvelope.omitted_count || 0 }}</small>
            </article>
          </div>
          <DataTable v-if="contextEnvelopeRows.length" searchable copyable :rows="contextEnvelopeRows" :columns="['envelope_id', 'session_id', 'profile', 'pressure_bp', 'selected', 'omitted']" @row-click="selectedDetail = $event" />
          <EmptyState v-else :title="t('memory.contextEnvelope.noEnvelope')" :detail="contextEnvelope.degraded_reason || t('memory.contextEnvelope.emptyDetail')" />
          <ObjectInspectorDrawer :title="t('memory.contextEnvelope.raw')" :data="contextEnvelope" />
        </section>

        <section id="memory-knowledge-governance" class="management-panel memory-panel wide" data-section="knowledge-governance">
          <header>
            <h2>{{ t('memory.knowledgeGovernance.label') }}</h2>
            <span>{{ knowledge.projection_mode || '-' }}</span>
          </header>
          <div class="metric-row compact">
            <article class="metric-card">
              <span>{{ t('memory.knowledgeGovernance.namespaces') }}</span>
              <strong>{{ namespaceRows.length }}</strong>
              <small>{{ t('memory.knowledgeGovernance.activePacks', { count: knowledge.projection?.health?.active_pack_count || 0 }) }}</small>
            </article>
            <article class="metric-card" data-tone="warn">
              <span>{{ t('memory.knowledgeGovernance.conflicts') }}</span>
              <strong>{{ knowledgeConflicts.conflict_projection?.unresolved || 0 }}</strong>
              <small>{{ t('memory.knowledgeGovernance.totalConflicts', { count: knowledgeConflicts.conflict_projection?.total || 0 }) }}</small>
            </article>
            <article class="metric-card" data-tone="info">
              <span>{{ t('memory.knowledgeGovernance.maintenance') }}</span>
              <strong>{{ knowledgeMaintenanceRows.length }}</strong>
              <small>{{ t('memory.knowledgeGovernance.precision', { value: Math.round(Number(recallQuality.precision_estimate ?? 1) * 100) }) }}</small>
            </article>
          </div>
          <div class="memory-tabs">
            <article>
              <h3>{{ t('memory.knowledgeGovernance.namespaces') }}</h3>
              <DataTable v-if="namespaceRows.length" searchable copyable :rows="namespaceRows" :columns="['namespace', 'level', 'corpus_count', 'pack_count', 'active_pack_count']" @row-click="selectedDetail = $event" />
              <EmptyState v-else :title="t('memory.knowledgeGovernance.emptyNamespaces')" :detail="knowledge.degraded_reason || '-'" />
            </article>
            <article>
              <h3>{{ t('memory.knowledgeGovernance.policyDistribution') }}</h3>
              <DataTable v-if="activationPolicyRows.length || governanceRows.length" copyable :rows="[...activationPolicyRows.map((row: any) => ({ kind: 'activation', ...row })), ...governanceRows.map((row: any) => ({ kind: 'governance', ...row }))]" :columns="['kind', 'key', 'count']" @row-click="selectedDetail = $event" />
              <EmptyState v-else :title="t('memory.knowledgeGovernance.emptyPolicy')" :detail="t('memory.knowledgeGovernance.emptyPolicyDetail')" />
            </article>
          </div>
          <DataTable v-if="knowledgeConflictRows.length" searchable copyable :rows="knowledgeConflictRows" :columns="['id', 'type', 'pack_id', 'decision', 'summary']" @row-click="selectedDetail = $event" />
          <DataTable v-if="knowledgeMaintenanceRows.length" searchable copyable :rows="knowledgeMaintenanceRows" :columns="['id', 'kind', 'severity', 'status', 'reason']" @row-click="selectedDetail = $event" />
          <ObjectInspectorDrawer :title="t('memory.knowledgeGovernance.recallQuality')" :data="recallQuality" />
          <ObjectInspectorDrawer :title="t('memory.knowledgeGovernance.raw')" :data="knowledge" />
        </section>

        <section id="memory-graph" class="management-panel memory-panel" data-section="graph">
          <header>
            <h2>{{ t('page.memory.page.text.8af20392f9') }}</h2>
            <span>{{ t('common.shownCount', { count: entityRows.length, unit: t('unit.entities') }) }}</span>
          </header>
          <div class="memory-tabs">
            <article>
              <h3>{{ t('page.memory.page.text.4629e42c4f') }}</h3>
              <DataTable v-if="entityRows.length" searchable copyable :rows="entityRows" @row-click="selectedDetail = $event" />
              <EmptyState v-else :title="t('page.memory.page.title.f0919ea2dd')" :detail="t('page.memory.page.detail.86d9c1fa2d')" />
            </article>
            <article>
              <h3>{{ t('page.memory.page.text.bab3ecc1cb') }}</h3>
              <DataTable v-if="tripleRows.length" searchable copyable :rows="tripleRows" @row-click="selectedDetail = $event" />
              <EmptyState v-else :title="t('page.memory.page.title.88ac34d434')" :detail="t('page.memory.page.detail.ad98015f0b')" />
            </article>
          </div>
          <label class="field-line">
            {{ t('template.pages.memorypage.55b9f253bb') }}
            <input v-model="symbolQuery" type="text" @keyup.enter="runRecall" />
          </label>
          <DataTable v-if="symbolRows.length" searchable copyable :rows="symbolRows" :columns="['symbol', 'target', 'kind', 'confidence', 'summary']" @row-click="selectedDetail = $event" />
          <ObjectInspectorDrawer :title="t('page.memory.page.title.4cf0ff71ef')" :data="symbolLinks" />
          <ObjectInspectorDrawer :title="t('page.memory.page.title.c2bbd9a5f2')" :data="{ clusters, runtime, links }" />
        </section>

        <section id="memory-maintenance" class="management-panel memory-panel" data-section="maintenance">
          <header>
            <h2>{{ t('page.memory.page.text.44500c4e90') }}</h2>
            <span>{{ formatCount('candidates', candidateRows.length) }}</span>
          </header>
          <button class="primary-action" type="button" @click="scanMaintenance">{{ t('page.memory.page.text.9dffc03a7b') }}</button>
          <RequestReceipt :receipt="maintenanceScan || actionResult" :title="t('page.memory.page.title.ba22f93cf4')" />
          <div class="maintenance-list">
            <article v-for="candidate in candidateRows.slice(0, 12)" :key="candidate.id || candidate.memory_id" role="button" tabindex="0" @click="selectedDetail = candidate" @keydown.enter.prevent="selectedDetail = candidate">
              <div>
                <strong>{{ candidate.kind || candidate.reason || candidate.id }}</strong>
                <p>{{ candidate.summary || candidate.description || summarize(candidate) }}</p>
              </div>
              <div class="button-row" v-if="candidate.id">
                <button class="ghost-action" type="button" @click.stop="markCandidate(candidate.id, 'acknowledged')">{{ t('page.memory.page.text.85c8084579') }}</button>
                <button class="ghost-action" type="button" @click.stop="markCandidate(candidate.id, 'dismissed')">{{ t('page.memory.page.text.13dc973ada') }}</button>
              </div>
            </article>
          </div>
          <EmptyState v-if="!candidateRows.length" :title="t('page.memory.page.title.e6a5608e97')" :detail="t('page.memory.page.detail.44a5990796')" />
          <RequestReceipt :receipt="actionResult" :title="t('page.memory.page.title.40ab8261c6')" />
          <ObjectInspectorDrawer :title="t('page.memory.page.title.695f0468d1')" :data="performance" />
        </section>

        <section id="structured-core" class="management-panel memory-panel wide" data-section="structured-core">
          <header>
            <h2>{{ t('page.memory.page.text.e198d8cb55') }}</h2>
            <span>{{ t('page.memory.page.text.00b20a67e4') }}</span>
          </header>
          <p>{{ t('page.memory.page.text.8dfef6e819') }}</p>
          <div class="memory-form-row">
            <label class="field-line">
              {{ t('template.pages.memorypage.5b079864d8') }}
              <input v-model="sourceRef" type="text" />
            </label>
            <label class="field-line">
              {{ t('template.pages.memorypage.60845e4205') }}
              <input v-model="factType" type="text" />
            </label>
          </div>
          <button class="primary-action" type="button" @click="planStructuredIngest">{{ t('page.memory.page.text.2ca6e733a6') }}</button>
          <RequestReceipt :receipt="structuredPlan" :title="t('page.memory.page.title.d8382cb203')" />
          <DataTable v-if="structuredRows.length" searchable copyable :rows="structuredRows" :columns="['id', 'kind', 'status', 'owner', 'summary']" @row-click="selectStructuredRow" />
          <ObjectInspectorDrawer :title="t('page.memory.page.title.e9ed3b1dc2')" :data="structured" />
          <ObjectInspectorDrawer :title="t('page.memory.page.title.5d5e81382a')" :data="structuredPlan || {}" />
        </section>

        <section class="management-panel memory-panel">
          <header>
          <h2>{{ t('page.memory.page.text.3a7f2092b2') }}</h2>
          <span>{{ t('page.memory.page.text.e1d20ad6e9') }}</span>
        </header>
          <EvidenceTrace :items="memoryEvidence" :title="t('page.memory.page.title.24852d9c53')" />
          <EvidenceObjectDetail :title="t('page.memory.page.title.33cead0976')" :evidence="selectedEvidence" @close="selectedDetail = null" />
          <RequestReceipt :receipt="actionResult || structuredPlan" :title="t('page.memory.page.title.c115b0f74c')" />
          <ObjectInspectorDrawer :title="t('page.memory.page.title.ef470a2336')" :data="actionResult || searchResult" />
        </section>
      </main>
    </section>
  </section>
</template>
