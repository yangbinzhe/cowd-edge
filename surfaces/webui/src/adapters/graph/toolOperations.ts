import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';

function payload(result: any) { return result?.data?.data || result?.data || result || {}; }

export function adaptToolOperationsGraph(result: any, checkpoints: any[], ledger: any[], title = ''): GraphViewModel {
  const data = payload(result);
  const nodes: GraphNodeView[] = [];
  const edges: GraphEdgeView[] = [];
  const operationId = String(data.plan_id || data.request_id || data.transaction_id || result?.request_id || 'tool-operation');
  nodes.push({ id: operationId, type: 'tool-operation', label: String(data.kind || data.mode || 'operation'), status: String(data.status || result?.status || (result ? 'ready' : 'idle')), group: 'operation', summary: String(data.summary || data.prompt || operationId), raw: data });
  const calls = Array.isArray(data.tool_calls) ? data.tool_calls : Array.isArray(data.calls) ? data.calls : [];
  calls.forEach((call: any, index: number) => {
    const id = `tool-call:${String(call.id || call.name || call.tool_name || index)}:${index}`;
    nodes.push({ id, type: 'tool-call', label: String(call.name || call.tool_name || id), status: String(call.status || 'planned'), group: 'tool', summary: String(call.purpose || call.reason || ''), badges: [call.cache_policy, call.safety_category || call.risk].filter(Boolean).map(String), raw: call });
    edges.push({ id: `${operationId}:${id}`, source: operationId, target: id, type: 'plans', label: 'plans', raw: call });
  });
  const files = Array.isArray(data.files) ? data.files : Array.isArray(data.preview) ? data.preview : [];
  files.forEach((file: any, index: number) => {
    const id = `mutation:${String(file.path || index)}`;
    nodes.push({ id, type: 'mutation', label: String(file.path || id), status: String(file.status || file.action || 'preview'), group: 'mutation', summary: String(file.changed === false ? 'unchanged' : file.expected_hash || ''), raw: file });
    edges.push({ id: `${operationId}:${id}`, source: operationId, target: id, type: 'mutates', label: 'mutates', raw: file });
  });
  checkpoints.slice(0, 20).forEach((checkpoint: any, index: number) => nodes.push({ id: `checkpoint:${String(checkpoint.id || checkpoint.checkpoint_id || index)}`, type: 'checkpoint', label: String(checkpoint.label || checkpoint.id || index), status: 'available', group: 'checkpoint', summary: String(checkpoint.created_at || checkpoint.created_at_ms || ''), raw: checkpoint }));
  ledger.slice(0, 20).forEach((event: any, index: number) => {
    const toolName = String(event.tool || event.tool_name || event.name || '');
    const call = nodes.find((node) => node.type === 'tool-call' && node.label === toolName);
    if (call) call.badges = [...(call.badges || []), String(event.status || event.level || `event ${index + 1}`)];
  });
  return { id: operationId, title, revision: nodes.length + edges.length, status: String(data.status || (result ? 'ready' : 'idle')), nodes, edges };
}
