import type { ActivityEvent } from '../types';

interface ToolBatchCall {
  id: string;
  name: string;
  input: unknown;
  depends_on: string[];
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function decodedJson(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function toolBatchCalls(node: Record<string, any>): ToolBatchCall[] {
  const payload = record(decodedJson(node.payload_ref));
  if (!Array.isArray(payload.calls)) return [];
  return payload.calls.flatMap((value: unknown) => {
    const call = record(value);
    const id = String(call.id || '').trim();
    const name = String(call.name || '').trim();
    if (!id || !name) return [];
    return [{
      id,
      name,
      input: decodedJson(call.input),
      depends_on: Array.isArray(call.depends_on)
        ? call.depends_on.map(String).filter(Boolean)
        : [],
    }];
  });
}

function eventTime(event: ActivityEvent, index: number) {
  const raw = typeof event.at === 'number' ? event.at : Date.parse(String(event.at || ''));
  return Number.isFinite(raw) ? raw : index;
}

function toolCallActivities(toolCallId: string, events: ActivityEvent[]) {
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => (
      event.tool_call_id === toolCallId
      || event.item_id === toolCallId
      || event.id === toolCallId
    ))
    .sort((left, right) => (
      eventTime(left.event, left.index) - eventTime(right.event, right.index)
    ))
    .map(({ event }) => event);
}

function activityEvidence(events: ActivityEvent[]) {
  const refs = new Set<string>();
  for (const event of events) {
    for (const reference of event.refs || []) {
      if (reference) refs.add(String(reference));
    }
    const raw = record(event.raw);
    for (const key of ['full_output_ref', 'output_ref', 'evidence_ref']) {
      if (raw[key]) refs.add(String(raw[key]));
    }
  }
  return [...refs];
}

function toolCallStatus(events: ActivityEvent[], fallback: unknown) {
  const status = [...events].reverse().find((event) => event.status)?.status;
  return String(status || fallback || 'planned');
}

function toolCallOutput(events: ActivityEvent[]) {
  return [...events].reverse().find((event) => event.output !== undefined)?.output;
}

function activityNodeId(event: ActivityEvent) {
  return String(
    event.node_id
    || event.raw?.node_id
    || event.raw?.execution_node_id
    || '',
  ).trim();
}

function agentNodeActivity(node: Record<string, any>, events: ActivityEvent[]) {
  const originalNodeId = String(node.original_node_id || node.node_id || '').trim();
  const childExecutionId = String(node.child_execution_id || '').trim();
  return [...events].reverse().find((event) => (
    event.kind === 'agent'
    && (
      (!!originalNodeId && activityNodeId(event) === originalNodeId)
      || (!!childExecutionId && event.execution_id === childExecutionId)
    )
  ));
}

function agentActivityStatus(event: ActivityEvent) {
  const phase = String(event.phase || event.status || '').toLowerCase();
  if (['started', 'running', 'first_output', 'evaluating'].includes(phase)) return 'running';
  if (['completed', 'complete'].includes(phase)) return 'completed';
  if (['failed', 'cancelled', 'blocked'].includes(phase)) return phase;
  return String(event.status || phase || 'planned');
}

/**
 * Apply live lifecycle facts to existing semantic nodes without changing
 * topology. ExecutionGraph remains authoritative; this only closes projection
 * delay between a durable Agent transition and the next graph refresh.
 */
export function applyExecutionActivityState(
  graph: Record<string, any> | null,
  activityEvents: ActivityEvent[] = [],
) {
  if (!graph || !activityEvents.length) return graph;
  let changed = false;
  const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []).map((node: Record<string, any>) => {
    if (!node.semantic_view || String(node.kind || '').toLowerCase() !== 'agent_task') return node;
    const activity = agentNodeActivity(node, activityEvents);
    if (!activity) return node;
    const outputSummary = String(activity.output || activity.detail || '').trim();
    const evidenceRefs = [
      ...(Array.isArray(node.evidence_refs) ? node.evidence_refs : []),
      ...(Array.isArray(activity.refs) ? activity.refs : []),
      ...(Array.isArray(activity.raw?.evidence_refs) ? activity.raw.evidence_refs : []),
    ].map(String).filter(Boolean);
    changed = true;
    return {
      ...node,
      status: agentActivityStatus(activity),
      output_summary: outputSummary || node.output_summary,
      evidence_refs: [...new Set(evidenceRefs)],
    };
  });
  return changed ? { ...graph, nodes } : graph;
}

function expandedCallNode(
  batch: Record<string, any>,
  call: ToolBatchCall,
  nodeId: string,
  activities: ActivityEvent[],
) {
  const latest = activities.at(-1);
  return {
    node_id: nodeId,
    original_node_id: call.id,
    parent_node_id: String(batch.node_id || ''),
    execution_id: batch.execution_id,
    parent_execution_id: batch.parent_execution_id,
    session_id: batch.session_id,
    turn_id: batch.turn_id,
    task_id: batch.task_id,
    kind: 'tool_call',
    executor_kind: call.name,
    status: toolCallStatus(activities, batch.status),
    summary: call.name,
    tool_call_id: call.id,
    payload_ref: call.input,
    input: call.input,
    output: toolCallOutput(activities),
    duration_ms: [...activities].reverse().find((event) => event.duration_ms != null)?.duration_ms,
    evidence_refs: activityEvidence(activities),
    started_at: activities.find((event) => event.status === 'running')?.at,
    completed_at: latest?.at,
    activity_event_ids: activities.map((event) => event.id).filter(Boolean),
  };
}

/**
 * Expands the canonical tool-batch node into its declared tool-call DAG.
 * The batch remains as the join node, so downstream graph semantics are unchanged.
 */
export function expandExecutionToolBatches(
  graph: Record<string, any> | null,
  activityEvents: ActivityEvent[] = [],
) {
  if (!graph) return null;
  const sourceNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const sourceEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodes = [...sourceNodes];
  let edges = [...sourceEdges];
  let expanded = false;

  for (const batch of sourceNodes) {
    if (String(batch?.kind || '').toLowerCase() !== 'tool_batch') continue;
    const calls = toolBatchCalls(batch);
    if (!calls.length) continue;

    const batchId = String(batch.node_id || '');
    const callNodeIds = new Map(
      calls.map((call) => [call.id, `${batchId}:call:${call.id}`]),
    );
    if (!batchId || [...callNodeIds.values()].some((id) => nodes.some((node) => node.node_id === id))) {
      continue;
    }

    const incoming = edges.filter((edge) => String(edge?.to || '') === batchId);
    edges = edges.filter((edge) => String(edge?.to || '') !== batchId);
    const localDependencies = new Map<string, string[]>();

    for (const call of calls) {
      const dependencies = call.depends_on.filter((dependency) => callNodeIds.has(dependency));
      localDependencies.set(call.id, dependencies);
      const callNodeId = callNodeIds.get(call.id)!;
      const activities = toolCallActivities(call.id, activityEvents);
      nodes.push(expandedCallNode(batch, call, callNodeId, activities));

      if (dependencies.length) {
        for (const dependency of dependencies) {
          edges.push({
            from: callNodeIds.get(dependency),
            to: callNodeId,
            kind: 'depends_on',
            tool_call_id: call.id,
          });
        }
      } else {
        for (const edge of incoming) {
          edges.push({
            ...edge,
            to: callNodeId,
            expanded_tool_batch_id: batchId,
          });
        }
      }
    }

    const dependedOn = new Set([...localDependencies.values()].flat());
    for (const call of calls) {
      if (dependedOn.has(call.id)) continue;
      edges.push({
        from: callNodeIds.get(call.id),
        to: batchId,
        kind: 'joins',
        tool_call_id: call.id,
      });
    }
    expanded = true;
  }

  return expanded ? { ...graph, nodes, edges } : graph;
}
