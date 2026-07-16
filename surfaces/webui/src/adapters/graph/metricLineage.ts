import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

export function adaptMetricLineage(result: Record<string, any> | null, title = ''): GraphViewModel {
  const detailResponse = result?.detail || {};
  const metric = detailResponse?.metric || detailResponse?.definition || detailResponse;
  const lineage = result?.lineage?.lineage || result?.lineage || {};
  const focusId = String(lineage.metric_id || metric?.metric_id || '');
  const upstream = Array.isArray(lineage.upstream_dependencies) ? lineage.upstream_dependencies : [];
  const downstream = Array.isArray(lineage.downstream_dependencies) ? lineage.downstream_dependencies : [];
  const impacted = Array.isArray(lineage.impacted_metric_ids) ? lineage.impacted_metric_ids : [];
  const nodes = new Map<string, GraphNodeView>();
  const edges: GraphEdgeView[] = [];

  const addMetric = (id: string, raw: any = {}) => {
    if (!id || nodes.has(id)) return;
    nodes.set(id, {
      id,
      type: 'metric',
      label: String(raw.display_name || raw.name || raw.metric_name || id),
      status: id === focusId ? 'focus' : impacted.includes(id) ? 'impacted' : 'ready',
      group: id === focusId ? 'focus' : 'dependency',
      summary: String(raw.description || raw.notes || raw.formula || id),
      badges: [raw.unit, raw.confidence != null ? `confidence ${raw.confidence}` : ''].filter(Boolean).map(String),
      evidenceRefs: Array.isArray(raw.evidence_refs) ? raw.evidence_refs.map(String) : [],
      correlationRefs: [raw.source_ref, raw.formula_version, raw.quality_gate_id].filter(Boolean).map(String),
      href: `/reality?section=matrix&focus=${encodeURIComponent(id)}`,
      raw,
    });
  };
  const addDependency = (dependency: any, index: number) => {
    const source = String(dependency.upstream_metric_id || dependency.source_metric_id || '');
    const target = String(dependency.downstream_metric_id || dependency.target_metric_id || '');
    if (!source || !target) return;
    addMetric(source, source === focusId ? metric : {});
    addMetric(target, target === focusId ? metric : {});
    edges.push({
      id: String(dependency.dependency_id || `${source}:${target}:${index}`),
      source,
      target,
      type: String(dependency.dependency_type || 'depends_on'),
      label: String(dependency.dependency_type || 'depends on').replace(/_/g, ' '),
      status: 'recorded',
      evidenceRefs: Array.isArray(dependency.evidence_refs) ? dependency.evidence_refs.map(String) : [],
      correlationRefs: [dependency.source_ref, dependency.version_id].filter(Boolean).map(String),
      raw: dependency,
    });
  };

  addMetric(focusId, metric);
  [...upstream, ...downstream].forEach(addDependency);
  impacted.forEach((id: any) => addMetric(String(id)));

  return {
    id: focusId || 'metric-lineage',
    title,
    revision: nodes.size + edges.length,
    status: nodes.size ? 'ready' : 'idle',
    nodes: Array.from(nodes.values()),
    edges: Array.from(new Map(edges.map((edge) => [edge.id, edge])).values()),
  };
}
