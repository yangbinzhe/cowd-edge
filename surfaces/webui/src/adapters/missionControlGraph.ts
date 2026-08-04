import type { MissionControlProjection } from '../types';

export function adaptMissionControlGraph(
  projection: MissionControlProjection | null | undefined,
) {
  const graph = projection?.mission_graph;
  if (!graph?.mission_id) return null;
  return {
    graph_id: `mission:${graph.mission_id}`,
    objective: projection.missions?.find(
      (mission) => mission.mission_id === graph.mission_id,
    )?.objective || graph.mission_id,
    status: projection.missions?.find(
      (mission) => mission.mission_id === graph.mission_id,
    )?.status || 'unknown',
    revision: Number(
      projection.missions?.find(
        (mission) => mission.mission_id === graph.mission_id,
      )?.revision || 0,
    ),
    nodes: graph.nodes.map((node) => ({
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
      output: {},
      evidence_refs: [],
      mission_id: node.mission_id,
      session_id: node.session_id,
      task_id: node.task_id,
      execution_id: node.execution_id,
      team_id: node.team_id,
      agent_id: node.agent_id,
    })),
    edges: graph.edges.map((edge) => ({
      from: edge.from_node_id,
      to: edge.to_node_id,
      kind: edge.kind,
      canonical_relation_id: edge.edge_id,
      evidence_refs: [],
    })),
    semantic_view: true,
    canonical_graph_id: `mission:${graph.mission_id}`,
  };
}
