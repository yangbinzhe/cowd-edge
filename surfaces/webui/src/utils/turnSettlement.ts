import type { ActivityEvent, ChatTurn } from '../types';

export interface TurnActivitySummary {
  total: number;
  tools: number;
  thinking: number;
  context: number;
  approvals: number;
  errors: number;
}

function clean(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function activityDedupeKey(event: ActivityEvent) {
  return [
    clean(event.kind).toLowerCase(),
    clean(event.title).toLowerCase(),
    clean(event.status).toLowerCase(),
    clean(event.detail).slice(0, 120).toLowerCase(),
  ].join(':');
}

export function normalizeTurnActivity(event: ActivityEvent): ActivityEvent {
  return {
    ...event,
    title: clean(event.title) || clean(event.kind) || 'event',
    detail: event.kind === 'think'
      ? String(event.detail || '').replace(/\r\n/g, '\n').trim()
      : clean(event.detail),
    status: clean(event.status || 'observed'),
  };
}

export function mergeActivityEvent(
  previous: ActivityEvent | undefined,
  incoming: ActivityEvent,
): ActivityEvent {
  if (!previous) return normalizeTurnActivity(incoming);
  const normalized = normalizeTurnActivity(incoming);
  return normalizeTurnActivity({
    ...previous,
    ...normalized,
    detail: normalized.detail || previous.detail,
    status: normalized.status || previous.status,
    duration_ms: normalized.duration_ms ?? previous.duration_ms,
    input: normalized.input ?? previous.input,
    output: normalized.output ?? previous.output,
    sequence: previous.sequence ?? normalized.sequence,
    commit_cursor: previous.commit_cursor ?? normalized.commit_cursor,
    causal_sequence: previous.causal_sequence ?? normalized.causal_sequence,
    raw: {
      ...(previous.raw || {}),
      ...(normalized.raw || {}),
    },
  });
}

export function mergeTurnActivity(existing: ActivityEvent[] = [], incoming: ActivityEvent | ActivityEvent[]) {
  const next = [...existing.map(normalizeTurnActivity)];
  const seen = new Set(next.map(activityDedupeKey));
  const rows = Array.isArray(incoming) ? incoming : [incoming];
  rows.map(normalizeTurnActivity).forEach((row) => {
    const key = activityDedupeKey(row);
    if (!key || seen.has(key)) return;
    seen.add(key);
    next.push(row);
  });
  return next.slice(-24);
}

export function activitySummary(turn: Pick<ChatTurn, 'activity' | 'tool_name'>): TurnActivitySummary {
  const events = Array.isArray(turn.activity) ? turn.activity : [];
  const summary = events.reduce<TurnActivitySummary>((acc, event) => {
    const kind = clean(event.kind).toLowerCase();
    const text = `${kind} ${event.title || ''} ${event.detail || ''}`.toLowerCase();
    acc.total += 1;
    if (kind === 'tool' || text.includes('tool')) acc.tools += 1;
    else if (kind === 'think' || text.includes('thinking')) acc.thinking += 1;
    else if (kind === 'context' || text.includes('context') || text.includes('memory')) acc.context += 1;
    else if (kind === 'approval' || text.includes('approval') || text.includes('policy')) acc.approvals += 1;
    if (kind === 'error' || String(event.status || '').toLowerCase().includes('error') || text.includes('failed')) acc.errors += 1;
    return acc;
  }, { total: 0, tools: 0, thinking: 0, context: 0, approvals: 0, errors: 0 });
  if (turn.tool_name && summary.tools === 0) {
    summary.total += 1;
    summary.tools += 1;
  }
  return summary;
}

export function hasTurnActivity(turn: Pick<ChatTurn, 'activity' | 'tool_name'>) {
  return activitySummary(turn).total > 0;
}
