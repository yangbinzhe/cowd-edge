import type { GraphViewModel } from '../../types/graph';
import { t } from '../../i18n';
import { executionNodeKindLabel } from '../../utils/executionNode';

function evidenceRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => String(item?.ref || item?.reference || item || '')).filter(Boolean);
}

function dependencyWaves(nodes: any[], edges: any[]) {
  const nodeIds = new Set(nodes.map((node) => String(node?.node_id || '')).filter(Boolean));
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    const source = String(edge?.from || '');
    const target = String(edge?.to || '');
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    predecessors.set(target, [...(predecessors.get(target) || []), source]);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (nodeId: string): number => {
    if (memo.has(nodeId)) return memo.get(nodeId)!;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const value = Math.max(
      0,
      ...(predecessors.get(nodeId) || []).map((predecessor) => depth(predecessor) + 1),
    );
    visiting.delete(nodeId);
    memo.set(nodeId, value);
    return value;
  };
  for (const nodeId of nodeIds) depth(nodeId);
  const counts = new Map<number, number>();
  for (const value of memo.values()) counts.set(value, (counts.get(value) || 0) + 1);
  return { depth: memo, counts };
}

function teamNodeIdentity(graphId: string, node: any) {
  const kind = String(node?.kind || '').toLowerCase();
  if (!graphId.startsWith('team-graph:') || !kind.includes('agent')) return null;
  const nodeId = String(node?.node_id || '');
  const prefix = `${graphId}:`;
  if (!nodeId.startsWith(prefix)) return null;
  const parts = nodeId.slice(prefix.length).split(':').filter(Boolean);
  if (parts.length < 2) return null;
  const slot = parts.pop()!;
  const role = parts.join(':');
  return { role, slot };
}

export function adaptExecutionGraph(graph: Record<string, any> | null): GraphViewModel {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const graphId = String(graph?.graph_id || 'execution-graph');
  const waves = dependencyWaves(nodes, edges);
  const work = graph?.work && typeof graph.work === 'object' ? graph.work : null;
  return {
    id: graphId,
    title: String(graph?.objective || graph?.graph_id || ''),
    revision: Number(graph?.revision || 0),
    status: String(graph?.status || (graph?.terminal_result_ref ? 'complete' : 'running')),
    work: work ? {
      nodeCount: Number(work.node_count || 0),
      width: Number(work.width || 0),
      depth: Number(work.depth || 0),
      expectedSerialMs: Number(work.expected_serial_ms || 0),
      expectedCriticalPathMs: Number(work.expected_critical_path_ms || 0),
      expectedSpeedupBasisPoints: work.expected_speedup_basis_points == null
        ? undefined
        : Number(work.expected_speedup_basis_points),
      actualSerialMs: Number(work.actual_serial_ms || 0),
      actualCriticalPathMs: Number(work.actual_critical_path_ms || 0),
      actualSpeedupBasisPoints: work.actual_speedup_basis_points == null
        ? undefined
        : Number(work.actual_speedup_basis_points),
      inputTokens: Number(work.input_tokens || 0),
      outputTokens: Number(work.output_tokens || 0),
      cachedTokens: Number(work.cached_tokens || 0),
      optionalNodes: Number(work.optional_nodes || 0),
      cancelledOptionalNodes: Number(work.cancelled_optional_nodes || 0),
    } : undefined,
    nodes: nodes.map((node: any) => {
      const nodeId = String(node.node_id);
      const executor = String(node.executor_kind || '').trim();
      const kind = String(node.kind || 'execution');
      const teamIdentity = teamNodeIdentity(graphId, node);
      const executorLabel = executor && executor !== kind
        ? executionNodeKindLabel(executor)
        : executionNodeKindLabel(kind);
      const wave = waves.depth.get(nodeId) || 0;
      const parallelCount = waves.counts.get(wave) || 1;
      return {
        id: nodeId,
        type: kind,
        label: teamIdentity
          ? `${teamIdentity.role} #${teamIdentity.slot}`
          : executorLabel || nodeId,
        group: teamIdentity?.role || (parallelCount > 1 ? t('execution.parallelGroup') : undefined),
        status: String(node.status || 'planned'),
        summary: String(node.summary || node.result_ref || nodeId),
        evidenceRefs: evidenceRefs(node.evidence_refs),
        correlationRefs: [graphId, node.parent_execution_id, node.session_id, node.turn_id, node.task_id, node.result_ref].filter(Boolean).map(String),
        href: `/mission?section=overview&execution_id=${encodeURIComponent(graphId)}&node_id=${encodeURIComponent(String(node.node_id))}`,
        badges: [
          executionNodeKindLabel(kind),
          t('execution.wave', { number: wave + 1 }),
          parallelCount > 1 ? t('execution.parallelCount', { count: parallelCount }) : '',
          node.usage?.total_tokens ? t('execution.tokens', { count: node.usage.total_tokens }) : '',
          node.work?.role ? String(node.work.role).replace(/_/g, ' ') : '',
          node.work?.expected_duration_ms ? `${node.work.expected_duration_ms} ms` : '',
        ].filter(Boolean).map(String),
        raw: node,
      };
    }),
    edges: edges.map((edge: any, index: number) => ({
      id: `${edge.from}:${edge.to}:${edge.kind || index}`,
      source: String(edge.from),
      target: String(edge.to),
      type: String(edge.kind || 'depends_on'),
      label: edge.kind === 'depends_on'
        ? t('execution.edge.dependsOn')
        : String(edge.kind || '').replace(/_/g, ' '),
      evidenceRefs: evidenceRefs(edge.evidence_refs),
      correlationRefs: [graphId, edge.command_id, edge.approval_id, edge.recovery_id].filter(Boolean).map(String),
      raw: edge,
    })),
  };
}
