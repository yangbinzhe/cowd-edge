import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

export function adaptEntityImpact(result: Record<string, any> | null, title = ''): GraphViewModel {
  const entityResponse = result?.entity || {};
  const root = entityResponse?.entity || entityResponse;
  const relationResponse = result?.relations || {};
  const impact = result?.impact?.trace || result?.impact?.impact || result?.impact || {};
  const entities = Array.isArray(impact.entities) ? impact.entities : [];
  const relations = Array.isArray(relationResponse?.relations) ? relationResponse.relations : [];
  const hops = Array.isArray(impact.hops) ? impact.hops : [];
  const nodes = new Map<string, GraphNodeView>();
  const edges: GraphEdgeView[] = [];

  const addEntity = (entity: any, status = 'recorded') => {
    const id = String(entity?.entity_id || entity?.id || '');
    if (!id || nodes.has(id)) return;
    nodes.set(id, {
      id,
      type: String(entity.entity_type || 'entity'),
      label: String(entity.display_name || entity.canonical_key || id),
      status: id === (impact.root_entity_id || root?.entity_id) ? 'focus' : status,
      group: String(entity.entity_type || 'entity'),
      summary: String(entity.canonical_key || id),
      badges: [entity.confidence != null ? `confidence ${entity.confidence}` : ''].filter(Boolean),
      raw: entity,
    });
  };
  const addRelation = (relation: any, index: number, hop?: any) => {
    const source = String(relation?.from_entity_id || relation?.source || '');
    const target = String(relation?.to_entity_id || relation?.target || '');
    if (!source || !target) return;
    addEntity(hop?.from_entity || { entity_id: source });
    addEntity(hop?.to_entity || { entity_id: target });
    edges.push({
      id: String(relation.relation_id || `${source}:${relation.relation_type || 'related'}:${target}:${index}`),
      source,
      target,
      type: String(relation.relation_type || 'related_to'),
      label: String(relation.relation_type || 'related to').replace(/_/g, ' '),
      status: String(hop?.traversal_direction || 'recorded'),
      raw: hop || relation,
    });
  };

  addEntity(root, 'focus');
  entities.forEach((entity: any) => addEntity(entity));
  relations.forEach((relation: any, index: number) => addRelation(relation, index));
  hops.forEach((hop: any, index: number) => addRelation(hop.relation || hop, relations.length + index, hop));

  return {
    id: String(impact.root_entity_id || root?.entity_id || 'entity-impact'),
    title,
    revision: nodes.size + edges.length,
    status: nodes.size ? 'ready' : 'idle',
    nodes: Array.from(nodes.values()),
    edges: Array.from(new Map(edges.map((edge) => [edge.id, edge])).values()),
  };
}
