import type { GraphViewModel } from '../../types/graph';
import { t } from '../../i18n';
import { executionNodeKindLabel } from '../../utils/executionNode';

function evidenceRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => String(item?.ref || item?.reference || item || ''))
    .filter(Boolean);
}

function metricLabels(node: any) {
  const values: string[] = [];
  const tools = node?.tool_summary;
  if (tools && Number(tools.total || 0) > 0) {
    values.push(
      `${t('chat.activity.tools.executed')} ${Number(tools.completed || 0)}/${Number(tools.total || 0)}`,
    );
    if (Number(tools.failed || 0) > 0) values.push(`! ${Number(tools.failed)}`);
  }
  const duration = Number(node?.duration_ms || node?.usage?.duration_ms || 0);
  if (duration > 0) values.push(formatDuration(duration));
  const expectedDuration = Number(node?.work?.expected_duration_ms || 0);
  if (duration <= 0 && expectedDuration > 0) values.push(formatDuration(expectedDuration));
  if (Array.isArray(node?.artifact_refs) && node.artifact_refs.length) {
    values.push(`${node.artifact_refs.length} artifact`);
  }
  if (Array.isArray(node?.evidence_refs) && node.evidence_refs.length) {
    values.push(t('execution.evidenceCount', { count: node.evidence_refs.length }));
  }
  return values;
}

export function adaptExecutionGraph(graph: Record<string, any> | null): GraphViewModel {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const graphId = String(graph?.graph_id || 'execution-graph');
  const work = graph?.work && typeof graph.work === 'object' ? graph.work : null;
  return {
    id: graphId,
    title: String(graph?.objective || graph?.graph_id || ''),
    revision: Number(graph?.revision || 0),
    status: String(graph?.status || 'running'),
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
      const kind = String(node.kind || 'execution');
      const kindLabel = executionNodeKindLabel(kind);
      const parallelGroup = String(node.parallel_group_id || '').trim();
      const workRole = String(node.work?.role || '').trim().replaceAll('_', ' ');
      const workStatus = String(node.work?.status || '').trim().replaceAll('_', ' ');
      const claimant = String(
        node.work?.claimant_role_id || node.work?.claimant_instance_id || '',
      ).trim();
      const blockers = Array.isArray(node.blocked_by_activity_ids)
        ? node.blocked_by_activity_ids.length
        : 0;
      const inputArtifacts = Array.isArray(node.work?.input_artifact_refs)
        ? node.work.input_artifact_refs.length
        : 0;
      return {
        id: nodeId,
        type: kind,
        label: String(node.display_label || node.label || node.summary || workRole || kindLabel || nodeId),
        group: parallelGroup || String(node.team_run_id || node.team_id || '').trim() || undefined,
        status: String(node.status || 'planned'),
        description: String(node.status_reason || node.description || ''),
        summary: String(node.summary || nodeId),
        outputSummary: String(node.output_summary || ''),
        metrics: metricLabels(node),
        evidenceRefs: evidenceRefs(node.evidence_refs),
        correlationRefs: [
          graphId,
          node.execution_id,
          node.parent_execution_id,
          node.session_id,
          node.turn_id,
          node.task_id,
          node.mission_id,
          node.team_id,
          node.agent_id,
          node.tool_call_id,
          node.approval_id,
          ...(Array.isArray(node.artifact_refs) ? node.artifact_refs : []),
        ].filter(Boolean).map(String),
        href: `/mission?section=overview&execution_id=${encodeURIComponent(
          String(node.execution_id || graphId),
        )}&activity_id=${encodeURIComponent(nodeId)}`,
        badges: [
          kindLabel,
          workRole,
          workStatus,
          claimant ? `${t('execution.claimedBy')} ${claimant}` : '',
          blockers ? t('execution.blockerCount', { count: blockers }) : '',
          inputArtifacts ? t('execution.inputArtifactCount', { count: inputArtifacts }) : '',
          parallelGroup ? t('execution.parallelGroup') : '',
          ...metricLabels(node),
        ].filter(Boolean).map(String),
        raw: node,
      };
    }),
    edges: edges.map((edge: any, index: number) => ({
      id: String(edge.canonical_relation_id || `${edge.from}:${edge.to}:${edge.kind || index}`),
      source: String(edge.from),
      target: String(edge.to),
      type: String(edge.kind || 'depends_on'),
      label: edgeLabel(String(edge.kind || '')),
      evidenceRefs: evidenceRefs(edge.evidence_refs),
      correlationRefs: [graphId, edge.canonical_relation_id].filter(Boolean).map(String),
      raw: edge,
    })),
  };
}

function edgeLabel(kind: string) {
  if (kind === 'depends_on') return t('execution.edge.dependsOn');
  if (kind === 'delegates' || kind === 'delegated_to') return t('execution.edge.delegates');
  if (kind === 'invokes') return t('execution.edge.invokes');
  if (kind === 'consumed') return t('execution.edge.consumed');
  if (kind === 'contributes_to') return t('execution.edge.contributesTo');
  if (kind === 'produced') return t('execution.edge.produced');
  if (kind === 'produces') return t('execution.edge.produced');
  if (kind === 'artifact_requires') return t('execution.edge.artifactRequires');
  if (kind === 'cross_team_handoff') return t('execution.edge.crossTeamHandoff');
  return kind.replaceAll('_', ' ');
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1_000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1).replace(/\.0$/, '')} s`;
}
