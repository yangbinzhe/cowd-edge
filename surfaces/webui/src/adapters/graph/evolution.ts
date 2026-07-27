import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

function refs(value: unknown) {
  return Array.isArray(value)
    ? value.map((item: any) => {
      if (item?.id) return `${String(item.ref_type || 'evidence')}:${String(item.id)}`;
      return String(item?.ref || item?.reference || item || '');
    }).filter(Boolean)
    : [];
}

export function adaptEvolutionGraph(input: Record<string, any>, title = ''): GraphViewModel {
  const nodes = new Map<string, GraphNodeView>();
  const edges: GraphEdgeView[] = [];
  const addNode = (id: string, type: string, label: string, status: string, raw: any, summary = '') => {
    if (!id || nodes.has(id)) return;
    nodes.set(id, {
      id, type, label: label || id, status: status || 'recorded', group: type, summary: summary || id,
      evidenceRefs: refs(raw?.evidence_refs || raw?.source_evidence_refs),
      correlationRefs: [raw?.mission_id, raw?.signal_id, raw?.diagnosis_id, raw?.proposal_id, raw?.candidate_id, raw?.review_id, raw?.comparison_report_ref].filter(Boolean).map(String),
      href: `/audit?section=evolution&focus=${encodeURIComponent(id)}`,
      raw,
    });
  };
  const addEdge = (source: string, target: string, type: string, raw: any) => {
    if (!source || !target || !nodes.has(source) || !nodes.has(target)) return;
    edges.push({ id: `${type}:${source}:${target}`, source, target, type, label: type.replace(/_/g, ' '), evidenceRefs: refs(raw?.evidence_refs || raw?.source_evidence_refs), correlationRefs: [raw?.mission_id, raw?.proposal_id, raw?.candidate_id].filter(Boolean).map(String), raw });
  };
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const diagnoses = Array.isArray(input.diagnoses) ? input.diagnoses : [];
  const missions = Array.isArray(input.missions) ? input.missions : [];
  const proposals = Array.isArray(input.proposals) ? input.proposals : [];
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];

  signals.forEach((item: any) => addNode(String(item.signal_id || item.id || ''), 'evolution-signal', String(item.signal_type || item.signal_id || ''), String(item.severity || 'observed'), item, String(item.summary || '')));
  diagnoses.forEach((item: any) => addNode(String(item.diagnosis_id || item.id || ''), 'evolution-diagnosis', String(item.root_cause_kind || item.diagnosis_id || ''), 'diagnosed', item, String(item.impact || '')));
  missions.forEach((item: any) => addNode(String(item.mission_id || item.id || ''), 'evolution-mission', String(item.owner || item.mission_id || ''), String(item.status || 'planned'), item));
  proposals.forEach((item: any) => addNode(String(item.proposal_id || item.id || ''), 'evolution-proposal', String(item.kind || item.proposal_id || ''), String(item.status || 'proposed'), item, String(item.expected_benefit || '')));
  candidates.forEach((item: any) => addNode(String(item.candidate_id || item.id || ''), 'evolution-candidate', String(item.subject?.kind || item.candidate_id || ''), String(item.lifecycle || 'candidate'), item, String(item.comparison_report_ref || '')));
  reviews.forEach((item: any) => addNode(String(item.review_id || item.id || ''), 'evolution-review', String(item.class || item.action || item.review_id || ''), String(item.status || 'pending'), item, String(item.observation_report_ref || '')));

  diagnoses.forEach((item: any) => refs(item.source_signal_ids || item.signal_ids || item.signal_refs).forEach((id) => addEdge(id, String(item.diagnosis_id || item.id || ''), 'diagnoses', item)));
  proposals.forEach((item: any) => addEdge(String(item.diagnosis_id || ''), String(item.proposal_id || item.id || ''), 'proposes', item));
  proposals.forEach((item: any) => refs(item.source_signal_ids).forEach((id) => addEdge(id, String(item.proposal_id || item.id || ''), 'supports', item)));
  candidates.forEach((item: any) => addEdge(String(item.proposal_id || item.source_proposal_id || item.intent?.proposal_id || ''), String(item.candidate_id || item.id || ''), 'evaluates', item));
  candidates.forEach((item: any) => {
    const candidateId = String(item.candidate_id || item.id || '');
    const reportRef = String(item.comparison_report_ref || '');
    if (!reportRef) return;
    const reportId = `report:${reportRef}`;
    addNode(reportId, 'evolution-report', reportRef, 'recorded', { ref: reportRef }, reportRef);
    addEdge(candidateId, reportId, 'produces', item);
  });
  reviews.forEach((item: any) => {
    const reviewId = String(item.review_id || item.id || '');
    const candidateId = String(item.candidate_id || '');
    addEdge(candidateId, reviewId, String(item.action || 'reviews'), item);
    const candidate = candidates.find((entry: any) => String(entry.candidate_id || entry.id || '') === candidateId);
    if (candidate?.comparison_report_ref) addEdge(`report:${String(candidate.comparison_report_ref)}`, reviewId, 'evidence_for', item);
  });
  missions.forEach((item: any) => {
    const missionId = String(item.mission_id || item.id || '');
    refs(item.signal_ids || item.signals).forEach((id) => addEdge(missionId, id, 'tracks', item));
    addEdge(missionId, String(item.diagnosis_id || ''), 'diagnoses', item);
    refs(item.proposal_ids || item.proposals).forEach((id) => addEdge(missionId, id, 'plans', item));
    refs(item.candidate_ids || item.candidates).forEach((id) => addEdge(missionId, id, 'governs', item));
  });

  const uniqueEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()];
  return { id: 'evolution-lifecycle', title, revision: nodes.size + uniqueEdges.length, status: nodes.size ? 'ready' : 'idle', nodes: [...nodes.values()], edges: uniqueEdges };
}
