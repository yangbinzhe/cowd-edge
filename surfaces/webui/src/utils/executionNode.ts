import type { ActivityEvent } from '../types';
import { t } from '../i18n';

const nodeKindLabels: Record<string, string> = {
  agent_task: 'execution.kind.agentTask',
  approval: 'execution.kind.approval',
  child_execution: 'execution.kind.childExecution',
  command: 'execution.kind.command',
  execution: 'execution.kind.execution',
  inline_model: 'execution.kind.model',
  recovery: 'execution.kind.recovery',
  synthesize: 'execution.kind.synthesize',
  team: 'execution.kind.team',
  tool_batch: 'execution.kind.toolBatch',
  tool_call: 'execution.kind.toolCall',
  verify: 'execution.kind.verify',
};

export function executionNodeKindLabel(kind: unknown) {
  const raw = String(kind || 'execution').trim();
  const normalized = raw.toLowerCase();
  return nodeKindLabels[normalized]
    ? t(nodeKindLabels[normalized])
    : raw.replace(/_/g, ' ');
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function decodedPayload(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === null || item === undefined || item === '') return false;
      if (Array.isArray(item)) return item.length > 0;
      if (typeof item === 'object') return Object.keys(item as Record<string, unknown>).length > 0;
      return true;
    }),
  );
}

function activityNodeRefs(event: ActivityEvent) {
  const raw = record(event.raw);
  const payload = record(raw.payload);
  const detail = record(raw.detail);
  return new Set([
    raw.node_id,
    raw.execution_node_id,
    raw.parent_node_id,
    payload.node_id,
    payload.execution_node_id,
    payload.parent_node_id,
    detail.node_id,
    detail.execution_node_id,
    ...(event.refs || []),
  ].filter(Boolean).map(String));
}

export function executionNodeActivities(node: Record<string, any>, events: ActivityEvent[]) {
  const nodeId = String(node.node_id || node.id || '');
  const originalNodeId = String(node.original_node_id || '');
  const canonicalNodeIds = new Set(
    (Array.isArray(node.canonical_node_ids) ? node.canonical_node_ids : [])
      .map(String)
      .filter(Boolean),
  );
  const toolCallId = String(node.tool_call_id || '');
  if (!nodeId) return [];
  return events.filter((event) => {
    if (toolCallId && (
      event.tool_call_id === toolCallId
      || event.item_id === toolCallId
      || event.id === toolCallId
    )) return true;
    const refs = activityNodeRefs(event);
    if (
      refs.has(nodeId)
      || (!!originalNodeId && refs.has(originalNodeId))
      || [...canonicalNodeIds].some((reference) => refs.has(reference))
    ) return true;
    return String(event.correlation || '')
      .split(/\s*·\s*/)
      .some((reference) => reference === nodeId || reference === originalNodeId);
  });
}

export function activeExecutionNode(nodes: Record<string, any>[]) {
  const priority = ['running', 'waiting_approval', 'waiting_input', 'waiting_external', 'ready', 'planned'];
  for (const status of priority) {
    const matched = nodes.find((node) => String(node.status || '').toLowerCase() === status);
    if (matched) return matched;
  }
  return [...nodes].reverse().find((node) => String(node.status || '').toLowerCase() === 'completed')
    || nodes[0]
    || null;
}

export function executionNodeDetail(
  node: Record<string, any> | null,
  objective: string,
  events: ActivityEvent[],
) {
  if (!node) return null;
  const related = executionNodeActivities(node, events);
  const inputEvent = related.find((event) => event.input !== undefined)
    || related.find((event) => event.raw?.input !== undefined);
  const outputEvent = [...related].reverse().find((event) => event.output !== undefined)
    || [...related].reverse().find((event) => event.raw?.output !== undefined);
  const acceptance = record(node.acceptance);
  const inputFallback = compactObject({
    payload_ref: node.payload_ref,
    criteria: acceptance.criteria,
    required_evidence: acceptance.required_evidence,
    minimum_score_basis_points: acceptance.minimum_score_basis_points,
    resource_scopes: node.resource_scopes,
  });
  const outputFallback = compactObject({
    output: node.output,
    summary: node.summary,
    result_ref: node.result_ref,
    failure: node.failure,
    evidence_refs: node.evidence_refs,
    usage: node.usage,
  });
  const semantic = Boolean(node.semantic_view);
  return {
    id: String(node.node_id || node.id || ''),
    title: String(node.executor_kind || node.kind || node.node_id || node.id || ''),
    kind: String(node.kind || 'execution'),
    status: String(node.status || 'planned'),
    description: String(node.description || objective || ''),
    summary: String(node.summary || ''),
    input: decodedPayload(semantic ? node.input : (inputEvent?.input ?? inputEvent?.raw?.input))
      ?? (Object.keys(inputFallback).length ? inputFallback : null),
    output: decodedPayload(semantic ? node.output : (outputEvent?.output ?? outputEvent?.raw?.output))
      ?? (Object.keys(outputFallback).length ? outputFallback : null),
    relatedActivities: related,
    raw: node,
  };
}
