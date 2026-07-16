<script setup lang="ts">
import { useCapabilitySection } from "../composables/useCapabilitySection";
const { isSectionActive } = useCapabilitySection();
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { Activity, Play, RefreshCw, RotateCcw, Send, ShieldCheck, Square, Wrench } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import SurfaceDiagnosticPlaybook from '../components/workbench/SurfaceDiagnosticPlaybook.vue';
import GraphSurface from '../components/graph/GraphSurface.vue';
import TimelineList from '../components/workbench/TimelineList.vue';
import { displayStatus } from '../i18n/domain/status';
import { adaptSurfaceTopology } from '../adapters/graph/surfaceTopology';

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

function isActiveInboxStatus(status: unknown) {
  return ['received', 'processing', 'replying', 'reply_retry_scheduled'].includes(String(status || '').toLowerCase());
}

function isActiveOutboxStatus(status: unknown) {
  return ['queued', 'sending', 'retry_scheduled'].includes(String(status || '').toLowerCase());
}

const surfaces = computed(() => registrySurfaces(state.value.registry));
const edgeRegistry = computed(() => state.value.edge || {});
const edgeSurfaces = computed(() => Array.isArray(edgeRegistry.value.surfaces) ? edgeRegistry.value.surfaces : []);
const edgeMessageConnectors = computed(() => Array.isArray(edgeRegistry.value.message_connectors) ? edgeRegistry.value.message_connectors : []);
const edgeSourceConnectors = computed(() => Array.isArray(edgeRegistry.value.source_connectors) ? edgeRegistry.value.source_connectors : []);
const edgeAutomationConnectors = computed(() => Array.isArray(edgeRegistry.value.automation_connectors) ? edgeRegistry.value.automation_connectors : []);
const configReloadStatus = computed(() => state.value.configReload || {});
const configReloadRestartFields = computed(() => {
  const fields = configReloadStatus.value?.restart_required?.fields;
  return Array.isArray(fields) && fields.length ? fields.join(', ') : '-';
});
const host = computed(() => state.value.health?.host || state.value.health || {});
const runtimeSnapshots = computed(() => {
  const items = state.value.health?.runtime || state.value.registry?.runtime || [];
  return Array.isArray(items) ? items : [];
});
const selectedRuntime = computed(() => state.value.status?.runtime || runtimeSnapshots.value.find((item: any) => item.surface === selectedSurface.value) || {});
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
const inboxItems = computed(() => {
  const inbox = state.value.inbox?.inbox || state.value.inbox?.snapshot?.inbox || [];
  return Array.isArray(inbox) ? inbox : [];
});
const activeInboxItems = computed(() => {
  const active = state.value.inbox?.snapshot?.active_inbox;
  if (Array.isArray(active)) return active;
  return inboxItems.value.filter((item: any) => isActiveInboxStatus(item.status));
});
const outboxItems = computed(() => {
  const outbox = state.value.outbox?.outbox || state.value.inbox?.snapshot?.outbox || [];
  return Array.isArray(outbox) ? outbox : [];
});
const activeOutboxItems = computed(() => {
  const active = state.value.inbox?.snapshot?.active_outbox;
  if (Array.isArray(active)) return active;
  return outboxItems.value.filter((item: any) => isActiveOutboxStatus(item.status));
});
const deliveryItems = computed(() => {
  const deliveries = state.value.messages?.snapshot?.deliveries || state.value.deliveries?.deliveries || state.value.inbox?.snapshot?.deliveries || [];
  return Array.isArray(deliveries) ? deliveries : [];
});
const deadLetterItems = computed(() => {
  const letters = state.value.messages?.snapshot?.dead_letters || state.value.outbox?.dead_letters || state.value.inbox?.snapshot?.dead_letters || [];
  return Array.isArray(letters) ? letters : [];
});
const archivedOutboxItems = computed(() => {
  const archived = state.value.messages?.snapshot?.archived_outbox || [];
  return Array.isArray(archived) ? archived : [];
});
const messageRoot = computed(() => state.value.messages?.message_root || state.value.messages?.snapshot?.message_root || '-');
const triggerEventItems = computed(() => {
  const listed = state.value.triggerEvents?.events;
  if (Array.isArray(listed)) return listed;
  const snapshot = state.value.messages?.snapshot?.trigger_events;
  return Array.isArray(snapshot) ? snapshot : [];
});
const activeTriggerEventItems = computed(() => {
  const snapshot = state.value.messages?.snapshot?.active_trigger_events;
  if (Array.isArray(snapshot)) return snapshot;
  return triggerEventItems.value.filter((item: any) => ['received', 'dispatching', 'retry_scheduled'].includes(String(item.status || '').toLowerCase()));
});
const failedTriggerEventItems = computed(() => {
  const snapshot = state.value.messages?.snapshot?.failed_trigger_events;
  if (Array.isArray(snapshot)) return snapshot;
  return triggerEventItems.value.filter((item: any) => ['failed', 'dead_letter'].includes(String(item.status || '').toLowerCase()));
});
const surfaceTopologyGraph = computed(() => adaptSurfaceTopology({
  surfaces: surfaces.value,
  connectors: [...edgeMessageConnectors.value, ...edgeSourceConnectors.value, ...edgeAutomationConnectors.value],
  endpoints: state.value.messageEndpoints?.endpoints || [],
  routes: [...routeItems.value, ...(state.value.messageRoutes?.routes || [])],
  bindings: state.value.messageBindings?.bindings || [],
  selectedSurface: selectedSurface.value,
}, t('page.surface.page.text.d0eb56ac2a')));
const deliveryTimeline = computed(() => [
  ...inboxItems.value.map((item: any) => ({ id: `inbox:${item.message_id || item.id}`, title: item.message_id || item.id || 'inbox', status: item.status || 'received', detail: item.last_error || item.sender_id || '', at: item.updated_at_ms || item.created_at_ms })),
  ...outboxItems.value.map((item: any) => ({ id: `outbox:${item.delivery_id || item.id}`, title: item.delivery_id || item.id || 'outbox', status: item.status || 'queued', detail: item.last_error || item.recipient || '', at: item.updated_at_ms || item.created_at_ms })),
  ...deliveryItems.value.map((item: any) => ({ id: `delivery:${item.delivery_id || item.message_id || item.created_at_ms}`, title: item.kind || item.delivery_id || 'delivery', status: item.status || 'recorded', detail: item.message_id || '', at: item.created_at_ms })),
  ...triggerEventItems.value.map((item: any) => ({ id: `trigger:${item.idempotency_key}`, title: item.event_type || item.idempotency_key || 'trigger', status: item.status || 'received', detail: item.last_error || '', at: item.updated_at_ms || item.created_at_ms })),
  ...deadLetterItems.value.map((item: any) => ({ id: `dead-letter:${item.delivery_id || item.id}`, title: item.delivery_id || item.id || 'dead letter', status: 'dead_letter', detail: item.last_error || item.reason || '', at: item.updated_at_ms || item.created_at_ms })),
].sort((left: any, right: any) => Number(left.at || 0) - Number(right.at || 0)).slice(-80));
const triggerEventRows = computed(() => triggerEventItems.value.slice(0, 32).map((item: any) => ({
  idempotency_key: item.idempotency_key || '-',
  event_type: item.event_type || item.trigger?.event_type || '-',
  status: item.status || '-',
  attempts: `${item.attempts ?? 0}/${item.max_attempts ?? 0}`,
  next_retry: item.next_retry_at_ms || '-',
  error: item.last_error || '-',
})));
const supervisorEventItems = computed(() => {
  const events = state.value.status?.events || state.value.events?.supervisor_events || [];
  return Array.isArray(events) ? events : [];
});
const externalSurfaces = computed(() => valueCount(host.value.external_surface_count) || surfaces.value.filter((surface: any) => surface.lifecycle !== 'builtin' && surface.kind !== 'builtin').length);
const degradedSurfaces = computed(() => valueCount(host.value.degraded_count) + valueCount(host.value.failed_count) + valueCount(host.value.circuit_open_count));

const surfaceRows = computed(() => surfaces.value.map((surface: any) => ({
  runtime: runtimeSnapshots.value.find((item: any) => item.surface === surface.id)?.status || surface.status || '-',
  id: surface.id || '-',
  name: surface.name || surface.id || '-',
  kind: surface.kind || '-',
  status: surface.status || surface.health || surface.lifecycle || 'ready',
  lifecycle: surface.lifecycle || '-',
  failures: runtimeSnapshots.value.find((item: any) => item.surface === surface.id)?.consecutive_failures ?? 0,
  restarts: runtimeSnapshots.value.find((item: any) => item.surface === surface.id)?.restart_count ?? 0,
  circuit: runtimeSnapshots.value.find((item: any) => item.surface === surface.id)?.circuit_open ? 'open' : 'closed',
  capabilities: Array.isArray(surface.capabilities) ? surface.capabilities.join(', ') : valueCount(surface.capabilities),
  routes: valueCount(surface.routes),
  resources: valueCount(surface.resources),
})));
const edgePartitionRows = computed(() => [
  { domain: 'surface', count: edgeSurfaces.value.length, purpose: t('edge.partition.surface'), endpoint: '/api/edges/surfaces' },
  { domain: 'message', count: edgeMessageConnectors.value.length, purpose: t('edge.partition.message'), endpoint: '/api/edges/connectors/message' },
  { domain: 'source', count: edgeSourceConnectors.value.length, purpose: t('edge.partition.source'), endpoint: '/api/edges/connectors/source' },
  { domain: 'automation', count: edgeAutomationConnectors.value.length, purpose: t('edge.partition.automation'), endpoint: '/api/edges/connectors' },
]);
const runtimeRows = computed(() => runtimeSnapshots.value.map((runtime: any) => ({
  surface: runtime.surface || '-',
  status: runtime.status || '-',
  active: runtime.active ? 'yes' : 'no',
  pid: runtime.pid || '-',
  failures: runtime.consecutive_failures ?? 0,
  restarts: runtime.restart_count ?? 0,
  circuit: runtime.circuit_open ? 'open' : 'closed',
  last_seen: runtime.last_seen_at || '-',
  next_retry: runtime.next_retry_at || '-',
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
const supervisorRows = computed(() => supervisorEventItems.value.slice(0, 14).map((event: any) => ({
  status: event.status || '-',
  message: event.message || event.error?.message || '-',
  kind: event.error?.kind || 'supervisor',
  at: event.timestamp || '-',
})));
const inboxRows = computed(() => inboxItems.value.slice(0, 16).map((item: any) => ({
  message_id: item.message_id || item.id || '-',
  status: item.status || '-',
  thread: item.thread_id || '-',
  sender: item.sender_id || '-',
  session: item.runtime_session_id || '-',
  turn: item.runtime_turn_id || '-',
  error: item.last_error || '-',
})));
const outboxRows = computed(() => outboxItems.value.slice(0, 16).map((item: any) => ({
  delivery_id: item.delivery_id || '-',
  status: item.status || '-',
  recipient: item.recipient || '-',
  attempts: `${item.attempts ?? 0}/${item.max_attempts ?? 0}`,
  next_retry: item.next_retry_at_ms || '-',
  error: item.last_error || '-',
})));
const deliveryRows = computed(() => deliveryItems.value.slice(0, 16).map((item: any) => ({
  kind: item.kind || '-',
  status: item.status || '-',
  delivery_id: item.delivery_id || '-',
  message_id: item.message_id || '-',
  at: item.created_at_ms || '-',
})));
function belongsToSelectedSurface(item: any) {
  const owner = item.surface_id || item.surface || item.surface_name;
  return !owner || String(owner) === selectedSurface.value;
}
const messageEndpointRows = computed(() => (state.value.messageEndpoints?.endpoints || [])
  .filter(belongsToSelectedSurface)
  .slice(0, 16)
  .map((item: any) => ({ endpoint: item.endpoint_id || '-', connector: item.connector || '-', kind: item.kind || '-', status: item.status || '-', configured: item.configured ? 'yes' : 'no' })));
const messageRouteRows = computed(() => (state.value.messageRoutes?.routes || [])
  .filter(belongsToSelectedSurface)
  .slice(0, 16)
  .map((item: any) => ({ route: item.route_id || '-', connector: item.connector || '-', policy: item.policy || '-', status: item.status || '-', runtime: item.runtime?.status || '-' })));
const messageBindingRows = computed(() => (state.value.messageBindings?.bindings || [])
  .filter(belongsToSelectedSurface)
  .slice(0, 16)
  .map((item: any) => ({ binding: item.binding_id || '-', connector: item.connector || '-', endpoint: item.endpoint || '-', status: item.status || item.outbound_status || '-', session: item.runtime_session_id || item.source_session_id || '-', direction: item.direction || '-' })));
const retryCandidate = computed(() => outboxItems.value.find((item: any) => ['failed', 'retry_scheduled', 'dead_letter'].includes(String(item.status || ''))));
const retryTriggerEventCandidate = computed(() => failedTriggerEventItems.value.find((item: any) => item.idempotency_key));
const replayCandidate = computed(() => inboxItems.value[0]);
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
  ...supervisorRows.value.slice(0, 5).map((row: any) => ({
    id: String(row.at || row.message || ''),
    kind: `surface.${row.kind || 'supervisor'}`,
    status: row.status || 'recorded',
    summary: row.message || 'supervisor event',
    source: selectedSurface.value,
  })),
  ...deliveryRows.value.slice(0, 5).map((row: any) => ({
    id: String(row.delivery_id || row.message_id || row.at),
    kind: row.kind || 'surface.delivery',
    status: row.status || 'recorded',
    summary: row.delivery_id || row.message_id || 'delivery event',
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
  const runtimeStatus = selectedRuntime.value.status || reportedHealth || '';
  const healthStatus = state.value.selectedHealth?.ok === false ? 'blocked' : (runtimeStatus || 'ready');
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
      severity: failures.length || selectedRuntime.value.circuit_open ? 'blocked' : healthStatus,
      status: selectedRuntime.value.circuit_open ? 'circuit open' : failures.length ? `${failures.length} failure(s)` : healthStatus,
      evidence: selectedRuntime.value.last_error?.message || failures[0]?.message || state.value.selectedHealth?.error || 'no failure evidence',
      next_action: selectedRuntime.value.circuit_open ? 'Use Repair after fixing credentials or sidecar process.' : failures.length ? 'Open selected event detail and retry after fixing route/resource.' : 'Keep monitoring health and dispatch receipts.',
    },
  ];
});

async function loadSurface(id = selectedSurface.value) {
  if (!id) return;
  selectedSurface.value = id;
  const [detail, routes, resources, status, health, events, inbox, outbox, messages, triggerEvents, deliveries, messageEndpoints, messageRoutes, messageBindings] = await Promise.all([
    api.surfaceDetail(id),
    api.surfaceRoutes(id),
    api.surfaceResources(id),
    api.surfaceStatus(id),
    api.surfaceHealth(id),
    api.surfaceEvents(id),
    api.surfaceInbox(id),
    api.surfaceOutbox(id),
    api.surfaceMessages(id),
    api.surfaceTriggerEvents(id),
    api.surfaceDeliveries(id),
    api.messageEndpoints(),
    api.messageRoutes(),
    api.messageBindings(),
  ]);
  state.value = { ...state.value, detail, routes, resources, status, selectedHealth: health, events, inbox, outbox, messages, triggerEvents, deliveries, messageEndpoints, messageRoutes, messageBindings };
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [registry, health, edge, configReload] = await Promise.all([
      api.surfaceRegistry(),
      api.surfaceHostHealth(),
      api.edgeRegistry(),
      api.configReloadStatus(),
    ]);
    const nextSurfaces = registrySurfaces(registry);
    const nextSelected = selectedSurface.value || nextSurfaces[0]?.id || 'webui';
    state.value = { ...state.value, registry, health, edge, configReload };
    await loadSurface(nextSurfaces.some((surface: any) => surface.id === nextSelected) ? nextSelected : nextSurfaces[0]?.id || nextSelected);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function checkSurfaceHealth() {
  if (!selectedSurface.value) return;
  actionResult.value = await api.surfaceHealthCheck(selectedSurface.value);
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

async function runSupervisorAction(action: 'start' | 'stop' | 'restart' | 'repair') {
  if (!selectedSurface.value) return;
  const calls = {
    start: api.surfaceStart,
    stop: api.surfaceStop,
    restart: api.surfaceRestart,
    repair: api.surfaceRepair,
  };
  actionResult.value = await calls[action](selectedSurface.value);
  selectedDetail.value = actionResult.value;
  await refresh();
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

async function retryDelivery() {
  if (!selectedSurface.value || !retryCandidate.value?.delivery_id) return;
  actionResult.value = await api.surfaceRetryOutbox(selectedSurface.value, retryCandidate.value.delivery_id);
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

async function retryTriggerEvent() {
  const idempotencyKey = retryTriggerEventCandidate.value?.idempotency_key;
  if (!selectedSurface.value || !idempotencyKey) return;
  actionResult.value = await api.surfaceRetryTriggerEvent(selectedSurface.value, idempotencyKey);
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

async function deadLetterDelivery() {
  if (!selectedSurface.value || !retryCandidate.value?.delivery_id) return;
  actionResult.value = await api.surfaceDeadLetterOutbox(selectedSurface.value, retryCandidate.value.delivery_id, 'operator moved delivery from WebUI');
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

async function archiveDeadLetters() {
  if (!selectedSurface.value || !deadLetterItems.value.length) return;
  actionResult.value = await api.surfaceArchiveMessages(selectedSurface.value, 100);
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

async function purgeArchivedEvents() {
  if (!selectedSurface.value || !archivedOutboxItems.value.length) return;
  actionResult.value = await api.surfacePurgeArchivedMessages(selectedSurface.value, 100);
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

async function replayInbound() {
  const messageId = replayCandidate.value?.message_id || replayCandidate.value?.id;
  if (!selectedSurface.value || !messageId) return;
  actionResult.value = await api.surfaceReplayInbox(selectedSurface.value, messageId);
  selectedDetail.value = actionResult.value;
  await loadSurface(selectedSurface.value);
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page surface-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.surface.page.text.4518e0281f') }}</h1>
        <p>{{ t('page.surface.page.text.d78467b9d5') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? t('page.surface.page.inline.aaeaebbce9') : t('page.surface.page.inline.284a5ec5f4') }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row tools-metrics" v-show="isSectionActive('health')" data-section="health">
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.surface.page.text.89e795a427') }}</span>
        <strong>{{ surfaces.length }}</strong>
        <small>{{ externalSurfaces }} external</small>
      </article>
      <article class="metric-card">
        <span>{{ t('page.surface.page.text.713ff0b8f0') }}</span>
        <strong>{{ displayStatus(host.status || state.health?.status || 'unknown') }}</strong>
        <small>{{ t('page.surface.page.text.e2665719ee') }}</small>
      </article>
      <article class="metric-card" :data-tone="deadLetterItems.length ? 'warn' : 'success'">
        <span>{{ t('page.surface.page.text.c215d81d09') }}</span>
        <strong>{{ activeInboxItems.length + activeOutboxItems.length }}</strong>
        <small>{{ t('page.surface.summary.deliveryQueue', { total: outboxRows.length, dlq: deadLetterItems.length }) }} · archived {{ archivedOutboxItems.length }}</small>
      </article>
      <article class="metric-card" :data-tone="configReloadStatus.restart_required?.required ? 'warn' : (configReloadStatus.status === 'invalid' ? 'danger' : 'success')">
        <span>{{ t('config.reload.label') }}</span>
        <strong>{{ configReloadStatus.status || 'unknown' }}</strong>
        <small>{{ configReloadStatus.restart_required?.required ? configReloadRestartFields : (configReloadStatus.trigger || 'auto') }}</small>
      </article>
    </section>

    <section class="gateway-grid">
      <section class="management-panel gateway-panel wide" v-show="isSectionActive('registry')" data-section="registry">
        <header>
          <h2>{{ t('edge.surface.partition.title') }}</h2>
          <StatusPill :status="state.edge?.health?.status || 'unknown'" />
        </header>
        <p>{{ t('edge.surface.partition.detail') }}</p>
        <DataTable searchable copyable :rows="edgePartitionRows" :columns="['domain', 'count', 'purpose', 'endpoint']" @row-click="selectedDetail = $event" />
        <ObjectInspectorDrawer :title="t('edge.gateway.raw')" :data="state.edge?.health || {}" />
      </section>

      <section class="management-panel gateway-panel wide" v-show="isSectionActive('registry')" data-section="registry">
        <header>
          <h2>{{ t('page.surface.page.text.d0eb56ac2a') }}</h2>
          <StatusPill :status="state.registry?.__state || 'ready'" />
        </header>
        <GraphSurface
          :model="surfaceTopologyGraph"
          :loading="loading"
          :connection-state="state.registry?.__state || state.edge?.health?.status || 'ready'"
          @select-node="selectedDetail = $event.raw || $event"
          @select-edge="selectedDetail = $event.raw || $event"
        />
        <DataTable v-if="surfaceRows.length" searchable copyable row-key="id" :rows="surfaceRows" :columns="['runtime', 'id', 'name', 'kind', 'lifecycle', 'failures', 'restarts', 'circuit', 'routes', 'resources']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.surface.page.title.9e87656d55')" :detail="t('page.surface.page.detail.7941de7927')" />
        <SurfaceDiagnosticPlaybook :rows="surfaceDiagnosticRows" />
        <label class="field-line">
          {{ t('page.surface.field.selectedSurface') }}
          <select v-model="selectedSurface" @change="loadSurface(selectedSurface)">
            <option v-for="surface in surfaces" :key="surface.id" :value="surface.id">{{ surface.name || surface.id }}</option>
            <option value="webui">webui</option>
          </select>
        </label>
      </section>

      <section class="management-panel gateway-panel" v-show="isSectionActive('health')" data-section="health">
        <header>
          <h2>{{ t('page.surface.page.text.0a8f2a8cc3') }}</h2>
          <span>{{ selectedSurface }}</span>
        </header>
        <div class="button-row">
          <button class="primary-action" type="button" @click="checkSurfaceHealth">
            <ShieldCheck :size="15" />
            {{ t('page.surface.action.checkHealth') }}
          </button>
          <button class="ghost-action" type="button" @click="runSupervisorAction('start')">
            <Play :size="15" />
            {{ t('page.surface.action.start') }}
          </button>
          <button class="ghost-action" type="button" @click="runSupervisorAction('stop')">
            <Square :size="15" />
            {{ t('page.surface.action.stop') }}
          </button>
          <button class="ghost-action" type="button" @click="runSupervisorAction('restart')">
            <RotateCcw :size="15" />
            {{ t('page.surface.action.restart') }}
          </button>
          <button class="ghost-action" type="button" @click="runSupervisorAction('repair')">
            <Wrench :size="15" />
            {{ t('page.surface.action.repair') }}
          </button>
        </div>
        <DataTable v-if="runtimeRows.length" searchable copyable row-key="surface" :rows="runtimeRows" :columns="['surface', 'status', 'active', 'pid', 'failures', 'restarts', 'circuit', 'last_seen', 'next_retry']" @row-click="selectedDetail = $event" />
        <ObjectInspectorDrawer :title="t('page.surface.page.title.8f45531e08')" :data="state.selectedHealth || {}" />
        <ObjectInspectorDrawer :title="t('page.surface.page.title.640ad216d7')" :data="state.status || selectedRuntime || {}" />
      </section>

      <section class="management-panel gateway-panel" v-show="isSectionActive('routes')" data-section="routes">
        <header>
          <h2>{{ t('page.surface.page.text.e3d84f3df6') }}</h2>
          <span>{{ formatCount('entries', routeRows.length) }}</span>
        </header>
        <DataTable v-if="routeRows.length" searchable copyable row-key="path" :rows="routeRows" :columns="['method', 'path', 'target', 'status']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.surface.page.title.0926c31b98')" :detail="t('page.surface.page.detail.833cc1397b')" />
      </section>

      <section class="management-panel gateway-panel" v-show="isSectionActive('routes')" data-section="routes">
        <header>
          <h2>{{ t('page.surface.page.text.df4e5009f8') }}</h2>
          <span>{{ formatCount('entries', resourceRows.length) }}</span>
        </header>
        <DataTable v-if="resourceRows.length" searchable copyable row-key="path" :rows="resourceRows" :columns="['path', 'file', 'type', 'spa']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.surface.page.title.bbd67aec43')" :detail="t('page.surface.page.detail.da70eaf510')" />
      </section>

      <section class="management-panel gateway-panel wide" v-show="isSectionActive('dispatch')" data-section="dispatch">
        <header>
          <h2>{{ t('page.surface.page.text.0324d20822') }}</h2>
          <span>{{ t('page.surface.page.text.44b8bcb54a') }}</span>
        </header>
        <label class="field-line">
          {{ t('page.surface.field.recipient') }}
          <input v-model="recipient" type="text" />
        </label>
        <label class="field-line">
          {{ t('page.surface.field.message') }}
          <textarea v-model="messageText" rows="3" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="sendMessage">
            <Send :size="15" />
            {{ t('page.surface.action.sendMessage') }}
          </button>
        </div>
        <label class="field-line">
          {{ t('page.surface.field.action') }}
          <input v-model="actionName" type="text" />
        </label>
        <label class="field-line">
          {{ t('page.surface.field.actionPayload') }}
          <textarea v-model="actionPayloadText" rows="5" />
        </label>
        <p v-if="actionError" class="field-error">{{ actionError }}</p>
        <button class="ghost-action" type="button" @click="runAction">
          <Activity :size="15" />
          {{ t('page.surface.action.runAction') }}
        </button>
        <RequestReceipt :receipt="actionResult" :title="t('page.surface.page.title.a15a0f334d')" />
      </section>

      <section class="management-panel gateway-panel wide" v-show="isSectionActive('delivery')" data-section="delivery">
        <header>
          <h2>{{ t('page.surface.page.text.c215d81d09') }}</h2>
          <span>{{ activeInboxItems.length + activeOutboxItems.length }} active · {{ inboxRows.length }} inbox · {{ outboxRows.length }} outbox · {{ deadLetterItems.length }} DLQ · {{ archivedOutboxItems.length }} archived</span>
        </header>
        <TimelineList v-if="deliveryTimeline.length" :items="deliveryTimeline" :title="t('page.surface.page.text.c215d81d09')" live @select="selectedDetail = $event" />
        <p class="muted-line">message root: {{ messageRoot }}</p>
        <div class="button-row">
          <button class="ghost-action" type="button" :disabled="!retryCandidate" @click="retryDelivery">
            <RotateCcw :size="15" />
            {{ t('template.pages.surfacepage.7b6ca4df85') }}
          </button>
          <button class="ghost-action" type="button" :disabled="!retryCandidate" @click="deadLetterDelivery">
            <Square :size="15" />
            {{ t('template.pages.surfacepage.ffb9f9eb33') }}
          </button>
          <button class="ghost-action" type="button" :disabled="!replayCandidate" @click="replayInbound">
            <Play :size="15" />
            {{ t('template.pages.surfacepage.a89fd9f7cf') }}
          </button>
          <button class="ghost-action" type="button" :disabled="!deadLetterItems.length" @click="archiveDeadLetters">
            <Square :size="15" />
            {{ t('template.pages.surfacepage.archiveDlq') }}
          </button>
          <button class="ghost-action" type="button" :disabled="!archivedOutboxItems.length" @click="purgeArchivedEvents">
            <Square :size="15" />
            {{ t('template.pages.surfacepage.purgeArchivedEvents') }}
          </button>
        </div>
        <DataTable v-if="inboxRows.length" searchable copyable row-key="message_id" :rows="inboxRows" :columns="['message_id', 'status', 'thread', 'sender', 'session', 'turn', 'error']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.surface.page.title.6e2d0aef09')" :detail="t('page.surface.page.detail.d4f6163244')" />
        <DataTable v-if="outboxRows.length" searchable copyable row-key="delivery_id" :rows="outboxRows" :columns="['delivery_id', 'status', 'recipient', 'attempts', 'next_retry', 'error']" @row-click="selectedDetail = $event" />
        <DataTable v-if="deliveryRows.length" searchable copyable :rows="deliveryRows" :columns="['kind', 'status', 'delivery_id', 'message_id', 'at']" @row-click="selectedDetail = $event" />
        <DataTable v-if="messageEndpointRows.length" searchable copyable row-key="endpoint" :rows="messageEndpointRows" :columns="['endpoint', 'connector', 'kind', 'status', 'configured']" @row-click="selectedDetail = $event" />
        <DataTable v-if="messageRouteRows.length" searchable copyable row-key="route" :rows="messageRouteRows" :columns="['route', 'connector', 'policy', 'status', 'runtime']" @row-click="selectedDetail = $event" />
        <DataTable v-if="messageBindingRows.length" searchable copyable row-key="binding" :rows="messageBindingRows" :columns="['binding', 'connector', 'endpoint', 'status', 'session', 'direction']" @row-click="selectedDetail = $event" />
      </section>

      <section class="management-panel gateway-panel wide" v-show="isSectionActive('trigger-events')" data-section="trigger-events">
        <header>
          <h2>{{ t('page.surface.triggerEvents.title') }}</h2>
          <span>{{ t('page.surface.triggerEvents.summary', { active: activeTriggerEventItems.length, failed: failedTriggerEventItems.length }) }}</span>
        </header>
        <p class="muted-line">{{ t('page.surface.triggerEvents.detail') }}</p>
        <div class="button-row">
          <button class="ghost-action" type="button" data-action="retry-trigger-event" :disabled="!retryTriggerEventCandidate" @click="retryTriggerEvent">
            <RotateCcw :size="15" />
            {{ t('page.surface.triggerEvents.retry') }}
          </button>
        </div>
        <DataTable v-if="triggerEventRows.length" searchable copyable row-key="idempotency_key" :rows="triggerEventRows" :columns="['event_type', 'status', 'attempts', 'next_retry', 'error']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.surface.triggerEvents.emptyTitle')" :detail="t('page.surface.triggerEvents.emptyDetail')" />
        <RequestReceipt :receipt="actionResult" :title="t('page.surface.triggerEvents.receiptTitle')" />
      </section>

      <section class="management-panel gateway-panel" v-show="isSectionActive('events')" data-section="events">
        <header>
          <h2>{{ t('page.surface.page.text.a14d7b470c') }}</h2>
          <span>{{ eventRows.length + supervisorRows.length }} recent</span>
        </header>
        <DataTable v-if="eventRows.length" searchable copyable :rows="eventRows" :columns="['kind', 'status', 'message', 'at']" @row-click="selectedDetail = $event" />
        <DataTable v-if="supervisorRows.length" searchable copyable :rows="supervisorRows" :columns="['kind', 'status', 'message', 'at']" @row-click="selectedDetail = $event" />
        <EmptyState v-if="!eventRows.length && !supervisorRows.length" :title="t('page.surface.page.title.4ed86fdc14')" :detail="t('page.surface.page.detail.5d2cac078e')" />
        <EvidenceTrace :items="surfaceEvidence" :title="t('page.surface.page.title.a565340669')" />
      </section>

      <section class="management-panel gateway-panel" v-show="isSectionActive('events')" data-section="events">
        <header>
          <h2>{{ t('page.surface.page.text.b6890edcf9') }}</h2>
          <span>{{ selectedSurface }}</span>
        </header>
        <ObjectInspectorDrawer :title="t('page.surface.page.title.db287fe009')" :data="selected || {}" />
        <ObjectInspectorDrawer :title="t('page.surface.page.title.5119090a59')" :data="state.health || {}" />
        <DetailDrawer :title="t('page.surface.page.title.61e43d53c8')" :row="selectedDetail || selected" @close="selectedDetail = null" />
      </section>
    </section>
  </section>
</template>
