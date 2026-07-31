import type { ActivityEvent } from '../types';

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clean(value: unknown) {
  return String(value || '').trim();
}

export function activityIdentityKey(event: ActivityEvent) {
  const execution = clean(event.execution_id || event.raw?.execution_id);
  const toolCall = clean(event.tool_call_id || event.raw?.tool_call_id);
  if (toolCall) return `${execution || 'unscoped'}|tool|${toolCall}`;
  const segment = clean(event.segment_id || event.raw?.segment_id);
  if (segment) return `${execution || 'unscoped'}|segment|${segment}`;
  const item = clean(event.item_id || event.raw?.item_id);
  if (item) return `${execution || 'unscoped'}|item|${item}`;
  return clean(event.id);
}

function compareActivity(left: ActivityEvent, right: ActivityEvent) {
  const leftCursor = finiteNumber(left.commit_cursor ?? left.raw?.runtime_commit_cursor);
  const rightCursor = finiteNumber(right.commit_cursor ?? right.raw?.runtime_commit_cursor);
  if (leftCursor !== undefined && rightCursor !== undefined && leftCursor !== rightCursor) {
    return leftCursor - rightCursor;
  }
  const sameExecution = clean(left.execution_id) === clean(right.execution_id);
  const leftCausal = finiteNumber(left.causal_sequence ?? left.raw?.causal_sequence);
  const rightCausal = finiteNumber(right.causal_sequence ?? right.raw?.causal_sequence);
  if (
    sameExecution
    && leftCausal !== undefined
    && rightCausal !== undefined
    && leftCausal !== rightCausal
  ) {
    return leftCausal - rightCausal;
  }
  const leftSequence = finiteNumber(left.sequence) ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = finiteNumber(right.sequence) ?? Number.MAX_SAFE_INTEGER;
  return leftSequence - rightSequence;
}

function decorateToolWaves(events: ActivityEvent[]) {
  const waveByCall = new Map<string, number>();
  const toolEvents = events.filter((event) => event.kind === 'tool' || event.kind === 'error');
  for (const event of toolEvents) {
    const parents = event.causal_parent_ids || [];
    const wave = parents.reduce(
      (maximum, parent) => Math.max(maximum, (waveByCall.get(parent) ?? -1) + 1),
      0,
    );
    event.wave = wave;
    if (event.tool_call_id) waveByCall.set(event.tool_call_id, wave);
  }
  const lanes = new Map<string, ActivityEvent[]>();
  for (const event of toolEvents) {
    const key = `${event.execution_id || 'unscoped'}|${event.model_step_id || 'step'}|${event.wave || 0}`;
    const rows = lanes.get(key) || [];
    rows.push(event);
    lanes.set(key, rows);
  }
  for (const rows of lanes.values()) {
    rows.forEach((event, index) => {
      event.lane = index;
      event.lane_count = rows.length;
    });
  }
}

export function causalActivityTimeline(events: ActivityEvent[], limit = 160) {
  const ordered = events
    .map((event) => ({ ...event, causal_parent_ids: [...(event.causal_parent_ids || [])] }))
    .sort(compareActivity);
  decorateToolWaves(ordered);
  return ordered.slice(-Math.max(1, limit));
}

export function appendReasoningSummary(previous: string, delta: string, limit = 16_384) {
  const combined = `${previous || ''}${delta || ''}`.replace(/\r\n/g, '\n');
  if (combined.length <= limit) return combined;
  let start = combined.length - limit;
  while (start < combined.length && isLowSurrogate(combined.charCodeAt(start))) start += 1;
  return `[earlier public reasoning omitted]\n${combined.slice(start)}`;
}

function isLowSurrogate(value: number) {
  return value >= 0xDC00 && value <= 0xDFFF;
}
