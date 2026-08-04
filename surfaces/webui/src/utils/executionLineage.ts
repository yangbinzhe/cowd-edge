import type { ExecutionProjection } from '../types';
import {
  activityTree,
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
  const activities = canonicalActivityEvents(available, 'narrative')
    .filter((activity) => BUSINESS_ACTIVITY_KINDS.has(activity.kind));
  if (!activities.length) return null;
  const activityIds = new Set(activities.map((activity) => activity.id));
  const relations = canonicalActivityRelations(available)
    .filter((relation) => (
      activityIds.has(relation.from_activity_id)
      && activityIds.has(relation.to_activity_id)
    ));
  const orderedActivities = flattenActivityTree(activityTree(activities, relations));
  const nodes = orderedActivities.map((activity) => ({
    node_id: activity.id,
    kind: graphNodeKind(activity.kind),
    executor_kind: activity.kind,
    status: normalizedStatus(activity.status),
    summary: activity.title,
    description: activity.detail || '',
    output_summary: activity.artifact_refs?.length
      ? `${activity.artifact_refs.length} artifact`
      : '',
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
    team_id: activity.team_id,
    agent_id: activity.agent_id,
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
    status: normalizedStatus(root.live?.status || 'running'),
    revision: Math.max(...available.map((projection) => Number(projection.revision || 0))),
    nodes,
    edges,
    work: root.graph?.work,
    semantic_view: true,
    canonical_graph_id: text(root.graph?.graph_id || root.execution_id),
    lineage_execution_ids: available.map((projection) => projection.execution_id),
  };
}

function flattenActivityTree(nodes: ActivityTreeNode[]) {
  return nodes.flatMap((node) => [
    node.activity,
    ...flattenActivityTree(node.children),
  ]);
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
