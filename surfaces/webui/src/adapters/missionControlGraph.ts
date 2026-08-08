import type {
  ExecutionActivityProjection,
  ExecutionProjection,
  MissionControlProjection,
} from '../types';
import { t } from '../i18n';

const STRATEGIC_KINDS = new Set([
  'mission',
  'session',
  'task',
  'execution',
  'team',
  'agent',
]);

export function adaptMissionControlGraph(
  projection: MissionControlProjection | null | undefined,
  executions: Array<ExecutionProjection | null> = [],
) {
  const graph = projection?.mission_graph;
  if (!graph?.mission_id) return null;
  const mission = projection.missions?.find(
    (candidate) => candidate.mission_id === graph.mission_id,
  );
  const canonicalNodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const canonicalParents = new Map<string, string>();
  for (const edge of graph.edges) {
    if (!['contains', 'delegated_to'].includes(edge.kind)) continue;
    if (!canonicalParents.has(edge.to_node_id)) {
      canonicalParents.set(edge.to_node_id, edge.from_node_id);
    }
  }
  const internalTaskIds = new Set(graph.nodes.flatMap((node) => (
    ['team', 'agent'].includes(node.kind)
      && node.task_id
      && isInternalTeamRoleTask(String(node.task_id), String(node.team_id || ''))
      ? [`task:${node.task_id}`]
      : []
  )));
  const retainedIds = new Set(graph.nodes.flatMap((node) => {
    if (!STRATEGIC_KINDS.has(node.kind)) return [];
    if (node.kind === 'task' && internalTaskIds.has(node.node_id)) return [];
    if (node.kind === 'execution' && canonicalParents.has(node.node_id)) return [];
    return [node.node_id];
  }));
  const presentationId = new Map<string, string>();
  for (const node of graph.nodes) {
    const resolved = resolveStrategicHost(
      node.node_id,
      retainedIds,
      canonicalParents,
    );
    if (resolved) presentationId.set(node.node_id, resolved);
  }
  const candidateNodes = graph.nodes.filter((node) => (
    retainedIds.has(node.node_id)
  ));
  const candidateIds = new Set(candidateNodes.map((node) => node.node_id));
  const agentMetrics = agentToolMetrics(executions);
  const objective = missionObjective(
    String(mission?.objective || ''),
    graph.nodes,
  );
  const taskLabels = new Map(graph.nodes.flatMap((node) => (
    node.kind === 'task' && node.task_id
      ? [[String(node.task_id), String(node.label || '')] as const]
      : []
  )));
  const strategicEdges = graph.edges
    .flatMap((edge) => {
      const from = presentationId.get(edge.from_node_id);
      const to = presentationId.get(edge.to_node_id);
      if (!from || !to || from === to || !candidateIds.has(from) || !candidateIds.has(to)) {
        return [];
      }
      return [{
      from,
      to,
      kind: edge.kind,
      canonical_relation_id: edge.edge_id,
      evidence_refs: [],
      }];
    });
  const rootId = `mission:${graph.mission_id}`;
  const reachableIds = reachableStrategicNodes(rootId, strategicEdges);
  const nodes = candidateNodes.filter((node) => reachableIds.has(node.node_id));
  const nodeIds = new Set(nodes.map((node) => node.node_id));
  const executionRelations = agentExecutionRelations(executions, nodes)
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const edges = new Map<string, any>();
  for (const edge of [...strategicEdges, ...executionRelations]) {
    const relationId = String(
      edge.canonical_relation_id
      || `mission:${edge.from}:${edge.to}:${edge.kind}`,
    );
    edges.set(relationId, { ...edge, canonical_relation_id: relationId });
  }
  return {
    graph_id: `mission:${graph.mission_id}`,
    objective: objectivePreview(objective),
    status: mission?.status || 'unknown',
    revision: Number(mission?.revision || 0),
    nodes: nodes.map((node) => {
      const metrics = node.kind === 'agent'
        ? agentMetrics.get(String(node.agent_id || ''))
        : undefined;
      return {
        node_id: node.node_id,
        kind: node.kind === 'agent' ? 'agent_task' : node.kind,
        executor_kind: node.kind,
        status: node.status,
        summary: node.kind === 'mission'
          ? t('execution.goal')
          : missionNodeLabel(node),
        description: node.kind === 'mission'
          ? objective
          : missionNodeDescription(node, taskLabels),
        input: {
          objective: node.kind === 'mission' ? objective : undefined,
          mission_id: node.mission_id,
          session_id: node.session_id,
          task_id: node.task_id,
          execution_id: node.execution_id,
          team_id: node.team_id,
          agent_id: node.agent_id,
        },
        output: metrics ? { tool_execution: metrics } : {},
        tool_summary: metrics,
        evidence_refs: [],
        mission_id: node.mission_id,
        session_id: node.session_id,
        task_id: node.task_id,
        execution_id: node.execution_id,
        team_id: node.team_id,
        agent_id: node.agent_id,
        semantic_view: true,
      };
    }),
    edges: [...edges.values()],
    semantic_view: true,
    strategic_view: true,
    canonical_graph_id: `mission:${graph.mission_id}`,
    diagnostics: {
      omitted_orphan_nodes: candidateNodes.length - nodes.length,
      folded_execution_nodes: graph.nodes.filter((node) => (
        node.kind === 'execution' && !retainedIds.has(node.node_id)
      )).length,
      folded_internal_task_nodes: internalTaskIds.size,
    },
  };
}

function resolveStrategicHost(
  nodeId: string,
  retainedIds: Set<string>,
  parents: Map<string, string>,
) {
  let current = nodeId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (retainedIds.has(current)) return current;
    visited.add(current);
    current = parents.get(current) || '';
  }
  return '';
}

function missionNodeLabel(node: Record<string, any>) {
  if (node.kind === 'team') return t('execution.kind.team');
  if (node.kind === 'agent') {
    const identity = String(node.agent_id || node.label || '').toLowerCase();
    const ordinal = identity.match(/:run:[^:]+:(\d+)/)?.[1] || '';
    const role = identity.includes('synth')
      ? t('execution.agentRole.synthesizer')
      : identity.includes('research')
        ? t('execution.agentRole.researcher')
        : t('execution.kind.agentTask');
    return ordinal ? `${role} ${ordinal}` : role;
  }
  return String(node.label || node.node_id);
}

function missionNodeDescription(
  node: Record<string, any>,
  taskLabels: Map<string, string>,
) {
  if (node.kind === 'agent') {
    const task = taskLabels.get(String(node.task_id || '')) || '';
    const focus = task.match(/^Focus:\s*(.+)$/im)?.[1]?.trim();
    if (focus) return t('execution.agentFocus', { focus });
    const responsibility = task.match(/^Responsibility:\s*(.+)$/im)?.[1]?.trim();
    if (responsibility) return responsibility;
    return '';
  }
  if (['mission', 'team'].includes(node.kind)) return '';
  return String(node.label || '');
}

function missionObjective(
  configuredObjective: string,
  nodes: Array<Record<string, any>>,
) {
  const configured = cleanObjective(configuredObjective);
  if (configured && !isGeneratedWorkspaceObjective(configured)) return configured;

  const executionObjective = nodes
    .filter((node) => node.kind === 'execution')
    .map((node) => cleanObjective(String(node.label || '')))
    .find((value) => value && !isOpaqueMissionText(value));
  if (executionObjective) return executionObjective;

  const taskObjective = nodes
    .filter((node) => node.kind === 'task')
    .map((node) => cleanObjective(String(node.label || '')))
    .find((value) => value && !isOpaqueMissionText(value));
  return taskObjective || t('chat.execution.globalMissionGraph');
}

function cleanObjective(value: string) {
  const parentObjective = value
    .replace(/^#+\s*Parent objective \(context only\)\s*/i, '')
    .split(/\n\s*(?:Parent-level orchestration directives|##\s*Team role)\b/i)[0]
    ?.trim() || '';
  return parentObjective.replace(/\s+/g, ' ').trim();
}

function objectivePreview(value: string) {
  const characters = Array.from(value);
  return characters.length > 120
    ? `${characters.slice(0, 119).join('')}…`
    : value;
}

function isGeneratedWorkspaceObjective(value: string) {
  return /^workspace mission for [a-z0-9_-]+$/i.test(value);
}

function isOpaqueMissionText(value: string) {
  return isGeneratedWorkspaceObjective(value)
    || /^(?:technical execution|runtime-team:|mission-default-)/i.test(value);
}

function isInternalTeamRoleTask(taskId: string, teamId: string) {
  return taskId.includes(':task:')
    && (
      taskId.startsWith('runtime-team:')
      || (teamId && taskId.startsWith(`${teamId}:task:`))
    );
}

function reachableStrategicNodes(
  rootId: string,
  edges: Array<{ from: string; to: string; kind?: string }>,
) {
  const reachable = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (reachable.has(edge.from) && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        changed = true;
      }
      if (edge.kind === 'contributes' && reachable.has(edge.to) && !reachable.has(edge.from)) {
        reachable.add(edge.from);
        changed = true;
      }
    }
  }
  return reachable;
}

function agentToolMetrics(executions: Array<ExecutionProjection | null>) {
  const metrics = new Map<string, {
    total: number;
    completed: number;
    failed: number;
    running: number;
  }>();
  for (const projection of executions) {
    for (const activity of projection?.activities || []) {
      if (activity.kind !== 'tool') continue;
      const identities = [
        activity.agent_instance_id,
        activity.agent_run_id,
      ].map((value) => String(value || '')).filter(Boolean);
      for (const identity of identities) {
        const metric = metrics.get(identity) || {
          total: 0,
          completed: 0,
          failed: 0,
          running: 0,
        };
        metric.total += 1;
        const status = String(activity.status || '').toLowerCase();
        if (['completed', 'complete', 'succeeded'].includes(status)) metric.completed += 1;
        else if (['failed', 'error', 'blocked', 'denied', 'cancelled'].includes(status)) {
          metric.failed += 1;
        } else {
          metric.running += 1;
        }
        metrics.set(identity, metric);
      }
    }
  }
  return metrics;
}

function agentExecutionRelations(
  executions: Array<ExecutionProjection | null>,
  missionNodes: Array<{ node_id: string; agent_id?: string | null }>,
) {
  const activityById = new Map<string, ExecutionActivityProjection>();
  const parentByActivity = new Map<string, string>();
  const missionAgentByIdentity = new Map<string, string>();
  for (const node of missionNodes) {
    const identity = String(node.agent_id || '').trim();
    if (identity) missionAgentByIdentity.set(identity, node.node_id);
  }
  for (const projection of executions) {
    for (const activity of projection?.activities || []) {
      activityById.set(activity.activity_id, activity);
      if (activity.parent_activity_id) {
        parentByActivity.set(activity.activity_id, activity.parent_activity_id);
      }
    }
    for (const relation of projection?.activity_relations || []) {
      if (
        ['contains', 'delegated_to', 'invoked', 'produced'].includes(relation.kind)
        && !parentByActivity.has(relation.to_activity_id)
      ) {
        parentByActivity.set(relation.to_activity_id, relation.from_activity_id);
      }
    }
  }
  return executions.flatMap((projection) => (
    (projection?.activity_relations || []).flatMap((relation) => {
      if (!['depends_on', 'contributes_to', 'consumed'].includes(relation.kind)) return [];
      const from = missionAgentForActivity(
        relation.from_activity_id,
        activityById,
        parentByActivity,
        missionAgentByIdentity,
      );
      const to = missionAgentForActivity(
        relation.to_activity_id,
        activityById,
        parentByActivity,
        missionAgentByIdentity,
      );
      if (!from || !to || from === to) return [];
      return [{
        from,
        to,
        kind: relation.kind,
        canonical_relation_id: `mission:${relation.relation_id}`,
        evidence_refs: relation.evidence_ref ? [relation.evidence_ref] : [],
      }];
    })
  ));
}

function missionAgentForActivity(
  activityId: string,
  activities: Map<string, ExecutionActivityProjection>,
  parents: Map<string, string>,
  nodes: Map<string, string>,
) {
  let current = activityId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const activity = activities.get(current);
    if (activity) {
      const nodeId = missionAgentNode(activity, nodes);
      if (nodeId) return nodeId;
    }
    current = parents.get(current) || '';
  }
  return '';
}

function missionAgentNode(
  activity: ExecutionActivityProjection,
  nodes: Map<string, string>,
) {
  return nodes.get(String(activity.agent_instance_id || ''))
    || nodes.get(String(activity.agent_run_id || ''))
    || '';
}
