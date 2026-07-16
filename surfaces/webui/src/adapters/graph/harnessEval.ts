import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

export function adaptHarnessEvalGraph(input: Record<string, any>, title = ''): GraphViewModel {
  const nodes = new Map<string, GraphNodeView>();
  const edges: GraphEdgeView[] = [];
  const addNode = (id: string, type: string, label: string, status: string, raw: any) => {
    if (!id || nodes.has(id)) return;
    nodes.set(id, { id, type, label: label || id, status: status || 'recorded', group: type, summary: String(raw?.objective || raw?.message || raw?.evidence || raw?.repair_hint || id), evidenceRefs: Array.isArray(raw?.required_evidence) ? raw.required_evidence.map(String) : [], raw });
  };
  const addEdge = (source: string, target: string, type: string, raw: any) => {
    if (!nodes.has(source) || !nodes.has(target)) return;
    edges.push({ id: `${type}:${source}:${target}`, source, target, type, label: type.replace(/_/g, ' '), raw });
  };
  const scenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
  const runs = Array.isArray(input.runs) ? input.runs : [];
  const reports = Array.isArray(input.reports) ? input.reports : [];
  scenarios.forEach((item: any) => addNode(`scenario:${String(item.id || item.scenario_id || '')}`, 'eval-scenario', String(item.kind || item.id || ''), 'declared', item));
  runs.forEach((item: any) => addNode(`run:${String(item.run_id || item.id || '')}`, 'eval-run', String(item.level || item.run_id || ''), String(item.status || 'queued'), item));
  reports.forEach((item: any) => addNode(`report:${String(item.id || item.report_id || '')}`, 'eval-report', String(item.level || item.id || ''), String(item.status || 'recorded'), item));
  runs.forEach((item: any) => {
    const runId = `run:${String(item.run_id || item.id || '')}`;
    const scenarioIds = Array.isArray(item.scenario_ids) ? item.scenario_ids : [];
    scenarioIds.forEach((id: any) => addEdge(`scenario:${String(id)}`, runId, 'executes', item));
    if (item.report_id) addEdge(runId, `report:${String(item.report_id)}`, 'produces', item);
  });
  const detail = input.detail?.detail?.report || input.detail?.report || input.detail || {};
  const detailSummary = input.detail?.detail?.summary || input.detail?.summary || {};
  const detailReportId = String(detail.id || detail.report_id || detailSummary.id || '');
  const reportId = detailReportId ? `report:${detailReportId}` : '';
  if (reportId) addNode(reportId, 'eval-report', detailReportId, String(detail.status || detail.report_gate?.status || 'recorded'), detail);
  const gateItems = Array.isArray(detail.report_gate?.items) ? detail.report_gate.items : [];
  gateItems.forEach((item: any, index: number) => {
    const id = `gate:${String(item.name || index)}`;
    addNode(id, 'eval-gate', String(item.name || id), String(item.status || 'unknown'), item);
    addEdge(reportId, id, 'gates', item);
  });
  const rounds = Array.isArray(detail.execution_trace?.rounds) ? detail.execution_trace.rounds : [];
  rounds.forEach((round: any, index: number) => {
    const id = `round:${String(round.detail_path || round.round_index || index)}`;
    addNode(id, 'eval-runtime-round', String(round.name || `#${index + 1}`), String(round.status || 'recorded'), {
      round_index: round.round_index,
      name: round.name,
      model: round.model,
      status: round.status,
      elapsed_ms: round.elapsed_ms,
      text_delta_count: round.text_delta_count,
      tool_use_count: round.tool_use_count,
      detail_path: round.detail_path,
    });
    addEdge(reportId, id, 'traces', round);
  });
  const artifacts = Array.isArray(input.detail?.detail?.artifacts) ? input.detail.detail.artifacts : Array.isArray(input.detail?.artifacts) ? input.detail.artifacts : [];
  artifacts.forEach((artifact: any, index: number) => {
    const path = String(artifact.path || artifact || index);
    const id = `artifact:${path}`;
    addNode(id, 'eval-evidence', path, 'recorded', { path });
    addEdge(reportId, id, 'evidence', artifact);
  });
  const scenarioResults = Array.isArray(detail.scenarios) ? detail.scenarios : [];
  scenarioResults.forEach((scenario: any, index: number) => {
    const id = `scenario-result:${String(scenario.id || scenario.scenario_id || index)}`;
    addNode(id, 'eval-scenario-result', String(scenario.kind || scenario.id || `#${index + 1}`), String(scenario.status || (scenario.passed ? 'passed' : 'recorded')), scenario);
    addEdge(reportId, id, 'evaluates', scenario);
  });
  const uniqueEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()];
  return { id: detailReportId || 'harness-eval', title, revision: nodes.size + uniqueEdges.length, status: nodes.size ? 'ready' : 'idle', nodes: [...nodes.values()], edges: uniqueEdges };
}
