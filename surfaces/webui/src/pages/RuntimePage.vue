<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RefreshCw, RotateCcw, ShieldCheck } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const loading = ref(false);
const error = ref('');
const controlPlane = ref<any>({});
const runtimeStatus = ref<any>({});
const runtimeSnapshot = ref<any>({});
const sourceAudit = ref<any>({});
const sourceRepairPlan = ref<any>({});
const runtimeTurns = ref<any>({});
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
const sessionId = computed(() => store.activeSessionId || 'api-context');
const approvalItems = computed(() => Array.isArray(approvals.value) ? approvals.value : approvals.value?.pending || []);
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
        <h1>Runtime Control</h1>
        <p>控制面、模型提供方、租约、审批、任务和运行时事件集中操作。</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? 'Loading' : 'Refresh runtime' }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row">
      <article class="metric-card">
        <span>Control plane</span>
        <strong>{{ controlPlane.degraded || runtimeStatus.degraded ? 'degraded' : 'ready' }}</strong>
        <small>{{ controlPlane.configured_model || 'no configured model' }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>Providers</span>
        <strong>{{ controlPlane.provider_count ?? controlPlane.provider_names?.length ?? 0 }}</strong>
        <small>{{ controlPlane.provider_model_count || 0 }} models</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>Pending approvals</span>
        <strong>{{ approvalItems.length }}</strong>
        <small>{{ taskRows.length }} visible tasks</small>
      </article>
      <article class="metric-card" data-tone="warning">
        <span>Growth events</span>
        <strong>{{ growthStatus.event_count ?? growthEventRows.length }}</strong>
        <small>{{ growthStatus.promotion_count ?? growthPromotionRows.length }} promotions</small>
      </article>
    </section>

    <section class="runtime-grid">
      <section class="management-panel runtime-panel" data-section="overview">
        <header>
          <h2>Control plane</h2>
          <button class="ghost-action" type="button" @click="reloadProviders">
            <RotateCcw :size="14" />
            Reload providers
          </button>
        </header>
        <dl class="detail-list">
          <dt>Status</dt>
          <dd>{{ controlPlane.degraded ? 'degraded' : 'ready' }}</dd>
          <dt>Model</dt>
          <dd>{{ controlPlane.configured_model || '-' }}</dd>
          <dt>Config source</dt>
          <dd>{{ controlPlane.config_source || effectiveConfig.source || '-' }}</dd>
          <dt>Workspace</dt>
          <dd>{{ controlPlane.workspace_root || '-' }}</dd>
        </dl>
        <RawPayload title="Effective config" :data="effectiveConfig" />
        <RawPayload title="Runtime status" :data="runtimeStatus" />
        <RequestReceipt :receipt="actionResult" title="Runtime write receipt" />
        <RawPayload title="Reload result" :data="reloadResult || {}" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="overview">
        <header>
          <h2>Runtime source and snapshot</h2>
          <StatusPill :status="sourceAudit.__offline || runtimeSnapshot.__offline ? 'offline' : (sourceAudit.report?.ok === false ? 'degraded' : 'ready')" />
        </header>
        <dl class="detail-list">
          <dt>Snapshot</dt>
          <dd>{{ runtimeSnapshot.status || runtimeSnapshot.kind || '-' }}</dd>
          <dt>Source audit</dt>
          <dd>{{ sourceAudit.report?.ok === false ? 'needs repair' : 'ok' }}</dd>
          <dt>Repair items</dt>
          <dd>{{ sourceRepairPlan.repair_plan?.length || 0 }}</dd>
        </dl>
        <RawPayload title="Runtime snapshot detail" :data="runtimeSnapshot" />
        <RawPayload title="Runtime source audit detail" :data="{ audit: sourceAudit, repair: sourceRepairPlan }" />
      </section>

      <section class="management-panel runtime-panel" data-section="runs">
        <header>
          <h2>Session lease</h2>
          <span>{{ leases.leases?.length || leases.count || 0 }} leases</span>
        </header>
        <label class="field-line">
          Owner
          <input v-model="leaseOwner" type="text" />
        </label>
        <label class="field-line">
          Mode
          <select v-model="leaseMode">
            <option value="shared">shared</option>
            <option value="exclusive">exclusive</option>
          </select>
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="acquireLease">Acquire</button>
          <button class="ghost-action" type="button" @click="releaseLease">Release</button>
        </div>
        <RequestReceipt :receipt="actionResult" title="Lease receipt" />
        <RawPayload title="Lease registry" :data="leases" />
      </section>

      <section class="management-panel runtime-panel" data-section="policy">
        <header>
          <h2>Approvals</h2>
          <span>{{ approvalItems.length }} pending</span>
        </header>
        <div class="runtime-approval-list">
          <article v-for="approval in approvalItems" :key="approval.id || approval.request_id">
            <div>
              <strong>{{ approval.summary || approval.reason || approval.id }}</strong>
              <p>{{ approval.command || approval.tool || approval.kind || 'approval request' }}</p>
            </div>
            <button class="ghost-action" type="button" @click="respondApproval(approval.id || approval.request_id, false)">Reject</button>
            <button class="primary-action" type="button" @click="respondApproval(approval.id || approval.request_id, true)">
              <ShieldCheck :size="14" />
              Approve
            </button>
          </article>
        </div>
        <EmptyState v-if="!approvalItems.length" title="No pending approvals" detail="需要人工确认的运行时动作会出现在这里。" />
        <RequestReceipt :receipt="actionResult" title="Approval receipt" />
      </section>

      <section class="management-panel runtime-panel" data-section="timeline">
        <header>
          <h2>Runtime timeline</h2>
          <StatusPill :status="timeline.__offline ? 'offline' : 'ready'" />
        </header>
        <DataTable v-if="timelineRows.length" :rows="timelineRows" :columns="['sequence', 'scope', 'kind', 'status', 'detail']" />
        <EmptyState v-else title="No runtime events" detail="当前 session 没有可展示的运行时事件，或后端离线。" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="runs">
        <header>
          <h2>Task registry</h2>
          <span>{{ taskRows.length }} tasks</span>
        </header>
        <DataTable v-if="taskRows.length" :rows="taskRows" :columns="['id', 'status', 'objective', 'current_phase', 'failures']" />
        <EmptyState v-else title="No tasks" detail="目标任务和阶段验收会通过 task kernel 记录。" />
        <RawPayload title="Control payload" :data="controlPlane" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="runs">
        <header>
          <h2>Runtime turns</h2>
          <span>{{ turnRows.length }} turns</span>
        </header>
        <label class="field-line">
          Prompt
          <textarea v-model="turnPrompt" rows="3" />
        </label>
        <label class="field-line">
          Turn id
          <input v-model="selectedTurnId" type="text" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" @click="submitTurn">Submit turn</button>
          <button class="ghost-action" type="button" :disabled="!selectedTurnId" @click="inspectTurn">Inspect turn</button>
          <button class="ghost-action" type="button" :disabled="!selectedTurnId" @click="cancelTurn">Cancel turn</button>
        </div>
        <DataTable v-if="turnRows.length" :rows="turnRows" :columns="['id', 'status', 'session', 'task', 'prompt']" />
        <EmptyState v-else title="No runtime turns" detail="通过 Runtime service 提交的 turn 会在这里展示。" />
        <RequestReceipt :receipt="actionResult" title="Runtime turn receipt" />
        <RawPayload title="Runtime turn registry" :data="runtimeTurns" />
      </section>

      <section class="management-panel runtime-panel wide" data-section="growth">
        <header>
          <h2>Growth loop</h2>
          <div class="button-row">
            <RouterLink class="ghost-action" :to="`/reality?section=fact-flow&session_id=${encodeURIComponent(sessionId)}`">Open Fact Flow</RouterLink>
            <StatusPill :status="growthStatus.__offline || growthEvents.__offline ? 'offline' : 'ready'" />
          </div>
        </header>
        <dl class="detail-list">
          <dt>Events</dt>
          <dd>{{ growthStatus.event_count ?? growthEventRows.length }}</dd>
          <dt>Promotions</dt>
          <dd>{{ growthStatus.promotion_count ?? growthPromotionRows.length }}</dd>
          <dt>Sources</dt>
          <dd>{{ growthSources }}</dd>
          <dt>Status</dt>
          <dd>{{ growthStatus.status || (growthStatus.__offline ? 'offline' : 'ready') }}</dd>
        </dl>
        <DataTable v-if="growthEventRows.length" :rows="growthEventRows" :columns="['id', 'source', 'mode', 'risk', 'at']" />
        <EmptyState v-else title="No growth events" detail="风险门禁后的成长事件会由后端记录并在这里展示。" />
        <DataTable v-if="growthPromotionRows.length" :rows="growthPromotionRows" :columns="['target', 'status', 'target_id', 'summary']" />
        <EmptyState v-else title="No promotions" detail="进入事实、记忆或矩阵的提升结果会作为 promotion 回执展示。" />
        <RawPayload title="Growth detail" :data="{ status: growthStatus, events: growthEvents }" />
      </section>
    </section>
  </section>
</template>
