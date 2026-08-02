<script setup lang="ts">
import { useCapabilitySection } from "../composables/useCapabilitySection";
const { activeSection, isSectionActive } = useCapabilitySection();
import { formatCount, t } from '../i18n';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { RefreshCw, ShieldCheck } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import EvidenceObjectDetail from '../components/workbench/EvidenceObjectDetail.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import TimelineList from '../components/workbench/TimelineList.vue';
import ExecutionTruthSummary from '../components/runtime/ExecutionTruthSummary.vue';
import StrategyDecisionSummary from '../components/runtime/StrategyDecisionSummary.vue';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import type { EvidenceObject } from '../types/evidence';
import { displayStatus } from '../i18n/domain/status';
import { adaptRuntimeTimeline } from '../adapters/graph/runtimeTimeline';
import { appPluginForId } from '../plugins/registry';

const store = useAppStore();
const chatSessions = useChatSessionsStore();
const projections = useProjectionRegistryStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const loadedSections = new Set<string>();
const sectionControllers = new Map<string, AbortController>();
const sectionGenerations = new Map<string, number>();
let pendingLoads = 0;
const error = ref('');
const controlPlane = ref<any>({});
const runtimeStatus = ref<any>({});
const runtimeSnapshot = ref<any>({});
const sourceAudit = ref<any>({});
const sourceRepairPlan = ref<any>({});
const runtimeTurns = ref<any>({});
const sessionExecution = ref<any>({});
const effectiveConfig = ref<any>({});
const leases = ref<any>({});
const approvals = ref<any>([]);
const timeline = ref<any>({});
const tasks = ref<any>({});
const growthStatus = ref<any>({});
const growthEvents = ref<any>({});
const actionResult = ref<any>(null);
const leaseMode = ref<'collaborative' | 'exclusive'>('collaborative');
const turnPrompt = ref(t('runtime.defaultPrompt'));
const selectedTurnId = ref('');
const selectedDetail = ref<Record<string, unknown> | null>(null);
const sessionId = computed(() => {
  const routed = typeof route.query.session_id === 'string' ? route.query.session_id.trim() : '';
  return routed || store.activeSessionId || 'api-context';
});
const configReloadStatus = computed(() => store.configReloadStatus || {});
const providerControl = computed(() => controlPlane.value?.components?.provider || {});
const gatewayHealth = computed(() => (
  controlPlane.value?.health
  || store.health?.health
  || {}
));
const hotStateHealth = computed(() => gatewayHealth.value?.runtime?.hot_state || {});
const providerTransportHealth = computed(() => gatewayHealth.value?.runtime?.provider_transport || {});
const postgresHealth = computed(() => gatewayHealth.value?.storage?.postgres || {});
const storageExecutionHealth = computed(() => gatewayHealth.value?.storage?.session_execution || {});
const configReloadRestartFields = computed(() => {
  const fields = configReloadStatus.value?.restart_required?.fields;
  return Array.isArray(fields) && fields.length ? fields.join(', ') : '-';
});
const configReloadStatusLabel = computed(() => String(configReloadStatus.value?.status || 'unknown'));
const approvalItems = computed(() => Array.isArray(approvals.value) ? approvals.value : approvals.value?.pending || []);
const timelineRows = computed(() => adaptRuntimeTimeline(Array.isArray(timeline.value?.events) ? timeline.value.events : []).slice(0, 16));
const timelineListItems = computed(() => timelineRows.value.map((row: any) => ({
  ...row,
  id: row.id,
  title: row.title,
  detail: `${row.domain} · ${row.detail}`,
})));
const taskRows = computed(() => (Array.isArray(tasks.value?.tasks) ? tasks.value.tasks : []).slice(0, 12).map((task: any) => ({
  id: task.id,
  status: task.status,
  objective: task.objective,
  current_phase: task.current_phase || '-',
  failures: task.failure_count || 0,
})));
const turnRows = computed(() => (Array.isArray(runtimeTurns.value?.turns) ? runtimeTurns.value.turns : Array.isArray(runtimeTurns.value?.items) ? runtimeTurns.value.items : []).slice(0, 12).map((turn: any) => ({
  id: turn.id || turn.turn_id || '-',
  status: turn.status || turn.phase || '-',
  session: turn.session_id || '-',
  task: turn.task_id || '-',
  execution: turn.execution_id || turn.execution_graph_id || '-',
  prompt: turn.prompt || turn.summary || '-',
})));
const activeExecutionId = computed(() => {
  const requested = typeof route.query.execution_id === 'string' ? route.query.execution_id.trim() : '';
  if (requested) return requested;
  const indexed = String(sessionExecution.value?.latest_execution_id || '').trim();
  if (indexed) return indexed;
  const fromTurn = String(turnRows.value.find((turn: any) => turn.execution && turn.execution !== '-')?.execution || '').trim();
  return fromTurn;
});
const executionProjection = computed(() => activeExecutionId.value
  ? projections.projectionFor(activeExecutionId.value)
  : null);
const growthEventRows = computed(() => (Array.isArray(growthEvents.value?.events) ? growthEvents.value.events : []).slice(0, 12).map((event: any) => ({
  id: event.id || event.event_id || '-',
  source: event.source || event.source_event_kind || event.kind || '-',
  mode: event.selected_mode || event.mode || '-',
  risk: event.risk || event.risk_level || '-',
  at: event.created_at || event.timestamp || '-',
})));
const growthPromotionRows = computed(() => (Array.isArray(growthEvents.value?.promotions) ? growthEvents.value.promotions : []).slice(0, 10).map((promotion: any) => ({
  target: promotion.target || promotion.target_kind || '-',
  status: promotion.status || promotion.decision || '-',
  target_id: promotion.target_id || promotion.id || '-',
  summary: promotion.summary || promotion.reason || '-',
})));
const growthSources = computed(() => {
  const sources = growthStatus.value?.sources || growthStatus.value?.source_counts || {};
  if (Array.isArray(sources)) return sources.length;
  return sources && typeof sources === 'object' ? Object.keys(sources).length : 0;
});
const runtimeEvidence = computed(() => [
  ...timelineRows.value.slice(0, 5).map((row: any) => ({
    id: String(row.sequence || ''),
    kind: row.kind || 'runtime.event',
    status: row.status || 'recorded',
    summary: row.detail || row.scope || 'runtime timeline event',
    source: `runtime.timeline:${row.scope || 'global'}`,
  })),
  ...growthEventRows.value.slice(0, 4).map((row: any) => ({
    id: String(row.id || ''),
    kind: 'growth.event',
    status: row.risk || row.mode || 'recorded',
    summary: row.source || 'growth event',
    source: 'runtime.growth',
  })),
  ...growthPromotionRows.value.slice(0, 3).map((row: any) => ({
    id: String(row.target_id || row.target || ''),
    kind: `promotion.${row.target || 'target'}`,
    status: row.status || 'recorded',
    summary: row.summary || row.target_id || 'growth promotion',
    source: 'runtime.growth.promotions',
  })),
  ...approvalItems.value.slice(0, 3).map((approval: any) => ({
    id: String(approval.id || approval.request_id || ''),
    kind: 'approval.pending',
    status: 'blocked',
    summary: approval.summary || approval.reason || approval.command || 'approval request',
    source: 'runtime.approval',
  })),
].filter((item) => item.id || item.summary));
const selectedEvidence = computed<EvidenceObject | null>(() => {
  const row: any = selectedDetail.value;
  if (!row) return null;
  const kind = row.kind || row.type || row.source || (row.prompt ? 'runtime.turn' : row.objective ? 'runtime.task' : 'runtime.evidence');
  const ref = String(row.id || row.sequence || row.target_id || row.task || row.session || row.source || kind);
  return {
    ref,
    kind,
    source: row.source || row.scope || 'runtime',
    status: row.status || row.phase || row.risk || row.mode || 'recorded',
    summary: row.detail || row.summary || row.message || row.prompt || row.objective || ref,
    session_id: row.session || row.session_id || sessionId.value,
    turn_id: row.turn_id || (row.id && kind === 'runtime.turn' ? row.id : undefined),
    audit_ref: row.approval_id || row.request_id,
    route: row.route || (row.session || row.session_id ? `/runtime?session_id=${encodeURIComponent(String(row.session || row.session_id))}` : undefined),
    raw: row.raw || row,
  };
});

function formatEpochMs(value: unknown) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  return new Date(ms).toLocaleString();
}

function formatBytes(value: unknown) {
  const bytes = Number(value || 0);
  if (value === undefined || value === null || !Number.isFinite(bytes)) return '-';
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

async function loadSection(section = activeSection.value || 'overview', force = false) {
  if (!force && loadedSections.has(section)) return;
  sectionControllers.get(section)?.abort();
  const controller = new AbortController();
  sectionControllers.set(section, controller);
  const generation = (sectionGenerations.get(section) || 0) + 1;
  sectionGenerations.set(section, generation);
  const current = () => (
    sectionGenerations.get(section) === generation
    && !controller.signal.aborted
    && (activeSection.value || 'overview') === section
  );
  pendingLoads += 1;
  loading.value = true;
  error.value = '';
  try {
    if (section === 'overview') {
      const [nextControl, nextSnapshot, nextSourceAudit, nextRepairPlan, nextEffectiveConfig] = await Promise.all([
        api.runtimeControlPlane(controller.signal),
        api.runtimeSnapshot(controller.signal),
        api.runtimeSourceAudit(controller.signal),
        api.runtimeSourceRepairPlan(controller.signal),
        api.effectiveConfig(controller.signal),
      ]);
      if (!current()) return;
      controlPlane.value = nextControl;
      runtimeStatus.value = nextControl?.runtime_status || {};
      runtimeSnapshot.value = nextSnapshot;
      sourceAudit.value = nextSourceAudit;
      sourceRepairPlan.value = nextRepairPlan;
      effectiveConfig.value = nextEffectiveConfig;
      store.configReloadStatus = nextControl?.config_reload || {};
    } else if (section === 'runs') {
      const [nextTurns, nextLeases, nextTasks, nextSessionExecution] = await Promise.all([
        api.runtimeTurns(controller.signal),
        api.runtimeSessionLeases(controller.signal),
        api.tasks(controller.signal),
        api.sessionExecution(sessionId.value, controller.signal),
      ]);
      if (!current()) return;
      runtimeTurns.value = nextTurns;
      leases.value = nextLeases;
      tasks.value = nextTasks;
      sessionExecution.value = nextSessionExecution;
      selectedTurnId.value = selectedTurnId.value || turnRows.value[0]?.id || '';
    } else if (section === 'policy') {
      const nextApprovals = await api.approvalPending(controller.signal);
      if (!current()) return;
      approvals.value = nextApprovals;
    } else if (section === 'timeline') {
      const nextTimeline = await api.runtimeTimeline(sessionId.value, controller.signal);
      if (!current()) return;
      timeline.value = nextTimeline;
    } else if (section === 'growth') {
      const [nextGrowthStatus, nextGrowthEvents] = await Promise.all([
        api.growthStatus(controller.signal),
        api.growthEvents(controller.signal),
      ]);
      if (!current()) return;
      growthStatus.value = nextGrowthStatus;
      growthEvents.value = nextGrowthEvents;
    }
    if (current()) loadedSections.add(section);
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (sectionControllers.get(section) === controller) sectionControllers.delete(section);
    pendingLoads = Math.max(0, pendingLoads - 1);
    loading.value = pendingLoads > 0;
  }
}

async function refresh() {
  await loadSection(activeSection.value || 'overview', true);
}

async function submitTurn() {
  if (!turnPrompt.value.trim()) return;
  actionResult.value = await api.submitRuntimeTurn(turnPrompt.value, sessionId.value, taskRows.value[0]?.id);
  await loadSection('runs', true);
}

async function inspectTurn() {
  if (!selectedTurnId.value) return;
  actionResult.value = await api.runtimeTurn(selectedTurnId.value);
  selectedDetail.value = actionResult.value?.turn || actionResult.value;
}

async function cancelTurn() {
  if (!selectedTurnId.value) return;
  actionResult.value = await api.cancelRuntimeTurn(selectedTurnId.value);
  await loadSection('runs', true);
}

async function acquireLease() {
  if (!store.activeSessionId) await store.createSession();
  const attached = await chatSessions.attachSurface(store.activeSessionId, leaseMode.value);
  actionResult.value = attached
    ? { ok: true, session_id: store.activeSessionId, mode: leaseMode.value }
    : {
        ok: false,
        session_id: store.activeSessionId,
        error: chatSessions.states[store.activeSessionId]?.degradedReason || 'writer lease rejected',
      };
  await loadSection('runs', true);
}

async function releaseLease() {
  if (!store.activeSessionId) return;
  await chatSessions.detachSurface(store.activeSessionId);
  const state = chatSessions.states[store.activeSessionId];
  actionResult.value = state?.attachmentRole === 'detached'
    ? { ok: true, session_id: store.activeSessionId, released: true }
    : {
        ok: false,
        session_id: store.activeSessionId,
        error: state?.degradedReason || 'writer lease release rejected',
      };
  await loadSection('runs', true);
}

async function respondApproval(approval: any, approved: boolean) {
  const sourceApp = appPluginForId(String(approval?.source?.kind || '').toLowerCase());
  if (sourceApp) {
    const reportRef = String(approval?.source?.resource_ref || '');
    await router.push({
      path: sourceApp.route,
      query: {
        section: 'reports',
        report: reportRef || undefined,
        review: approval?.source?.review_ref || undefined,
      },
    });
    return;
  }
  const id = approval?.approval_id || approval?.id || approval?.request_id;
  actionResult.value = await api.approvalRespond(id, approved, approved ? 'approved from Runtime Workbench' : 'rejected from Runtime Workbench');
  await loadSection('policy', true);
}

watch([activeExecutionId, sessionId], ([executionId, authority], previous) => {
  if (previous && (previous[0] !== executionId || previous[1] !== authority)) {
    projections.release('runtime-page');
  }
  if (executionId) {
    projections.acquire(executionId, 'runtime-page', 'full', 'bounded', authority);
  }
  else projections.release('runtime-page');
}, { immediate: true });
watch(activeSection, (section) => {
  const next = section || 'overview';
  for (const [ownedSection, controller] of sectionControllers.entries()) {
    if (ownedSection !== next) {
      controller.abort();
      sectionControllers.delete(ownedSection);
    }
  }
  const liveSection = ['runs', 'policy', 'timeline', 'growth'].includes(next);
  void loadSection(next, liveSection);
});
watch(sessionId, () => {
  loadedSections.delete('runs');
  loadedSections.delete('timeline');
  const section = activeSection.value || 'overview';
  if (section === 'runs' || section === 'timeline') void loadSection(section, true);
});
onMounted(() => {
  void loadSection(activeSection.value || 'overview');
});
onUnmounted(() => {
  for (const controller of sectionControllers.values()) controller.abort();
  sectionControllers.clear();
  projections.release('runtime-page');
});
</script>

<template>
  <section class="capability-page runtime-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.runtime.page.text.22f16af38e') }}</h1>
        <p>{{ t('page.runtime.page.text.3152ab97db') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? t('page.runtime.page.inline.ae316aff0b') : t('page.runtime.page.inline.d630960583') }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row" v-show="isSectionActive('overview')">
      <article class="metric-card">
        <span>{{ t('page.runtime.page.text.895180bcc2') }}</span>
        <strong>{{ controlPlane.degraded || runtimeStatus.degraded ? t('page.runtime.page.inline.394dec1c4e') : t('page.runtime.page.inline.a6b1ab29de') }}</strong>
        <small>{{ providerControl.configured_model || t('page.runtime.page.inline.b523fd5a1b') }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.runtime.page.text.b803a28e02') }}</span>
        <strong>{{ providerControl.provider_count ?? providerControl.provider_names?.length ?? '-' }}</strong>
        <small>{{ formatCount('models', providerControl.model_count || 0) }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.runtime.page.text.8ee2353a6b') }}</span>
        <strong>{{ approvalItems.length }}</strong>
        <small>{{ taskRows.length }} visible tasks</small>
      </article>
      <article class="metric-card" :data-tone="store.configReloadInvalid ? 'danger' : (store.configReloadNeedsRestart ? 'warn' : 'success')">
        <span>{{ t('config.reload.label') }}</span>
        <strong>{{ displayStatus(configReloadStatusLabel) }}</strong>
        <small>{{ store.configReloadNeedsRestart ? configReloadRestartFields : displayStatus(configReloadStatus.trigger || 'auto') }}</small>
      </article>
    </section>

    <section class="metric-row" v-show="isSectionActive('overview')">
      <article class="metric-card" :data-tone="hotStateHealth.metrics ? (hotStateHealth.pressure_high ? 'warn' : 'success') : 'neutral'">
        <span>{{ t('runtime.health.hotState') }}</span>
        <strong>{{ formatBytes(hotStateHealth.metrics?.resident_bytes) }}</strong>
        <small>{{ t('runtime.health.ofBudget', { value: formatBytes(hotStateHealth.budget?.limit_bytes) }) }}</small>
      </article>
      <article class="metric-card" :data-tone="postgresHealth.metrics ? (Number(postgresHealth.metrics?.query_error_count || 0) > 0 ? 'warn' : 'success') : 'neutral'">
        <span>{{ t('runtime.health.postgres') }}</span>
        <strong>{{ postgresHealth.metrics?.query_count ?? '-' }}</strong>
        <small>{{ t('runtime.health.queryErrors', { value: postgresHealth.metrics?.query_error_count ?? '-' }) }}</small>
      </article>
      <article class="metric-card" :data-tone="storageExecutionHealth.active !== undefined ? (Number(storageExecutionHealth.queue_rejected || 0) > 0 ? 'warn' : 'success') : 'neutral'">
        <span>{{ t('runtime.health.storagePlane') }}</span>
        <strong>{{ storageExecutionHealth.active ?? '-' }} / {{ storageExecutionHealth.queued ?? '-' }}</strong>
        <small>{{ t('runtime.health.activeQueued') }}</small>
      </article>
      <article class="metric-card" :data-tone="providerTransportHealth.entries !== undefined ? 'success' : 'neutral'">
        <span>{{ t('runtime.health.providerTransport') }}</span>
        <strong>{{ providerTransportHealth.entries ?? '-' }}</strong>
        <small>{{ t('runtime.health.transportReuse', {
          hits: providerTransportHealth.hits ?? '-',
          checkouts: providerTransportHealth.checkouts ?? '-',
        }) }}</small>
      </article>
    </section>

    <section class="runtime-grid">
      <StrategyDecisionSummary
        v-if="executionProjection?.strategy"
        class="runtime-panel wide"
        v-show="isSectionActive('runs')"
        data-section="runs"
        :strategy="executionProjection.strategy"
        :agents="executionProjection.agents"
        :execution-id="activeExecutionId"
        :connection-state="projections.stateFor(activeExecutionId)"
        surface="runtime"
      />
      <ExecutionTruthSummary
        v-if="executionProjection"
        class="runtime-panel wide"
        v-show="isSectionActive('runs')"
        data-section="runs"
        :projection="executionProjection"
        :connection-state="projections.stateFor(activeExecutionId)"
      />
      <section class="management-panel runtime-panel wide" v-show="isSectionActive('overview')" data-section="overview">
        <header>
          <h2>{{ t('page.runtime.page.text.895180bcc2') }}</h2>
          <StatusPill :status="configReloadStatusLabel" />
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.runtime.page.text.1debc04086') }}</dt>
          <dd>{{ controlPlane.degraded ? t('page.runtime.page.inline.394dec1c4e') : t('page.runtime.page.inline.a6b1ab29de') }}</dd>
          <dt>{{ t('page.runtime.page.text.75cdd3e77e') }}</dt>
          <dd>{{ providerControl.configured_model || '-' }}</dd>
          <dt>{{ t('page.runtime.page.text.d54281d656') }}</dt>
          <dd>{{ controlPlane.config?.source || effectiveConfig.source || '-' }}</dd>
          <dt>{{ t('page.runtime.page.text.1b6d171a3f') }}</dt>
          <dd>{{ controlPlane.workspace_root || '-' }}</dd>
          <dt>{{ t('config.reload.label') }}</dt>
          <dd>{{ configReloadStatusLabel }} / {{ configReloadStatus.trigger || '-' }}</dd>
          <dt>{{ t('config.reload.lastChecked') }}</dt>
          <dd>{{ formatEpochMs(configReloadStatus.last_checked_at_ms) }}</dd>
          <dt>{{ t('config.reload.lastApplied') }}</dt>
          <dd>{{ formatEpochMs(configReloadStatus.last_applied_at_ms) }}</dd>
          <dt>{{ t('config.reload.restartRequired') }}</dt>
          <dd>{{ configReloadStatus.restart_required?.required ? configReloadRestartFields : t('config.reload.no') }}</dd>
        </dl>
        <ObjectInspectorDrawer :title="t('page.runtime.page.title.bd73a88559')" :data="effectiveConfig" />
        <ObjectInspectorDrawer :title="t('config.reload.statusTitle')" :data="configReloadStatus" />
        <ObjectInspectorDrawer :title="t('page.runtime.page.title.c86b8b732a')" :data="runtimeStatus" />
        <RequestReceipt :receipt="actionResult" :title="t('page.runtime.page.title.d71a6eb85e')" />
      </section>

      <section class="management-panel runtime-panel wide" v-show="isSectionActive('overview')" data-section="overview">
        <header>
          <h2>{{ t('page.runtime.page.text.73dcc03517') }}</h2>
          <StatusPill :status="sourceAudit.__state && sourceAudit.__state !== 'ready' ? sourceAudit.__state : (runtimeSnapshot.__state && runtimeSnapshot.__state !== 'ready' ? runtimeSnapshot.__state : (sourceAudit.report?.ok === false ? 'degraded' : 'ready'))" />
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.runtime.page.text.2076b210ae') }}</dt>
          <dd>{{ runtimeSnapshot.status ? displayStatus(runtimeSnapshot.status) : (runtimeSnapshot.kind || '-') }}</dd>
          <dt>{{ t('page.runtime.page.text.8023cbd84d') }}</dt>
          <dd>{{ sourceAudit.report?.ok === false ? t('page.runtime.page.inline.023e5f7fa9') : displayStatus('ok') }}</dd>
          <dt>{{ t('page.runtime.page.text.27a30f378f') }}</dt>
          <dd>{{ sourceRepairPlan.repair_plan?.length || 0 }}</dd>
        </dl>
        <ObjectInspectorDrawer :title="t('page.runtime.page.title.1d53dbce6a')" :data="runtimeSnapshot" />
        <ObjectInspectorDrawer :title="t('page.runtime.page.title.79e8d02599')" :data="{ audit: sourceAudit, repair: sourceRepairPlan }" />
      </section>

      <section class="management-panel runtime-panel wide" v-show="isSectionActive('mission-link')" data-section="mission-link">
        <header>
          <h2>{{ t('runtime.missionLink.title') }}</h2>
          <StatusPill status="ready" />
        </header>
        <p class="panel-note">{{ t('runtime.missionLink.detail') }}</p>
        <a class="primary-action" href="#/mission">{{ t('runtime.missionLink.action') }}</a>
      </section>

      <section class="management-panel runtime-panel wide" v-show="isSectionActive('runs')" data-section="runs">
        <header>
          <h2>{{ t('page.runtime.page.text.f81fa83905') }}</h2>
          <span>{{ formatCount('leases', leases.leases?.length || leases.count || 0) }}</span>
        </header>
        <label class="field-line">
          {{ t('page.runtime.field.mode') }}
          <select v-model="leaseMode">
            <option value="collaborative">{{ t('page.runtime.leaseMode.shared') }}</option>
            <option value="exclusive">{{ t('page.runtime.leaseMode.exclusive') }}</option>
          </select>
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="acquireLease">{{ t('page.runtime.page.text.c66fa93092') }}</button>
          <button class="ghost-action" type="button" @click="releaseLease">{{ t('page.runtime.page.text.3e1c429858') }}</button>
        </div>
        <RequestReceipt :receipt="actionResult" :title="t('page.runtime.page.title.e757994218')" />
        <ObjectInspectorDrawer :title="t('page.runtime.page.title.e86490ec1d')" :data="leases" />
      </section>

      <section class="management-panel runtime-panel wide" v-show="isSectionActive('policy')" data-section="policy">
        <header>
          <h2>{{ t('page.runtime.page.text.93f65d3d63') }}</h2>
          <span>{{ formatCount('pending', approvalItems.length) }}</span>
        </header>
        <div class="runtime-approval-list">
          <article v-for="approval in approvalItems" :key="approval.id || approval.request_id">
            <div>
              <strong>{{ approval.summary || approval.reason || approval.id }}</strong>
              <p>{{ approval.command || approval.tool || approval.kind || t('page.runtime.page.inline.516d8685da') }}</p>
            </div>
            <button class="ghost-action" type="button" @click="respondApproval(approval, false)">{{ t('page.runtime.page.text.ae4dd827f7') }}</button>
            <button class="primary-action" type="button" @click="respondApproval(approval, true)">
              <ShieldCheck :size="14" />
              {{ t('template.pages.runtimepage.7b2c7f146a') }}
            </button>
          </article>
        </div>
        <EmptyState v-if="!approvalItems.length" :title="t('page.runtime.page.title.362da6a741')" :detail="t('page.runtime.page.detail.e69affe6a7')" />
        <RequestReceipt :receipt="actionResult" :title="t('page.runtime.page.title.a09bbcf3ae')" />
      </section>

      <section class="management-panel runtime-panel wide" v-show="isSectionActive('timeline')" data-section="timeline">
        <header>
          <h2>{{ t('page.runtime.page.text.f3558aafc0') }}</h2>
          <StatusPill :status="timeline.__state || 'ready'" />
        </header>
        <TimelineList v-if="timelineListItems.length" :items="timelineListItems" live @select="selectedDetail = $event" />
        <DataTable v-if="timelineRows.length" :rows="timelineRows" :columns="['sequence', 'domain', 'title', 'status', 'correlation', 'detail']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.16b97cb353')" :detail="t('page.runtime.page.detail.059281d68e')" />
      </section>

      <section class="management-panel runtime-panel wide" v-show="isSectionActive('runs')" data-section="runs">
        <header>
          <h2>{{ t('page.runtime.page.text.aa5f5e3bb0') }}</h2>
          <span>{{ formatCount('tasks', taskRows.length) }}</span>
        </header>
        <DataTable v-if="taskRows.length" :rows="taskRows" :columns="['id', 'status', 'objective', 'current_phase', 'failures']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.c3b49b1801')" :detail="t('page.runtime.page.detail.bb56d607f9')" />
        <ObjectInspectorDrawer :title="t('page.runtime.page.title.09aeda5ef4')" :data="controlPlane" />
      </section>

      <section class="management-panel runtime-panel wide" v-show="isSectionActive('runs')" data-section="runs">
        <header>
          <h2>{{ t('page.runtime.page.text.7557813607') }}</h2>
          <span>{{ formatCount('turns', turnRows.length) }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.runtimepage.a817d7eb8e') }}
          <textarea v-model="turnPrompt" rows="3" />
        </label>
        <label class="field-line">
          {{ t('template.pages.runtimepage.98f6fbf3c0') }}
          <input v-model="selectedTurnId" type="text" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="submitTurn">{{ t('page.runtime.page.text.9baa241112') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedTurnId" @click="inspectTurn">{{ t('page.runtime.page.text.fc0b5cfe07') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedTurnId" @click="cancelTurn">{{ t('page.runtime.page.text.65edf171ac') }}</button>
        </div>
        <DataTable v-if="turnRows.length" :rows="turnRows" :columns="['id', 'status', 'session', 'task', 'execution', 'prompt']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.3d05bab814')" :detail="t('page.runtime.page.detail.334c21b2ac')" />
        <RequestReceipt :receipt="actionResult" :title="t('page.runtime.page.title.42c676123b')" />
        <ObjectInspectorDrawer :title="t('page.runtime.page.title.0d53bacfd6')" :data="runtimeTurns" />
      </section>

      <section class="management-panel runtime-panel wide" v-show="isSectionActive('growth')" data-section="growth">
        <header>
          <h2>{{ t('page.runtime.page.text.996c9d7071') }}</h2>
          <div class="button-row">
            <RouterLink class="ghost-action" :to="`/reality?section=fact-flow&session_id=${encodeURIComponent(sessionId)}`">{{ t('page.runtime.page.text.f381fb2c63') }}</RouterLink>
            <StatusPill :status="growthStatus.__state && growthStatus.__state !== 'ready' ? growthStatus.__state : (growthEvents.__state && growthEvents.__state !== 'ready' ? growthEvents.__state : 'ready')" />
          </div>
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.runtime.page.text.dbd7c33b41') }}</dt>
          <dd>{{ growthStatus.event_count ?? growthEventRows.length }}</dd>
          <dt>{{ t('page.runtime.page.text.6b0540b3f5') }}</dt>
          <dd>{{ growthStatus.promotion_count ?? growthPromotionRows.length }}</dd>
          <dt>{{ t('page.runtime.page.text.c247c75434') }}</dt>
          <dd>{{ growthSources }}</dd>
          <dt>{{ t('page.runtime.page.text.1debc04086') }}</dt>
          <dd>{{ growthStatus.status ? displayStatus(growthStatus.status) : (growthStatus.__state && growthStatus.__state !== 'ready' ? t('page.runtime.page.inline.461aa94b0c') : t('page.runtime.page.inline.a6b1ab29de')) }}</dd>
        </dl>
        <DataTable v-if="growthEventRows.length" :rows="growthEventRows" :columns="['id', 'source', 'mode', 'risk', 'at']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.78769f1c69')" :detail="t('page.runtime.page.detail.340bd22f56')" />
        <DataTable v-if="growthPromotionRows.length" :rows="growthPromotionRows" :columns="['target', 'status', 'target_id', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.f57369a2f0')" :detail="t('page.runtime.page.detail.9cf299404f')" />
        <EvidenceTrace :items="runtimeEvidence" :title="t('page.runtime.page.title.ba93e308cd')" />
        <EvidenceObjectDetail :title="t('page.runtime.page.title.03bcf82613')" :evidence="selectedEvidence" @close="selectedDetail = null" />
        <ObjectInspectorDrawer :title="t('page.runtime.page.title.0889c4b92a')" :data="{ status: growthStatus, events: growthEvents }" />
      </section>
    </section>
  </section>
</template>
