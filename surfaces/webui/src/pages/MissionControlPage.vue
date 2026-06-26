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
import MissionActionPreview from '../components/workbench/MissionActionPreview.vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const loading = ref(false);
const error = ref('');
const showFullTrace = ref(true);
const selectedSessionId = ref('');
const selectedTeamId = ref('');
const teamObjective = ref('Analyze the current task, split roles, execute, and produce an evidence-backed summary');
const teamHandoffNote = ref('请接管并审查团队综合结果与证据链');
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
const schedulerState = ref<any>(null);
const stewardHandoff = ref<any>(null);
const recoveryReport = ref<any>(null);
const teamRunDetail = ref<any>({});
const controlProjection = computed(() => missionProjection.value?.projection || missionProjection.value || {});

const mission = computed(() => controlProjection.value?.mission || missionProjection.value?.mission || {});
const sessions = computed(() => Array.isArray(mission.value?.sessions) ? mission.value.sessions : []);
const activeSession = computed(() => selectedSessionId.value || store.activeSessionId || sessions.value[0]?.session_id || sessions.value[0]?.id || '');
const selectedSession = computed(() => sessions.value.find((session: any) => (session.session_id || session.id) === activeSession.value) || {});
const approvalProjection = computed(() => controlProjection.value?.approvals || mission.value?.approval_projection || approvals.value?.approvals || approvals.value || {});
const approvalItems = computed(() => {
  const projection = approvalProjection.value;
  if (Array.isArray(projection)) return projection;
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
const teams = computed(() => Array.isArray(controlProjection.value?.teams) ? controlProjection.value.teams : (Array.isArray(mission.value?.team_projections) ? mission.value.team_projections : []));
const agents = computed(() => Array.isArray(controlProjection.value?.agents) ? controlProjection.value.agents : (Array.isArray(mission.value?.agent_projections) ? mission.value.agent_projections : []));
const collaborationRuns = computed(() => {
  const teamProjection = mission.value?.team_projection || controlProjection.value?.team_projection || {};
  const directRuns = teamProjection?.collaboration_runs?.runs || teamProjection?.runs || controlProjection.value?.collaboration_runs?.runs || [];
  if (Array.isArray(directRuns) && directRuns.length) return directRuns;
  return teams.value.map((team: any) => ({ team, agent_runs: team.agents || [] }));
});
const events = computed(() => Array.isArray(mission.value?.events) ? mission.value.events : []);
const runtimeDigestEvents = computed(() => Array.isArray(controlProjection.value?.event_digest?.latest) ? controlProjection.value.event_digest.latest : []);
const stewardRows = computed(() => Array.isArray(controlProjection.value?.stewards) ? controlProjection.value.stewards : []);
const relationCount = computed(() => controlProjection.value?.relations?.relation_count || relations.value?.relations?.relation_count || mission.value?.relation_projection?.relation_count || 0);
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
    ...runtimeDigestEvents.value.slice(0, 8).map((event: any) => ({
      source: 'eventstore',
      kind: event.kind || '-',
      status: event.status || '-',
      summary: event.stream_id || event.actor || '-',
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
const teamRunRows = computed(() => collaborationRuns.value.slice(0, 8).map((run: any) => {
  const team = run.team || run;
  return {
    id: team.team_id || team.id || '-',
    status: team.status || '-',
    agents: Array.isArray(run.agent_runs) ? run.agent_runs.length : Array.isArray(team.agents) ? team.agents.length : 0,
    synthesis: run.execution_summary?.synthesis_status || team.execution_summary?.synthesis_status || '-',
  };
}));
const dispatchPreview = computed(() => ({
  affected: sessionCommands.value.slice(0, 8).map((command: any) => command.target_session_id || activeSession.value || command.command_id),
  expected: ['mission.command.claimed', 'session.inbox.updated', 'runtime.turn.optional'],
  risk: sessionCommands.value.length > 5 ? 'medium' : 'low',
  approval: pendingApprovals.value.length ? `${pendingApprovals.value.length} pending approval gate(s)` : 'no pending approval gate',
}));
const stewardPreview = computed(() => {
  const stewardIds = stewardRows.value.map((steward: any) => steward.id || steward.steward_id || steward.name).filter(Boolean);
  return {
    affected: stewardIds.length ? stewardIds : sessions.value.slice(0, 6).map((session: any) => session.session_id || session.id),
    expected: ['steward.scheduler.tick', 'team.execution.tick', 'handoff.snapshot'],
    risk: stewardRows.value.length ? 'medium' : 'low',
    approval: 'bounded by steward policy and runtime approvals',
  };
});
const recoveryPreview = computed(() => {
  const gaps = recoveryReport.value?.gaps || recoveryReport.value?.replay_gaps || recoveryReport.value?.report?.gaps || [];
  const affected = Array.isArray(gaps)
    ? gaps.slice(0, 8).map((gap: any) => gap.session_id || gap.stream_id || gap.id || gap.kind || 'gap')
    : sessions.value.slice(0, 6).map((session: any) => session.session_id || session.id);
  return {
    affected,
    expected: ['runtime.recovery.report', 'runtime.recovery.apply', 'eventstore.replay'],
    risk: affected.length ? 'high' : 'medium',
    approval: recoveryReport.value ? 'report reviewed in WebUI' : 'preview required before apply',
  };
});

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextMission, nextApprovals, nextRelations] = await Promise.all([
      api.missionControl(),
      api.missionApprovals().catch(() => ({})),
      api.missionRelations().catch(() => ({})),
    ]);
    missionProjection.value = nextMission;
    approvals.value = nextApprovals;
    relations.value = nextRelations;
    if (!selectedSessionId.value) selectedSessionId.value = store.activeSessionId || sessions.value[0]?.session_id || sessions.value[0]?.id || '';
    if (!selectedTeamId.value) selectedTeamId.value = teamRunRows.value[0]?.id || '';
    await refreshSelectedSession();
    if (selectedTeamId.value) await loadTeamRun();
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
  const teamId = actionResult.value?.team?.team_id || actionResult.value?.receipt?.result?.team?.team_id;
  if (teamId) {
    selectedTeamId.value = teamId;
    actionResult.value = await api.tickTeamExecution(teamId);
  }
  await refresh();
}

async function loadTeamRun(teamId = selectedTeamId.value) {
  if (!teamId) return;
  selectedTeamId.value = teamId;
  teamRunDetail.value = await api.collaborationRun(teamId);
}

async function tickSelectedTeam() {
  if (!selectedTeamId.value) return;
  actionResult.value = await api.tickTeamExecution(selectedTeamId.value);
  await refresh();
}

async function synthesizeSelectedTeam() {
  if (!selectedTeamId.value) return;
  actionResult.value = await api.synthesizeTeamRuntime(selectedTeamId.value);
  teamRunDetail.value = actionResult.value;
  await refresh();
}

async function handoffSelectedTeam() {
  if (!selectedTeamId.value) return;
  actionResult.value = await api.handoffTeamRuntime(selectedTeamId.value, {
    target: 'human-agent',
    note: teamHandoffNote.value,
  });
  teamRunDetail.value = actionResult.value;
  await refresh();
}

async function cancelSelectedTeam() {
  if (!selectedTeamId.value) return;
  actionResult.value = await api.cancelTeamRuntime(selectedTeamId.value);
  await refresh();
}

async function routeToSession() {
  if (!activeSession.value || !routeTarget.value.trim() || !routeCommand.value.trim()) return;
  actionResult.value = await api.missionControlCommand({
    target: { session: { session_id: activeSession.value } },
    action: 'route_to_session',
    actor: 'webui',
    payload: {
      target_session_id: routeTarget.value.trim().replace(/^@/, ''),
      command: routeCommand.value.trim(),
    },
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

async function dispatchSessions() {
  actionResult.value = await api.dispatchMissionSessions();
  await refresh();
}

async function previewStewardship() {
  const [scheduler, handoff] = await Promise.all([
    api.stewardScheduler().catch((error) => ({ __offline: true, __error: String(error) })),
    stewardRows.value[0]?.id || stewardRows.value[0]?.steward_id
      ? api.stewardHandoff(stewardRows.value[0].id || stewardRows.value[0].steward_id).catch((error) => ({ __offline: true, __error: String(error) }))
      : Promise.resolve({ steward: null, note: 'no steward selected from current projection' }),
  ]);
  schedulerState.value = scheduler;
  stewardHandoff.value = handoff;
}

async function tickStewards() {
  if (!schedulerState.value) await previewStewardship();
  actionResult.value = await api.tickStewardScheduler();
  await refresh();
}

async function previewRecovery() {
  recoveryReport.value = await api.runtimeRecoveryReport();
}

async function applyRecovery() {
  if (!recoveryReport.value) {
    await previewRecovery();
    return;
  }
  actionResult.value = await api.applyRuntimeRecovery();
  recoveryReport.value = await api.runtimeRecoveryReport().catch(() => recoveryReport.value);
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
        <button class="ghost-action" type="button" @click="dispatchSessions">执行调度</button>
        <button class="ghost-action" type="button" @click="previewStewardship">预览托管</button>
        <button class="ghost-action" type="button" @click="previewRecovery">预览恢复</button>
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
      <article class="metric-card">
        <span>Stewards</span>
        <strong>{{ stewardRows.length }}</strong>
        <small>scheduler-ready supervision</small>
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
      <section class="mission-panel governed-wide">
        <header>
          <h2>Governed actions</h2>
          <span>preview before high-impact write</span>
        </header>
        <div class="mission-preview-grid">
          <MissionActionPreview
            title="Dispatch session inbox"
            action="Claim or start pending session commands through Mission Runtime."
            :target="activeSession || 'all sessions'"
            :affected="dispatchPreview.affected"
            :expected="dispatchPreview.expected"
            :risk="dispatchPreview.risk"
            :approval="dispatchPreview.approval"
          />
          <MissionActionPreview
            title="Steward scheduler"
            action="Tick delegated stewards and collect handoff state before execution."
            :target="stewardRows[0]?.id || stewardRows[0]?.steward_id || 'scheduler'"
            :affected="stewardPreview.affected"
            :expected="stewardPreview.expected"
            :risk="stewardPreview.risk"
            :approval="stewardPreview.approval"
            :source="schedulerState ? 'backend scheduler state' : 'frontend projection preview'"
          />
          <MissionActionPreview
            title="Runtime recovery"
            action="Replay and recover runtime gaps only after recovery report is visible."
            :target="activeSession || 'runtime'"
            :affected="recoveryPreview.affected"
            :expected="recoveryPreview.expected"
            :risk="recoveryPreview.risk"
            :approval="recoveryPreview.approval"
            :source="recoveryReport ? 'runtime recovery report' : 'report required'"
          />
        </div>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="dispatchSessions">Run dispatch</button>
          <button class="ghost-action" type="button" @click="previewStewardship">Load steward state</button>
          <button class="primary-action" type="button" @click="tickStewards">Tick stewards</button>
          <button class="ghost-action" type="button" @click="previewRecovery">Load recovery report</button>
          <button class="danger-action" type="button" :disabled="!recoveryReport" @click="applyRecovery">Apply recovery</button>
        </div>
        <RequestReceipt v-if="schedulerState" :receipt="schedulerState" title="Steward scheduler state" />
        <RawPayload v-if="stewardHandoff" title="Steward handoff summary" :data="stewardHandoff" />
        <RequestReceipt v-if="recoveryReport" :receipt="recoveryReport" title="Runtime recovery report" />
      </section>

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
          <h2>Team Runs</h2>
          <StatusPill :status="selectedTeamId ? 'ready' : 'idle'" />
        </header>
        <div class="mission-session-list compact">
          <button
            v-for="team in teamRunRows"
            :key="team.id"
            class="section-row"
            :class="{ active: team.id === selectedTeamId }"
            type="button"
            @click="loadTeamRun(team.id)"
          >
            <strong>{{ team.id }}</strong>
            <span>{{ team.status }} · agents {{ team.agents }} · synthesis {{ team.synthesis }}</span>
          </button>
          <p v-if="!teamRunRows.length" class="empty-note">当前没有 runtime team run。</p>
        </div>
        <label class="field-line">
          Handoff note
          <textarea v-model="teamHandoffNote" rows="3" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" :disabled="!selectedTeamId" @click="tickSelectedTeam">Tick</button>
          <button class="primary-action" type="button" :disabled="!selectedTeamId" @click="synthesizeSelectedTeam">Synthesis</button>
          <button class="ghost-action" type="button" :disabled="!selectedTeamId" @click="handoffSelectedTeam">Handoff</button>
          <button class="danger-action" type="button" :disabled="!selectedTeamId" @click="cancelSelectedTeam">Cancel</button>
        </div>
        <RawPayload v-if="teamRunDetail?.run || teamRunDetail?.summary" title="Team run detail" :data="teamRunDetail" />
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
          <span>{{ approval.summary || approval.action || approval.command }} · {{ approval.session_id || approval.agent_id || approval.tool || 'mission' }} · {{ approval.risk || 'policy' }}</span>
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
    <RawPayload title="Mission projection" :data="missionProjection" />
  </section>
</template>
