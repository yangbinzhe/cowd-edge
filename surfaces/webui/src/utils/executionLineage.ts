import type { ExecutionProjection } from '../types';

const MAX_LINEAGE_PROJECTIONS = 12;

function text(value: unknown) {
  return String(value || '').trim();
}

export function executionProjectionLinks(projection: ExecutionProjection | null) {
  if (!projection) return [];
  const links = new Set<string>();
  const rootId = text(projection.execution_id);
  const strategyId = text((projection.strategy as any)?.team_execution_id);
  if (strategyId && strategyId !== rootId) links.add(strategyId);
  for (const team of Array.isArray(projection.teams) ? projection.teams : []) {
    const graphId = text((team as any)?.detail?.graph_id);
    if (graphId && graphId !== rootId) links.add(graphId);
  }
  for (const child of Array.isArray(projection.child_executions) ? projection.child_executions : []) {
    const executionId = text(child?.execution_id);
    if (executionId && executionId !== rootId) links.add(executionId);
  }
  return [...links].slice(0, MAX_LINEAGE_PROJECTIONS);
}

function prefixedNodeId(executionId: string, nodeId: unknown) {
  return `${executionId}::${text(nodeId)}`;
}

function entryNodeId(executionId: string) {
  return `lineage::${executionId}`;
}

function graphRoots(graph: Record<string, any>) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const incoming = new Set(
    (Array.isArray(graph.edges) ? graph.edges : [])
      .map((edge: any) => text(edge?.to))
      .filter(Boolean),
  );
  const roots = nodes
    .map((node: any) => text(node?.node_id))
    .filter((nodeId: string) => nodeId && !incoming.has(nodeId));
  return roots.length ? roots : nodes.slice(0, 1).map((node: any) => text(node?.node_id)).filter(Boolean);
}

export function combineExecutionLineage(
  rootExecutionId: string,
  projections: Array<ExecutionProjection | null>,
) {
  const rootId = text(rootExecutionId);
  const available = projections
    .filter((projection): projection is ExecutionProjection => !!projection?.execution_id)
    .filter((projection, index, rows) => (
      rows.findIndex((candidate) => candidate.execution_id === projection.execution_id) === index
    ))
    .slice(0, MAX_LINEAGE_PROJECTIONS);
  if (!available.length) return null;

  const byId = new Map(available.map((projection) => [text(projection.execution_id), projection]));
  const root = byId.get(rootId) || available[0];
  const nodes: Record<string, any>[] = [];
  const edges: Record<string, any>[] = [];
  const childBindings = new Map<string, { parent: string; parentNode: string }>();

  for (const projection of available) {
    for (const child of Array.isArray(projection.child_executions) ? projection.child_executions : []) {
      const childId = text(child?.execution_id);
      if (!childId || childBindings.has(childId)) continue;
      childBindings.set(childId, {
        parent: text(child?.parent_execution_id) || text(projection.execution_id),
        parentNode: text(child?.parent_node_id),
      });
    }
  }

  for (const projection of available) {
    const executionId = text(projection.execution_id);
    const graph = projection.graph as Record<string, any>;
    const liveStatus = text(projection.live?.status);
    nodes.push({
      node_id: entryNodeId(executionId),
      kind: 'subgraph',
      executor_kind: executionId === rootId ? 'execution' : 'child_execution',
      status: liveStatus === 'complete' ? 'completed' : (liveStatus || text(graph?.status) || 'running'),
      summary: text(graph?.objective) || executionId,
      payload_ref: executionId,
      resource_scopes: [],
      evidence_refs: [],
      acceptance: {
        criteria: [],
        required_evidence: [],
        minimum_score_basis_points: null,
      },
      execution_id: executionId,
      lineage_entry: true,
      objective: text(graph?.objective),
    });
    for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
      nodes.push({
        ...node,
        node_id: prefixedNodeId(executionId, node?.node_id),
        original_node_id: text(node?.node_id),
        execution_id: executionId,
      });
    }
    for (const edge of Array.isArray(graph?.edges) ? graph.edges : []) {
      edges.push({
        ...edge,
        from: prefixedNodeId(executionId, edge?.from),
        to: prefixedNodeId(executionId, edge?.to),
      });
    }
    for (const nodeId of graphRoots(graph)) {
      edges.push({
        from: entryNodeId(executionId),
        to: prefixedNodeId(executionId, nodeId),
        kind: 'produces',
      });
    }
  }

  for (const projection of available) {
    const executionId = text(projection.execution_id);
    if (executionId === rootId) continue;
    const binding = childBindings.get(executionId);
    const parentId = byId.has(text(binding?.parent)) ? text(binding?.parent) : rootId;
    const parentNodeId = text(binding?.parentNode);
    const source = parentNodeId
      ? prefixedNodeId(parentId, parentNodeId)
      : entryNodeId(parentId);
    edges.push({
      from: nodes.some((node) => node.node_id === source) ? source : entryNodeId(parentId),
      to: entryNodeId(executionId),
      kind: 'produces',
    });
  }

  return {
    ...root.graph,
    graph_id: `lineage:${rootId || root.execution_id}`,
    objective: text(root.graph?.objective) || text(root.execution_id),
    revision: Math.max(...available.map((projection) => Number(projection.revision || 0))),
    nodes,
    edges,
    lineage_execution_ids: available.map((projection) => projection.execution_id),
  };
}
