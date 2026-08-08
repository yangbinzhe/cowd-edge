<script setup lang="ts">
import { useCapabilitySection } from "../composables/useCapabilitySection";
const { activeSection, isSectionActive } = useCapabilitySection();
import { formatCount, t } from '../i18n';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Database, Pause, Pencil, Play, RefreshCw, Route,
  ShieldCheck, Square, Trash2, Users, Workflow, X,
} from 'lucide-vue-next';
import { api } from '../api/client';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import DataTable from '../components/workbench/DataTable.vue';
import MissionActionPreview from '../components/workbench/MissionActionPreview.vue';
import ExecutionGraphCanvas from '../components/mission/ExecutionGraphCanvas.vue';
import ExecutionTruthSummary from '../components/runtime/ExecutionTruthSummary.vue';
import StrategyDecisionSummary from '../components/runtime/StrategyDecisionSummary.vue';
import { useAppStore } from '../stores/app';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import { openLiveSource } from '../stores/liveTransport';
import type { LiveSourceLease } from '../stores/liveTransport';
import { displayStatus } from '../i18n/domain/status';
import { adaptRuntimeTimeline } from '../adapters/graph/runtimeTimeline';
import { applyMissionProjectionDelta } from '../adapters/missionProjection';
import { adaptMissionControlGraph } from '../adapters/missionControlGraph';
import type {
  MissionCommand,
  MissionControlProjection,
  MissionMaterializedSnapshot,
  MissionProjectionDelta,
} from '../types';

const store = useAppStore();
const projections = useProjectionRegistryStore();
const route = useRoute();
const loading = ref(false);
const error = ref('');
const showFullTrace = ref(false);
const selectedMissionId = ref('');
const selectedSessionId = ref('');
const selectedTeamId = ref('');
const selectedExecutionId = ref('');
const teamObjective = ref(t('page.mission.control.team.objectiveDefault'));
const routeTarget = ref('');
const routeCommand = ref(t('page.mission.control.route.commandDefault'));
const missionSnapshot = ref<MissionMaterializedSnapshot | null>(null);
const approvals = ref<any>({});
const relations = ref<any>({});
const conflicts = ref<any>({});
const sessionDetail = ref<any>({});
const timeline = ref<any>({});
const realityFlow = ref<any>({});
const actionResult = ref<any>(null);
const recoveryReport = ref<any>(null);
const teamRunDetail = ref<any>({});
const teamExecutionPlan = ref<any>({});
const teamEvidence = ref<any>({});
const teamDetailLoading = ref(false);
const teamDetailError = ref('');
const scheduleResponse = ref<any>({});
const scheduleTriggerKind = ref<'interval' | 'at' | 'cron'>('interval');
const scheduleObjective = ref('');
const scheduleIntervalMinutes = ref(60);
const scheduleAt = ref('');
const scheduleCron = ref('0 0 9 * * *');
const scheduleTimezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
const schedulePermission = ref('read-only');
const scheduleBusyId = ref('');
const editingScheduleId = ref('');
const editingScheduleRevision = ref(0);
const selectedExecutionNode = ref<any>(null);
const selectedTraceEvidence = ref<Record<string, unknown> | null>(null);
const selectedTaskDetail = ref<any>(null);
const taskAssignmentTarget = ref('');
const taskAssignmentPreview = ref<any>(null);
const taskAssignmentBusy = ref(false);
let missionLiveSource: LiveSourceLease | null = null;
const loadedAuxiliarySections = new Set<string>();
const controlProjection = computed<MissionControlProjection | Record<string, never>>(
  () => missionSnapshot.value?.projection || {},
);

const missions = computed(() => Array.isArray(controlProjection.value?.missions)
  ? controlProjection.value.missions
  : []);
const mission = computed<any>(() => controlProjection.value?.mission || {});
const sessions = computed(() => Array.isArray(controlProjection.value?.sessions)
  ? controlProjection.value.sessions
  : []);
const tasks = computed(() => Array.isArray(controlProjection.value?.tasks)
  ? controlProjection.value.tasks
  : []);
const organizationDecisions = computed(() => Array.isArray((controlProjection.value as any)?.organization_decisions)
  ? (controlProjection.value as any).organization_decisions
  : []);
const missionSessionIds = computed(() => new Set(sessions.value
  .map((session: any) => String(session.session_id || session.id || '').trim())
  .filter(Boolean)));
const declaredActiveSessionId = computed(() => String(
  controlProjection.value?.workspace?.active_session_id
  || controlProjection.value?.summary?.active_session_id
  || '',
).trim());
const routedSessionId = computed(() => typeof route.query.session_id === 'string'
  ? route.query.session_id.trim()
  : '');
const activeSession = computed(() => {
  if (routedSessionId.value) return routedSessionId.value;
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
const events = computed(() => Array.isArray(controlProjection.value?.event_digest?.latest)
  ? controlProjection.value.event_digest.latest
  : []);
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
const scheduleProjection = computed(() => scheduleResponse.value?.schedules || {});
const schedules = computed<any[]>(() => Array.isArray(scheduleProjection.value?.schedules)
  ? scheduleProjection.value.schedules
  : []);
const scheduleFires = computed<any[]>(() => Array.isArray(scheduleProjection.value?.fires)
  ? scheduleProjection.value.fires
  : []);
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
  const runtimeEvents = adaptRuntimeTimeline(Array.isArray(timeline.value?.events) ? timeline.value.events : []);
  const realityEvents = Array.isArray(realityFlow.value?.events) ? realityFlow.value.events : [];
  return [
    ...events.value.slice(0, 8).map((event: any) => ({
      source: 'mission',
      kind: event.event_type || event.kind || event.type || '-',
      status: event.status || '-',
      summary: event.message || event.summary || event.session_id || '-',
    })),
    ...runtimeEvents.slice(0, 8).map((event) => ({
      source: event.domain,
      kind: event.title,
      status: event.status,
      summary: event.detail,
      raw: event.raw,
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
const missionAggregateGraph = computed(() => adaptMissionControlGraph(
  controlProjection.value as MissionControlProjection,
  executionProjection.value ? [executionProjection.value] : [],
));
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
  teams: Number(session.team_count || 0),
  agents: Number(session.agent_count || 0),
})));
const taskRows = computed(() => tasks.value.map((task: any) => ({
  id: task.task_id || '-',
  status: task.status || '-',
  kind: task.kind || '-',
  session: task.origin_session_id || '-',
  objective: task.objective || '-',
  turns: Number(task.turn_count || 0),
  assignment: task.assignment_source || '-',
  graphs: Number(task.graph_count || 0),
  failures: Number(task.failure_count || 0),
  raw: task,
})));
const organizationRows = computed(() => organizationDecisions.value.map((decision: any) => ({
  id: decision.decision_id || '-',
  status: decision.status || '-',
  action: decision.action || '-',
  tasks: Array.isArray(decision.task_ids) ? decision.task_ids.length : 0,
  candidates: Number(decision.candidate_count || 0),
  provider: decision.provider_invoked ? (decision.provider_model || 'provider') : 'deterministic',
  elapsed: `${Number(decision.elapsed_ms || 0)} ms`,
  reason: decision.reason || decision.rejected_reason || '-',
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
const requestedAgentId = computed(() => typeof route.query.agent_id === 'string'
  ? route.query.agent_id.trim()
  : '');
const agentRows = computed(() => agents.value.map((agent: any) => ({
  id: agent.agent_id || agent.id || agent.name || '-',
  role: agent.role || agent.kind || agent.profile || '-',
  status: agent.status || agent.lifecycle || '-',
  session: agent.session_id || agent.active_session_id || activeSession.value || '-',
  team: agent.team_id || agent.active_team_id || '-',
  summary: agent.summary || agent.objective || agent.last_message || agent.name || '-',
})).sort((left: any, right: any) => {
  if (left.id === requestedAgentId.value) return -1;
  if (right.id === requestedAgentId.value) return 1;
  return String(left.id).localeCompare(String(right.id));
}).slice(0, 24));
const focusedAgent = computed(() => agentRows.value.find((agent: any) => agent.id === requestedAgentId.value) || null);
function selectExecutionProjection(executionId: unknown) {
  const next = typeof executionId === 'string' ? executionId.trim() : '';
  if (!next || next === '-') {
    selectedExecutionId.value = '';
    projections.release('mission');
    return;
  }
  selectedExecutionId.value = next;
  projections.acquire(next, 'mission', 'full', 'bounded', activeSession.value);
}
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
  const requestedExecutionId = typeof route.query.execution_id === 'string'
    ? route.query.execution_id.trim()
    : '';
  // Execution deep links are an independent canonical projection. Acquire
  // them before loading Mission dashboard auxiliaries so one aborted
  // best-effort read cannot hide a valid execution strategy.
  if (requestedExecutionId) selectExecutionProjection(requestedExecutionId);
  try {
    const nextMission = await api.missionControl(selectedMissionId.value);
    missionSnapshot.value = nextMission.snapshot;
    selectedMissionId.value = String(
      nextMission.snapshot?.projection?.selected_mission_id
      || selectedMissionId.value
      || '',
    );
    if (!selectedSessionId.value && declaredActiveSessionId.value && missionSessionIds.value.has(declaredActiveSessionId.value)) {
      selectedSessionId.value = declaredActiveSessionId.value;
    }
    if (selectedSessionId.value && !missionSessionIds.value.has(selectedSessionId.value)) selectedSessionId.value = '';
    const requestedTeamId = typeof route.query.team_id === 'string' ? route.query.team_id.trim() : '';
    if (requestedTeamId) selectedTeamId.value = requestedTeamId;
    if (!selectedTeamId.value) selectedTeamId.value = teamRunRows.value[0]?.id || '';
    const executionId = requestedExecutionId || (
      activeSection.value === 'runtime-v2' ? executionGraphRows.value[0]?.graph : ''
    );
    selectExecutionProjection(executionId);
    await refreshAuxiliarySection(activeSection.value || 'overview', true);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function refreshAuxiliarySection(section: string, force = false) {
  const sectionId = section || 'overview';
  if (!force && loadedAuxiliarySections.has(sectionId)) return;
  switch (sectionId) {
    case 'approvals':
      approvals.value = await api.missionApprovals();
      break;
    case 'relations':
    case 'routes':
      relations.value = await api.missionRelations();
      break;
    case 'runtime-v2':
      if (!selectedExecutionId.value) {
        selectExecutionProjection(executionGraphRows.value[0]?.graph);
      }
      [conflicts.value] = await Promise.all([
        api.missionConflicts(),
        refreshSelectedSession(),
      ]);
      break;
    case 'schedules':
      scheduleResponse.value = await api.missionSchedules();
      break;
    case 'sessions':
      await refreshSelectedSession();
      break;
    case 'teams':
      if (selectedTeamId.value) await loadTeamRun(selectedTeamId.value, false);
      break;
    case 'trace':
      if (!showFullTrace.value) {
        showFullTrace.value = true;
        const missionId = String(mission.value?.mission_id || '').trim();
        if (missionId) {
          missionLiveSource?.update({
            kind: 'mission',
            id: missionId,
            cursor: missionSnapshot.value?.cursor || 0,
            detail_scope: 'full',
          });
        }
      }
      await refreshSelectedSession();
      break;
    default:
      break;
  }
  loadedAuxiliarySections.add(sectionId);
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

async function selectTask(row: any) {
  const taskId = String(row?.id || row?.task_id || '').trim();
  if (!taskId || taskId === '-') return;
  selectedTaskDetail.value = await api.taskDetail(taskId);
  taskAssignmentTarget.value = selectedTaskDetail.value?.task?.mission_id || '';
  taskAssignmentPreview.value = null;
}

async function previewSelectedTaskMission() {
  const task = selectedTaskDetail.value?.task;
  if (!task?.task_id || !taskAssignmentTarget.value) return;
  taskAssignmentBusy.value = true;
  error.value = '';
  try {
    taskAssignmentPreview.value = await api.previewTaskMission(
      [task.task_id],
      taskAssignmentTarget.value,
      { [task.task_id]: Number(task.revision || 0) },
    );
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    taskAssignmentBusy.value = false;
  }
}

async function commitSelectedTaskMission() {
  const command = taskAssignmentPreview.value?.command;
  if (!command) return;
  if (!globalThis.confirm(t('page.mission.taskAssignment.confirm'))) return;
  taskAssignmentBusy.value = true;
  error.value = '';
  try {
    actionResult.value = await api.commitTaskMission(command);
    taskAssignmentPreview.value = null;
    selectedTaskDetail.value = null;
    await refresh();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    taskAssignmentBusy.value = false;
  }
}

async function startTeam() {
  if (!activeSession.value || !teamObjective.value.trim()) return;
  const commandId = `mission-team-create-${randomId()}`;
  const teamId = `team-${randomId()}`;
  const missionId = String(mission.value?.mission_id || '').trim();
  if (!missionId) {
    error.value = 'Mission projection does not expose a canonical mission_id';
    return;
  }
  const command: MissionCommand = {
    command_id: commandId,
    action: 'create',
    target: { kind: 'team', team_id: teamId },
    actor: 'webui',
    correlation_id: commandId,
    payload: {
      request_id: commandId,
      team_id: teamId,
      session_id: activeSession.value,
      mission_id: missionId,
      selection_mode: 'explicit',
      strategy_binding: null,
      template_selector: {
        kind: 'latest_stable',
        template_id: 'builtin/cowd/execute-review',
      },
      objective: teamObjective.value.trim(),
      acceptance: ['summary', 'evidence'],
      risk: null,
      role_binding_overrides: [],
      cardinality_overrides: [],
      focus_partition_plans: [],
      permission_lease: 'workspace-write',
      model_lease: 'default',
      budget_lease: null,
      managed_invocation: null,
      resource_scopes: ['workspace:read', 'workspace:write'],
    },
    evidence_refs: [],
  };
  actionResult.value = await api.missionControlCommand(command);
  const startedTeamId = actionResult.value?.data?.receipt?.result?.team_id
    || actionResult.value?.data?.receipt?.result?.team?.team_id
    || teamId;
  if (startedTeamId) {
    selectedTeamId.value = startedTeamId;
  }
  await refresh();
}

async function loadTeamRun(teamId = selectedTeamId.value, userSelected = false) {
  if (!teamId) return;
  selectedTeamId.value = teamId;
  teamDetailLoading.value = true;
  teamDetailError.value = '';
  try {
    [teamRunDetail.value, teamExecutionPlan.value, teamEvidence.value] = await Promise.all([
      api.collaborationRun(teamId),
      api.teamExecutionPlan(teamId),
      api.teamMissionEvidence(teamId),
    ]);
  } catch (reason) {
    teamDetailError.value = reason instanceof Error ? reason.message : String(reason);
    teamRunDetail.value = {};
    teamExecutionPlan.value = {};
    teamEvidence.value = {};
    return;
  } finally {
    teamDetailLoading.value = false;
  }
  const executionId = teamRunDetail.value?.execution_graph_id
    || teamRunDetail.value?.graph_id
    || teamRunDetail.value?.run?.execution_graph_id
    || teamRunDetail.value?.run?.graph_id;
  const requestedExecutionId = typeof route.query.execution_id === 'string'
    ? route.query.execution_id.trim()
    : '';
  // A deep link is the cross-Surface execution identity.  Loading ambient
  // team detail must never silently replace it; only an explicit user team
  // selection is allowed to retarget the projection.
  if (requestedExecutionId && !userSelected) {
    selectExecutionProjection(requestedExecutionId);
  } else if (executionId) {
    selectExecutionProjection(executionId);
  } else {
    selectExecutionProjection('');
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

function missionScheduleTrigger() {
  if (scheduleTriggerKind.value === 'at') {
    const atMs = new Date(scheduleAt.value).getTime();
    if (!Number.isFinite(atMs) || atMs <= Date.now()) {
      throw new Error(t('page.mission.schedules.error.future'));
    }
    return { at: { at_ms: atMs } };
  }
  if (scheduleTriggerKind.value === 'cron') {
    if (!scheduleCron.value.trim()) throw new Error(t('page.mission.schedules.error.cron'));
    return {
      cron: {
        expression: scheduleCron.value.trim(),
        timezone: scheduleTimezone.value.trim() || 'UTC',
      },
    };
  }
  const everyMs = Math.round(Number(scheduleIntervalMinutes.value) * 60_000);
  if (!Number.isFinite(everyMs) || everyMs < 1_000) {
    throw new Error(t('page.mission.schedules.error.interval'));
  }
  return { interval: { every_ms: everyMs } };
}

function resetScheduleEditor() {
  editingScheduleId.value = '';
  editingScheduleRevision.value = 0;
  scheduleObjective.value = '';
  scheduleTriggerKind.value = 'interval';
  scheduleIntervalMinutes.value = 60;
  scheduleAt.value = '';
  scheduleCron.value = '0 0 9 * * *';
  scheduleTimezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  schedulePermission.value = 'read-only';
}

function editSchedule(schedule: any) {
  editingScheduleId.value = String(schedule?.schedule_id || '');
  editingScheduleRevision.value = Number(schedule?.revision || 0);
  scheduleObjective.value = String(schedule?.objective || '');
  schedulePermission.value = String(schedule?.permission_ceiling || 'read-only');
  const trigger = schedule?.trigger || {};
  if (trigger.at) {
    scheduleTriggerKind.value = 'at';
    const at = new Date(Number(trigger.at.at_ms || 0));
    scheduleAt.value = Number.isNaN(at.getTime())
      ? ''
      : new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  } else if (trigger.cron) {
    scheduleTriggerKind.value = 'cron';
    scheduleCron.value = String(trigger.cron.expression || '');
    scheduleTimezone.value = String(trigger.cron.timezone || 'UTC');
  } else {
    scheduleTriggerKind.value = 'interval';
    scheduleIntervalMinutes.value = Math.max(1, Math.round(Number(trigger.interval?.every_ms || 60_000) / 60_000));
  }
}

async function saveSchedule() {
  error.value = '';
  const missionId = String(mission.value?.mission_id || '').trim();
  if ((!editingScheduleId.value && (!missionId || !activeSession.value)) || !scheduleObjective.value.trim()) {
    error.value = t('page.mission.schedules.error.required');
    return;
  }
  try {
    const editable = {
      objective: scheduleObjective.value.trim(),
      trigger: missionScheduleTrigger(),
      autonomy_profile: 'assisted',
      permission_ceiling: schedulePermission.value,
      priority: 64,
    };
    actionResult.value = editingScheduleId.value
      ? await api.updateMissionSchedule(editingScheduleId.value, {
          expected_revision: editingScheduleRevision.value,
          ...editable,
        })
      : await api.createMissionSchedule({
          mission_id: missionId,
          target_session_id: activeSession.value,
          ...editable,
        });
    resetScheduleEditor();
    scheduleResponse.value = await api.missionSchedules();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function controlSchedule(schedule: any, action: 'run' | 'pause' | 'resume' | 'delete') {
  const scheduleId = String(schedule?.schedule_id || '').trim();
  if (!scheduleId || scheduleBusyId.value) return;
  scheduleBusyId.value = scheduleId;
  error.value = '';
  try {
    if (action === 'run') actionResult.value = await api.runMissionSchedule(scheduleId);
    if (action === 'pause') actionResult.value = await api.pauseMissionSchedule(scheduleId);
    if (action === 'resume') actionResult.value = await api.resumeMissionSchedule(scheduleId);
    if (action === 'delete') {
      if (!globalThis.confirm(t('page.mission.schedules.confirmDelete'))) return;
      actionResult.value = await api.deleteMissionSchedule(scheduleId);
    }
    scheduleResponse.value = await api.missionSchedules();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    scheduleBusyId.value = '';
  }
}

function formatScheduleTrigger(trigger: any) {
  if (trigger?.at) {
    return `${t('page.mission.schedules.trigger.at')} · ${new Date(Number(trigger.at.at_ms || 0)).toLocaleString()}`;
  }
  if (trigger?.cron) return `${trigger.cron.expression} · ${trigger.cron.timezone}`;
  if (trigger?.interval) {
    return `${t('page.mission.schedules.trigger.interval')} · ${Math.round(Number(trigger.interval.every_ms || 0) / 60_000)} min`;
  }
  return '-';
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

function attachMissionLiveSource() {
  const missionId = String(mission.value?.mission_id || '').trim();
  if (!missionId || missionLiveSource) return;
  missionLiveSource = openLiveSource(
    {
      kind: 'mission',
      id: missionId,
      cursor: missionSnapshot.value?.cursor || 0,
      detail_scope: showFullTrace.value ? 'full' : 'summary',
    },
    {
      error: (reason) => { error.value = reason; },
      envelope: (envelope) => {
        if (envelope.source_health === 'resync_required') {
          void refresh();
          return;
        }
        if (envelope.event === 'mission_snapshot') {
          missionSnapshot.value = envelope.payload as MissionMaterializedSnapshot;
          return;
        }
        if (envelope.event === 'mission_delta') {
          if (!applyMissionDelta(envelope.payload as MissionProjectionDelta)) void refresh();
          return;
        }
      },
    },
  );
}

function applyMissionDelta(delta: MissionProjectionDelta) {
  const next = applyMissionProjectionDelta(missionSnapshot.value, delta);
  if (!next) return false;
  missionSnapshot.value = next;
  return true;
}

function randomId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function setTraceMode(enabled: boolean) {
  showFullTrace.value = enabled;
  timeline.value = {};
  realityFlow.value = {};
  const missionId = String(mission.value?.mission_id || '').trim();
  if (missionId) {
    missionLiveSource?.update({
      kind: 'mission',
      id: missionId,
      cursor: missionSnapshot.value?.cursor || 0,
      detail_scope: enabled ? 'full' : 'summary',
    });
  }
  await refreshSelectedSession();
}

async function selectMission() {
  missionLiveSource?.close();
  missionLiveSource = null;
  selectedSessionId.value = '';
  selectedTeamId.value = '';
  loadedAuxiliarySections.clear();
  selectExecutionProjection('');
  await refresh();
  attachMissionLiveSource();
}

onMounted(async () => {
  await refresh();
  attachMissionLiveSource();
});
watch(
  [() => route.query.team_id, () => route.query.execution_id, () => route.query.session_id],
  async ([teamId, executionId, sessionAuthority], previous) => {
    const previousExecutionId = previous?.[1];
    if (previous && previous[2] !== sessionAuthority) projections.release('mission');
    const requestedExecutionId = typeof executionId === 'string' ? executionId.trim() : '';
    if (requestedExecutionId) {
      selectExecutionProjection(requestedExecutionId);
    } else if (typeof previousExecutionId === 'string' && previousExecutionId.trim()) {
      // A cleared deep link is an explicit deselection, not permission to
      // retain the previous execution's strategy while Mission refreshes.
      selectExecutionProjection('');
    }
    const requestedTeamId = typeof teamId === 'string' ? teamId.trim() : '';
    if (requestedTeamId && requestedTeamId !== selectedTeamId.value) await loadTeamRun(requestedTeamId, false);
  },
);
watch(
  activeSection,
  async (section) => {
    try {
      const requestedExecutionId = typeof route.query.execution_id === 'string'
        ? route.query.execution_id.trim()
        : '';
      if (!requestedExecutionId && !['runtime-v2', 'teams'].includes(section || 'overview')) {
        selectExecutionProjection('');
      }
      await refreshAuxiliarySection(section || 'overview');
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  },
);
onUnmounted(() => {
  missionLiveSource?.close();
  missionLiveSource = null;
  projections.release('mission');
});
</script>

<template>
  <section class="capability-page mission-control-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.mission.control.page.text.5ac12b00e1') }}</h1>
        <p>{{ t('page.mission.control.page.text.f7b12477b7') }}</p>
      </div>
      <div class="chat-top-actions">
        <label v-if="missions.length > 1" class="mission-selector">
          <span class="sr-only">{{ t('page.mission.selector.label') }}</span>
          <select v-model="selectedMissionId" @change="selectMission">
            <option
              v-for="item in missions"
              :key="item.mission_id"
              :value="item.mission_id"
            >
              {{ item.objective || item.mission_id }}
            </option>
          </select>
        </label>
        <label class="mode-switch" :title="t('page.mission.control.page.title.1d58605a7b')">
          <button type="button" :class="{ active: showFullTrace }" @click="setTraceMode(true)">{{ t('page.mission.control.page.text.3c1abbcbcf') }}</button>
          <button type="button" :class="{ active: !showFullTrace }" @click="setTraceMode(false)">{{ t('page.mission.control.page.text.f0c3c77173') }}</button>
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
        <span>{{ t('unit.tasks') }}</span>
        <strong>{{ tasks.length }}</strong>
        <small>{{ formatCount('tasks', tasks.length) }}</small>
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

    <div v-show="isSectionActive('runtime-v2')" class="runtime-v2-stack" data-section="runtime-v2">
      <StrategyDecisionSummary
        v-if="executionProjection?.strategy"
        :strategy="executionProjection.strategy"
        :agents="executionProjection.agents"
        :execution-id="selectedExecutionId"
        :connection-state="selectedExecutionId ? projections.stateFor(selectedExecutionId) : 'idle'"
        surface="mission"
      />
      <ExecutionTruthSummary
        v-if="executionProjection"
        :projection="executionProjection"
        :connection-state="selectedExecutionId ? projections.stateFor(selectedExecutionId) : 'idle'"
      />
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
            :action="t('mission.recovery.action')"
            :target="activeSession || 'runtime'"
            :affected="recoveryPreview.affected"
            :expected="recoveryPreview.expected"
            :risk="recoveryPreview.risk"
            :approval="recoveryPreview.approval"
            :source="recoveryReport ? t('mission.recovery.reportVisible') : t('mission.recovery.reportRequired')"
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
          :graph="missionAggregateGraph"
          :selected-node-id="String(selectedExecutionNode?.node_id || '')"
          :connection-state="loading ? 'connecting' : 'live'"
          @select="selectedExecutionNode = $event"
        />
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

      <section class="mission-panel wide" v-show="isSectionActive('sessions')" data-section="sessions">
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
            @click="loadTeamRun(team.id, true)"
          >
            <strong>{{ team.id }}</strong>
            <span>{{ displayStatus(team.status) }} · agents {{ team.agents }} · synthesis {{ displayStatus(team.synthesis) }}</span>
          </button>
          <p v-if="!teamRunRows.length" class="empty-note">{{ t('page.mission.control.page.text.f0c708899b') }}</p>
        </div>
        <div class="button-row">
          <button class="danger-action" type="button" :disabled="!selectedTeamId" @click="cancelSelectedTeam">{{ t('page.mission.control.page.text.ed848a3a21') }}</button>
        </div>
        <p v-if="teamDetailLoading" class="empty-note">{{ t('common.loading') }}</p>
        <p v-else-if="teamDetailError" class="settings-alert">{{ teamDetailError }}</p>
        <template v-else>
          <ObjectInspectorDrawer v-if="teamRunDetail?.run || teamRunDetail?.summary" :title="t('page.mission.control.page.title.026a2c3405')" :data="teamRunDetail" />
          <ObjectInspectorDrawer v-if="Object.keys(teamExecutionPlan).length" :title="t('page.mission.team.executionPlan')" :data="teamExecutionPlan" />
          <ObjectInspectorDrawer v-if="Object.keys(teamEvidence).length" :title="t('page.mission.team.evidence')" :data="teamEvidence" />
        </template>
      </section>

      <section class="mission-panel wide" v-show="isSectionActive('agents')" data-section="agents">
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
        <dl v-if="focusedAgent" class="detail-list">
          <dt>{{ t('runtime.execution.node.field.executor') }}</dt><dd>{{ focusedAgent.id }}</dd>
          <dt>{{ t('runtime.execution.node.field.status') }}</dt><dd>{{ displayStatus(focusedAgent.status) }}</dd>
          <dt>{{ t('page.mission.control.page.text.ed040118e2') }}</dt><dd>{{ focusedAgent.team }}</dd>
          <dt>{{ t('runtime.execution.node.field.result') }}</dt><dd>{{ focusedAgent.summary }}</dd>
        </dl>
        <p v-else class="empty-note">{{ t('capability.section.mission.agents.description') }}</p>
      </section>

      <section class="mission-panel wide" v-show="isSectionActive('routes')" data-section="routes">
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

      <section class="mission-panel governed-wide" v-show="isSectionActive('schedules')" data-section="schedules">
        <header>
          <h2><CalendarClock :size="18" />{{ t('page.mission.schedules.title') }}</h2>
          <span>{{ schedules.length }} · {{ scheduleFires.length }} {{ t('page.mission.schedules.fires') }}</span>
        </header>
        <div class="mission-schedule-form">
          <label class="field-line">
            {{ t('page.mission.schedules.objective') }}
            <textarea v-model="scheduleObjective" rows="3" :placeholder="t('page.mission.schedules.objectivePlaceholder')" />
          </label>
          <label class="field-line">
            {{ t('page.mission.schedules.trigger.label') }}
            <select v-model="scheduleTriggerKind">
              <option value="interval">{{ t('page.mission.schedules.trigger.interval') }}</option>
              <option value="at">{{ t('page.mission.schedules.trigger.at') }}</option>
              <option value="cron">{{ t('page.mission.schedules.trigger.cron') }}</option>
            </select>
          </label>
          <label v-if="scheduleTriggerKind === 'interval'" class="field-line">
            {{ t('page.mission.schedules.intervalMinutes') }}
            <input v-model.number="scheduleIntervalMinutes" type="number" min="1" step="1" />
          </label>
          <label v-if="scheduleTriggerKind === 'at'" class="field-line">
            {{ t('page.mission.schedules.runAt') }}
            <input v-model="scheduleAt" type="datetime-local" />
          </label>
          <template v-if="scheduleTriggerKind === 'cron'">
            <label class="field-line">
              {{ t('page.mission.schedules.cronExpression') }}
              <input v-model="scheduleCron" />
            </label>
            <label class="field-line">
              {{ t('page.mission.schedules.timezone') }}
              <input v-model="scheduleTimezone" />
            </label>
          </template>
          <label class="field-line">
            {{ t('page.mission.schedules.permission') }}
            <select v-model="schedulePermission">
              <option value="read-only">read-only</option>
              <option value="workspace-write">workspace-write</option>
              <option value="danger-full-access">danger-full-access</option>
            </select>
          </label>
          <div class="button-row">
            <button class="primary-action" type="button" :disabled="(!editingScheduleId && !activeSession) || !scheduleObjective.trim()" @click="saveSchedule">
              <CalendarClock :size="16" />{{ editingScheduleId ? t('page.mission.schedules.save') : t('page.mission.schedules.create') }}
            </button>
            <button v-if="editingScheduleId" class="ghost-action" type="button" @click="resetScheduleEditor">
              <X :size="16" />{{ t('common.cancel') }}
            </button>
          </div>
        </div>
        <div class="mission-schedule-list">
          <article v-for="schedule in schedules" :key="schedule.schedule_id" class="mission-schedule-row">
            <div>
              <strong>{{ schedule.objective }}</strong>
              <span>{{ formatScheduleTrigger(schedule.trigger) }} · {{ displayStatus(schedule.status) }}</span>
              <small>{{ schedule.target_session_id }} · {{ t('page.mission.schedules.next') }} {{ new Date(Number(schedule.next_at_ms || 0)).toLocaleString() }}</small>
            </div>
            <div class="icon-button-row">
              <button class="icon-action" type="button" :disabled="scheduleBusyId === schedule.schedule_id" :aria-label="t('page.mission.schedules.edit')" @click="editSchedule(schedule)"><Pencil :size="16" /></button>
              <button class="icon-action" type="button" :disabled="scheduleBusyId === schedule.schedule_id" :aria-label="t('page.mission.schedules.runNow')" @click="controlSchedule(schedule, 'run')"><Play :size="16" /></button>
              <button v-if="String(schedule.status).toLowerCase() !== 'paused'" class="icon-action" type="button" :disabled="scheduleBusyId === schedule.schedule_id" :aria-label="t('page.mission.schedules.pause')" @click="controlSchedule(schedule, 'pause')"><Pause :size="16" /></button>
              <button v-else class="icon-action" type="button" :disabled="scheduleBusyId === schedule.schedule_id" :aria-label="t('page.mission.schedules.resume')" @click="controlSchedule(schedule, 'resume')"><Play :size="16" /></button>
              <button class="icon-action danger" type="button" :disabled="scheduleBusyId === schedule.schedule_id" :aria-label="t('page.mission.schedules.delete')" @click="controlSchedule(schedule, 'delete')"><Trash2 :size="16" /></button>
            </div>
          </article>
          <p v-if="!schedules.length" class="empty-note">{{ t('page.mission.schedules.empty') }}</p>
        </div>
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
        <div class="clean-counts">
          <span><strong>{{ cleanCounters.tools }}</strong>{{ t('page.mission.control.page.text.d9eab38096') }}</span>
          <span><strong>{{ cleanCounters.memory }}</strong>{{ t('page.mission.control.page.text.0910f37f8f') }}</span>
          <span><strong>{{ relationCount }}</strong>{{ t('unit.relations') }}</span>
          <span><strong>{{ executionGraphRows.length }}</strong>{{ t('page.mission.control.runtimeV2.executionGraph') }}</span>
          <span><strong>{{ conflictItems.length }}</strong>{{ t('page.mission.control.runtimeV2.conflicts') }}</span>
          <span><strong>{{ cleanCounters.handoffs }}</strong>{{ t('unit.relations') }}</span>
        </div>
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
        <DataTable
          v-if="taskRows.length"
          searchable
          copyable
          row-key="id"
          :rows="taskRows"
          :columns="['id', 'status', 'kind', 'session', 'objective', 'turns', 'assignment', 'graphs', 'failures']"
          @row-click="selectTask"
        />
        <section v-if="selectedTaskDetail?.task" class="task-governance-detail">
          <header>
            <div>
              <strong>{{ selectedTaskDetail.task.objective }}</strong>
              <span>{{ selectedTaskDetail.task.task_id }} · {{ displayStatus(selectedTaskDetail.task.status) }}</span>
            </div>
            <button class="icon-action" type="button" :aria-label="t('common.close')" @click="selectedTaskDetail = null"><X :size="15" /></button>
          </header>
          <div class="task-governance-facts">
            <span>{{ t('page.mission.taskDetail.origin') }} <strong>{{ selectedTaskDetail.task.origin_session_id }}</strong></span>
            <span>{{ t('page.mission.taskDetail.lineage') }} <strong>{{ selectedTaskDetail.task.root_task_id }}</strong></span>
            <span>{{ t('page.mission.taskDetail.assignment') }} <strong>{{ selectedTaskDetail.task.mission_assignment }}</strong></span>
            <span>{{ t('page.mission.taskDetail.turns') }} <strong>{{ selectedTaskDetail.turns?.length || 0 }}</strong></span>
          </div>
          <DataTable
            v-if="selectedTaskDetail.turns?.length"
            row-key="binding_id"
            :rows="selectedTaskDetail.turns"
            :columns="['session_id', 'turn_id', 'role', 'bound_at_ms']"
          />
          <div class="task-assignment-controls">
            <select v-model="taskAssignmentTarget">
              <option v-for="missionOption in missions" :key="missionOption.mission_id" :value="missionOption.mission_id">
                {{ missionOption.objective || missionOption.mission_id }}
              </option>
            </select>
            <button class="ghost-action" type="button" :disabled="taskAssignmentBusy || !taskAssignmentTarget" @click="previewSelectedTaskMission">
              {{ t('page.mission.taskAssignment.preview') }}
            </button>
            <button v-if="taskAssignmentPreview?.command" class="primary-action" type="button" :disabled="taskAssignmentBusy" @click="commitSelectedTaskMission">
              {{ t('page.mission.taskAssignment.commit') }}
            </button>
          </div>
        </section>
        <DataTable
          v-if="organizationRows.length"
          searchable
          copyable
          row-key="id"
          :rows="organizationRows"
          :columns="['id', 'status', 'action', 'tasks', 'candidates', 'provider', 'elapsed', 'reason']"
        />
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
        <p v-if="!taskRows.length && !executionGraphRows.length && !conflictItems.length && !actionContractRows.length" class="empty-note">{{ t('page.mission.control.runtimeV2.empty') }}</p>
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

      <section class="mission-panel wide" v-show="isSectionActive('approvals')" data-section="approvals">
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
        <article
          v-for="item in evidenceRows"
          :key="`${item.source}-${item.kind}-${item.summary}`"
          class="evidence-item"
          :role="item.raw ? 'button' : undefined"
          :tabindex="item.raw ? 0 : undefined"
          @click="item.raw && (selectedTraceEvidence = item)"
          @keydown.enter.prevent="item.raw && (selectedTraceEvidence = item)"
        >
          <strong>{{ item.source }} · {{ item.kind }} · {{ displayStatus(item.status) }}</strong>
          <p>{{ item.summary }}</p>
        </article>
        <p v-if="!evidenceRows.length" class="empty-note">{{ t('page.mission.control.page.text.4c14c2f5a7') }}</p>
      </div>
      <DetailDrawer
        v-if="selectedTraceEvidence"
        :title="t('component.workbench.evidence.object.detail.title.payload')"
        :row="selectedTraceEvidence"
        @close="selectedTraceEvidence = null"
      />
    </section>

    <RequestReceipt v-if="actionResult" :receipt="actionResult" />
    <ObjectInspectorDrawer :title="t('page.mission.control.page.title.7ac6ef49a7')" :data="missionSnapshot" />
  </section>
</template>

<style scoped>
.runtime-v2-stack {
  display: grid;
  gap: 16px;
  margin-bottom: 16px;
}
.task-governance-detail { display: grid; gap: 12px; padding: 12px 0; border-block: 1px solid var(--border); }
.task-governance-detail > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.task-governance-detail > header div { min-width: 0; display: grid; gap: 3px; }
.task-governance-detail > header span { color: var(--text-muted); font-size: 12px; }
.task-governance-facts { display: flex; gap: 8px; flex-wrap: wrap; }
.task-governance-facts span { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); font-size: 11px; }
.task-assignment-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.task-assignment-controls select { min-width: min(320px, 100%); }
</style>
