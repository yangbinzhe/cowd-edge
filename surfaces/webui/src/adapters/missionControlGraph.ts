import type {
  ExecutionActivityProjection,
  ExecutionProjection,
  MissionControlProjection,
} from '../types';

const STRATEGIC_KINDS = new Set([
  'mission',
  'task',
  'execution',
  'team',
  'agent',
  'outcome',
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
  const nodes = graph.nodes.filter((node) => STRATEGIC_KINDS.has(node.kind));
  const nodeIds = new Set(nodes.map((node) => node.node_id));
  const agentMetrics = agentToolMetrics(executions);
  const strategicEdges = graph.edges
    .filter((edge) => nodeIds.has(edge.from_node_id) && nodeIds.has(edge.to_node_id))
    .map((edge) => ({
      from: edge.from_node_id,
      to: edge.to_node_id,
      kind: edge.kind,
      canonical_relation_id: edge.edge_id,
      evidence_refs: [],
    }));
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
    objective: mission?.objective || graph.mission_id,
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
        summary: node.label,
        description: node.label,
        input: {
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
  };
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
  const missionAgentByIdentity = new Map<string, string>();
  for (const node of missionNodes) {
    const identity = String(node.agent_id || '').trim();
    if (identity) missionAgentByIdentity.set(identity, node.node_id);
  }
  for (const projection of executions) {
    for (const activity of projection?.activities || []) {
      activityById.set(activity.activity_id, activity);
    }
  }
  return executions.flatMap((projection) => (
    (projection?.activity_relations || []).flatMap((relation) => {
      if (!['depends_on', 'contributes_to', 'consumed'].includes(relation.kind)) return [];
      const source = activityById.get(relation.from_activity_id);
      const target = activityById.get(relation.to_activity_id);
      if (source?.kind !== 'agent' || target?.kind !== 'agent') return [];
      const from = missionAgentNode(source, missionAgentByIdentity);
      const to = missionAgentNode(target, missionAgentByIdentity);
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

function missionAgentNode(
  activity: ExecutionActivityProjection,
  nodes: Map<string, string>,
) {
  return nodes.get(String(activity.agent_instance_id || ''))
    || nodes.get(String(activity.agent_run_id || ''))
    || '';
}
