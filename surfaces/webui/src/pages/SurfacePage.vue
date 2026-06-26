<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Activity, RefreshCw, Send, ShieldCheck } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import SurfaceDiagnosticPlaybook from '../components/workbench/SurfaceDiagnosticPlaybook.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';

const loading = ref(false);
const error = ref('');
const actionError = ref('');
const state = ref<any>({});
const selectedSurface = ref('webui');
const recipient = ref('webui');
const messageText = ref('SurfaceHost readiness check from WebUI.');
const actionName = ref('health');
const actionPayloadText = ref(JSON.stringify({ source: 'webui', purpose: 'readiness-check' }, null, 2));
const actionResult = ref<any>(null);
const selectedDetail = ref<Record<string, unknown> | null>(null);

function registrySurfaces(payload: any) {
  const surfaces = payload?.registry?.surfaces || payload?.surfaces || [];
  return Array.isArray(surfaces) ? surfaces : [];
}

function valueCount(value: any) {
  return Array.isArray(value) ? value.length : Number(value || 0);
}

const surfaces = computed(() => registrySurfaces(state.value.registry));
const host = computed(() => state.value.health?.host || state.value.health || {});
const selected = computed(() => surfaces.value.find((surface: any) => surface.id === selectedSurface.value) || state.value.detail?.surface || {});
const routeItems = computed(() => {
  const routes = state.value.routes?.routes || selected.value.routes || [];
  return Array.isArray(routes) ? routes : [];
});
const resourceItems = computed(() => {
  const resources = state.value.resources?.resources || selected.value.resources || [];
  return Array.isArray(resources) ? resources : [];
});
const eventItems = computed(() => {
  const events = state.value.events?.events || [];
  return Array.isArray(events) ? events : [];
});
const totalRoutes = computed(() => valueCount(host.value.route_count) || surfaces.value.reduce((count: number, surface: any) => count + valueCount(surface.routes), 0));
const totalResources = computed(() => valueCount(host.value.resource_count) || surfaces.value.reduce((count: number, surface: any) => count + valueCount(surface.resources), 0));
const externalSurfaces = computed(() => valueCount(host.value.external_surface_count) || surfaces.value.filter((surface: any) => surface.lifecycle !== 'builtin' && surface.kind !== 'builtin').length);

const surfaceRows = computed(() => surfaces.value.map((surface: any) => ({
  id: surface.id || '-',
  name: surface.name || surface.id || '-',
  kind: surface.kind || '-',
  status: surface.status || surface.health || surface.lifecycle || 'ready',
  lifecycle: surface.lifecycle || '-',
  capabilities: Array.isArray(surface.capabilities) ? surface.capabilities.join(', ') : valueCount(surface.capabilities),
  routes: valueCount(surface.routes),
  resources: valueCount(surface.resources),
})));
const routeRows = computed(() => routeItems.value.map((route: any) => ({
  method: route.method || route.kind || 'GET',
  path: route.path || route.route || route.url || '-',
  target: route.target || route.proxy_to || route.handler || '-',
  status: route.status || '-',
})));
const resourceRows = computed(() => resourceItems.value.map((resource: any) => ({
  path: resource.path || resource.route || resource.mount || '-',
  file: resource.file_path || resource.file || resource.root || '-',
  type: resource.content_type || resource.kind || '-',
  spa: resource.spa_fallback === undefined ? '-' : String(resource.spa_fallback),
})));
const eventRows = computed(() => eventItems.value.slice(0, 14).map((event: any) => ({
  kind: event.kind || event.type || '-',
  status: event.status || event.level || '-',
  message: event.message || event.text || event.detail || '-',
  at: event.at || event.timestamp || event.created_at || '-',
})));
const surfaceContext = computed(() => [
  { label: 'Selected', value: selectedSurface.value },
  { label: 'Surfaces', value: surfaces.value.length, tone: surfaces.value.length ? 'success' : 'warn' },
  { label: 'Routes', value: totalRoutes.value },
  { label: 'Resources', value: totalResources.value },
]);
const surfaceWorkflow = computed(() => [
  { id: 'registry', label: 'Registry', status: surfaces.value.length ? 'ready' : 'idle', count: surfaces.value.length },
  { id: 'health', label: 'Health', status: state.value.selectedHealth?.status === 'error' ? 'blocked' : 'ready', description: selectedSurface.value },
  { id: 'routes', label: 'Routes', status: routeRows.value.length ? 'ready' : 'idle', count: routeRows.value.length },
  { id: 'routes', label: 'Resources', status: resourceRows.value.length ? 'ready' : 'idle', count: resourceRows.value.length },
  { id: 'dispatch', label: 'Dispatch', status: actionResult.value ? 'active' : 'idle' },
  { id: 'events', label: 'Events', status: eventRows.value.length ? 'ready' : 'idle', count: eventRows.value.length },
]);
const surfaceEvidence = computed(() => [
  ...routeRows.value.slice(0, 4).map((row: any) => ({
    id: String(row.path || ''),
    kind: 'surface.route',
    status: row.status || 'declared',
    summary: `${row.method || 'GET'} ${row.path || '-'}`,
    source: row.target || selectedSurface.value,
  })),
  ...resourceRows.value.slice(0, 4).map((row: any) => ({
    id: String(row.path || row.file || ''),
    kind: 'surface.resource',
    status: row.spa === 'true' ? 'spa' : 'static',
    summary: row.file || row.path || 'resource',
    source: selectedSurface.value,
  })),
  ...eventRows.value.slice(0, 5).map((row: any) => ({
    id: String(row.at || row.message || ''),
    kind: row.kind || 'surface.event',
    status: row.status || 'recorded',
    summary: row.message || row.kind || 'surface event',
    source: selectedSurface.value,
  })),
  ...(actionResult.value ? [{
    id: String(actionResult.value.request_id || actionResult.value.id || actionName.value),
    kind: 'surface.dispatch',
    status: actionResult.value.status || (actionResult.value.ok === false ? 'error' : 'ready'),
    summary: actionResult.value.payload_summary || actionResult.value.error || actionName.value,
    source: selectedSurface.value,
  }] : []),
].filter((item) => item.id || item.summary));
const surfaceDiagnosticRows = computed(() => {
  const failures = eventRows.value.filter((row: any) => ['error', 'failed', 'blocked', 'offline'].includes(String(row.status || '').toLowerCase()));
  const reportedHealth = state.value.selectedHealth?.status || selected.value.status || '';
  const healthStatus = state.value.selectedHealth?.ok === false ? 'blocked' : (reportedHealth || 'ready');
  return [
    {
      lane: 'Ingress',
      severity: routeRows.value.length ? 'ready' : 'degraded',
      status: routeRows.value.length ? 'ready' : 'missing routes',
      evidence: `${routeRows.value.length} routes for ${selectedSurface.value}`,
      next_action: routeRows.value.length ? 'Verify route target and callback path.' : 'Register routes in the surface manifest or host config.',
    },
    {
      lane: 'Delivery',
      severity: actionResult.value?.ok === false ? 'blocked' : 'ready',
      status: actionResult.value ? (actionResult.value.status || (actionResult.value.ok === false ? 'failed' : 'ready')) : 'not tested',
      evidence: actionResult.value ? (actionResult.value.error || actionResult.value.request_id || actionName.value) : 'no dispatch receipt',
      next_action: actionResult.value ? 'Inspect dispatch receipt and recent events.' : 'Send a health message or run an action test.',
    },
    {
      lane: 'Static resources',
      severity: resourceRows.value.length ? 'ready' : 'degraded',
      status: resourceRows.value.length ? 'ready' : 'missing resources',
      evidence: `${resourceRows.value.length} resources, spa=${resourceRows.value.some((row: any) => row.spa === 'true')}`,
      next_action: resourceRows.value.length ? 'Confirm file path and SPA fallback.' : 'Publish static resources or disable static forwarding.',
    },
    {
      lane: 'Callback',
      severity: eventRows.value.length ? 'ready' : 'info',
      status: eventRows.value.length ? 'events visible' : 'no events',
      evidence: `${eventRows.value.length} recent events`,
      next_action: eventRows.value.length ? 'Review failed event rows first.' : 'Trigger a callback/action to generate audit evidence.',
    },
    {
      lane: 'Recent failures',
      severity: failures.length ? 'blocked' : healthStatus,
      status: failures.length ? `${failures.length} failure(s)` : healthStatus,
      evidence: failures[0]?.message || state.value.selectedHealth?.error || 'no failure evidence',
      next_action: failures.length ? 'Open selected event detail and retry after fixing route/resource.' : 'Keep monitoring health and dispatch receipts.',
    },
  ];
});

async function loadSurface(id = selectedSurface.value) {
  if (!id) return;
  selectedSurface.value = id;
  const [detail, routes, resources, health, events] = await Promise.all([
    api.surfaceDetail(id),
    api.surfaceRoutes(id),
    api.surfaceResources(id),
    api.surfaceHealth(id),
    api.surfaceEvents(id),
  ]);
  state.value = { ...state.value, detail, routes, resources, selectedHealth: health, events };
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [registry, health] = await Promise.all([
      api.surfaceRegistry(),
      api.surfaceHostHealth(),
    ]);
    const nextSurfaces = registrySurfaces(registry);
    const nextSelected = selectedSurface.value || nextSurfaces[0]?.id || 'webui';
    state.value = { ...state.value, registry, health };
    await loadSurface(nextSurfaces.some((surface: any) => surface.id === nextSelected) ? nextSelected : nextSurfaces[0]?.id || nextSelected);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function checkSurfaceHealth() {
  if (!selectedSurface.value) return;
  actionResult.value = await api.surfaceHealth(selectedSurface.value);
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

async function sendMessage() {
  actionError.value = '';
  if (!selectedSurface.value || !recipient.value || !messageText.value) return;
  actionResult.value = await api.surfaceSend(selectedSurface.value, recipient.value, messageText.value, undefined, {
    source: 'webui',
    intent: 'surface-host-test',
  });
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

async function runAction() {
  actionError.value = '';
  try {
    const payload = JSON.parse(actionPayloadText.value || '{}');
    actionResult.value = await api.surfaceAction(selectedSurface.value, actionName.value, payload);
    selectedDetail.value = actionResult.value;
    await loadSurface(selectedSurface.value);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page surface-page">
    <header class="page-header">
      <div>
        <h1>Surface Host</h1>
        <p>Gateway 统一发现、诊断和分发 WebUI、TUI、外部消息面与静态资源面。</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? 'Loading' : 'Refresh surfaces' }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <PrimaryContextBar :items="surfaceContext" />
    <WorkflowStrip :steps="surfaceWorkflow" title="Surface lifecycle" />

    <section class="metric-row tools-metrics" data-section="health">
      <article class="metric-card" data-tone="success">
        <span>Surfaces</span>
        <strong>{{ surfaces.length }}</strong>
        <small>{{ externalSurfaces }} external</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>Routes</span>
        <strong>{{ totalRoutes }}</strong>
        <small>HTTP and callback entries</small>
      </article>
      <article class="metric-card" data-tone="warn">
        <span>Resources</span>
        <strong>{{ totalResources }}</strong>
        <small>static mounts</small>
      </article>
      <article class="metric-card">
        <span>Host</span>
        <strong>{{ host.status || state.health?.status || 'unknown' }}</strong>
        <small>surface service health</small>
      </article>
    </section>

    <section class="gateway-grid">
      <section class="management-panel gateway-panel wide" data-section="registry">
        <header>
          <h2>Surface registry</h2>
          <StatusPill :status="state.registry?.__offline ? 'offline' : 'ready'" />
        </header>
        <DataTable v-if="surfaceRows.length" :rows="surfaceRows" :columns="['id', 'name', 'kind', 'status', 'lifecycle', 'capabilities', 'routes', 'resources']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No surfaces" detail="Gateway SurfaceHost 未返回可用 surface。" />
        <SurfaceDiagnosticPlaybook :rows="surfaceDiagnosticRows" />
        <label class="field-line">
          Selected surface
          <select v-model="selectedSurface" @change="loadSurface(selectedSurface)">
            <option v-for="surface in surfaces" :key="surface.id" :value="surface.id">{{ surface.name || surface.id }}</option>
            <option value="webui">webui</option>
          </select>
        </label>
      </section>

      <section class="management-panel gateway-panel" data-section="health">
        <header>
          <h2>Selected health</h2>
          <span>{{ selectedSurface }}</span>
        </header>
        <button class="primary-action" type="button" @click="checkSurfaceHealth">
          <ShieldCheck :size="15" />
          Check health
        </button>
        <RawPayload title="Surface health detail" :data="state.selectedHealth || {}" />
      </section>

      <section class="management-panel gateway-panel" data-section="routes">
        <header>
          <h2>Routes</h2>
          <span>{{ routeRows.length }} entries</span>
        </header>
        <DataTable v-if="routeRows.length" :rows="routeRows" :columns="['method', 'path', 'target', 'status']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No routes" detail="该 surface 未声明 HTTP 路由。" />
      </section>

      <section class="management-panel gateway-panel" data-section="routes">
        <header>
          <h2>Resources</h2>
          <span>{{ resourceRows.length }} entries</span>
        </header>
        <DataTable v-if="resourceRows.length" :rows="resourceRows" :columns="['path', 'file', 'type', 'spa']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No resources" detail="该 surface 未声明静态资源挂载。" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="dispatch">
        <header>
          <h2>Dispatch</h2>
          <span>send and action</span>
        </header>
        <label class="field-line">
          Recipient
          <input v-model="recipient" type="text" />
        </label>
        <label class="field-line">
          Message
          <textarea v-model="messageText" rows="3" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="sendMessage">
            <Send :size="15" />
            Send message
          </button>
        </div>
        <label class="field-line">
          Action
          <input v-model="actionName" type="text" />
        </label>
        <label class="field-line">
          Action payload
          <textarea v-model="actionPayloadText" rows="5" />
        </label>
        <p v-if="actionError" class="field-error">{{ actionError }}</p>
        <button class="ghost-action" type="button" @click="runAction">
          <Activity :size="15" />
          Run action
        </button>
        <RequestReceipt :receipt="actionResult" title="Surface dispatch receipt" />
      </section>

      <section class="management-panel gateway-panel" data-section="events">
        <header>
          <h2>Events</h2>
          <span>{{ eventRows.length }} recent</span>
        </header>
        <DataTable v-if="eventRows.length" :rows="eventRows" :columns="['kind', 'status', 'message', 'at']" @row-click="selectedDetail = $event" />
        <EmptyState v-else title="No events" detail="当前 surface 尚无投递或回调事件。" />
        <EvidenceTrace :items="surfaceEvidence" title="Surface evidence trace" />
      </section>

      <section class="management-panel gateway-panel" data-section="events">
        <header>
          <h2>Raw payloads</h2>
          <span>{{ selectedSurface }}</span>
        </header>
        <RawPayload title="Selected surface" :data="selected || {}" />
        <RawPayload title="Host payload" :data="state.health || {}" />
        <DetailDrawer title="Surface selected detail" :row="selectedDetail || selected" @close="selectedDetail = null" />
      </section>
    </section>
  </section>
</template>
