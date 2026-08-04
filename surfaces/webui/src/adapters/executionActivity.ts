import type {
  ActivityEvent,
  ExecutionActivityProjection,
  ExecutionActivityRelation,
  ExecutionProjection,
} from '../types';

const TERMINAL = new Set([
  'complete',
  'completed',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
  'rejected',
  'error',
]);
const ATTENTION = new Set(['failed', 'blocked', 'rejected', 'error', 'waiting_approval']);

export type ActivityView = ActivityEvent & {
  canonical: ExecutionActivityProjection;
};

export interface ActivityTreeNode {
  activity: ActivityView;
  children: ActivityTreeNode[];
}

export function canonicalActivityEvents(
  projections: Array<ExecutionProjection | null>,
  visibility?: 'narrative' | 'operational' | 'audit',
): ActivityView[] {
  const rows = new Map<string, ExecutionActivityProjection>();
  for (const projection of projections) {
    for (const activity of projection?.activities || []) {
      if (visibility && !activity.visibility.includes(visibility)) continue;
      const previous = rows.get(activity.activity_id);
      if (
        previous
        && Number(previous.commit_cursor || 0) > Number(activity.commit_cursor || 0)
      ) continue;
      rows.set(activity.activity_id, activity);
    }
  }
  return [...rows.values()]
    .sort(compareActivities)
    .map(activityView);
}

export function canonicalActivityRelations(
  projections: Array<ExecutionProjection | null>,
): ExecutionActivityRelation[] {
  const rows = new Map<string, ExecutionActivityRelation>();
  for (const projection of projections) {
    for (const relation of projection?.activity_relations || []) {
      rows.set(relation.relation_id, relation);
    }
  }
  return [...rows.values()].sort((left, right) => (
    left.relation_id.localeCompare(right.relation_id)
  ));
}

export function activityTree(
  activities: ActivityView[],
  relations: ExecutionActivityRelation[],
): ActivityTreeNode[] {
  const nodes = new Map(
    activities.map((activity) => [
      activity.id,
      { activity, children: [] } satisfies ActivityTreeNode,
    ]),
  );
  const relationParents = new Map<string, string>();
  for (const relation of relations) {
    if (!['contains', 'delegated_to', 'invoked'].includes(relation.kind)) continue;
    if (!relationParents.has(relation.to_activity_id)) {
      relationParents.set(relation.to_activity_id, relation.from_activity_id);
    }
  }
  const roots: ActivityTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.activity.parent_activity_id
      || relationParents.get(node.activity.id)
      || '';
    const parent = nodes.get(parentId);
    if (parent && parent !== node && !wouldCreateCycle(nodes, parentId, node.activity.id)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (items: ActivityTreeNode[]) => {
    items.sort((left, right) => compareActivityViews(left.activity, right.activity));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

export function activityAutoCollapsed(activity: ActivityView) {
  const status = normalizedStatus(activity.status);
  if (!TERMINAL.has(status) || ATTENTION.has(status)) return false;
  if (activity.kind === 'tool') return true;
  return activity.kind === 'agent' && Boolean(activity.artifact_refs?.length);
}

export function activityNeedsAttention(activity: ActivityView) {
  return ATTENTION.has(normalizedStatus(activity.status));
}

export function normalizedStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'complete' || status === 'succeeded') return 'completed';
  return status || 'planned';
}

function activityView(activity: ExecutionActivityProjection): ActivityView {
  const status = normalizedStatus(activity.status);
  return {
    id: activity.activity_id,
    activity_id: activity.activity_id,
    kind: activity.kind,
    title: activity.public_summary || activity.kind.replaceAll('_', ' '),
    detail: activity.public_summary || '',
    status,
    at: activity.started_at_ms || undefined,
    duration_ms: activity.duration_ms || undefined,
    refs: [...activity.evidence_refs, ...activity.artifact_refs],
    evidence_refs: activity.evidence_refs,
    artifact_refs: activity.artifact_refs,
    visibility: activity.visibility,
    execution_id: activity.scope.execution_id || undefined,
    parent_execution_id: activity.scope.parent_execution_id || undefined,
    session_id: activity.scope.session_id || undefined,
    turn_id: activity.scope.turn_id || undefined,
    team_id: activity.team_id || undefined,
    agent_id: activity.agent_id || undefined,
    tool_call_id: activity.tool_call_id || undefined,
    approval_id: activity.approval_id || undefined,
    parent_activity_id: activity.parent_activity_id || undefined,
    initiator_activity_id: activity.initiator_activity_id || undefined,
    causal_parent_ids: activity.causal_parent_ids,
    dependency_ids: activity.dependency_ids,
    parallel_group_id: activity.parallel_group_id || undefined,
    completed_at_ms: activity.completed_at_ms || undefined,
    commit_cursor: activity.commit_cursor,
    sequence: activity.sequence,
    detail_capability: activity.detail_capability,
    raw: {
      activity_id: activity.activity_id,
      scope: activity.scope,
      relation: {
        parent_activity_id: activity.parent_activity_id,
        initiator_activity_id: activity.initiator_activity_id,
        causal_parent_ids: activity.causal_parent_ids,
        dependency_ids: activity.dependency_ids,
        parallel_group_id: activity.parallel_group_id,
      },
      artifact_refs: activity.artifact_refs,
      evidence_refs: activity.evidence_refs,
      detail_capability: activity.detail_capability,
    },
    canonical: activity,
  };
}

function compareActivities(
  left: ExecutionActivityProjection,
  right: ExecutionActivityProjection,
) {
  return (
    Number(left.started_at_ms || 0) - Number(right.started_at_ms || 0)
    || Number(left.commit_cursor || 0) - Number(right.commit_cursor || 0)
    || Number(left.sequence || 0) - Number(right.sequence || 0)
    || left.activity_id.localeCompare(right.activity_id)
  );
}

function compareActivityViews(left: ActivityView, right: ActivityView) {
  return compareActivities(left.canonical, right.canonical);
}

function wouldCreateCycle(
  nodes: Map<string, ActivityTreeNode>,
  parentId: string,
  childId: string,
) {
  const visited = new Set([childId]);
  let cursor = parentId;
  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = nodes.get(cursor)?.activity.parent_activity_id || '';
  }
  return false;
}
