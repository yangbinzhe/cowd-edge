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
