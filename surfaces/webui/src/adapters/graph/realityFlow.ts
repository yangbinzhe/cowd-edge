import type { GraphViewModel } from '../../types/graph';

export function adaptRealityFlow(flow: Record<string, any> | null, title = ''): GraphViewModel {
  const stages = Array.isArray(flow?.stages) ? flow.stages : [];
  const nodes = stages.map((stage: any, index: number) => ({
    id: String(stage.id || stage.stage_id || `stage-${index}`),
    type: String(stage.kind || stage.type || 'fact-stage'),
    label: String(stage.label || stage.kind || stage.stage_id || `#${index + 1}`),
    status: String(stage.status || stage.decision || 'recorded'),
    group: String(stage.target || stage.target_kind || 'flow'),
    summary: String(stage.summary || stage.reason || stage.target_ref || stage.source_ref || '-'),
    evidenceRefs: Array.isArray(stage.evidence_refs)
      ? stage.evidence_refs.map((item: any) => String(item?.ref || item?.reference || item || '')).filter(Boolean)
      : [],
    correlationRefs: [flow?.flow_id, stage.source_ref, stage.target_ref, stage.correlation_ref, stage.session_id].filter(Boolean).map(String),
    href: `/reality?section=fact-flow&focus=${encodeURIComponent(String(stage.id || stage.stage_id || `stage-${index}`))}`,
    badges: [stage.decision, stage.confidence_bp != null ? `${stage.confidence_bp} bp` : ''].filter(Boolean).map(String),
    raw: stage,
  }));
  const eventByRef = new Map<string, string>();
  const candidateByTarget = new Map<string, string>();
  stages.forEach((stage: any, index: number) => {
    const id = String(stage.id || stage.stage_id || `stage-${index}`);
    if (stage.kind === 'event' && stage.source_ref) eventByRef.set(String(stage.source_ref), id);
    if (stage.kind !== 'event' && stage.target_ref) candidateByTarget.set(String(stage.target_ref), id);
  });
  const projectedEdges = Array.isArray(flow?.edges) ? flow.edges : [];
  const fallbackEdges = stages.flatMap((stage: any, index: number) => {
    const target = String(stage.id || stage.stage_id || `stage-${index}`);
    if (stage.kind === 'event') return [];
    const sourceRef = String(stage.source_ref || stage.target_ref || '');
    const explicitSource = eventByRef.get(sourceRef)
      || (stage.kind === 'fact_decision' || stage.kind === 'memory_target' ? candidateByTarget.get(String(stage.target_ref || '')) : undefined);
    if (!explicitSource || explicitSource === target) return [];
    return [{
      id: `flow:${explicitSource}:${target}`,
      source: explicitSource,
      target,
      type: String(stage.decision || stage.transition || 'next'),
      label: String(stage.decision || stage.transition || 'next').replace(/_/g, ' '),
      status: String(stage.status || 'recorded'),
      raw: stage,
    }];
  });
  const edges = projectedEdges.length ? projectedEdges.map((edge: any, index: number) => ({
    id: String(edge.edge_id || edge.id || `flow-edge-${index}`),
    source: String(edge.from || edge.source),
    target: String(edge.to || edge.target),
    type: String(edge.kind || edge.type || 'correlates'),
    label: String(edge.kind || edge.type || 'correlates').replace(/_/g, ' '),
    status: String(edge.status || 'recorded'),
    evidenceRefs: Array.isArray(edge.evidence_refs) ? edge.evidence_refs.map(String) : [],
    correlationRefs: [edge.correlation_ref, edge.source_ref, edge.target_ref].filter(Boolean).map(String),
    raw: edge,
  })) : fallbackEdges;

  return {
    id: String(flow?.flow_id || 'reality-fact-flow'),
    title,
    revision: Number(flow?.revision || stages.length),
    status: String(flow?.status || (nodes.length ? 'ready' : 'idle')),
    nodes,
    edges,
    truncated: Boolean(flow?.truncated),
  };
}
