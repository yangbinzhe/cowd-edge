import type { GraphViewModel } from '../../types/graph';

function evidenceRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => String(item?.ref || item?.reference || item || '')).filter(Boolean);
}

export function adaptExecutionGraph(graph: Record<string, any> | null): GraphViewModel {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const graphId = String(graph?.graph_id || 'execution-graph');
  return {
    id: graphId,
    title: String(graph?.objective || graph?.graph_id || ''),
    revision: Number(graph?.revision || 0),
    status: String(graph?.status || (graph?.terminal_result_ref ? 'complete' : 'running')),
    nodes: nodes.map((node: any) => ({
      id: String(node.node_id),
      type: String(node.kind || 'execution'),
      label: String(node.executor_kind || node.kind || node.node_id),
      status: String(node.status || 'planned'),
      summary: String(node.result_ref || node.node_id),
      evidenceRefs: evidenceRefs(node.evidence_refs),
      correlationRefs: [graphId, node.parent_execution_id, node.session_id, node.turn_id, node.task_id, node.result_ref].filter(Boolean).map(String),
      href: `/mission?section=overview&execution_id=${encodeURIComponent(graphId)}&node_id=${encodeURIComponent(String(node.node_id))}`,
      badges: [node.kind, node.usage?.total_tokens ? `${node.usage.total_tokens} tokens` : ''].filter(Boolean).map(String),
      raw: node,
    })),
    edges: edges.map((edge: any, index: number) => ({
      id: `${edge.from}:${edge.to}:${edge.kind || index}`,
      source: String(edge.from),
      target: String(edge.to),
      type: String(edge.kind || 'depends_on'),
      label: String(edge.kind || '').replace(/_/g, ' '),
      evidenceRefs: evidenceRefs(edge.evidence_refs),
      correlationRefs: [graphId, edge.command_id, edge.approval_id, edge.recovery_id].filter(Boolean).map(String),
      raw: edge,
    })),
  };
}
