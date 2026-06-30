<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { RefreshCw, RotateCcw, ShieldCheck } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import EvidenceObjectDetail from '../components/workbench/EvidenceObjectDetail.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import { useAppStore } from '../stores/app';
import type { EvidenceObject } from '../types/evidence';

const store = useAppStore();
const loading = ref(false);
const error = ref('');
const controlPlane = ref<any>({});
const runtimeStatus = ref<any>({});
const runtimeSnapshot = ref<any>({});
const sourceAudit = ref<any>({});
const sourceRepairPlan = ref<any>({});
const runtimeTurns = ref<any>({});
const missionProjection = ref<any>({});
const missionApprovals = ref<any>({});
const missionRelations = ref<any>({});
const effectiveConfig = ref<any>({});
const leases = ref<any>({});
const approvals = ref<any>([]);
const timeline = ref<any>({});
const tasks = ref<any>({});
const growthStatus = ref<any>({});
const growthEvents = ref<any>({});
const reloadResult = ref<any>(null);
const actionResult = ref<any>(null);
const leaseOwner = ref('webui');
const leaseMode = ref('shared');
const turnPrompt = ref('Summarize current runtime state and blockers');
const selectedTurnId = ref('');
const selectedDetail = ref<Record<string, unknown> | null>(null);
const sessionId = computed(() => store.activeSessionId || 'api-context');
const approvalItems = computed(() => Array.isArray(approvals.value) ? approvals.value : approvals.value?.pending || []);
const missionControlProjection = computed(() => missionProjection.value?.projection || missionProjection.value || {});
const mission = computed(() => missionControlProjection.value?.mission || {});
const missionSessions = computed(() => Array.isArray(mission.value?.sessions) ? mission.value.sessions : []);
const missionEvents = computed(() => Array.isArray(mission.value?.events) ? mission.value.events : []);
const missionApprovalProjection = computed(() => mission.value?.approval_projection || missionApprovals.value?.approvals || {});
const missionRelationProjection = computed(() => mission.value?.relation_projection || missionRelations.value?.relations || {});
const missionSessionRows = computed(() => missionSessions.value.slice(0, 12).map((session: any) => ({
  id: session.session_id || session.id || '-',
  title: session.title || session.session_id || '-',
  status: session.status || '-',
  teams: Array.isArray(session.active_team_ids) ? session.active_team_ids.length : 0,
  agents: Array.isArray(session.active_agent_ids) ? session.active_agent_ids.length : 0,
})));
const missionEventRows = computed(() => missionEvents.value.slice(0, 10).map((event: any) => ({
  sequence: event.sequence ?? '-',
  type: event.event_type || event.kind || event.type || '-',
  session: event.session_id || '-',
  message: event.message || event.summary || '-',
})));
const timelineRows = computed(() => (Array.isArray(timeline.value?.events) ? timeline.value.events : []).slice(0, 16).map((event: any) => ({
  sequence: event.sequence ?? event.id ?? '-',
  scope: event.scope || event.kind || event.type || '-',
  kind: event.kind || event.type || '-',
  status: event.status || event.phase || '-',
  detail: event.detail || event.summary || event.message || '-',
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
  prompt: turn.prompt || turn.summary || '-',
})));
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
const runtimeContext = computed(() => [
  { label: t('script.pages.runtimepage.label.f7f1997c6c'), value: sessionId.value },
  { label: t('script.pages.runtimepage.label.68c2cc7f0c'), value: controlPlane.value.configured_model || effectiveConfig.value?.model || 'unresolved' },
  { label: t('script.pages.runtimepage.label.7ceee3f361'), value: controlPlane.value.provider_count ?? 0, tone: controlPlane.value.provider_count ? 'success' : 'warn' },
  { label: t('script.pages.runtimepage.label.6dc1222c37'), value: controlPlane.value.production_ready === true ? 'production ready' : 'attention', tone: controlPlane.value.production_ready === true ? 'success' : 'warn' },
]);
const runtimeWorkflow = computed(() => [
  { id: 'overview', label: t('script.pages.runtimepage.label.8851142da5'), status: controlPlane.value.degraded ? 'degraded' : 'ready', count: controlPlane.value.provider_count ?? 0, description: 'providers' },
  { id: 'runs', label: t('script.pages.runtimepage.label.b24ef8c7cc'), status: leases.value?.__offline ? 'blocked' : 'ready', count: Array.isArray(leases.value?.leases) ? leases.value.leases.length : 0 },
  { id: 'runs', label: t('script.pages.runtimepage.label.368e8081b7'), status: turnRows.value.length ? 'active' : 'idle', count: turnRows.value.length },
  { id: 'mission', label: t('script.pages.runtimepage.label.e4698d4cea'), status: missionSessions.value.length ? 'ready' : 'idle', count: missionSessions.value.length },
  { id: 'timeline', label: t('script.pages.runtimepage.label.018514a3d5'), status: timelineRows.value.length ? 'ready' : 'idle', count: timelineRows.value.length },
  { id: 'policy', label: t('script.pages.runtimepage.label.8cc047ac17'), status: approvalItems.value.length ? 'blocked' : 'ready', count: approvalItems.value.length },
  { id: 'growth', label: t('script.pages.runtimepage.label.f3b21e049f'), status: growthPromotionRows.value.length ? 'done' : 'idle', count: growthEventRows.value.length },
]);
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
    turn_id: row.id && kind === 'runtime.turn' ? row.id : row.turn_id,
    audit_ref: row.approval_id || row.request_id,
    route: row.session || row.session_id ? `/runtime?session_id=${encodeURIComponent(String(row.session || row.session_id))}` : undefined,
    raw: row,
  };
});

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [
      nextControl,
      nextStatus,
      nextSnapshot,
      nextSourceAudit,
      nextRepairPlan,
      nextTurns,
      nextMission,
      nextMissionApprovals,
      nextMissionRelations,
      nextConfig,
      nextLeases,
      nextApprovals,
      nextTimeline,
      nextTasks,
      nextGrowthStatus,
      nextGrowthEvents,
    ] = await Promise.all([
      api.runtimeControlPlane(),
      api.runtimeStatus(),
      api.runtimeSnapshot(),
      api.runtimeSourceAudit(),
      api.runtimeSourceRepairPlan(),
      api.runtimeTurns(),
      api.missionControl(),
      api.missionApprovals(),
      api.missionRelations(),
      api.effectiveConfig(),
      api.runtimeSessionLeases(),
      api.approvalPending(),
      api.runtimeTimeline(sessionId.value),
      api.tasks(),
      api.growthStatus(),
      api.growthEvents(),
    ]);
    controlPlane.value = nextControl;
    runtimeStatus.value = nextStatus;
    runtimeSnapshot.value = nextSnapshot;
    sourceAudit.value = nextSourceAudit;
    sourceRepairPlan.value = nextRepairPlan;
    runtimeTurns.value = nextTurns;
    missionProjection.value = nextMission;
    missionApprovals.value = nextMissionApprovals;
    missionRelations.value = nextMissionRelations;
    effectiveConfig.value = nextConfig;
    leases.value = nextLeases;
    approvals.value = nextApprovals;
    timeline.value = nextTimeline;
    tasks.value = nextTasks;
    growthStatus.value = nextGrowthStatus;
    growthEvents.value = nextGrowthEvents;
    selectedTurnId.value = selectedTurnId.value || turnRows.value[0]?.id || '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function submitTurn() {
  if (!turnPrompt.value.trim()) return;
  actionResult.value = await api.submitRuntimeTurn(turnPrompt.value, sessionId.value, taskRows.value[0]?.id);
  await refresh();
}

async function inspectTurn() {
  if (!selectedTurnId.value) return;
  actionResult.value = await api.runtimeTurn(selectedTurnId.value);
  selectedDetail.value = actionResult.value?.turn || actionResult.value;
}

async function cancelTurn() {
  if (!selectedTurnId.value) return;
  actionResult.value = await api.cancelRuntimeTurn(selectedTurnId.value);
  await refresh();
}

async function reloadProviders() {
  reloadResult.value = await api.reloadProviders();
  actionResult.value = reloadResult.value;
  await refresh();
}

async function acquireLease() {
  if (!store.activeSessionId) await store.createSession();
  actionResult.value = await api.acquireRuntimeLease(store.activeSessionId, leaseOwner.value, leaseMode.value);
  await refresh();
}

async function releaseLease() {
  if (!store.activeSessionId) return;
  actionResult.value = await api.releaseRuntimeLease(store.activeSessionId, leaseOwner.value);
  await refresh();
}

async function respondApproval(id: string, approved: boolean) {
  actionResult.value = await api.approvalRespond(id, approved, approved ? 'approved from Runtime Workbench' : 'rejected from Runtime Workbench');
  await refresh();
}

onMounted(refresh);
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
    <PrimaryContextBar :items="runtimeContext" />
    <WorkflowStrip :steps="runtimeWorkflow" :title="t('page.runtime.page.title.cd537a35f0')" />

    <section class="metric-row">
      <article class="metric-card">
        <span>{{ t('page.runtime.page.text.895180bcc2') }}</span>
        <strong>{{ controlPlane.degraded || runtimeStatus.degraded ? t('page.runtime.page.inline.394dec1c4e') : t('page.runtime.page.inline.a6b1ab29de') }}</strong>
        <small>{{ controlPlane.configured_model || t('page.runtime.page.inline.b523fd5a1b') }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.runtime.page.text.b803a28e02') }}</span>
        <strong>{{ controlPlane.provider_count ?? controlPlane.provider_names?.length ?? 0 }}</strong>
        <small>{{ formatCount('models', controlPlane.provider_model_count || 0) }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.runtime.page.text.8ee2353a6b') }}</span>
        <strong>{{ approvalItems.length }}</strong>
        <small>{{ taskRows.length }} visible tasks</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.runtime.page.text.6cf339578a') }}</span>
        <strong>{{ missionSessions.length }}</strong>
        <small>{{ mission.active_session_id || t('page.runtime.page.inline.9e652504d9') }}</small>
      </article>
      <article class="metric-card" data-tone="warning">
        <span>{{ t('page.runtime.page.text.188d0073a9') }}</span>
        <strong>{{ growthStatus.event_count ?? growthEventRows.length }}</strong>
        <small>{{ formatCount('promotions', growthStatus.promotion_count ?? growthPromotionRows.length) }}</small>
      </article>
    </section>

    <section class="runtime-grid">
      <section class="management-panel runtime-panel" data-section="overview">
        <header>
          <h2>{{ t('page.runtime.page.text.895180bcc2') }}</h2>
          <button class="ghost-action" type="button" @click="reloadProviders">
            <RotateCcw :size="14" />
            {{ t('template.pages.runtimepage.13cb300646') }}
          </button>
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.runtime.page.text.1debc04086') }}</dt>
          <dd>{{ controlPlane.degraded ? t('page.runtime.page.inline.394dec1c4e') : t('page.runtime.page.inline.a6b1ab29de') }}</dd>
          <dt>{{ t('page.runtime.page.text.75cdd3e77e') }}</dt>
          <dd>{{ controlPlane.configured_model || '-' }}</dd>
          <dt>{{ t('page.runtime.page.text.d54281d656') }}</dt>
          <dd>{{ controlPlane.config_source || effectiveConfig.source || '-' }}</dd>
          <dt>{{ t('page.runtime.page.text.1b6d171a3f') }}</dt>
          <dd>{{ controlPlane.workspace_root || '-' }}</dd>
        </dl>
        <RawPayload :title="t('page.runtime.page.title.bd73a88559')" :data="effectiveConfig" />
        <RawPayload :title="t('page.runtime.page.title.c86b8b732a')" :data="runtimeStatus" />
        <RequestReceipt :receipt="actionResult" :title="t('page.runtime.page.title.d71a6eb85e')" />
        <RawPayload :title="t('page.runtime.page.title.c320bdf9a0')" :data="reloadResult || {}" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="overview">
        <header>
          <h2>{{ t('page.runtime.page.text.73dcc03517') }}</h2>
          <StatusPill :status="sourceAudit.__offline || runtimeSnapshot.__offline ? 'offline' : (sourceAudit.report?.ok === false ? 'degraded' : 'ready')" />
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.runtime.page.text.2076b210ae') }}</dt>
          <dd>{{ runtimeSnapshot.status || runtimeSnapshot.kind || '-' }}</dd>
          <dt>{{ t('page.runtime.page.text.8023cbd84d') }}</dt>
          <dd>{{ sourceAudit.report?.ok === false ? t('page.runtime.page.inline.023e5f7fa9') : 'ok' }}</dd>
          <dt>{{ t('page.runtime.page.text.27a30f378f') }}</dt>
          <dd>{{ sourceRepairPlan.repair_plan?.length || 0 }}</dd>
        </dl>
        <RawPayload :title="t('page.runtime.page.title.1d53dbce6a')" :data="runtimeSnapshot" />
        <RawPayload :title="t('page.runtime.page.title.79e8d02599')" :data="{ audit: sourceAudit, repair: sourceRepairPlan }" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="mission">
        <header>
          <h2>{{ t('page.runtime.page.text.9ad26584ae') }}</h2>
          <StatusPill :status="missionProjection.__offline ? 'offline' : (missionSessions.length ? 'ready' : 'idle')" />
        </header>
        <dl class="detail-list">
          <dt>{{ t('page.runtime.page.text.8c9939cab6') }}</dt>
          <dd>{{ mission.active_session_id || '-' }}</dd>
          <dt>{{ t('page.runtime.page.text.e7346c0efc') }}</dt>
          <dd>{{ missionSessions.length }}</dd>
          <dt>{{ t('page.runtime.page.text.8ee2353a6b') }}</dt>
          <dd>{{ missionApprovalProjection.pending_count ?? 0 }}</dd>
          <dt>{{ t('page.runtime.page.text.74b4efa226') }}</dt>
          <dd>{{ missionRelationProjection.relation_count ?? 0 }}</dd>
        </dl>
        <DataTable v-if="missionSessionRows.length" :rows="missionSessionRows" :columns="['id', 'title', 'status', 'teams', 'agents']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.764ff57548')" :detail="t('page.runtime.page.detail.d92a88eb8c')" />
        <DataTable v-if="missionEventRows.length" :rows="missionEventRows" :columns="['sequence', 'type', 'session', 'message']" @row-click="selectedDetail = $event" />
        <RawPayload :title="t('page.runtime.page.title.c172d5cfe2')" :data="{ projection: missionProjection, approvals: missionApprovals, relations: missionRelations }" />
      </section>

      <section class="management-panel runtime-panel" data-section="runs">
        <header>
          <h2>{{ t('page.runtime.page.text.f81fa83905') }}</h2>
          <span>{{ formatCount('leases', leases.leases?.length || leases.count || 0) }}</span>
        </header>
        <label class="field-line">
          {{ t('page.runtime.field.owner') }}
          <input v-model="leaseOwner" type="text" />
        </label>
        <label class="field-line">
          {{ t('page.runtime.field.mode') }}
          <select v-model="leaseMode">
            <option value="shared">{{ t('page.runtime.leaseMode.shared') }}</option>
            <option value="exclusive">{{ t('page.runtime.leaseMode.exclusive') }}</option>
          </select>
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="acquireLease">{{ t('page.runtime.page.text.c66fa93092') }}</button>
          <button class="ghost-action" type="button" @click="releaseLease">{{ t('page.runtime.page.text.3e1c429858') }}</button>
        </div>
        <RequestReceipt :receipt="actionResult" :title="t('page.runtime.page.title.e757994218')" />
        <RawPayload :title="t('page.runtime.page.title.e86490ec1d')" :data="leases" />
      </section>

      <section class="management-panel runtime-panel" data-section="policy">
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
            <button class="ghost-action" type="button" @click="respondApproval(approval.id || approval.request_id, false)">{{ t('page.runtime.page.text.ae4dd827f7') }}</button>
            <button class="primary-action" type="button" @click="respondApproval(approval.id || approval.request_id, true)">
              <ShieldCheck :size="14" />
              {{ t('template.pages.runtimepage.7b2c7f146a') }}
            </button>
          </article>
        </div>
        <EmptyState v-if="!approvalItems.length" :title="t('page.runtime.page.title.362da6a741')" :detail="t('page.runtime.page.detail.e69affe6a7')" />
        <RequestReceipt :receipt="actionResult" :title="t('page.runtime.page.title.a09bbcf3ae')" />
      </section>

      <section class="management-panel runtime-panel" data-section="timeline">
        <header>
          <h2>{{ t('page.runtime.page.text.f3558aafc0') }}</h2>
          <StatusPill :status="timeline.__offline ? 'offline' : 'ready'" />
        </header>
        <DataTable v-if="timelineRows.length" :rows="timelineRows" :columns="['sequence', 'scope', 'kind', 'status', 'detail']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.16b97cb353')" :detail="t('page.runtime.page.detail.059281d68e')" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="runs">
        <header>
          <h2>{{ t('page.runtime.page.text.aa5f5e3bb0') }}</h2>
          <span>{{ formatCount('tasks', taskRows.length) }}</span>
        </header>
        <DataTable v-if="taskRows.length" :rows="taskRows" :columns="['id', 'status', 'objective', 'current_phase', 'failures']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.c3b49b1801')" :detail="t('page.runtime.page.detail.bb56d607f9')" />
        <RawPayload :title="t('page.runtime.page.title.09aeda5ef4')" :data="controlPlane" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="runs">
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
        <DataTable v-if="turnRows.length" :rows="turnRows" :columns="['id', 'status', 'session', 'task', 'prompt']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.3d05bab814')" :detail="t('page.runtime.page.detail.334c21b2ac')" />
        <RequestReceipt :receipt="actionResult" :title="t('page.runtime.page.title.42c676123b')" />
        <RawPayload :title="t('page.runtime.page.title.0d53bacfd6')" :data="runtimeTurns" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="growth">
        <header>
          <h2>{{ t('page.runtime.page.text.996c9d7071') }}</h2>
          <div class="button-row">
            <RouterLink class="ghost-action" :to="`/reality?section=fact-flow&session_id=${encodeURIComponent(sessionId)}`">{{ t('page.runtime.page.text.f381fb2c63') }}</RouterLink>
            <StatusPill :status="growthStatus.__offline || growthEvents.__offline ? 'offline' : 'ready'" />
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
          <dd>{{ growthStatus.status || (growthStatus.__offline ? t('page.runtime.page.inline.461aa94b0c') : t('page.runtime.page.inline.a6b1ab29de')) }}</dd>
        </dl>
        <DataTable v-if="growthEventRows.length" :rows="growthEventRows" :columns="['id', 'source', 'mode', 'risk', 'at']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.78769f1c69')" :detail="t('page.runtime.page.detail.340bd22f56')" />
        <DataTable v-if="growthPromotionRows.length" :rows="growthPromotionRows" :columns="['target', 'status', 'target_id', 'summary']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.runtime.page.title.f57369a2f0')" :detail="t('page.runtime.page.detail.9cf299404f')" />
        <EvidenceTrace :items="runtimeEvidence" :title="t('page.runtime.page.title.ba93e308cd')" />
        <EvidenceObjectDetail :title="t('page.runtime.page.title.03bcf82613')" :evidence="selectedEvidence" @close="selectedDetail = null" />
        <RawPayload :title="t('page.runtime.page.title.0889c4b92a')" :data="{ status: growthStatus, events: growthEvents }" />
      </section>
    </section>
  </section>
</template>
