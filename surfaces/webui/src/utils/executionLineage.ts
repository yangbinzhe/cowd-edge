import type { ExecutionProjection } from '../types';
import {
  activityTree,
  businessGraphActivities,
  canonicalActivityEvents,
  canonicalActivityRelations,
  normalizedStatus,
  type ActivityTreeNode,
} from '../adapters/executionActivity';

const MAX_LINEAGE_PROJECTIONS = 64;
const BUSINESS_ACTIVITY_KINDS = new Set([
  'execution',
  'goal',
  'team',
  'agent',
  'skill',
  'model',
  'tool_batch',
  'tool',
  'approval',
  'verify',
  'artifact',
  'outcome',
  'replan',
]);

function text(value: unknown) {
  return String(value || '').trim();
}

export interface TurnExecutionEntry {
  execution_id: string;
  graph_id?: string | null;
  turn_id?: string | null;
  updated_at_ms?: number;
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
  return [...links].sort().slice(0, MAX_LINEAGE_PROJECTIONS);
}

export function combineExecutionLineage(
  rootExecutionId: string,
  projections: Array<ExecutionProjection | null>,
) {
  const available = projections
    .filter((projection): projection is ExecutionProjection => !!projection?.execution_id)
    .filter((projection, index, rows) => (
      rows.findIndex((candidate) => candidate.execution_id === projection.execution_id) === index
    ))
    .slice(0, MAX_LINEAGE_PROJECTIONS);
  if (!available.length) return null;

  const requestedRootId = text(rootExecutionId);
  const root = available.find((projection) => projection.execution_id === requestedRootId)
    || available[0];
  // The root projection is the canonical business-topology boundary. It
  // already materializes Team, Agent and delegated tool activity. Linked
  // child projections remain drill-down resources and must not duplicate the
  // root graph or force all children to load eagerly.
  const activitySources = root.activities?.length ? [root] : available;
  const allActivities = canonicalActivityEvents(activitySources, 'audit');
  const graphActivities = businessGraphActivities(allActivities)
    .filter((activity) => BUSINESS_ACTIVITY_KINDS.has(activity.kind));
  const activities = graphActivities.filter((activity) => (
    activity.execution_id === root.execution_id
  ));
  if (!activities.length) return null;
  const activityIds = new Set(activities.map((activity) => activity.id));
  const relations = canonicalActivityRelations(activitySources)
    .filter((relation) => (
      activityIds.has(relation.from_activity_id)
      && activityIds.has(relation.to_activity_id)
    ));
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
  const nodes = orderedActivities.map((activity) => ({
    node_id: activity.id,
    semantic_view: true,
    kind: graphNodeKind(activity.kind),
    executor_kind: activity.kind,
    status: graphActivityStatus(
      activity,
      root.execution_id,
      effectiveRootStatus,
    ),
    summary: activity.title,
    description: activity.detail || '',
    output_summary: graphOutputSummary(activity),
    input: {
      mission_id: activity.canonical.scope.mission_id,
      task_id: activity.canonical.scope.task_id,
      session_id: activity.session_id,
      turn_id: activity.turn_id,
    },
    output: {
      artifact_refs: activity.artifact_refs || [],
      evidence_refs: activity.evidence_refs || [],
    },
    usage: {
      duration_ms: activity.duration_ms || 0,
    },
    duration_ms: activity.duration_ms,
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
    evidence_refs: activity.evidence_refs || [],
    artifact_refs: activity.artifact_refs || [],
    execution_id: activity.execution_id,
    parent_execution_id: activity.parent_execution_id,
    session_id: activity.session_id,
    turn_id: activity.turn_id,
    task_id: activity.canonical.scope.task_id,
    mission_id: activity.canonical.scope.mission_id,
    canonical_activity_id: activity.id,
  }));
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

function flattenActivityTree(nodes: ActivityTreeNode[]) {
  return nodes.flatMap((node) => [
    node.activity,
    ...flattenActivityTree(node.children),
  ]);
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
) {
  const value = typeof activity.output === 'string'
    ? activity.output.replace(/\s+/g, ' ').trim()
    : '';
  const internalCode = /^(?:runtime|provider|authorization|context|projection|session)\.[a-z0-9_.:-]+$/i
    .test(value);
  if (!value || value === activity.title || internalCode) {
    return activity.artifact_refs?.length ? `${activity.artifact_refs.length} artifact` : '';
  }
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
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
