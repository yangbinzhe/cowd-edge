import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

function firstArray(value: any, keys: string[]) {
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function entityId(entity: any) {
  return String(entity?.id || entity?.entity_id || entity?.canonical_key || entity?.name || '');
}

export function adaptKnowledgeGraph(
  entitiesProjection: Record<string, any> | null,
  triplesProjection: Record<string, any> | null,
  symbolProjection: Record<string, any> | null,
  clustersProjection: Record<string, any> | null,
  title = '',
): GraphViewModel {
  const entityItems = firstArray(entitiesProjection, ['entities', 'items']);
  const triples = firstArray(triplesProjection, ['triples', 'relations', 'items']);
  const symbolLinks = firstArray(symbolProjection, ['links', 'entries', 'items']);
  const clusters = firstArray(clustersProjection, ['clusters', 'items']);
  const nodes = new Map<string, GraphNodeView>();
  const edges: GraphEdgeView[] = [];

  const ensureNode = (id: string, raw: any = {}, fallbackType = 'entity') => {
    if (!id || nodes.has(id)) return;
    nodes.set(id, {
      id,
      type: String(raw.entity_type || raw.type || fallbackType),
      label: String(raw.display_name || raw.name || raw.title || raw.symbol || id),
      status: String(raw.status || 'recorded'),
      group: fallbackType,
      summary: String(raw.summary || raw.content || raw.canonical_key || raw.source_type || id),
      badges: [raw.confidence != null ? `confidence ${raw.confidence}` : '', raw.frequency != null ? `frequency ${raw.frequency}` : ''].filter(Boolean),
      raw,
    });
  };

  entityItems.forEach((entity: any) => ensureNode(entityId(entity), entity));
  triples.forEach((triple: any, index: number) => {
    const source = String(triple.subject_id || triple.from_entity_id || triple.source || triple.from || '');
    const target = String(triple.object_id || triple.to_entity_id || triple.target || triple.to || '');
    if (!source || !target) return;
    ensureNode(source, { id: source }, 'inferred-entity');
    ensureNode(target, { id: target }, 'inferred-entity');
    const predicate = String(triple.predicate || triple.relation_type || triple.kind || 'related_to');
    edges.push({
      id: String(triple.id || triple.relation_id || `${source}:${predicate}:${target}:${index}`),
      source,
      target,
      type: predicate,
      label: predicate.replace(/_/g, ' '),
      status: String(triple.status || 'recorded'),
      raw: triple,
    });
  });
  symbolLinks.forEach((link: any, index: number) => {
    const symbol = String(link.symbol || link.symbol_id || symbolProjection?.symbol || '');
    const target = String(link.target || link.ref || link.memory_id || link.id || '');
    if (!symbol || !target) return;
    const source = `symbol:${symbol}`;
    ensureNode(source, { ...link, symbol }, 'symbol');
    ensureNode(target, link, 'memory');
    edges.push({
      id: `symbol-link:${source}:${target}:${index}`,
      source,
      target,
      type: String(link.reference_type || link.kind || 'symbol_link'),
      label: String(link.reference_type || link.kind || 'symbol link').replace(/_/g, ' '),
      raw: link,
    });
  });
  clusters.forEach((cluster: any, index: number) => {
    const clusterId = `cluster:${String(cluster.id || index)}`;
    ensureNode(clusterId, cluster, 'cluster');
    const entries = Array.isArray(cluster.entry_ids) ? cluster.entry_ids : [];
    entries.forEach((entryId: any, entryIndex: number) => {
      const target = String(entryId);
      ensureNode(target, { id: target }, 'memory');
      edges.push({
        id: `cluster-member:${clusterId}:${target}:${entryIndex}`,
        source: clusterId,
        target,
        type: 'contains',
        label: 'contains',
        raw: cluster,
      });
    });
  });

  return {
    id: 'memory-knowledge-graph',
    title,
    revision: nodes.size + edges.length,
    status: entitiesProjection?.enabled === false ? 'offline' : nodes.size ? 'ready' : 'idle',
    nodes: Array.from(nodes.values()),
    edges,
    truncated: Boolean(entitiesProjection?.truncated || clustersProjection?.truncated),
  };
}
