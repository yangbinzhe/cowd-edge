import type { GraphDirection, GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

export interface GraphDiagnostics {
  duplicateNodeIds: string[];
  duplicateEdgeIds: string[];
  danglingEdgeIds: string[];
}

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  });
  return [...duplicate].sort();
}

export function graphDiagnostics(nodes: GraphNodeView[], edges: GraphEdgeView[]): GraphDiagnostics {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    duplicateNodeIds: duplicates(nodes.map((node) => node.id)),
    duplicateEdgeIds: duplicates(edges.map((edge) => edge.id)),
    danglingEdgeIds: edges
      .filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))
      .map((edge) => edge.id)
      .sort(),
  };
}

export function graphLayoutSignature(
  modelId: string,
  direction: GraphDirection,
  nodes: GraphNodeView[],
  edges: GraphEdgeView[],
) {
  return [
    modelId,
    direction,
    nodes.map((node) => node.id).sort().join(','),
    edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}`).sort().join(','),
  ].join('|');
}

export function semanticToolColumnLayoutEdges(
  modelId: string,
  direction: GraphDirection,
  nodes: GraphNodeView[],
  edges: GraphEdgeView[],
): GraphEdgeView[] {
  if (direction !== 'DOWN' || !modelId.startsWith('activity-lineage:')) return [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    successors.set(edge.source, [...(successors.get(edge.source) || []), edge.target]);
  }
  const reaches = (source: string, target: string) => {
    const pending = [...(successors.get(source) || [])];
    const visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(successors.get(current) || []));
    }
    return false;
  };
  const toolsByAgent = new Map<string, GraphNodeView[]>();
  for (const edge of edges) {
    if (edge.type !== 'invokes') continue;
    const agent = nodesById.get(edge.source);
    const tool = nodesById.get(edge.target);
    const agentKind = String(agent?.raw?.executor_kind || agent?.type || '');
    const toolKind = String(tool?.raw?.executor_kind || tool?.type || '');
    if (agentKind !== 'agent' || toolKind !== 'tool' || !tool) continue;
    toolsByAgent.set(edge.source, [...(toolsByAgent.get(edge.source) || []), tool]);
  }
  const layoutEdges: GraphEdgeView[] = [];
  for (const [agentId, tools] of toolsByAgent) {
    tools.sort((left, right) => (
      Number(left.raw?.sequence || left.raw?.started_at_ms || 0)
      - Number(right.raw?.sequence || right.raw?.started_at_ms || 0)
      || left.id.localeCompare(right.id)
    ));
    for (let index = 1; index < tools.length; index += 1) {
      if (reaches(tools[index]!.id, tools[index - 1]!.id)) continue;
      if (reaches(tools[index - 1]!.id, tools[index]!.id)) continue;
      layoutEdges.push({
        id: `layout:tool-column:${agentId}:${index}`,
        source: tools[index - 1]!.id,
        target: tools[index]!.id,
        type: 'layout_only',
      });
      successors.set(
        tools[index - 1]!.id,
        [...(successors.get(tools[index - 1]!.id) || []), tools[index]!.id],
      );
    }
  }
  return layoutEdges;
}

export function semanticHierarchyLayoutEdges(
  modelId: string,
  edges: GraphEdgeView[],
) {
  if (
    !modelId.startsWith('activity-lineage:')
    && !modelId.startsWith('mission:')
  ) return edges;
  const hierarchy = new Set([
    'contains',
    'delegates',
    'delegated_to',
    'invokes',
    'owns',
  ]);
  return edges.filter((edge) => hierarchy.has(edge.type));
}

export function graphExportPayload(
  model: GraphViewModel,
  nodes: GraphNodeView[],
  edges: GraphEdgeView[],
  direction: GraphDirection,
  diagnostics: GraphDiagnostics,
  generatedAt = new Date(),
) {
  const publicNodes = nodes.map(({ raw: _raw, ...node }) => node);
  const publicEdges = edges.map(({ raw: _raw, ...edge }) => edge);
  return {
    schema_version: 1,
    graph: {
      id: model.id,
      title: model.title,
      revision: model.revision ?? null,
      status: model.status || 'unknown',
      truncated: model.truncated === true,
      direction,
    },
    selection: { node_count: nodes.length, edge_count: edges.length },
    diagnostics,
    nodes: publicNodes,
    edges: publicEdges,
    generated_at: generatedAt.toISOString(),
  };
}
