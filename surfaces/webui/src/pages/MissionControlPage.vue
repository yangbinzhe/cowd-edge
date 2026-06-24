<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CheckCircle2, GitBranch, Inbox, Play, RefreshCw, Route, ShieldCheck, Square,
  Users,
} from 'lucide-vue-next';
import { api } from '../api/client';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const loading = ref(false);
const error = ref('');
const showFullTrace = ref(true);
const selectedSessionId = ref('');
const teamObjective = ref('Analyze the current task, split roles, execute, and produce an evidence-backed summary');
const routeTarget = ref('');
const routeCommand = ref('Review current evidence and summarize blockers');
const missionProjection = ref<any>({});
const approvals = ref<any>({});
const relations = ref<any>({});
const sessionDetail = ref<any>({});
const sessionInbox = ref<any>({});
const timeline = ref<any>({});
const realityFlow = ref<any>({});
const actionResult = ref<any>(null);

const mission = computed(() => missionProjection.value?.mission || {});
const sessions = computed(() => Array.isArray(mission.value?.sessions) ? mission.value.sessions : []);
const activeSession = computed(() => selectedSessionId.value || store.activeSessionId || sessions.value[0]?.session_id || sessions.value[0]?.id || '');
const selectedSession = computed(() => sessions.value.find((session: any) => (session.session_id || session.id) === activeSession.value) || {});
const approvalProjection = computed(() => mission.value?.approval_projection || approvals.value?.approvals || approvals.value || {});
const approvalItems = computed(() => {
  const projection = approvalProjection.value;
  if (Array.isArray(projection?.requests)) return projection.requests;
  if (Array.isArray(approvals.value?.pending)) return approvals.value.pending;
  if (Array.isArray(approvals.value)) return approvals.value;
  return [];
});
const pendingApprovals = computed(() => approvalItems.value.filter((item: any) => String(item.status || 'pending') === 'pending'));
const sessionCommands = computed(() => {
  if (Array.isArray(sessionInbox.value?.commands)) return sessionInbox.value.commands;
  if (Array.isArray(sessionDetail.value?.session_commands)) return sessionDetail.value.session_commands;
  if (Array.isArray(mission.value?.session_commands)) return mission.value.session_commands.filter((command: any) => command.target_session_id === activeSession.value);
  return [];
});
const commandSummary = computed(() => mission.value?.session_command_summary || sessionInbox.value?.summary || {});
const teams = computed(() => Array.isArray(mission.value?.team_projections) ? mission.value.team_projections : []);
const agents = computed(() => Array.isArray(mission.value?.agent_projections) ? mission.value.agent_projections : []);
const events = computed(() => Array.isArray(mission.value?.events) ? mission.value.events : []);
const relationCount = computed(() => relations.value?.relations?.relation_count || mission.value?.relation_projection?.relation_count || 0);
const evidenceRows = computed(() => {
  if (!showFullTrace.value) return [];
  const runtimeEvents = Array.isArray(timeline.value?.events) ? timeline.value.events : [];
  const realityEvents = Array.isArray(realityFlow.value?.events) ? realityFlow.value.events : [];
  return [
    ...events.value.slice(0, 8).map((event: any) => ({
      source: 'mission',
      kind: event.event_type || event.kind || event.type || '-',
      status: event.status || '-',
      summary: event.message || event.summary || event.session_id || '-',
    })),
    ...runtimeEvents.slice(0, 8).map((event: any) => ({
      source: 'runtime',
      kind: event.kind || event.type || '-',
      status: event.status || event.phase || '-',
      summary: event.detail || event.summary || event.message || '-',
    })),
    ...realityEvents.slice(0, 6).map((event: any) => ({
      source: 'reality',
      kind: event.kind || event.type || '-',
      status: event.status || '-',
      summary: event.summary || event.detail || '-',
    })),
  ];
});
const cleanCounters = computed(() => ({
  tools: Number(sessionDetail.value?.tool_count || sessionDetail.value?.tool_calls || 0),
  memory: Number(sessionDetail.value?.memory_recall_count || sessionDetail.value?.memory_recalls || 0),
  commands: sessionCommands.value.length,
}));
const sessionRows = computed(() => sessions.value.map((session: any) => ({
  id: session.session_id || session.id || '-',
  title: session.title || session.summary || session.session_id || '-',
  status: session.status || '-',
  teams: Array.isArray(session.active_team_ids) ? session.active_team_ids.length : 0,
  agents: Array.isArray(session.active_agent_ids) ? session.active_agent_ids.length : 0,
})));

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextMission, nextApprovals, nextRelations] = await Promise.all([
      api.missionProjection(),
      api.missionApprovals(),
      api.missionRelations(),
    ]);
    missionProjection.value = nextMission;
    approvals.value = nextApprovals;
    relations.value = nextRelations;
    if (!selectedSessionId.value) selectedSessionId.value = store.activeSessionId || sessions.value[0]?.session_id || sessions.value[0]?.id || '';
    await refreshSelectedSession();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function refreshSelectedSession() {
  const sessionId = activeSession.value;
  if (!sessionId) return;
  const requests: Promise<any>[] = [
    api.missionSessionDetail(sessionId),
    api.missionSessionInbox(sessionId),
  ];
  if (showFullTrace.value) {
    requests.push(api.runtimeTimeline(sessionId), api.realityFlow(sessionId, 80));
  }
  const [detail, inbox, nextTimeline, nextReality] = await Promise.all(requests);
  sessionDetail.value = detail;
  sessionInbox.value = inbox;
  timeline.value = nextTimeline || {};
  realityFlow.value = nextReality || {};
}

async function selectSession(sessionId: string) {
  selectedSessionId.value = sessionId;
  await refreshSelectedSession();
}

async function startTeam() {
  if (!activeSession.value || !teamObjective.value.trim()) return;
  actionResult.value = await api.startMissionTeamRuntime(activeSession.value, teamObjective.value.trim());
  await refresh();
}

async function routeToSession() {
  if (!activeSession.value || !routeTarget.value.trim() || !routeCommand.value.trim()) return;
  actionResult.value = await api.routeMissionCommand({
    from_session_id: activeSession.value,
    target_ref: routeTarget.value.trim(),
    command: routeCommand.value.trim(),
  });
  await refresh();
}

async function decideApproval(approvalId: string, approved: boolean) {
  actionResult.value = await api.decideMissionApproval(approvalId, approved, approved ? 'approved from Mission Control' : 'denied from Mission Control');
  await refresh();
}

async function consumeCommand(commandId: string, mode = 'mark_claimed_only') {
  actionResult.value = await api.consumeMissionSessionCommand(activeSession.value, commandId, mode);
  await refresh();
}

async function cancelCommand(commandId: string) {
  actionResult.value = await api.cancelMissionSessionCommand(activeSession.value, commandId);
  await refresh();
}

async function retryCommand(commandId: string) {
  actionResult.value = await api.retryMissionSessionCommand(activeSession.value, commandId);
  await refresh();
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page mission-control-page">
    <header class="page-header">
      <div>
        <h1>Mission Control</h1>
        <p>全局掌控 sessions、teams、agents、approvals、routes、inbox 与 evidence，所有状态来自 Gateway。</p>
      </div>
      <div class="chat-top-actions">
        <label class="mode-switch" title="关闭后只保留正文级计数和关键状态，减少额外投影请求">
          <button type="button" :class="{ active: showFullTrace }" @click="showFullTrace = true; refreshSelectedSession()">全量线索</button>
          <button type="button" :class="{ active: !showFullTrace }" @click="showFullTrace = false; refreshSelectedSession()">纯净</button>
        </label>
        <button class="ghost-action" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="16" /> 刷新
        </button>
      </div>
    </header>

    <div v-if="error" class="file-error">{{ error }}</div>

    <div class="metric-row tools-metrics">
      <article class="metric-card">
        <span>Sessions</span>
        <strong>{{ sessions.length }}</strong>
        <small>{{ mission.active_session_id || activeSession || 'no active session' }}</small>
      </article>
      <article class="metric-card">
        <span>Teams / Agents</span>
        <strong>{{ teams.length }} / {{ agents.length }}</strong>
        <small>runtime lifecycle projection</small>
      </article>
      <article class="metric-card" :data-tone="pendingApprovals.length ? 'warn' : 'success'">
        <span>Approvals</span>
        <strong>{{ pendingApprovals.length }}</strong>
        <small>GlobalApprovalQueue</small>
      </article>
      <article class="metric-card">
        <span>Inbox</span>
        <strong>{{ commandSummary.total || sessionCommands.length }}</strong>
        <small>pending {{ commandSummary.pending || 0 }}, running {{ commandSummary.running || 0 }}</small>
      </article>
    </div>

    <div class="clean-counts">
      <span><strong>{{ cleanCounters.tools }}</strong> tool calls</span>
      <span><strong>{{ cleanCounters.memory }}</strong> memory recalls</span>
      <span><strong>{{ relationCount }}</strong> relations</span>
      <span><strong>{{ cleanCounters.commands }}</strong> commands</span>
    </div>

    <div class="mission-grid">
      <section class="mission-panel">
        <header>
          <h2>Sessions</h2>
          <span>{{ activeSession || 'none selected' }}</span>
        </header>
        <div class="mission-session-list">
          <button
            v-for="session in sessionRows"
            :key="session.id"
            class="section-row"
            :class="{ active: session.id === activeSession }"
            type="button"
            @click="selectSession(session.id)"
          >
            <strong>{{ session.title }}</strong>
            <span>{{ session.id }} · {{ session.status }} · teams {{ session.teams }} · agents {{ session.agents }}</span>
          </button>
          <p v-if="!sessionRows.length" class="empty-note">Gateway 当前没有返回 mission sessions。</p>
        </div>
      </section>

      <section class="mission-panel">
        <header>
          <h2>Launch Team</h2>
          <StatusPill :status="activeSession ? 'ready' : 'idle'" />
        </header>
        <label class="field-line">
          Objective
          <textarea v-model="teamObjective" rows="4" />
        </label>
        <button class="primary-action" type="button" :disabled="!activeSession || !teamObjective.trim()" @click="startTeam">
          <Users :size="16" /> 启动团队
        </button>
      </section>

      <section class="mission-panel">
        <header>
          <h2>Route Session</h2>
          <StatusPill :status="routeTarget ? 'ready' : 'idle'" />
        </header>
        <label class="field-line">
          Target session or alias
          <input v-model="routeTarget" placeholder="session id or alias" />
        </label>
        <label class="field-line">
          Command
          <textarea v-model="routeCommand" rows="3" />
        </label>
        <button class="ghost-action" type="button" :disabled="!routeTarget.trim() || !routeCommand.trim()" @click="routeToSession">
          <Route :size="16" /> 投递命令
        </button>
      </section>
    </div>

    <div class="mission-grid lower">
      <section class="mission-panel wide">
        <header>
          <h2>Command Inbox</h2>
          <span>{{ selectedSession.title || selectedSessionId || activeSession }}</span>
        </header>
        <div class="mission-command-list">
          <article v-for="command in sessionCommands" :key="command.command_id" class="activity-item">
            <div>
              <strong>{{ command.kind || 'command' }} · {{ command.status }}</strong>
              <p>{{ command.command }}</p>
              <small>{{ command.command_id }} · from {{ command.from_session_id || '-' }}</small>
            </div>
            <div class="button-row">
              <button class="icon-action" title="claim" type="button" @click="consumeCommand(command.command_id)">
                <Inbox :size="15" />
              </button>
              <button class="icon-action" title="start turn" type="button" @click="consumeCommand(command.command_id, 'start_turn')">
                <Play :size="15" />
              </button>
              <button class="icon-action" title="retry" type="button" @click="retryCommand(command.command_id)">
                <GitBranch :size="15" />
              </button>
              <button class="danger-action" title="cancel" type="button" @click="cancelCommand(command.command_id)">
                <Square :size="15" />
              </button>
            </div>
          </article>
          <p v-if="!sessionCommands.length" class="empty-note">当前 session 没有待处理命令。</p>
        </div>
      </section>

      <section class="mission-panel">
        <header>
          <h2>Approvals</h2>
          <StatusPill :status="pendingApprovals.length ? 'blocked' : 'ready'" />
        </header>
        <article v-for="approval in pendingApprovals" :key="approval.approval_id || approval.id" class="approval-row">
          <span>{{ approval.summary || approval.action || approval.command }}</span>
          <button class="ghost-action" type="button" @click="decideApproval(approval.approval_id || approval.id, true)">
            <CheckCircle2 :size="15" /> 批准
          </button>
          <button class="danger-action" type="button" @click="decideApproval(approval.approval_id || approval.id, false)">
            <ShieldCheck :size="15" /> 拒绝
          </button>
        </article>
        <p v-if="!pendingApprovals.length" class="empty-note">没有待审批事项。</p>
      </section>
    </div>

    <section v-if="showFullTrace" class="mission-panel trace-panel">
      <header>
        <h2>Evidence Trace</h2>
        <span>{{ evidenceRows.length }} records</span>
      </header>
      <div class="evidence-list">
        <article v-for="item in evidenceRows" :key="`${item.source}-${item.kind}-${item.summary}`" class="evidence-item">
          <strong>{{ item.source }} · {{ item.kind }} · {{ item.status }}</strong>
          <p>{{ item.summary }}</p>
        </article>
        <p v-if="!evidenceRows.length" class="empty-note">暂无可展示线索。</p>
      </div>
    </section>

    <RequestReceipt v-if="actionResult" :receipt="actionResult" />
    <RawPayload title="Mission projection" :payload="missionProjection" />
  </section>
</template>
