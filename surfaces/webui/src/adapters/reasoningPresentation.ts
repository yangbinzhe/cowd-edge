import type { ActivityEvent } from '../types';
import type { ActivityView } from './executionActivity';

const TERMINAL_STATUSES = new Set([
  'complete',
  'completed',
  'completed_with_warnings',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
  'rejected',
  'error',
]);

export interface ReasoningSegmentView {
  id: string;
  text: string;
  status: string;
  at?: string | number;
  sequence: number;
  executionId?: string;
  agentId?: string;
}

export interface ReasoningGroupView {
  ownerActivityId?: string;
  scope: 'global' | 'agent';
  items: ReasoningSegmentView[];
  latest: ReasoningSegmentView;
  running: boolean;
  count: number;
}

export interface ReasoningPresentation {
  global: ReasoningGroupView | null;
  byOwner: Record<string, ReasoningGroupView>;
}

interface ReasoningSource {
  id: string;
  text: string;
  status: string;
  at?: string | number;
  sequence: number;
  executionId: string;
  agentId: string;
  parentActivityId: string;
  assistantProgress: boolean;
}

export function reasoningPresentation(
  events: ActivityEvent[],
  activities: ActivityView[],
  rootExecutionId = '',
): ReasoningPresentation {
  const agents = activities.filter((activity) => activity.kind === 'agent');
  const rootActivityIds = new Set(
    activities
      .filter((activity) => ['execution', 'goal'].includes(activity.kind))
      .map((activity) => activity.id),
  );
  const sources = [
    ...events.filter((event) => event.kind === 'think').map(eventReasoningSource),
    ...activities.filter(publicReasoningActivity).map(activityReasoningSource),
  ]
    .filter((source): source is ReasoningSource => Boolean(source?.text))
    .sort(compareSources);

  const grouped = new Map<string, Map<string, ReasoningSegmentView>>();
  for (const source of sources) {
    const ownerActivityId = exactAgentOwner(source, agents);
    const scope = ownerActivityId
      ? `agent:${ownerActivityId}`
      : isGlobalReasoning(source, rootExecutionId, rootActivityIds)
        ? 'global'
        : '';
    if (!scope) continue;

    const segment: ReasoningSegmentView = {
      id: source.id,
      text: source.text,
      status: source.status,
      at: source.at,
      sequence: source.sequence,
      executionId: source.executionId || undefined,
      agentId: source.agentId || undefined,
    };
    const normalized = normalizedText(source.text);
    const entries = grouped.get(scope) || new Map<string, ReasoningSegmentView>();
    const previous = entries.get(normalized);
    if (!previous || compareSegments(previous, segment) <= 0) {
      entries.set(normalized, segment);
    }
    grouped.set(scope, entries);
  }

  const global = buildGroup(grouped.get('global'), 'global');
  const byOwner: Record<string, ReasoningGroupView> = {};
  for (const [scope, entries] of grouped) {
    if (!scope.startsWith('agent:')) continue;
    const ownerActivityId = scope.slice('agent:'.length);
    const group = buildGroup(entries, 'agent', ownerActivityId);
    if (group) byOwner[ownerActivityId] = group;
  }
  return { global, byOwner };
}

function eventReasoningSource(event: ActivityEvent): ReasoningSource | null {
  const text = readableReasoningText(event.detail);
  if (!text) return null;
  return {
    id: String(event.activity_id || event.id),
    text,
    status: normalizedStatus(event.status),
    at: event.at,
    sequence: numericSequence(event.sequence),
    executionId: String(event.execution_id || '').trim(),
    agentId: String(
      event.agent_instance_id
      || event.agent_run_id
      || event.agent_id
      || '',
    ).trim(),
    parentActivityId: String(event.parent_activity_id || '').trim(),
    assistantProgress: String(event.id || '').startsWith('assistant-progress:'),
  };
}

function activityReasoningSource(activity: ActivityView): ReasoningSource | null {
  const text = readableReasoningText(activity.detail || activity.canonical.public_summary);
  if (!text) return null;
  return {
    id: activity.id,
    text,
    status: normalizedStatus(activity.status),
    at: activity.at,
    sequence: numericSequence(activity.sequence),
    executionId: String(
      activity.execution_id
      || activity.canonical.scope.execution_id
      || '',
    ).trim(),
    agentId: String(
      activity.agent_instance_id
      || activity.agent_run_id
      || activity.agent_id
      || '',
    ).trim(),
    parentActivityId: String(activity.parent_activity_id || '').trim(),
    assistantProgress: false,
  };
}

function publicReasoningActivity(activity: ActivityView) {
  if (activity.kind !== 'model') return false;
  const marker = [
    activity.id,
    activity.phase,
    activity.canonical.phase,
    activity.canonical.display_label,
  ].join(' ').toLowerCase();
  return marker.includes('public_reasoning')
    || marker.includes('reasoning_summary')
    || marker.includes('reasoning summary');
}

function exactAgentOwner(source: ReasoningSource, agents: ActivityView[]) {
  if (source.parentActivityId) {
    const parent = agents.find((agent) => agent.id === source.parentActivityId);
    if (parent) return parent.id;
  }
  if (!source.executionId && !source.agentId) return '';
  const owner = agents.find((agent) => {
    const identities = new Set([
      agent.execution_id,
      agent.agent_id,
      agent.agent_run_id,
      agent.agent_instance_id,
      agent.canonical.scope.execution_id,
      agent.canonical.agent_run_id,
      agent.canonical.agent_instance_id,
    ].map((value) => String(value || '').trim()).filter(Boolean));
    return (source.executionId && identities.has(source.executionId))
      || (source.agentId && identities.has(source.agentId));
  });
  return owner?.id || '';
}

function isGlobalReasoning(
  source: ReasoningSource,
  rootExecutionId: string,
  rootActivityIds: Set<string>,
) {
  if (source.assistantProgress) return true;
  if (source.agentId) return false;
  if (source.parentActivityId && rootActivityIds.has(source.parentActivityId)) return true;
  const root = String(rootExecutionId || '').trim();
  if (root) return !source.executionId || source.executionId === root;
  return !source.executionId && !source.parentActivityId;
}

function buildGroup(
  entries: Map<string, ReasoningSegmentView> | undefined,
  scope: ReasoningGroupView['scope'],
  ownerActivityId?: string,
): ReasoningGroupView | null {
  const items = [...(entries?.values() || [])].sort(compareSegments);
  const latest = items.at(-1);
  if (!latest) return null;
  return {
    ownerActivityId,
    scope,
    items,
    latest,
    running: items.some((item) => !TERMINAL_STATUSES.has(normalizedStatus(item.status))),
    count: items.length,
  };
}

function readableReasoningText(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  const fenced = text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  const candidate = fenced?.[1]?.trim() || text;
  if (
    (candidate.startsWith('{') && candidate.endsWith('}'))
    || (candidate.startsWith('[') && candidate.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return '';
    } catch {
      // Ordinary prose may contain braces.
    }
  }
  return text;
}

function normalizedStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'complete' || status === 'succeeded') return 'completed';
  return status || 'planned';
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function numericSequence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function compareSources(left: ReasoningSource, right: ReasoningSource) {
  return timestamp(left.at) - timestamp(right.at)
    || left.sequence - right.sequence
    || left.id.localeCompare(right.id);
}

function compareSegments(left: ReasoningSegmentView, right: ReasoningSegmentView) {
  return timestamp(left.at) - timestamp(right.at)
    || left.sequence - right.sequence
    || left.id.localeCompare(right.id);
}
