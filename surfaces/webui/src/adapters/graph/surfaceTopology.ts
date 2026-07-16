import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

export function adaptSurfaceTopology(input: Record<string, any>, title = ''): GraphViewModel {
  const nodes = new Map<string, GraphNodeView>();
  const edges: GraphEdgeView[] = [];
  const addNode = (id: string, type: string, label: string, status: string, raw: any) => {
    if (!id || nodes.has(id)) return;
    nodes.set(id, { id, type, label: label || id, status: status || 'declared', group: type, summary: String(raw?.name || raw?.path || raw?.route || raw?.endpoint || id), raw });
  };
  const addEdge = (source: string, target: string, type: string, raw: any) => {
    if (!nodes.has(source) || !nodes.has(target)) return;
    edges.push({ id: `${type}:${source}:${target}`, source, target, type, label: type.replace(/_/g, ' '), raw });
  };
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces : [];
  const connectors = Array.isArray(input.connectors) ? input.connectors : [];
  const endpoints = Array.isArray(input.endpoints) ? input.endpoints : [];
  const routes = Array.isArray(input.routes) ? input.routes : [];
  const bindings = Array.isArray(input.bindings) ? input.bindings : [];
  const selectedSurface = String(input.selectedSurface || '');
  surfaces.forEach((item: any) => addNode(`surface:${String(item.id || item.surface_id || '')}`, 'surface', String(item.name || item.id || ''), String(item.status || item.lifecycle || 'ready'), item));
  connectors.forEach((item: any) => {
    const id = `connector:${String(item.id || item.connector_id || item.name || '')}`;
    addNode(id, 'connector', String(item.name || item.id || ''), String(item.runtime?.status || item.status || 'declared'), item);
    const surface = String(item.surface_id || item.surface || selectedSurface || '');
    if (surface) addEdge(`surface:${surface}`, id, 'uses', item);
  });
  endpoints.forEach((item: any) => {
    const id = `endpoint:${String(item.endpoint_id || item.id || item.endpoint || '')}`;
    addNode(id, 'endpoint', String(item.endpoint_id || item.endpoint || item.id || ''), String(item.status || 'declared'), item);
    addEdge(`connector:${String(item.connector || item.connector_id || '')}`, id, 'exposes', item);
  });
  routes.forEach((item: any) => {
    const id = `route:${String(item.route_id || item.id || item.path || item.route || '')}`;
    addNode(id, 'route', String(item.path || item.route || item.route_id || ''), String(item.status || 'declared'), item);
    const connector = `connector:${String(item.connector || item.connector_id || '')}`;
    if (nodes.has(connector)) addEdge(connector, id, 'routes', item);
    const surface = `surface:${String(item.surface_id || item.surface || selectedSurface || '')}`;
    if (nodes.has(surface)) addEdge(surface, id, 'publishes', item);
  });
  bindings.forEach((item: any) => {
    const id = `binding:${String(item.binding_id || item.id || '')}`;
    addNode(id, 'binding', String(item.binding_id || item.id || ''), String(item.status || item.outbound_status || 'declared'), item);
    addEdge(`connector:${String(item.connector || item.connector_id || '')}`, id, 'binds', item);
    addEdge(id, `endpoint:${String(item.endpoint || item.endpoint_id || '')}`, 'targets', item);
  });
  const uniqueEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()];
  return { id: 'surface-topology', title, revision: nodes.size + uniqueEdges.length, status: nodes.size ? 'ready' : 'idle', nodes: [...nodes.values()], edges: uniqueEdges };
}
