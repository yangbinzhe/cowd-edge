import type { ExecutionProjection } from '../types';
import {
  activityTree,
  businessGraphActivities,
  canonicalActivityEvents,
  canonicalActivityRelations,
  normalizedStatus,
  type ActivityTreeNode,
} from '../adapters/executionActivity';
import { t } from '../i18n';

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
  const toolActivities = graphActivities.filter((activity) => activity.kind === 'tool');
  const activities = compactLineageActivities(graphActivities, root.execution_id);
  if (!activities.length) return null;
  const activityIds = new Set(activities.map((activity) => activity.id));
  const relations = canonicalActivityRelations(activitySources)
    .filter((relation) => (
      activityIds.has(relation.from_activity_id)
      && activityIds.has(relation.to_activity_id)
    ));
  const relationKeys = new Set(relations.map((relation) => (
    `${relation.from_activity_id}:${relation.to_activity_id}`
  )));
  const allById = new Map(allActivities.map((activity) => [activity.id, activity]));
  for (const activity of activities) {
    const parentId = nearestVisibleParent(activity.parent_activity_id, activityIds, allById);
    if (!parentId || parentId === activity.id) continue;
    const key = `${parentId}:${activity.id}`;
    if (relationKeys.has(key)) continue;
    relationKeys.add(key);
    relations.push({
      relation_id: `derived-parent:${parentId}:${activity.id}`,
      kind: activity.kind === 'tool' || activity.kind === 'tool_batch'
        ? 'invoked'
        : 'contains',
      from_activity_id: parentId,
      to_activity_id: activity.id,
    });
  }
  const orderedActivities = flattenActivityTree(activityTree(activities, relations));
  const nodes = orderedActivities.map((activity) => ({
    node_id: activity.id,
    semantic_view: true,
    kind: graphNodeKind(activity.kind),
    executor_kind: activity.kind,
    status: graphActivityStatus(
      activity,
      root.execution_id,
      normalizedStatus(root.live?.status || 'running'),
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
  const rootActivityId = orderedActivities.find((activity) => (
    activity.kind === 'execution' || activity.kind === 'goal'
  ))?.id || orderedActivities[0]?.id || '';
  const toolsByParent = new Map<string, typeof toolActivities>();
  for (const tool of toolActivities) {
    const parentId = nearestVisibleParent(tool.parent_activity_id, activityIds, allById)
      || orderedActivities.find((activity) => (
        activity.kind === 'agent'
        && tool.agent_id
        && agentIdentity(activity.agent_id) === agentIdentity(tool.agent_id)
      ))?.id
      || rootActivityId;
    if (!parentId) continue;
    toolsByParent.set(parentId, [...(toolsByParent.get(parentId) || []), tool]);
  }
  for (const [parentId, tools] of toolsByParent) {
    const toolNodeId = `activity:view:tool-group:${parentId}`;
    const statuses = tools.map((tool) => normalizedStatus(tool.status));
    const completed = statuses.filter((status) => status === 'completed').length;
    const failed = statuses.filter((status) => (
      ['failed', 'error', 'blocked', 'denied', 'cancelled'].includes(status)
    )).length;
    const running = statuses.filter((status) => (
      ['running', 'started', 'starting'].includes(status)
    )).length;
    const starts = tools.map((tool) => Number(tool.canonical.started_at_ms || 0)).filter(Boolean);
    const completions = tools.map((tool) => Number(tool.completed_at_ms || 0)).filter(Boolean);
    const startedAt = starts.length ? Math.min(...starts) : 0;
    const completedAt = running === 0 && completions.length ? Math.max(...completions) : 0;
    const evidenceRefs = Array.from(new Set(tools.flatMap((tool) => tool.evidence_refs || [])));
    const artifactRefs = Array.from(new Set(tools.flatMap((tool) => tool.artifact_refs || [])));
    const batchNodeId = `tool-batch:${parentId}`;
    const toolCalls = tools.map((tool) => ({
      id: tool.tool_call_id || tool.id,
      name: tool.title,
      status: normalizedStatus(tool.status),
      batch_node_id: batchNodeId,
      depends_on: tool.canonical.dependency_ids || [],
      duration_ms: Number(tool.duration_ms || 0),
      started_at_ms: Number(tool.canonical.started_at_ms || 0),
      completed_at_ms: Number(tool.completed_at_ms || 0),
      evidence_refs: tool.evidence_refs || [],
      artifact_refs: tool.artifact_refs || [],
    }));
    nodes.push({
      node_id: toolNodeId,
      semantic_view: true,
      kind: 'tool_batch',
      executor_kind: 'tool',
      status: failed > 0 ? 'failed' : running > 0 ? 'running' : 'completed',
      summary: `${t('execution.kind.toolBatch')} · ${tools.length}`,
      description: `${t('chat.activity.tools.executed')} ${completed + failed}/${tools.length}`,
      output_summary: failed > 0 ? `${failed} failed` : '',
      input: {
        tool_call_ids: tools.map((tool) => tool.tool_call_id || tool.id),
      },
      output: {
        artifact_refs: artifactRefs,
        evidence_refs: evidenceRefs,
        tool_execution: {
          call_count: tools.length,
          batch_count: 1,
          max_parallel_width: maximumConcurrentTools(tools),
          calls: toolCalls,
          batches: [{
            node_id: batchNodeId,
            status: failed > 0 ? 'failed' : running > 0 ? 'running' : 'completed',
          }],
        },
      },
      usage: {
        duration_ms: startedAt && completedAt ? completedAt - startedAt : 0,
      },
      duration_ms: startedAt && completedAt ? completedAt - startedAt : undefined,
      started_at_ms: startedAt || undefined,
      completed_at_ms: completedAt || undefined,
      parallel_group_id: tools.find((tool) => tool.parallel_group_id)?.parallel_group_id,
      team_id: tools.find((tool) => tool.team_id)?.team_id,
      agent_id: tools.find((tool) => tool.agent_id)?.agent_id,
      tool_call_id: undefined,
      approval_id: undefined,
      evidence_refs: evidenceRefs,
      artifact_refs: artifactRefs,
      execution_id: tools.find((tool) => tool.execution_id)?.execution_id,
      parent_execution_id: tools.find((tool) => tool.parent_execution_id)?.parent_execution_id,
      session_id: tools.find((tool) => tool.session_id)?.session_id,
      turn_id: tools.find((tool) => tool.turn_id)?.turn_id,
      task_id: tools.find((tool) => tool.canonical.scope.task_id)?.canonical.scope.task_id,
      mission_id: tools.find((tool) => tool.canonical.scope.mission_id)?.canonical.scope.mission_id,
      canonical_activity_id: toolNodeId,
      grouped_activity_ids: tools.map((tool) => tool.id),
    });
    edges.push({
      from: parentId,
      to: toolNodeId,
      kind: 'invokes',
      evidence_refs: evidenceRefs,
      canonical_relation_id: `derived-tool-group:${parentId}`,
    });
  }
  const incoming = new Set(edges.map((edge) => edge.to));
  for (const node of nodes) {
    if (!rootActivityId || node.node_id === rootActivityId || incoming.has(node.node_id)) continue;
    const teamParent = node.executor_kind === 'agent' && node.team_id
      ? nodes.find((candidate) => (
          candidate.executor_kind === 'team'
          && candidate.team_id === node.team_id
        ))?.node_id
      : '';
    const parentId = teamParent || rootActivityId;
    edges.push({
      from: parentId,
      to: node.node_id,
      kind: node.executor_kind === 'agent' ? 'delegates' : 'contains',
      evidence_refs: node.evidence_refs || [],
      canonical_relation_id: `derived-owner:${parentId}:${node.node_id}`,
    });
    incoming.add(node.node_id);
  }

  return {
    graph_id: `activity-lineage:${root.execution_id}`,
    objective: text(root.graph?.objective) || root.execution_id,
    status: normalizedStatus(root.live?.status || 'running'),
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

function compactLineageActivities(
  activities: ReturnType<typeof businessGraphActivities>,
  rootExecutionId: string,
) {
  const rows = new Map<string, (typeof activities)[number]>();
  for (const activity of activities) {
    let key = '';
    if (activity.kind === 'execution') {
      if (activity.execution_id !== rootExecutionId) continue;
      key = `execution:${rootExecutionId}`;
    } else if (activity.kind === 'goal') {
      if (activity.execution_id !== rootExecutionId) continue;
      key = `goal:${activity.id}`;
    } else if (activity.kind === 'team') {
      key = `team:${activity.team_id || activity.id}`;
    } else if (activity.kind === 'agent') {
      key = `agent:${agentIdentity(activity.agent_id) || activity.id}`;
    } else if (activity.kind === 'approval') {
      if (!activity.approval_id) continue;
      key = `approval:${activity.approval_id}`;
    } else if (activity.kind === 'verify' || activity.kind === 'replan') {
      key = `${activity.kind}:${activity.id}`;
    } else {
      // Tool calls are represented by a per-owner aggregate. Model mechanics,
      // child execution wrappers, artifacts and outcomes stay in Activity and
      // evidence detail instead of duplicating the business topology.
      continue;
    }
    const previous = rows.get(key);
    if (!previous || lineageActivityFreshness(activity) >= lineageActivityFreshness(previous)) {
      rows.set(key, activity);
    }
  }
  return [...rows.values()];
}

function lineageActivityFreshness(
  activity: ReturnType<typeof businessGraphActivities>[number],
) {
  const terminal = ['completed', 'failed', 'error', 'blocked', 'cancelled']
    .includes(normalizedStatus(activity.status)) ? 1_000_000_000_000 : 0;
  return terminal
    + Number(activity.completed_at_ms || activity.canonical.started_at_ms || 0)
    + Number(activity.commit_cursor || 0);
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

function agentIdentity(value: unknown) {
  return text(value).replace(/^instance:/, '');
}

function nearestVisibleParent(
  parentId: string | undefined,
  visibleIds: Set<string>,
  allById: Map<string, ReturnType<typeof canonicalActivityEvents>[number]>,
) {
  const visited = new Set<string>();
  let candidate = text(parentId);
  while (candidate && !visited.has(candidate)) {
    if (visibleIds.has(candidate)) return candidate;
    visited.add(candidate);
    candidate = text(allById.get(candidate)?.parent_activity_id);
  }
  return '';
}

function maximumConcurrentTools(
  tools: ReturnType<typeof businessGraphActivities>,
) {
  const points = tools.flatMap((tool) => {
    const start = Number(tool.canonical.started_at_ms || 0);
    const end = Number(tool.completed_at_ms || start || 0);
    if (!start) return [];
    // End points sort before start points at the same timestamp, so sequential
    // calls that merely touch are not presented as concurrent.
    return [{ at: start, delta: 1 }, { at: Math.max(start, end), delta: -1 }];
  }).sort((left, right) => left.at - right.at || left.delta - right.delta);
  let active = 0;
  let maximum = 0;
  for (const point of points) {
    active += point.delta;
    maximum = Math.max(maximum, active);
  }
  return maximum || (tools.length ? 1 : 0);
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
