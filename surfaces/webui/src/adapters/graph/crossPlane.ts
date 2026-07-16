import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

export function adaptCrossPlaneGraph(input: Record<string, any>, title = ''): GraphViewModel {
  const nodes = new Map<string, GraphNodeView>();
  const edges: GraphEdgeView[] = [];
  const addNode = (id: string, type: string, label: string, status: string, raw: any) => {
    if (!id || nodes.has(id)) return;
    nodes.set(id, { id, type, label: label || id, status: status || 'recorded', group: type, summary: String(raw?.summary || raw?.identity_ref || raw?.capability || raw?.resource_ref || id), raw });
  };
  const addEdge = (source: string, target: string, type: string, raw: any) => {
    if (!source || !target || !nodes.has(source) || !nodes.has(target)) return;
    edges.push({ id: `${type}:${source}:${target}`, source, target, type, label: type.replace(/_/g, ' '), raw });
  };
  const identities = Array.isArray(input.identities) ? input.identities : [];
  const grants = Array.isArray(input.grants) ? input.grants : [];
  const executions = Array.isArray(input.executions) ? input.executions : [];
  const action = input.action?.data?.data || input.action?.data || input.action || {};

  [...identities, ...grants, ...executions].forEach((item: any) => {
    const principal = String(item.principal_id || item.actor_principal || '');
    if (principal) addNode(`principal:${principal}`, 'principal', principal, 'verified', { principal_id: principal });
  });
  identities.forEach((item: any) => {
    const id = `identity:${String(item.id || item.identity_ref || '')}`;
    addNode(id, 'identity', String(item.identity_ref || item.id || ''), String(item.trust || item.status || 'unknown'), item);
    addEdge(`principal:${String(item.principal_id || '')}`, id, 'binds', item);
  });
  grants.forEach((item: any) => {
    const id = `grant:${String(item.id || '')}`;
    const capabilityValue = String(item.capability || '');
    const capability = capabilityValue ? `capability:${capabilityValue}` : '';
    const resource = item.resource_ref ? `resource:${String(item.resource_ref)}` : '';
    addNode(id, 'grant', String(item.grant_type || item.id || ''), String(item.status || 'active'), item);
    if (capability) addNode(capability, 'capability', capabilityValue, 'declared', item);
    if (resource) addNode(resource, 'resource', String(item.resource_ref), 'scoped', item);
    addEdge(`principal:${String(item.principal_id || '')}`, id, 'owns', item);
    if (capability) addEdge(id, capability, 'permits', item);
    if (resource) addEdge(id, resource, 'scopes', item);
  });
  executions.forEach((item: any) => {
    const id = `execution:${String(item.execution_id || item.id || '')}`;
    const capabilityValue = String(item.requested_capability || item.capability || '');
    const capability = capabilityValue ? `capability:${capabilityValue}` : '';
    addNode(id, 'cross-plane-execution', String(item.mode || item.execution_id || item.id || ''), String(item.status || item.dispatch_status || 'recorded'), item);
    if (capability) addNode(capability, 'capability', capabilityValue, 'declared', item);
    addEdge(`principal:${String(item.actor_principal || item.principal_id || '')}`, id, 'requests', item);
    if (capability) addEdge(id, capability, 'executes', item);
  });
  const stages = [
    ['preflight', action.preflight || action.plan],
    ['policy', action.policy || action.simulation || action.decision],
    ['execute', action.execution || (action.execution_id ? action : null)],
    ['audit', action.audit || (action.audit_ref ? { audit_ref: action.audit_ref, status: 'recorded' } : null)],
  ].filter((entry) => entry[1]);
  stages.forEach(([kind, stage]: any, index) => {
    const id = `stage:${kind}:${String(stage.id || stage.execution_id || action.request_id || 'current')}`;
    addNode(id, `cross-plane-${kind}`, String(kind), String(stage.status || stage.result || 'recorded'), stage);
    if (index > 0) {
      const [previousKind, previousStage]: any = stages[index - 1];
      addEdge(`stage:${previousKind}:${String(previousStage.id || previousStage.execution_id || action.request_id || 'current')}`, id, 'then', stage);
    }
  });
  const uniqueEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()];
  return { id: 'cross-plane-permissions', title, revision: nodes.size + uniqueEdges.length, status: nodes.size ? 'ready' : 'idle', nodes: [...nodes.values()], edges: uniqueEdges };
}
