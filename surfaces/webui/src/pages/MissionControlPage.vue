<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import {
  AlertTriangle, CheckCircle2, Database, GitBranch, Inbox, Play, RefreshCw, Route,
  ShieldCheck, Square, Users, Workflow,
} from 'lucide-vue-next';
import { api } from '../api/client';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import DataTable from '../components/workbench/DataTable.vue';
import MissionActionPreview from '../components/workbench/MissionActionPreview.vue';
import { useAppStore } from '../stores/app';
import { displayStatus } from '../i18n/domain/status';

const store = useAppStore();
const loading = ref(false);
const error = ref('');
const showFullTrace = ref(true);
const selectedSessionId = ref('');
const selectedTeamId = ref('');
const teamObjective = ref('Analyze the current task, split roles, execute, and produce an evidence-backed summary');
const teamHandoffNote = ref(t('page.mission.teamHandoff.default'));
const routeTarget = ref('');
const routeCommand = ref('Review current evidence and summarize blockers');
const missionProjection = ref<any>({});
const approvals = ref<any>({});
const relations = ref<any>({});
const conflicts = ref<any>({});
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
const workgraphProjection = computed(() => controlProjection.value?.workgraphs || mission.value?.workgraph_projection || {});
const workgraphRows = computed(() => {
  const rows = workgraphProjection.value?.workgraphs || workgraphProjection.value?.items || [];
  return Array.isArray(rows) ? rows.slice(0, 12).map((row: any) => ({
    team: row.team_id || '-',
    graph: row.workgraph_id || row.id || '-',
    nodes: row.node_count ?? row.quality?.node_count ?? '-',
    edges: row.edge_count ?? row.quality?.edge_count ?? '-',
    ready: Array.isArray(row.ready_node_ids) ? row.ready_node_ids.length : 0,
    blocked: Array.isArray(row.blocked_node_ids) ? row.blocked_node_ids.length : 0,
    parallelism: row.max_parallelism || '-',
  })) : [];
});
const conflictProjection = computed(() => controlProjection.value?.conflicts || mission.value?.conflict_projection || conflicts.value?.conflicts || {});
const conflictItems = computed(() => {
  const rows = conflictProjection.value?.receipts || conflictProjection.value?.conflicts || [];
  return Array.isArray(rows) ? rows.slice(0, 12).map((row: any) => ({
    id: row.conflict_id || row.id || '-',
    source: row.source || '-',
    severity: row.severity || '-',
    decision: row.decision || '-',
    summary: row.summary || '-',
  })) : [];
});
const evidenceProjection = computed(() => controlProjection.value?.evidence || mission.value?.evidence_projection || {});
const missionEvidenceRows = computed(() => {
  const rows = evidenceProjection.value?.latest || evidenceProjection.value?.evidence || [];
  return Array.isArray(rows) ? rows.slice(0, 12).map((row: any) => ({
    kind: row.kind || '-',
    session: row.session_id || '-',
    team: row.team_id || '-',
    agent: row.agent_id || '-',
    summary: row.summary || '-',
  })) : [];
});
const capabilityProjection = computed(() => controlProjection.value?.capabilities || mission.value?.capability_projection || {});
const actionContractRows = computed(() => {
  const rows = capabilityProjection.value?.action_contracts || [];
  return Array.isArray(rows) ? rows.slice(0, 10).map((row: any) => ({
    action: row.runtime_action || '-',
    tool: row.tool_action || '-',
    use: row.when_to_use || '-',
    projection: Array.isArray(row.expected_projection) ? row.expected_projection.join(', ') : '-',
  })) : [];
});
const missionHealth = computed(() => controlProjection.value?.health?.mission || mission.value?.health_projection || {});
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
    ...missionEvidenceRows.value.slice(0, 8).map((event: any) => ({
      source: 'mission-evidence',
      kind: event.kind,
      status: event.session,
      summary: event.summary,
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
const agentRows = computed(() => agents.value.slice(0, 24).map((agent: any) => ({
  id: agent.agent_id || agent.id || agent.name || '-',
  role: agent.role || agent.kind || agent.profile || '-',
  status: agent.status || agent.lifecycle || '-',
  session: agent.session_id || agent.active_session_id || activeSession.value || '-',
  team: agent.team_id || agent.active_team_id || '-',
  summary: agent.summary || agent.objective || agent.last_message || agent.name || '-',
})));
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
    const [nextMission, nextApprovals, nextRelations, nextConflicts] = await Promise.all([
      api.missionControl(),
      api.missionApprovals().catch(() => ({})),
      api.missionRelations().catch(() => ({})),
      api.missionConflicts().catch(() => ({})),
    ]);
    missionProjection.value = nextMission;
    approvals.value = nextApprovals;
    relations.value = nextRelations;
    conflicts.value = nextConflicts;
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
        <h1>{{ t('page.mission.control.page.text.5ac12b00e1') }}</h1>
        <p>{{ t('page.mission.control.page.text.f7b12477b7') }}</p>
      </div>
      <div class="chat-top-actions">
        <label class="mode-switch" :title="t('page.mission.control.page.title.1d58605a7b')">
          <button type="button" :class="{ active: showFullTrace }" @click="showFullTrace = true; refreshSelectedSession()">{{ t('page.mission.control.page.text.3c1abbcbcf') }}</button>
          <button type="button" :class="{ active: !showFullTrace }" @click="showFullTrace = false; refreshSelectedSession()">{{ t('page.mission.control.page.text.f0c3c77173') }}</button>
        </label>
        <button class="ghost-action" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="16" />{{ t('page.mission.control.page.text.8364cc9fa6') }}</button>
        <button class="ghost-action" type="button" @click="dispatchSessions">{{ t('page.mission.control.page.text.6b851c1b61') }}</button>
        <button class="ghost-action" type="button" @click="previewStewardship">{{ t('page.mission.control.page.text.a14649984f') }}</button>
        <button class="ghost-action" type="button" @click="previewRecovery">{{ t('page.mission.control.page.text.ac15490f40') }}</button>
      </div>
    </header>

    <div v-if="error" class="file-error">{{ error }}</div>

    <div class="metric-row tools-metrics" data-section="overview">
      <article class="metric-card">
        <span>{{ t('page.mission.control.page.text.3ca3f069de') }}</span>
        <strong>{{ sessions.length }}</strong>
        <small>{{ mission.active_session_id || activeSession || t('page.mission.control.page.inline.e68413410a') }}</small>
      </article>
      <article class="metric-card">
        <span>{{ t('page.mission.control.page.text.e9a0adf323') }}</span>
        <strong>{{ teams.length }} / {{ agents.length }}</strong>
        <small>{{ t('page.mission.control.page.text.281dd561ad') }}</small>
      </article>
      <article class="metric-card">
        <span>{{ t('page.mission.control.page.text.79a658d351') }}</span>
        <strong>{{ stewardRows.length }}</strong>
        <small>{{ t('page.mission.control.page.text.81e193588a') }}</small>
      </article>
      <article class="metric-card" :data-tone="pendingApprovals.length ? 'warn' : 'success'">
        <span>{{ t('page.mission.control.page.text.ba7c90b793') }}</span>
        <strong>{{ pendingApprovals.length }}</strong>
        <small>{{ t('page.mission.control.page.text.3d3e8b0be9') }}</small>
      </article>
      <article class="metric-card">
        <span>{{ t('page.mission.control.page.text.98e1681877') }}</span>
        <strong>{{ commandSummary.total || sessionCommands.length }}</strong>
        <small>{{ t('page.mission.control.summary.commandStates', { pending: commandSummary.pending || 0, running: commandSummary.running || 0 }) }}</small>
      </article>
    </div>

    <div class="clean-counts" data-section="overview">
      <span><strong>{{ cleanCounters.tools }}</strong>{{ t('page.mission.control.page.text.d9eab38096') }}</span>
      <span><strong>{{ cleanCounters.memory }}</strong>{{ t('page.mission.control.page.text.0910f37f8f') }}</span>
      <span><strong>{{ relationCount }}</strong>{{ t('unit.relations') }}</span>
      <span><strong>{{ workgraphRows.length }}</strong>{{ t('page.mission.control.runtimeV2.workgraph') }}</span>
      <span><strong>{{ conflictItems.length }}</strong>{{ t('page.mission.control.runtimeV2.conflicts') }}</span>
      <span><strong>{{ cleanCounters.commands }}</strong>{{ t('unit.commands') }}</span>
    </div>

    <div class="mission-grid">
      <section class="mission-panel governed-wide" data-section="overview">
        <header>
          <h2>{{ t('page.mission.control.page.text.658886936e') }}</h2>
          <span>{{ t('page.mission.control.page.text.5e7c8e4b54') }}</span>
        </header>
        <div class="mission-preview-grid">
          <MissionActionPreview
            :title="t('page.mission.control.page.title.f3a4686d1d')"
            action="Claim or start pending session commands through Mission Runtime."
            :target="activeSession || 'all sessions'"
            :affected="dispatchPreview.affected"
            :expected="dispatchPreview.expected"
            :risk="dispatchPreview.risk"
            :approval="dispatchPreview.approval"
          />
          <MissionActionPreview
            :title="t('page.mission.control.page.title.94a752af20')"
            action="Tick delegated stewards and collect handoff state before execution."
            :target="stewardRows[0]?.id || stewardRows[0]?.steward_id || 'scheduler'"
            :affected="stewardPreview.affected"
            :expected="stewardPreview.expected"
            :risk="stewardPreview.risk"
            :approval="stewardPreview.approval"
            :source="schedulerState ? 'backend scheduler state' : 'frontend projection preview'"
          />
          <MissionActionPreview
            :title="t('page.mission.control.page.title.96c5455ed4')"
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
          <button class="ghost-action" type="button" @click="dispatchSessions">{{ t('page.mission.control.page.text.526c2cd14f') }}</button>
          <button class="ghost-action" type="button" @click="previewStewardship">{{ t('page.mission.control.page.text.673c612f9e') }}</button>
          <button class="primary-action" type="button" @click="tickStewards">{{ t('page.mission.control.page.text.f9b5c5c5ae') }}</button>
          <button class="ghost-action" type="button" @click="previewRecovery">{{ t('page.mission.control.page.text.281d341bb5') }}</button>
          <button class="danger-action" type="button" :disabled="!recoveryReport" @click="applyRecovery">{{ t('page.mission.control.page.text.56ca46aeea') }}</button>
        </div>
        <RequestReceipt v-if="schedulerState" :receipt="schedulerState" :title="t('page.mission.control.page.title.7b05b80c41')" />
        <RawPayload v-if="stewardHandoff" :title="t('page.mission.control.page.title.59f468683e')" :data="stewardHandoff" />
        <RequestReceipt v-if="recoveryReport" :receipt="recoveryReport" :title="t('page.mission.control.page.title.7590b53f8e')" />
      </section>

      <section class="mission-panel" data-section="sessions">
        <header>
          <h2>{{ t('page.mission.control.page.text.3ca3f069de') }}</h2>
          <span>{{ activeSession || t('page.mission.control.page.inline.54b8982e68') }}</span>
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
            <span>{{ session.id }} · {{ displayStatus(session.status) }} · teams {{ session.teams }} · agents {{ session.agents }}</span>
          </button>
          <p v-if="!sessionRows.length" class="empty-note">{{ t('page.mission.control.page.text.9c6452b08a') }}</p>
        </div>
      </section>

      <section class="mission-panel" data-section="teams">
        <header>
          <h2>{{ t('page.mission.control.page.text.5901596e99') }}</h2>
          <StatusPill :status="activeSession ? 'ready' : 'idle'" />
        </header>
        <label class="field-line">
          {{ t('template.pages.missioncontrolpage.50c8920b8d') }}
          <textarea v-model="teamObjective" rows="4" />
        </label>
        <button class="primary-action" type="button" :disabled="!activeSession || !teamObjective.trim()" @click="startTeam">
          <Users :size="16" />{{ t('page.mission.control.page.text.978a4ee277') }}</button>
      </section>

      <section class="mission-panel" data-section="teams">
        <header>
          <h2>{{ t('page.mission.control.page.text.ed040118e2') }}</h2>
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
            <span>{{ displayStatus(team.status) }} · agents {{ team.agents }} · synthesis {{ displayStatus(team.synthesis) }}</span>
          </button>
          <p v-if="!teamRunRows.length" class="empty-note">{{ t('page.mission.control.page.text.f0c708899b') }}</p>
        </div>
        <label class="field-line">
          {{ t('template.pages.missioncontrolpage.da796fa714') }}
          <textarea v-model="teamHandoffNote" rows="3" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" :disabled="!selectedTeamId" @click="tickSelectedTeam">{{ t('page.mission.control.page.text.d1e9e2d114') }}</button>
          <button class="primary-action" type="button" :disabled="!selectedTeamId" @click="synthesizeSelectedTeam">{{ t('page.mission.control.page.text.359d792ff9') }}</button>
          <button class="ghost-action" type="button" :disabled="!selectedTeamId" @click="handoffSelectedTeam">{{ t('page.mission.control.page.text.347108bf3d') }}</button>
          <button class="danger-action" type="button" :disabled="!selectedTeamId" @click="cancelSelectedTeam">{{ t('page.mission.control.page.text.ed848a3a21') }}</button>
        </div>
        <RawPayload v-if="teamRunDetail?.run || teamRunDetail?.summary" :title="t('page.mission.control.page.title.026a2c3405')" :data="teamRunDetail" />
      </section>

      <section class="mission-panel" data-section="agents">
        <header>
          <h2>{{ t('capability.section.mission.agents.label') }}</h2>
          <span>{{ formatCount('agents', agentRows.length) }}</span>
        </header>
        <DataTable
          v-if="agentRows.length"
          searchable
          selectable
          copyable
          row-key="id"
          :rows="agentRows"
          :columns="['id', 'role', 'status', 'session', 'team', 'summary']"
        />
        <p v-else class="empty-note">{{ t('capability.section.mission.agents.description') }}</p>
      </section>

      <section class="mission-panel" data-section="routes">
        <header>
          <h2>{{ t('page.mission.control.page.text.eb5e456863') }}</h2>
          <StatusPill :status="routeTarget ? 'ready' : 'idle'" />
        </header>
        <label class="field-line">
          {{ t('template.pages.missioncontrolpage.6c723ce0e4') }}
          <input v-model="routeTarget" :placeholder="t('page.mission.control.page.placeholder.e8b21a9b4a')" />
        </label>
        <label class="field-line">
          {{ t('template.pages.missioncontrolpage.8901895fb1') }}
          <textarea v-model="routeCommand" rows="3" />
        </label>
        <button class="ghost-action" type="button" :disabled="!routeTarget.trim() || !routeCommand.trim()" @click="routeToSession">
          <Route :size="16" />{{ t('page.mission.control.page.text.7dd0114f4f') }}</button>
      </section>

      <section class="mission-panel governed-wide" data-section="runtime-v2">
        <header>
          <h2>{{ t('page.mission.control.runtimeV2.title') }}</h2>
          <StatusPill :status="missionHealth.status || (conflictItems.length ? 'degraded' : 'ready')" />
        </header>
        <div class="button-row">
          <span class="mini-chip"><Workflow :size="14" />{{ t('page.mission.control.runtimeV2.workgraph') }} {{ workgraphRows.length }}</span>
          <span class="mini-chip"><AlertTriangle :size="14" />{{ t('page.mission.control.runtimeV2.conflicts') }} {{ conflictItems.length }}</span>
          <span class="mini-chip"><Database :size="14" />{{ t('page.mission.control.runtimeV2.evidence') }} {{ missionEvidenceRows.length }}</span>
        </div>
        <DataTable
          v-if="workgraphRows.length"
          searchable
          copyable
          row-key="graph"
          :rows="workgraphRows"
          :columns="['team', 'graph', 'nodes', 'edges', 'ready', 'blocked', 'parallelism']"
        />
        <DataTable
          v-if="conflictItems.length"
          searchable
          copyable
          row-key="id"
          :rows="conflictItems"
          :columns="['id', 'source', 'severity', 'decision', 'summary']"
        />
        <DataTable
          v-if="actionContractRows.length"
          searchable
          copyable
          row-key="action"
          :rows="actionContractRows"
          :columns="['action', 'tool', 'use', 'projection']"
        />
        <p v-if="!workgraphRows.length && !conflictItems.length && !actionContractRows.length" class="empty-note">{{ t('page.mission.control.runtimeV2.empty') }}</p>
      </section>
    </div>

    <div class="mission-grid lower">
      <section class="mission-panel wide" data-section="inbox">
        <header>
          <h2>{{ t('page.mission.control.page.text.38c0d91903') }}</h2>
          <span>{{ selectedSession.title || selectedSessionId || activeSession }}</span>
        </header>
        <div class="mission-command-list">
          <article v-for="command in sessionCommands" :key="command.command_id" class="activity-item">
            <div>
              <strong>{{ command.kind || t('page.mission.control.fallback.command') }} · {{ displayStatus(command.status) }}</strong>
              <p>{{ command.command }}</p>
              <small>{{ command.command_id }} · {{ t('page.mission.control.command.from', { source: command.from_session_id || '-' }) }}</small>
            </div>
            <div class="button-row">
              <button class="icon-action" :title="t('page.mission.control.action.claim')" type="button" @click="consumeCommand(command.command_id)">
                <Inbox :size="15" />
              </button>
              <button class="icon-action" :title="t('page.mission.control.page.title.f9e851ae97')" type="button" @click="consumeCommand(command.command_id, 'start_turn')">
                <Play :size="15" />
              </button>
              <button class="icon-action" :title="t('page.mission.control.action.retry')" type="button" @click="retryCommand(command.command_id)">
                <GitBranch :size="15" />
              </button>
              <button class="danger-action" :title="t('page.mission.control.action.cancel')" type="button" @click="cancelCommand(command.command_id)">
                <Square :size="15" />
              </button>
            </div>
          </article>
          <p v-if="!sessionCommands.length" class="empty-note">{{ t('page.mission.control.page.text.85c2cc0a2c') }}</p>
        </div>
      </section>

      <section class="mission-panel" data-section="approvals">
        <header>
          <h2>{{ t('page.mission.control.page.text.ba7c90b793') }}</h2>
          <StatusPill :status="pendingApprovals.length ? 'blocked' : 'ready'" />
        </header>
        <article v-for="approval in pendingApprovals" :key="approval.approval_id || approval.id" class="approval-row">
          <span>{{ approval.summary || approval.action || approval.command }} · {{ approval.session_id || approval.agent_id || approval.tool || 'mission' }} · {{ displayStatus(approval.risk || 'policy') }}</span>
          <button class="ghost-action" type="button" @click="decideApproval(approval.approval_id || approval.id, true)">
            <CheckCircle2 :size="15" />{{ t('page.mission.control.page.text.d282699e33') }}</button>
          <button class="danger-action" type="button" @click="decideApproval(approval.approval_id || approval.id, false)">
            <ShieldCheck :size="15" />{{ t('page.mission.control.page.text.3784408abf') }}</button>
        </article>
        <p v-if="!pendingApprovals.length" class="empty-note">{{ t('page.mission.control.page.text.77f4b7d8e5') }}</p>
      </section>
    </div>

    <section v-if="showFullTrace" class="mission-panel trace-panel" data-section="trace">
      <header>
        <h2>{{ t('page.mission.control.page.text.c54e2b4723') }}</h2>
        <span>{{ formatCount('records', evidenceRows.length) }}</span>
      </header>
      <div class="evidence-list">
        <article v-for="item in evidenceRows" :key="`${item.source}-${item.kind}-${item.summary}`" class="evidence-item">
          <strong>{{ item.source }} · {{ item.kind }} · {{ displayStatus(item.status) }}</strong>
          <p>{{ item.summary }}</p>
        </article>
        <p v-if="!evidenceRows.length" class="empty-note">{{ t('page.mission.control.page.text.4c14c2f5a7') }}</p>
      </div>
    </section>

    <RequestReceipt v-if="actionResult" :receipt="actionResult" />
    <RawPayload :title="t('page.mission.control.page.title.7ac6ef49a7')" :data="missionProjection" />
  </section>
</template>
