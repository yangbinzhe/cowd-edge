<script setup lang="ts">
import { useCapabilitySection } from "../composables/useCapabilitySection";
const { isSectionActive } = useCapabilitySection();
import { formatCount, t } from '../i18n';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  AlertTriangle, CheckCircle2, Database, RefreshCw, Route,
  ShieldCheck, Square, Users, Workflow,
} from 'lucide-vue-next';
import { api } from '../api/client';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import DataTable from '../components/workbench/DataTable.vue';
import MissionActionPreview from '../components/workbench/MissionActionPreview.vue';
import ExecutionGraphCanvas from '../components/mission/ExecutionGraphCanvas.vue';
import { useAppStore } from '../stores/app';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import { displayStatus } from '../i18n/domain/status';

const store = useAppStore();
const projections = useProjectionRegistryStore();
const loading = ref(false);
const error = ref('');
const showFullTrace = ref(true);
const selectedSessionId = ref('');
const selectedTeamId = ref('');
const selectedExecutionId = ref('');
const teamObjective = ref(t('page.mission.control.team.objectiveDefault'));
const routeTarget = ref('');
const routeCommand = ref(t('page.mission.control.route.commandDefault'));
const missionProjection = ref<any>({});
const approvals = ref<any>({});
const relations = ref<any>({});
const conflicts = ref<any>({});
const sessionDetail = ref<any>({});
const timeline = ref<any>({});
const realityFlow = ref<any>({});
const actionResult = ref<any>(null);
const recoveryReport = ref<any>(null);
const teamRunDetail = ref<any>({});
const selectedExecutionNode = ref<any>(null);
const controlProjection = computed(() => missionProjection.value?.projection || missionProjection.value || {});

const mission = computed(() => controlProjection.value?.mission || missionProjection.value?.mission || {});
const sessions = computed(() => Array.isArray(mission.value?.sessions) ? mission.value.sessions : []);
const missionSessionIds = computed(() => new Set(sessions.value
  .map((session: any) => String(session.session_id || session.id || '').trim())
  .filter(Boolean)));
const declaredActiveSessionId = computed(() => String(mission.value?.active_session_id || '').trim());
const activeSession = computed(() => {
  if (selectedSessionId.value && missionSessionIds.value.has(selectedSessionId.value)) return selectedSessionId.value;
  if (declaredActiveSessionId.value && missionSessionIds.value.has(declaredActiveSessionId.value)) return declaredActiveSessionId.value;
  return '';
});
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
const relationCount = computed(() => controlProjection.value?.relations?.relation_count || relations.value?.relations?.relation_count || mission.value?.relation_projection?.relation_count || 0);
const relationRows = computed(() => {
  const source = controlProjection.value?.relations || relations.value?.relations || mission.value?.relation_projection || {};
  const rows = source?.relations || [];
  return Array.isArray(rows) ? rows.map((relation: any) => ({
    id: relation.relation_id || relation.id || '-',
    from: relation.from_session_id || '-',
    to: relation.to_session_id || '-',
    kind: relation.kind || '-',
    summary: relation.summary || '-',
  })) : [];
});
const executionGraphCatalog = computed(() => controlProjection.value?.execution_graphs || mission.value?.execution_graph_projection || {});
const executionGraphRows = computed(() => {
  const rows = executionGraphCatalog.value?.execution_graphs || [];
  return Array.isArray(rows) ? rows.slice(0, 12).map((row: any) => ({
    team: row.parent_execution?.parent_execution_id || '-',
    graph: row.graph_id || '-',
    nodes: Array.isArray(row.nodes) ? row.nodes.length : 0,
    edges: Array.isArray(row.edges) ? row.edges.length : 0,
    ready: Array.isArray(row.nodes) ? row.nodes.filter((node: any) => ['ready', 'planned'].includes(String(node.status))).length : 0,
    blocked: Array.isArray(row.nodes) ? row.nodes.filter((node: any) => ['blocked', 'failed', 'error'].includes(String(node.status))).length : 0,
    parallelism: Array.isArray(row.nodes) ? row.nodes.filter((node: any) => String(node.status) === 'running').length : 0,
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
const controlReadiness = computed(() => controlProjection.value?.control_readiness || mission.value?.control_readiness || {});
const controlReadinessRows = computed(() => {
  const rows = controlReadiness.value?.actions || [];
  return Array.isArray(rows) ? rows.map((row: any) => ({
    action: row.action || '-',
    status: row.available ? 'ready' : 'blocked',
    reason: row.reason || '-',
    approval: row.requires_approval ? 'required' : 'not_required',
    targets: row.target_count ?? 0,
    policy: row.policy_marker || '-',
  })) : [];
});
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
  handoffs: relationCount.value,
}));
const executionProjection = computed(() => selectedExecutionId.value ? projections.projectionFor(selectedExecutionId.value) : null);
const executionGraph = computed(() => executionProjection.value?.graph || null);
const executionCommandRows = computed(() => executionProjection.value?.available_commands || []);
const executionNodeRows = computed(() => (executionProjection.value?.graph?.nodes || []).map((node: any) => ({
  id: node.node_id || '-',
  kind: node.kind || '-',
  status: node.status || '-',
  executor: node.executor_kind || '-',
  evidence: Array.isArray(node.evidence_refs) ? node.evidence_refs.length : 0,
})));
const canonicalRelationRows = computed(() => (executionProjection.value?.relations || []).map((relation: any) => ({
  id: relation.id || '-',
  status: relation.status || '-',
  summary: relation.summary || '-',
  evidence: Array.isArray(relation.evidence_refs) ? relation.evidence_refs.length : 0,
})));
const canonicalApprovalRows = computed(() => (executionProjection.value?.approvals || []).map((approval: any) => ({
  id: approval.id || '-',
  status: approval.status || '-',
  summary: approval.summary || '-',
  evidence: Array.isArray(approval.evidence_refs) ? approval.evidence_refs.length : 0,
})));
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
const recoveryPreview = computed(() => {
  const candidates = recoveryReport.value?.candidates || recoveryReport.value?.report?.candidates || recoveryReport.value?.plan?.candidates || [];
  const gaps = candidates.length ? candidates : (recoveryReport.value?.gaps || recoveryReport.value?.replay_gaps || recoveryReport.value?.report?.gaps || []);
  const affected = Array.isArray(gaps)
    ? gaps.slice(0, 8).map((gap: any) => gap.session_id || gap.source_stream_id || gap.stream_id || gap.id || gap.kind || 'gap')
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
    if (!selectedSessionId.value && declaredActiveSessionId.value && missionSessionIds.value.has(declaredActiveSessionId.value)) {
      selectedSessionId.value = declaredActiveSessionId.value;
    }
    if (selectedSessionId.value && !missionSessionIds.value.has(selectedSessionId.value)) selectedSessionId.value = '';
    if (!selectedTeamId.value) selectedTeamId.value = teamRunRows.value[0]?.id || '';
    const executionId = executionGraphRows.value[0]?.graph;
    if (executionId && executionId !== '-') {
      selectedExecutionId.value = String(executionId);
      projections.acquire(selectedExecutionId.value, 'mission', 'full');
    }
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
  ];
  if (showFullTrace.value) {
    requests.push(api.runtimeTimeline(sessionId), api.realityFlow(sessionId, 80));
  }
  const [detail, nextTimeline, nextReality] = await Promise.all(requests);
  sessionDetail.value = detail;
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
  }
  await refresh();
}

async function loadTeamRun(teamId = selectedTeamId.value) {
  if (!teamId) return;
  selectedTeamId.value = teamId;
  teamRunDetail.value = await api.collaborationRun(teamId);
  const executionId = teamRunDetail.value?.execution_graph_id
    || teamRunDetail.value?.graph_id
    || teamRunDetail.value?.run?.execution_graph_id
    || teamRunDetail.value?.run?.graph_id;
  if (executionId) {
    selectedExecutionId.value = String(executionId);
    projections.acquire(selectedExecutionId.value, 'mission', 'full');
  }
}

async function cancelSelectedTeam() {
  if (!selectedTeamId.value) return;
  actionResult.value = await api.cancelTeamRuntime(selectedTeamId.value);
  await refresh();
}

async function routeToSession() {
  if (!activeSession.value || !routeTarget.value.trim() || !routeCommand.value.trim()) return;
  actionResult.value = await api.interpretMissionCommand({
    current_session_id: activeSession.value,
    target_ref: routeTarget.value.trim().replace(/^@/, ''),
    command_text: routeCommand.value.trim(),
    execute: true,
  });
  await refresh();
}

async function decideApproval(approvalId: string, approved: boolean) {
  actionResult.value = await api.decideMissionApproval(approvalId, approved, approved ? 'approved from Mission Control' : 'denied from Mission Control');
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

async function executeProjectionCommand(command: string) {
  if (!selectedExecutionId.value) return;
  actionResult.value = await projections.executeCommand(selectedExecutionId.value, command);
  await refresh();
}

function executionCommandLabel(command: string) {
  const labels: Record<string, string> = {
    pause: t('runtime.execution.command.pause'),
    resume: t('runtime.execution.command.resume'),
    cancel: t('runtime.execution.command.cancel'),
    replan: t('runtime.execution.command.replan'),
  };
  return labels[command] || command;
}

onMounted(refresh);
onUnmounted(() => projections.release('mission'));
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
        <button class="ghost-action" type="button" @click="previewRecovery">{{ t('page.mission.control.page.text.ac15490f40') }}</button>
      </div>
    </header>

    <div v-if="error" class="file-error">{{ error }}</div>

    <div class="metric-row tools-metrics" v-show="isSectionActive('overview')" data-section="overview">
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
        <span>{{ t('unit.relations') }}</span>
        <strong>{{ relationCount }}</strong>
        <small>{{ t('page.mission.control.page.text.81e193588a') }}</small>
      </article>
      <article class="metric-card" :data-tone="pendingApprovals.length ? 'warn' : 'success'">
        <span>{{ t('page.mission.control.page.text.ba7c90b793') }}</span>
        <strong>{{ pendingApprovals.length }}</strong>
        <small>{{ t('page.mission.control.page.text.3d3e8b0be9') }}</small>
      </article>
      <article class="metric-card">
        <span>{{ t('page.mission.control.runtimeV2.executionGraph') }}</span>
        <strong>{{ executionGraphRows.length }}</strong>
        <small>{{ t('page.mission.control.runtimeV2.title') }}</small>
      </article>
    </div>

    <div class="clean-counts" v-show="isSectionActive('overview')" data-section="overview">
      <span><strong>{{ cleanCounters.tools }}</strong>{{ t('page.mission.control.page.text.d9eab38096') }}</span>
      <span><strong>{{ cleanCounters.memory }}</strong>{{ t('page.mission.control.page.text.0910f37f8f') }}</span>
      <span><strong>{{ relationCount }}</strong>{{ t('unit.relations') }}</span>
      <span><strong>{{ executionGraphRows.length }}</strong>{{ t('page.mission.control.runtimeV2.executionGraph') }}</span>
      <span><strong>{{ conflictItems.length }}</strong>{{ t('page.mission.control.runtimeV2.conflicts') }}</span>
      <span><strong>{{ cleanCounters.handoffs }}</strong>{{ t('unit.relations') }}</span>
    </div>

    <div class="mission-grid">
      <section class="mission-panel governed-wide" v-show="isSectionActive('overview')" data-section="overview">
        <header>
          <h2>{{ t('page.mission.control.page.text.658886936e') }}</h2>
          <span>{{ t('page.mission.control.page.text.5e7c8e4b54') }}</span>
        </header>
        <div class="mission-preview-grid">
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
        <DataTable
          v-if="controlReadinessRows.length"
          searchable
          copyable
          row-key="action"
          :rows="controlReadinessRows"
          :columns="['action', 'status', 'reason', 'approval', 'targets', 'policy']"
        />
        <div class="button-row">
          <button class="ghost-action" type="button" @click="previewRecovery">{{ t('page.mission.control.page.text.281d341bb5') }}</button>
          <button class="danger-action" type="button" :disabled="!recoveryReport" @click="applyRecovery">{{ t('page.mission.control.page.text.56ca46aeea') }}</button>
        </div>
        <ExecutionGraphCanvas
          :graph="executionGraph"
          :selected-node-id="String(selectedExecutionNode?.node_id || '')"
          :connection-state="selectedExecutionId ? projections.stateFor(selectedExecutionId) : 'idle'"
          @select="selectedExecutionNode = $event"
        />
        <div v-if="executionCommandRows.length" class="button-row" :aria-label="t('runtime.execution.commandGroup')">
          <button
            v-for="command in executionCommandRows"
            :key="command.command"
            class="ghost-action"
            type="button"
            :disabled="!command.available"
            @click="executeProjectionCommand(command.command)"
          >{{ executionCommandLabel(command.command) }}</button>
        </div>
        <dl v-if="selectedExecutionNode" class="detail-list">
          <dt>{{ t('runtime.execution.node.field.node') }}</dt><dd>{{ selectedExecutionNode.node_id }}</dd>
          <dt>{{ t('runtime.execution.node.field.status') }}</dt><dd>{{ displayStatus(selectedExecutionNode.status || 'planned') }}</dd>
          <dt>{{ t('runtime.execution.node.field.executor') }}</dt><dd>{{ selectedExecutionNode.executor_kind || '-' }}</dd>
          <dt>{{ t('runtime.execution.node.field.evidence') }}</dt><dd>{{ selectedExecutionNode.evidence_refs?.length || 0 }}</dd>
          <dt>{{ t('runtime.execution.node.field.usage') }}</dt><dd>{{ formatCount('tokens', Number(selectedExecutionNode.usage?.input_tokens || 0) + Number(selectedExecutionNode.usage?.output_tokens || 0)) }} · {{ selectedExecutionNode.usage?.tool_calls || 0 }} {{ t('runtime.execution.node.tools') }}</dd>
          <dt v-if="selectedExecutionNode.result_ref">{{ t('runtime.execution.node.field.result') }}</dt><dd v-if="selectedExecutionNode.result_ref">{{ selectedExecutionNode.result_ref }}</dd>
        </dl>
        <RequestReceipt v-if="recoveryReport" :receipt="recoveryReport" :title="t('page.mission.control.page.title.7590b53f8e')" />
        <RequestReceipt v-if="actionResult" :receipt="actionResult" :title="t('runtime.execution.commandReceipt')" />
      </section>

      <section class="mission-panel" v-show="isSectionActive('sessions')" data-section="sessions">
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

      <section class="mission-panel" v-show="isSectionActive('teams')" data-section="teams">
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

      <section class="mission-panel" v-show="isSectionActive('teams')" data-section="teams">
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
        <div class="button-row">
          <button class="danger-action" type="button" :disabled="!selectedTeamId" @click="cancelSelectedTeam">{{ t('page.mission.control.page.text.ed848a3a21') }}</button>
        </div>
        <ObjectInspectorDrawer v-if="teamRunDetail?.run || teamRunDetail?.summary" :title="t('page.mission.control.page.title.026a2c3405')" :data="teamRunDetail" />
      </section>

      <section class="mission-panel" v-show="isSectionActive('agents')" data-section="agents">
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

      <section class="mission-panel" v-show="isSectionActive('routes')" data-section="routes">
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

      <section class="mission-panel governed-wide" v-show="isSectionActive('runtime-v2')" data-section="runtime-v2">
        <header>
          <h2>{{ t('page.mission.control.runtimeV2.title') }}</h2>
          <StatusPill :status="missionHealth.status || (conflictItems.length ? 'degraded' : 'ready')" />
        </header>
        <div class="button-row">
          <span class="mini-chip"><Workflow :size="14" />{{ t('page.mission.control.runtimeV2.executionGraph') }} {{ executionGraphRows.length }}</span>
          <span class="mini-chip"><AlertTriangle :size="14" />{{ t('page.mission.control.runtimeV2.conflicts') }} {{ conflictItems.length }}</span>
          <span class="mini-chip"><Database :size="14" />{{ t('page.mission.control.runtimeV2.evidence') }} {{ missionEvidenceRows.length }}</span>
        </div>
        <DataTable
          v-if="executionGraphRows.length"
          searchable
          copyable
          row-key="graph"
          :rows="executionGraphRows"
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
        <DataTable
          v-if="executionNodeRows.length"
          searchable
          copyable
          row-key="id"
          :rows="executionNodeRows"
          :columns="['id', 'kind', 'status', 'executor', 'evidence']"
        />
        <p v-if="!executionGraphRows.length && !conflictItems.length && !actionContractRows.length" class="empty-note">{{ t('page.mission.control.runtimeV2.empty') }}</p>
      </section>
    </div>

    <div class="mission-grid lower">
      <section class="mission-panel wide" v-show="isSectionActive('relations')" data-section="relations">
        <header>
          <h2>{{ t('unit.relations') }}</h2>
          <span>{{ selectedSession.title || selectedSessionId || activeSession }}</span>
        </header>
        <DataTable v-if="relationRows.length" searchable copyable row-key="id" :rows="relationRows" :columns="['id', 'from', 'to', 'kind', 'summary']" />
        <DataTable v-if="canonicalRelationRows.length" searchable copyable row-key="id" :rows="canonicalRelationRows" :columns="['id', 'status', 'summary', 'evidence']" />
        <p v-else class="empty-note">{{ t('page.mission.control.runtimeV2.empty') }}</p>
      </section>

      <section class="mission-panel" v-show="isSectionActive('approvals')" data-section="approvals">
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
        <DataTable v-if="canonicalApprovalRows.length" searchable copyable row-key="id" :rows="canonicalApprovalRows" :columns="['id', 'status', 'summary', 'evidence']" />
      </section>
    </div>

    <section v-if="showFullTrace" class="mission-panel trace-panel" v-show="isSectionActive('trace')" data-section="trace">
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
    <ObjectInspectorDrawer :title="t('page.mission.control.page.title.7ac6ef49a7')" :data="missionProjection" />
  </section>
</template>
