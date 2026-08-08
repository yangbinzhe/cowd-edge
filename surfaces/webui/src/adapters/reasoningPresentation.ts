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

export function reasoningPresentation(
  events: ActivityEvent[],
  activities: ActivityView[],
  rootExecutionId = '',
): ReasoningPresentation {
  const agents = new Set(
    activities.filter((activity) => activity.kind === 'agent').map((activity) => activity.id),
  );
  const rootActivityIds = new Set(
    activities
      .filter((activity) => ['execution', 'goal'].includes(activity.kind))
      .map((activity) => activity.id),
  );
  const rootIdentity = String(rootExecutionId || '').trim();
  if (rootIdentity) {
    rootActivityIds.add(
      rootIdentity.startsWith('activity:execution:')
        ? rootIdentity
        : `activity:execution:${rootIdentity}`,
    );
  }
  const grouped = new Map<string, Map<string, ReasoningSegmentView>>();
  for (const event of events.filter((event) => event.kind === 'reasoning')) {
    const text = readableReasoningText(event.detail);
    const ownerActivityId = String(event.parent_activity_id || '').trim();
    const scope = agents.has(ownerActivityId)
      ? `agent:${ownerActivityId}`
      : rootActivityIds.has(ownerActivityId)
        ? 'global'
        : '';
    if (!scope || !text || !event.activity_id) continue;
    const entries = grouped.get(scope) || new Map<string, ReasoningSegmentView>();
    entries.set(event.activity_id, {
      id: event.activity_id,
      text,
      status: normalizedStatus(event.status),
      at: event.at,
      sequence: numericSequence(event.sequence),
      executionId: event.execution_id,
      agentId: event.agent_instance_id || event.agent_run_id,
    });
    grouped.set(scope, entries);
  }
  for (const activity of activities.filter((activity) => activity.kind === 'reasoning')) {
    const text = readableReasoningText(
      activity.detail
      || activity.canonical.public_summary
      || activity.canonical.result_summary,
    );
    if (!text) continue;
    const ownerActivityId = String(activity.parent_activity_id || '').trim();
    const scope = agents.has(ownerActivityId)
      ? `agent:${ownerActivityId}`
      : rootActivityIds.has(ownerActivityId)
        ? 'global'
        : '';
    if (!scope) continue;
    const segment: ReasoningSegmentView = {
      id: activity.id,
      text,
      status: normalizedStatus(activity.status),
      at: activity.at,
      sequence: numericSequence(activity.sequence),
      executionId: activity.execution_id || undefined,
      agentId: activity.agent_instance_id || activity.agent_run_id || undefined,
    };
    const entries = grouped.get(scope) || new Map<string, ReasoningSegmentView>();
    const previous = entries.get(segment.id);
    if (!previous || compareSegments(previous, segment) <= 0) {
      entries.set(segment.id, segment);
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

function compareSegments(left: ReasoningSegmentView, right: ReasoningSegmentView) {
  return timestamp(left.at) - timestamp(right.at)
    || left.sequence - right.sequence
    || left.id.localeCompare(right.id);
}
