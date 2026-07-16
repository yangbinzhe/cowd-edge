import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

function refs(value: unknown) { return Array.isArray(value) ? value.map((item: any) => String(item?.ref || item || '')).filter(Boolean) : []; }

export function adaptSurfaceTopology(input: Record<string, any>, title = ''): GraphViewModel {
  const nodes = new Map<string, GraphNodeView>();
  const edges: GraphEdgeView[] = [];
  const addNode = (id: string, type: string, label: string, status: string, raw: any) => {
    if (!id || nodes.has(id)) return;
    nodes.set(id, { id, type, label: label || id, status: status || 'declared', group: type, summary: String(raw?.name || raw?.path || raw?.route || raw?.endpoint || raw?.last_error || id), evidenceRefs: refs(raw?.evidence_refs), correlationRefs: [raw?.message_id, raw?.delivery_id, raw?.idempotency_key, raw?.session_id, raw?.turn_id].filter(Boolean).map(String), href: `/surfaces?section=${['inbox', 'outbox', 'delivery', 'dead-letter'].includes(type) ? 'delivery' : type === 'trigger-event' ? 'trigger-events' : 'registry'}&focus=${encodeURIComponent(id)}`, raw });
  };
  const addEdge = (source: string, target: string, type: string, raw: any) => {
    if (!nodes.has(source) || !nodes.has(target)) return;
    edges.push({ id: `${type}:${source}:${target}`, source, target, type, label: type.replace(/_/g, ' '), evidenceRefs: refs(raw?.evidence_refs), correlationRefs: [raw?.message_id, raw?.delivery_id, raw?.idempotency_key].filter(Boolean).map(String), raw });
  };
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces : [];
  const connectors = Array.isArray(input.connectors) ? input.connectors : [];
  const endpoints = Array.isArray(input.endpoints) ? input.endpoints : [];
  const routes = Array.isArray(input.routes) ? input.routes : [];
  const bindings = Array.isArray(input.bindings) ? input.bindings : [];
  const inbox = Array.isArray(input.inbox) ? input.inbox : [];
  const outbox = Array.isArray(input.outbox) ? input.outbox : [];
  const deliveries = Array.isArray(input.deliveries) ? input.deliveries : [];
  const triggers = Array.isArray(input.triggerEvents) ? input.triggerEvents : [];
  const deadLetters = Array.isArray(input.deadLetters) ? input.deadLetters : [];
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
  const surfaceNode = `surface:${selectedSurface}`;
  if (selectedSurface && !nodes.has(surfaceNode)) addNode(surfaceNode, 'surface', selectedSurface, 'unknown', { id: selectedSurface });
  inbox.forEach((item: any, index: number) => {
    const messageId = String(item.message_id || item.id || index);
    const id = `inbox:${messageId}`;
    addNode(id, 'inbox', messageId, String(item.status || 'received'), item);
    addEdge(surfaceNode, id, 'receives', item);
  });
  outbox.forEach((item: any, index: number) => {
    const deliveryId = String(item.delivery_id || item.id || index);
    const id = `outbox:${deliveryId}`;
    addNode(id, 'outbox', deliveryId, String(item.status || 'queued'), item);
    addEdge(surfaceNode, id, 'dispatches', item);
    const inboxId = item.message_id ? `inbox:${String(item.message_id)}` : '';
    if (inboxId && nodes.has(inboxId)) addEdge(inboxId, id, 'replies_via', item);
  });
  deliveries.forEach((item: any, index: number) => {
    const deliveryId = String(item.delivery_id || item.id || item.message_id || index);
    const id = `delivery:${deliveryId}:${index}`;
    addNode(id, 'delivery', String(item.kind || deliveryId), String(item.status || 'recorded'), item);
    const outboxId = `outbox:${deliveryId}`;
    addEdge(nodes.has(outboxId) ? outboxId : surfaceNode, id, String(item.kind || 'attempt'), item);
  });
  triggers.forEach((item: any, index: number) => {
    const key = String(item.idempotency_key || item.id || index);
    const id = `trigger:${key}`;
    addNode(id, 'trigger-event', String(item.event_type || key), String(item.status || 'received'), item);
    addEdge(surfaceNode, id, String(item.status === 'retry_scheduled' ? 'retry_scheduled' : 'triggers'), item);
    const inboxId = item.message_id ? `inbox:${String(item.message_id)}` : '';
    if (inboxId && nodes.has(inboxId)) addEdge(id, inboxId, 'admits', item);
  });
  deadLetters.forEach((item: any, index: number) => {
    const deliveryId = String(item.delivery_id || item.id || index);
    const id = `dead-letter:${deliveryId}`;
    addNode(id, 'dead-letter', deliveryId, 'dead_letter', item);
    const outboxId = `outbox:${deliveryId}`;
    addEdge(nodes.has(outboxId) ? outboxId : surfaceNode, id, 'dead_letters', item);
  });
  const uniqueEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()];
  return { id: 'surface-topology', title, revision: nodes.size + uniqueEdges.length, status: nodes.size ? 'ready' : 'idle', nodes: [...nodes.values()], edges: uniqueEdges };
}
