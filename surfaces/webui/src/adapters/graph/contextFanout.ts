import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

function contextItems(envelope: Record<string, any> | null) {
  const direct = envelope?.envelope?.selected || envelope?.selected || envelope?.envelope?.items || envelope?.items || envelope?.context?.items;
  return Array.isArray(direct) ? direct : [];
}

function omissionItems(envelope: Record<string, any> | null) {
  const direct = envelope?.envelope?.omitted || envelope?.omitted || envelope?.envelope?.omitted_items || envelope?.omitted_items || envelope?.omissions;
  return Array.isArray(direct) ? direct : [];
}

function refs(value: unknown) {
  return Array.isArray(value)
    ? value.map((item: any) => String(item?.ref || item?.reference || item || '')).filter(Boolean)
    : [];
}

export function adaptContextFanout(envelope: Record<string, any> | null, title = ''): GraphViewModel {
  const nodes: GraphNodeView[] = [];
  const edges: GraphEdgeView[] = [];
  const sources = new Set<string>();
  const selected = contextItems(envelope);
  const omitted = omissionItems(envelope);
  const envelopeId = String(envelope?.envelope_id || envelope?.envelope?.id || 'context-fanout');

  [...selected, ...omitted].forEach((item: any, index) => {
    const omittedItem = index >= selected.length;
    const source = String(item.source_kind || item.source || item.authority || 'context');
    const sourceId = `source:${source}`;
    if (!sources.has(sourceId)) {
      sources.add(sourceId);
      nodes.push({
        id: sourceId,
        type: 'context-source',
        label: source,
        status: 'ready',
        group: 'source',
        summary: String(item.authority || source),
        raw: { source, authority: item.authority },
      });
    }
    const id = String(item.id || item.ref || item.memory_id || item.matrix_ref || `item-${index}`);
    const nodeId = `context:${id}:${index}`;
    nodes.push({
      id: nodeId,
      type: omittedItem ? 'context-omitted' : 'context-item',
      label: String(item.role || item.kind || id),
      status: omittedItem ? 'omitted' : String(item.status || 'selected'),
      group: omittedItem ? 'omitted' : 'selected',
      summary: String(item.text || item.content || item.summary || item.reason || id),
      evidenceRefs: refs(item.evidence_refs || item.refs),
      correlationRefs: [envelopeId, item.session_id, item.turn_id, item.memory_id, item.matrix_ref].filter(Boolean).map(String),
      href: `/context?section=packet&focus=${encodeURIComponent(nodeId)}`,
      badges: [item.authority, item.score != null ? `score ${item.score}` : ''].filter(Boolean).map(String),
      raw: item,
    });
    edges.push({
      id: `${sourceId}:${nodeId}`,
      source: sourceId,
      target: nodeId,
      type: omittedItem ? 'omitted' : 'selected',
      label: omittedItem ? 'omitted' : 'selected',
      raw: { source, omitted: omittedItem },
    });
  });

  return {
    id: envelopeId,
    title,
    revision: Number(envelope?.revision || envelope?.envelope?.revision || nodes.length),
    status: envelope?.__state || (selected.length ? 'ready' : 'idle'),
    nodes,
    edges,
    truncated: Boolean(envelope?.truncated),
  };
}
