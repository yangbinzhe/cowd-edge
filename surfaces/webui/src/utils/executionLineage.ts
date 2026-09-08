import type { ExecutionActivityRelation, ExecutionProjection } from '../types';
import {
  activityTree,
  businessGraphActivities,
  canonicalActivityEvents,
  canonicalActivityRelations,
  normalizedStatus,
  type ActivityTreeNode,
} from '../adapters/executionActivity';

const BUSINESS_ACTIVITY_KINDS = new Set([
  'execution',
  'team',
  'agent',
  'skill',
  'tool',
  'approval',
]);
const HIERARCHY_RELATION_KINDS = new Set(['contains', 'delegated_to', 'invoked']);
const FOLDED_OUTPUT_KINDS = new Set(['artifact', 'outcome']);

function text(value: unknown) {
  return String(value || '').trim();
}

export interface TurnExecutionEntry {
  execution_id: string;
  graph_id?: string | null;
  turn_id?: string | null;
  updated_at_ms?: number;
}

export interface ExecutionTopologyCounts {
  nodes: number;
  teams: number;
  agents: number;
  tools: number;
}

export function executionTopologyCounts(
  graph: { nodes?: Array<{ executor_kind?: string; kind?: string }> } | null | undefined,
): ExecutionTopologyCounts {
  const nodes = graph?.nodes || [];
  const count = (kind: string) => nodes.filter((node) => (
    text(node.executor_kind || node.kind) === kind
  )).length;
  return {
    nodes: nodes.length,
    teams: count('team'),
    agents: count('agent'),
    tools: count('tool'),
  };
}

export function selectTurnExecutionEntry<T extends TurnExecutionEntry>(
  entries: T[],
  turnId: string,
  executionId = '',
): T | null {
  const exactExecutionId = text(executionId);
  if (exactExecutionId) {
    const exact = entries.find((entry) => text(entry.execution_id) === exactExecutionId);
    if (exact) return exact;
  }

  const canonicalTurnId = text(turnId);
  if (!canonicalTurnId) return null;
  const candidates = entries.filter((entry) => text(entry.turn_id) === canonicalTurnId);
  if (!candidates.length) return null;

  // A Turn index may list Agent child executions before the Session root.
  // Prefer the root-like entry, then the latest committed candidate. Child
  // executions normally have a different graph_id, while Session roots own
  // their graph identity and link the complete Team/Agent lineage.
  const rootLike = candidates.filter((entry) => (
    text(entry.execution_id) === text(entry.graph_id)
    || text(entry.execution_id).startsWith('session-ingress-graph:')
  ));
  const pool = rootLike.length ? rootLike : candidates;
  return [...pool].sort((left, right) => (
    Number(right.updated_at_ms || 0) - Number(left.updated_at_ms || 0)
  ))[0] || null;
}

export function entryGraphId(
  entry: { graph_id?: string | null; execution_id: string } | null | undefined,
): string {
  const value = entry?.graph_id || entry?.execution_id || '';
  return String(value).trim();
}

export function executionProjectionLinks(projection: ExecutionProjection | null) {
  if (!projection) return [];
  const rootId = text(projection.execution_id);
  const links = new Set<string>();
  for (const child of projection.child_executions || []) {
    const executionId = text(child.execution_id);
    if (executionId && executionId !== rootId) links.add(executionId);
  }
  for (const activity of projection.activities || []) {
    for (const executionId of [
      activity.scope.execution_id,
      activity.scope.parent_execution_id,
    ]) {
      const id = text(executionId);
      if (id && id !== rootId) links.add(id);
    }
  }
  return [...links].sort();
}

export function combineExecutionLineage(
  rootExecutionId: string,
  projections: Array<ExecutionProjection | null>,
) {
  const byExecution = new Map<string, ExecutionProjection>();
  for (const projection of projections) {
    if (projection?.execution_id && !byExecution.has(projection.execution_id)) {
      byExecution.set(projection.execution_id, projection);
    }
  }
  const available = [...byExecution.values()];
  if (!available.length) return null;

  const requestedRootId = text(rootExecutionId);
  const root = available.find((projection) => projection.execution_id === requestedRootId)
    || available[0];
  // `agentic_collaboration` is the sole Runtime-owned business aggregate for
  // a Program. Prefer it whenever it is present: transport/activity traces
  // are useful drill-down evidence, but they are not an alternate owner of
  // Team, Agent, Task, dependency, or Artifact topology. In particular, a
  // Session root can contain only model/tool activities while a fully live
  // Program is running beneath it.
  const collaborationGraph = agenticCollaborationGraph(root);
  if (collaborationGraph) return collaborationGraph;
  // The root projection is the canonical business-topology boundary. It
  // already materializes Team, Agent and delegated tool activity. Linked
  // child projections remain drill-down resources and must not duplicate the
  // root graph or force all children to load eagerly.
  const activitySources = root.activities?.length ? [root] : available;
  const allActivities = canonicalActivityEvents(activitySources, 'audit');
  const canonicalRelations = canonicalActivityRelations(activitySources);
  const canonicalById = new Map(allActivities.map((activity) => [activity.id, activity]));
  const canonicalParent = canonicalParentIndex(allActivities, canonicalRelations);
  const graphCandidates = businessGraphActivities(allActivities)
    .filter((activity) => BUSINESS_ACTIVITY_KINDS.has(activity.kind))
    .filter((activity) => (
      activity.kind !== 'execution'
      || activity.execution_id === root.execution_id
    ));
  const candidateIds = new Set(graphCandidates.map((activity) => activity.id));
  const rootActivityId = graphCandidates.find((activity) => (
    activity.kind === 'execution' && activity.execution_id === root.execution_id
  ))?.id || '';
  const parentByActivity = new Map<string, string>();
  for (const activity of graphCandidates) {
    const parent = nearestVisibleAncestor(
      activity.id,
      candidateIds,
      canonicalById,
      canonicalParent,
    );
    if (parent) parentByActivity.set(activity.id, parent);
  }
  const reachableIds = reachableBusinessActivities(rootActivityId, parentByActivity);
  const activities = graphCandidates.filter((activity) => reachableIds.has(activity.id));
  if (!activities.length) return null;
  const activityIds = new Set(activities.map((activity) => activity.id));
  const directRelations = canonicalRelations
    .filter((relation) => (
      activityIds.has(relation.from_activity_id)
      && activityIds.has(relation.to_activity_id)
      && !HIERARCHY_RELATION_KINDS.has(relation.kind)
    ));
  const hierarchyRelations = activities.flatMap((activity) => {
    const parent = parentByActivity.get(activity.id);
    if (!parent || !activityIds.has(parent)) return [];
    return [{
      relation_id: `business-hierarchy:${parent}:${activity.id}`,
      kind: hierarchyRelationKind(activity.kind),
      from_activity_id: parent,
      to_activity_id: activity.id,
    } satisfies ExecutionActivityRelation];
  });
  const outputFolds = foldCanonicalOutputs(
    allActivities,
    canonicalRelations,
    activityIds,
    canonicalById,
    canonicalParent,
  );
  const relations = deduplicateRelations([
    ...hierarchyRelations,
    ...directRelations,
    ...outputFolds.dataRelations,
  ]);
  const orderedActivities = flattenActivityTree(activityTree(activities, relations));
  const rootActivity = orderedActivities.find((activity) => (
    activity.kind === 'execution' && activity.execution_id === root.execution_id
  ));
  const activityRootStatus = normalizedStatus(rootActivity?.status || '');
  const liveRootStatus = normalizedStatus(root.live?.status || '');
  const effectiveRootStatus = activityRootStatus === 'completed_with_warnings'
    ? activityRootStatus
    : isTerminalStatus(liveRootStatus)
      ? liveRootStatus
      : activityRootStatus === 'planned'
        ? liveRootStatus
        : activityRootStatus;
  const nodes = orderedActivities.map((activity) => {
    const folded = outputFolds.byProducer.get(activity.id);
    const artifactRefs = unique([
      ...(activity.artifact_refs || []),
      ...(folded?.artifactRefs || []),
    ]);
    const evidenceRefs = unique([
      ...(activity.evidence_refs || []),
      ...(folded?.evidenceRefs || []),
    ]);
    return ({
    node_id: activity.id,
    semantic_view: true,
    kind: graphNodeKind(activity.kind),
    executor_kind: activity.kind,
    status: graphActivityStatus(
      activity,
      root.execution_id,
      effectiveRootStatus,
    ),
    summary: graphActivitySummary(activity),
    description: graphActivityDescription(activity),
    output_summary: graphOutputSummary(activity, folded?.summaries || []),
    input: {
      mission_id: activity.canonical.scope.mission_id,
      task_id: activity.canonical.scope.task_id,
      session_id: activity.session_id,
      turn_id: activity.turn_id,
    },
    output: {
      artifact_refs: artifactRefs,
      evidence_refs: evidenceRefs,
    },
    usage: {
      duration_ms: activity.duration_ms || 0,
    },
    duration_ms: activity.duration_ms,
    sequence: activity.canonical.sequence,
    started_at_ms: activity.canonical.started_at_ms,
    completed_at_ms: activity.completed_at_ms,
    parallel_group_id: activity.parallel_group_id,
    team_id: activity.team_run_id,
    agent_id: activity.agent_instance_id || activity.agent_run_id,
    team_run_id: activity.team_run_id,
    agent_instance_id: activity.agent_instance_id,
    agent_run_id: activity.agent_run_id,
    skill_id: activity.skill_id,
    skill_revision: activity.skill_revision,
    skill_activation_id: activity.skill_activation_id,
    tool_contract_id: activity.tool_contract_id,
    definition_refs: activity.canonical.definition_refs,
    tool_call_id: activity.tool_call_id,
    approval_id: activity.approval_id,
    blocked_by_activity_ids: activity.canonical.blocked_by_activity_ids,
    status_reason_kind: activity.canonical.status_reason_kind,
    status_reason: activity.status_reason,
    work: {
      status: activity.work_status,
      revision: activity.work_revision,
      claimant_instance_id: activity.claimant_instance_id,
      claimant_role_id: activity.claimant_role_id,
      claim_lease_expires_at_ms: activity.claim_lease_expires_at_ms,
      input_artifact_refs: activity.input_artifact_refs || [],
      output_artifact_kinds: activity.output_artifact_kinds || [],
    },
    evidence_refs: evidenceRefs,
    artifact_refs: artifactRefs,
    execution_id: activity.execution_id,
    parent_execution_id: activity.parent_execution_id,
    session_id: activity.session_id,
    turn_id: activity.turn_id,
    task_id: activity.canonical.scope.task_id,
    mission_id: activity.canonical.scope.mission_id,
    canonical_activity_id: activity.id,
    });
  });
  const edges = relations.map((relation) => ({
    from: relation.from_activity_id,
    to: relation.to_activity_id,
    kind: graphEdgeKind(relation.kind),
    evidence_refs: relation.evidence_ref ? [relation.evidence_ref] : [],
    canonical_relation_id: relation.relation_id,
  }));
  return {
    graph_id: `activity-lineage:${root.execution_id}`,
    objective: text(root.graph?.objective) || root.execution_id,
    status: effectiveRootStatus,
    revision: Math.max(...activitySources.map((projection) => Number(projection.revision || 0))),
    nodes,
    edges,
    work: root.graph?.work,
    semantic_view: true,
    canonical_graph_id: text(root.graph?.graph_id || root.execution_id),
    lineage_execution_ids: [
      root.execution_id,
      ...executionProjectionLinks(root),
    ],
  };
}

function agenticCollaborationGraph(root: ExecutionProjection) {
  const collaboration = (root as any).agentic_collaboration;
  const programs = Array.isArray(collaboration?.programs) ? collaboration.programs : [];
  if (!programs.length) return null;

  const program = programs.find((candidate: any) => (
    text(candidate?.root_execution_id) === root.execution_id
  )) || programs.find((candidate: any) => (
    !!text(root.session_id) && !!text(root.turn_id)
    && text(candidate?.session_id) === text(root.session_id)
    && text(candidate?.turn_id) === text(root.turn_id)
  ));
  if (!program || !Array.isArray(program.teams) || !program.teams.length) return null;

  const programId = text(program.program_id);
  if (!programId) return null;
  const teams = program.teams.filter((team: any) => text(team?.team_id));
  const teamIds = new Set(teams.map((team: any) => text(team.team_id)));
  if (!teamIds.size) return null;
  const agents = Array.isArray(program.agents) ? program.agents : [];
  const memberships = Array.isArray(program.memberships) ? program.memberships : [];
  const tasks = Array.isArray(program.tasks) ? program.tasks : [];
  const artifacts = Array.isArray(program.artifacts) ? program.artifacts : [];
  const objective = text(root.graph?.objective) || text(program.objective_summary) || programId;
  const programNodeId = `program:${programId}`;
  const nodes: any[] = [{
    node_id: programNodeId,
    semantic_view: true,
    kind: 'mission',
    executor_kind: 'execution',
    status: text(program.status) || 'open',
    display_label: conciseLabel(program.objective_summary, programId),
    summary: text(program.objective_summary),
    description: objective,
    program_id: programId,
    execution_id: root.execution_id,
    session_id: root.session_id,
    turn_id: root.turn_id,
    evidence_refs: unique(program.unresolved || []),
    artifact_refs: unique(program.semantic_refs?.artifact_refs || []),
  }];
  const edges: any[] = [];
  const addEdge = (from: string, to: string, kind: string, suffix: string) => {
    if (!from || !to || from === to) return;
    edges.push({
      canonical_relation_id: `agentic:${programId}:${kind}:${suffix}`,
      from,
      to,
      kind,
    });
  };

  for (const team of teams) {
    const teamId = text(team.team_id);
    nodes.push({
      node_id: teamId,
      semantic_view: true,
      kind: 'team',
      executor_kind: 'team',
      status: text(team.lifecycle) || 'active',
      display_label: conciseLabel(team.name, teamId),
      summary: text(team.mission),
      description: text(team.objective) || text(team.mission),
      team_id: teamId,
      program_id: programId,
      execution_id: root.execution_id,
      session_id: root.session_id,
      turn_id: root.turn_id,
      evidence_refs: [],
      artifact_refs: [],
    });
    addEdge(programNodeId, teamId, 'delegates', `program:${teamId}`);
  }

  const membershipsByAgent = new Map<string, string[]>();
  for (const membership of memberships) {
    const agentId = text(membership?.agent_id);
    const teamId = text(membership?.team_id);
    if (!agentId || !teamIds.has(teamId) || text(membership?.lifecycle) === 'retired') continue;
    membershipsByAgent.set(agentId, unique([...(membershipsByAgent.get(agentId) || []), teamId]));
  }
  const agentIds = new Set<string>();
  for (const agent of agents) {
    const agentId = text(agent?.agent_id);
    if (!agentId) continue;
    const membershipsForAgent = unique(membershipsByAgent.get(agentId) || []);
    if (!membershipsForAgent.length) continue;
    agentIds.add(agentId);
    nodes.push({
      node_id: agentId,
      semantic_view: true,
      kind: 'agent',
      executor_kind: 'agent',
      status: text(agent.status),
      display_label: conciseLabel(agent.display_name || agent.role, agentId),
      summary: text(agent.mission),
      description: text(agent.mission),
      team_id: membershipsForAgent[0],
      membership_ids: membershipsForAgent,
      agent_id: agentId,
      program_id: programId,
      execution_id: root.execution_id,
      session_id: root.session_id,
      turn_id: root.turn_id,
      evidence_refs: [],
      artifact_refs: [],
    });
    for (const teamId of membershipsForAgent) {
      addEdge(teamId, agentId, 'delegates', `membership:${teamId}:${agentId}`);
    }
  }

  const taskIds = new Set<string>();
  for (const task of tasks) {
    const taskId = text(task?.task_id);
    const teamId = text(task?.team_id);
    if (!taskId) continue;
    taskIds.add(taskId);
    nodes.push({
      node_id: taskId,
      semantic_view: true,
      kind: 'task',
      executor_kind: 'task',
      status: text(task.status) || 'published',
      display_label: conciseLabel(task.title, taskId),
      summary: text(task.objective),
      description: text(task.acceptance) || text(task.objective),
      team_id: teamId,
      claimant: text(task.claimant),
      dependency_resolution: task.dependency_resolution || [],
      program_id: programId,
      execution_id: root.execution_id,
      session_id: root.session_id,
      turn_id: root.turn_id,
      evidence_refs: unique(task.evidence_refs || []),
      artifact_refs: unique(task.artifact_refs || []),
    });
    const claimant = text(task.claimant);
    if (agentIds.has(claimant)) addEdge(claimant, taskId, 'delegates', `claim:${claimant}:${taskId}`);
    else addEdge(teamIds.has(teamId) ? teamId : programNodeId, taskId, 'delegates', `task:${taskId}`);
  }
  for (const task of tasks) {
    const taskId = text(task?.task_id);
    if (!taskIds.has(taskId)) continue;
    for (const dependencyId of task.depends_on || []) {
      const dependency = text(dependencyId);
      if (taskIds.has(dependency)) addEdge(dependency, taskId, 'depends_on', `dependency:${dependency}:${taskId}`);
    }
  }
  for (const artifact of artifacts) {
    const artifactId = text(artifact?.artifact_ref);
    if (!artifactId) continue;
    nodes.push({
      node_id: artifactId,
      semantic_view: true,
      kind: 'evidence',
      executor_kind: 'artifact',
      status: artifactId === text(program.completion?.final_artifact_ref) ? 'verified' : 'completed',
      display_label: conciseLabel(artifact.title, artifactId),
      summary: text(artifact.kind),
      description: text(artifact.content_ref),
      program_id: programId,
      execution_id: root.execution_id,
      session_id: root.session_id,
      turn_id: root.turn_id,
      artifact_refs: [artifactId],
      evidence_refs: [],
    });
    for (const related of artifact.relates_to || []) {
      const taskId = text(related);
      if (taskIds.has(taskId)) addEdge(taskId, artifactId, 'produced', `artifact:${taskId}:${artifactId}`);
    }
  }
  return {
    graph_id: `agentic-collaboration:${root.execution_id}:${programId}`,
    objective,
    status: text(program.status) || 'open',
    revision: Number(program.revision || root.revision || 0),
    nodes,
    edges,
    work: root.graph?.work,
    semantic_view: true,
    canonical_graph_id: text(root.graph?.graph_id || root.execution_id),
    lineage_execution_ids: [root.execution_id],
  };
}

function conciseLabel(value: unknown, fallback: string, maximum = 96) {
  const label = text(value) || fallback;
  return label.length > maximum ? `${label.slice(0, maximum - 1)}…` : label;
}

function flattenActivityTree(nodes: ActivityTreeNode[]): ActivityTreeNode['activity'][] {
  const result: ActivityTreeNode['activity'][] = [];
  const pending = [...nodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    result.push(node.activity);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push(node.children[index]);
    }
  }
  return result;
}

function isTerminalStatus(status: string) {
  return [
    'completed',
    'completed_with_warnings',
    'failed',
    'error',
    'blocked',
    'cancelled',
  ].includes(status);
}

function graphOutputSummary(
  activity: ReturnType<typeof businessGraphActivities>[number],
  foldedSummaries: string[] = [],
) {
  const value = concisePublicText(activity.output);
  const internalCode = /^(?:runtime|provider|authorization|context|projection|session)\.[a-z0-9_.:-]+$/i
    .test(value);
  if (value && value !== activity.title && !internalCode && !isOpaqueReference(value)) {
    if (activity.kind === 'team' && /completed child graph revision/i.test(value)) {
      return '团队已汇总成员执行状态与产出';
    }
    return value;
  }
  const folded = foldedSummaries
    .map(concisePublicText)
    .find((summary) => summary && !isOpaqueReference(summary));
  if (folded) return folded;
  const artifactCount = activity.artifact_refs?.length || foldedSummaries.length;
  return artifactCount ? `${artifactCount} 项产出` : '';
}

function graphActivitySummary(
  activity: ReturnType<typeof businessGraphActivities>[number],
) {
  if (activity.kind === 'team') return '协作团队';
  if (activity.kind === 'agent') {
    const display = text(activity.display_label) || text(activity.title);
    if (display && !isMachineIdentityLabel(display)) return display;
    const role = text(activity.agent_instance_id)
      || text(activity.agent_run_id);
    if (role) return humanizeAgentRole(role);
  }
  return sanitizeInternalIdentifiers(activity.title);
}

function isMachineIdentityLabel(value: string) {
  return /^(?:instance|runtime-team|agent|team|role)[:_-]/i.test(value)
    || value.includes(':run:');
}

function graphActivityDescription(
  activity: ReturnType<typeof businessGraphActivities>[number],
) {
  if (activity.kind === 'tool') return text(activity.tool_contract_id) || activity.title;
  const detail = concisePublicText(activity.detail);
  if (!detail || isOpaqueReference(detail)) return '';
  if (activity.kind === 'team' && /completed child graph revision/i.test(detail)) {
    return '团队已汇总成员执行状态与产出';
  }
  return detail;
}

function concisePublicText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') {
    if (Array.isArray(value)) {
      return concisePublicText(value.find((entry) => typeof entry === 'string') || '');
    }
    if (typeof value === 'object') return conciseJsonRecord(value as Record<string, unknown>);
    return '';
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (
    (normalized.startsWith('{') && normalized.endsWith('}'))
    || (normalized.startsWith('[') && normalized.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(normalized);
      const concise = Array.isArray(parsed)
        ? concisePublicText(parsed)
        : conciseJsonRecord(parsed as Record<string, unknown>);
      if (concise) return concise;
    } catch {
      // Some providers emit incomplete JSON-looking summaries. Keep a
      // bounded public summary instead of dropping the result.
    }
  }
  const sanitized = sanitizeInternalIdentifiers(normalized);
  return sanitized.length > 180 ? `${sanitized.slice(0, 177)}...` : sanitized;
}

function conciseJsonRecord(record: Record<string, unknown>): string {
  for (const key of [
    'summary',
    'result_summary',
    'answer',
    'conclusion',
    'overview',
    'message',
    'findings',
  ]) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return concisePublicText(candidate);
    }
    if (Array.isArray(candidate)) {
      const first = candidate.find((entry) => (
        typeof entry === 'string'
        || (entry && typeof entry === 'object')
      ));
      if (typeof first === 'string') return concisePublicText(first);
      if (first && typeof first === 'object') {
        const nested = conciseJsonRecord(first as Record<string, unknown>);
        if (nested) return nested;
      }
    }
  }
  for (const candidate of Object.values(record)) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return concisePublicText(candidate);
    }
  }
  return '';
}

function sanitizeInternalIdentifiers(value: string) {
  return value
    .replace(/Team\s+`runtime-team:[^`]+`/gi, '团队')
    .replace(/`?runtime-team:[a-z0-9:._-]+`?/gi, '团队')
    .replace(/`?session-ingress-graph:[a-z0-9:._-]+`?/gi, '当前执行')
    .replace(/`?input-[0-9a-f-]{8,}`?/gi, '当前输入')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeAgentRole(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/researcher/.test(normalized)) return '研究智能体';
  if (/review|critic|audit/.test(normalized)) return '审查智能体';
  if (/synth|report|writer/.test(normalized)) return '综合智能体';
  return value.replace(/[_-]+/g, ' ').trim() || '执行智能体';
}

function isOpaqueReference(value: string) {
  return /^(?:tool|artifact|evidence|memory|file|session):\/\//i.test(value);
}

function canonicalParentIndex(
  activities: ReturnType<typeof canonicalActivityEvents>,
  relations: ExecutionActivityRelation[],
) {
  const parents = new Map<string, string>();
  for (const activity of activities) {
    if (activity.parent_activity_id) parents.set(activity.id, activity.parent_activity_id);
  }
  for (const relation of relations) {
    if (
      HIERARCHY_RELATION_KINDS.has(relation.kind)
      && !parents.has(relation.to_activity_id)
    ) {
      parents.set(relation.to_activity_id, relation.from_activity_id);
    }
  }
  return parents;
}

function nearestVisibleAncestor(
  activityId: string,
  visibleIds: Set<string>,
  activities: Map<string, ReturnType<typeof canonicalActivityEvents>[number]>,
  parents: Map<string, string>,
) {
  let current = parents.get(activityId) || '';
  const visited = new Set<string>([activityId]);
  while (current && !visited.has(current)) {
    if (visibleIds.has(current)) return current;
    visited.add(current);
    current = parents.get(current)
      || activities.get(current)?.parent_activity_id
      || '';
  }
  return '';
}

function reachableBusinessActivities(rootId: string, parents: Map<string, string>) {
  if (!rootId) return new Set<string>();
  const reachable = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parent] of parents) {
      if (!reachable.has(parent) || reachable.has(child)) continue;
      reachable.add(child);
      changed = true;
    }
  }
  return reachable;
}

function foldCanonicalOutputs(
  activities: ReturnType<typeof canonicalActivityEvents>,
  relations: ExecutionActivityRelation[],
  visibleIds: Set<string>,
  activityById: Map<string, ReturnType<typeof canonicalActivityEvents>[number]>,
  parents: Map<string, string>,
) {
  const byProducer = new Map<string, {
    artifactRefs: string[];
    evidenceRefs: string[];
    summaries: string[];
  }>();
  const producersByOutput = new Map<string, string[]>();
  for (const output of activities.filter((activity) => FOLDED_OUTPUT_KINDS.has(activity.kind))) {
    const explicitProducers = relations
      .filter((relation) => (
        relation.kind === 'produced'
        && relation.to_activity_id === output.id
      ))
      .map((relation) => relation.from_activity_id);
    const candidates = explicitProducers.length
      ? explicitProducers
      : [output.parent_activity_id || ''];
    const producers = unique(candidates.map((candidate) => (
      visibleIds.has(candidate)
        ? candidate
        : nearestVisibleAncestor(candidate, visibleIds, activityById, parents)
    )).filter(Boolean));
    producersByOutput.set(output.id, producers);
    for (const producer of producers) {
      const folded = byProducer.get(producer) || {
        artifactRefs: [],
        evidenceRefs: [],
        summaries: [],
      };
      folded.artifactRefs = unique([
        ...folded.artifactRefs,
        ...(output.artifact_refs || []),
      ]);
      folded.evidenceRefs = unique([
        ...folded.evidenceRefs,
        ...(output.evidence_refs || []),
      ]);
      folded.summaries = unique([
        ...folded.summaries,
        text(output.result_summary || output.detail || output.title),
      ].filter(Boolean));
      byProducer.set(producer, folded);
    }
  }
  const dataRelations: ExecutionActivityRelation[] = [];
  for (const relation of relations.filter((candidate) => candidate.kind === 'consumed')) {
    const consumer = visibleIds.has(relation.to_activity_id)
      ? relation.to_activity_id
      : nearestVisibleAncestor(
        relation.to_activity_id,
        visibleIds,
        activityById,
        parents,
      );
    if (!consumer) continue;
    for (const producer of producersByOutput.get(relation.from_activity_id) || []) {
      if (producer === consumer) continue;
      dataRelations.push({
        relation_id: `business-consumed:${producer}:${consumer}:${relation.relation_id}`,
        kind: 'consumed',
        from_activity_id: producer,
        to_activity_id: consumer,
        evidence_ref: relation.evidence_ref,
      });
    }
  }
  return { byProducer, dataRelations };
}

function hierarchyRelationKind(kind: string): ExecutionActivityRelation['kind'] {
  if (kind === 'team' || kind === 'agent') return 'delegated_to';
  if (kind === 'skill' || kind === 'tool') return 'invoked';
  return 'contains';
}

function deduplicateRelations(relations: ExecutionActivityRelation[]) {
  const rows = new Map<string, ExecutionActivityRelation>();
  for (const relation of relations) {
    const key = [
      relation.kind,
      relation.from_activity_id,
      relation.to_activity_id,
      relation.evidence_ref || '',
    ].join(':');
    if (!rows.has(key)) rows.set(key, relation);
  }
  return [...rows.values()];
}

function unique(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function graphActivityStatus(
  activity: ReturnType<typeof businessGraphActivities>[number],
  rootExecutionId: string,
  rootStatus: string,
) {
  const status = normalizedStatus(activity.status);
  if (activity.kind === 'execution' && activity.execution_id === rootExecutionId) {
    return rootStatus;
  }
  if (
    activity.kind === 'replan'
    && ['complete', 'completed', 'failed', 'error', 'blocked', 'cancelled'].includes(rootStatus)
    && !['complete', 'completed', 'failed', 'error', 'blocked', 'cancelled'].includes(status)
  ) {
    return 'completed';
  }
  return status;
}

function graphNodeKind(kind: string) {
  if (kind === 'agent') return 'agent_task';
  return kind;
}

function graphEdgeKind(kind: string) {
  const aliases: Record<string, string> = {
    delegated_to: 'delegates',
    invoked: 'invokes',
    approved_by: 'approved_by',
    contributes_to: 'contributes_to',
    replanned_to: 'replanned_to',
    recovered_from: 'recovered_from',
  };
  return aliases[kind] || kind;
}
