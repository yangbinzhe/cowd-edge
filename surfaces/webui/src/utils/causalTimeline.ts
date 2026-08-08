import type { ActivityEvent } from '../types';

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clean(value: unknown) {
  return String(value || '').trim();
}

export function activityIdentityKey(event: ActivityEvent) {
  const canonicalActivity = clean(event.activity_id || event.activity_binding?.activity_id);
  if (canonicalActivity) return `activity|${canonicalActivity}`;
  const execution = clean(event.execution_id || event.raw?.execution_id);
  if (event.kind === 'agent') {
    const run = clean(event.raw?.run_id || event.execution_id || event.agent_id);
    const phase = clean(event.phase || event.raw?.phase || event.status);
    if (run) return `${run}|agent|${phase || 'lifecycle'}`;
  }
  const toolCall = clean(event.tool_call_id || event.raw?.tool_call_id);
  if (toolCall) return `${execution || 'unscoped'}|tool|${toolCall}`;
  const segment = clean(event.segment_id || event.raw?.segment_id);
  if (segment) return `${execution || 'unscoped'}|segment|${segment}`;
  const item = clean(event.item_id || event.raw?.item_id);
  if (item) return `${execution || 'unscoped'}|item|${item}`;
  return clean(event.id);
}

function compareActivity(left: ActivityEvent, right: ActivityEvent) {
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
  const leftAt = activityTime(left);
  const rightAt = activityTime(right);
  if (leftAt !== undefined && rightAt !== undefined && leftAt !== rightAt) {
    return leftAt - rightAt;
  }
  if (sameExecution && left.kind === 'agent' && right.kind === 'agent') {
    const phaseDifference = agentPhaseRank(left) - agentPhaseRank(right);
    if (phaseDifference) return phaseDifference;
  }
  const leftSequence = finiteNumber(left.sequence) ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = finiteNumber(right.sequence) ?? Number.MAX_SAFE_INTEGER;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  const leftCursor = finiteNumber(left.commit_cursor ?? left.raw?.runtime_commit_cursor);
  const rightCursor = finiteNumber(right.commit_cursor ?? right.raw?.runtime_commit_cursor);
  return (leftCursor ?? Number.MAX_SAFE_INTEGER) - (rightCursor ?? Number.MAX_SAFE_INTEGER);
}

function activityTime(event: ActivityEvent) {
  const value = event.at;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function agentPhaseRank(event: ActivityEvent) {
  const phase = clean(event.phase || event.status).toLowerCase();
  const ranks: Record<string, number> = {
    delegated: 0,
    prepared: 1,
    started: 2,
    running: 2,
    first_output: 3,
    evaluating: 4,
    completed: 5,
    complete: 5,
    failed: 5,
    cancelled: 5,
    blocked: 5,
  };
  return ranks[phase] ?? 3;
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

function decorateAgentLanes(events: ActivityEvent[]) {
  const roles = new Map<string, string>();
  for (const event of events) {
    const agent = clean(event.agent_id);
    const role = clean(event.role || event.agent_lane_label);
    if (agent && role) roles.set(agent, role);
  }
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const agent = clean(event.agent_id);
    const execution = clean(event.execution_id);
    if (!agent && !event.parent_execution_id) continue;
    const group = [
      clean(event.parent_execution_id || event.graph_id || 'root'),
      clean(event.team_id || 'team'),
    ].join('|');
    const rows = groups.get(group) || [];
    rows.push(event);
    groups.set(group, rows);
    if (!agent && execution) roles.set(execution, clean(event.role));
  }
  for (const rows of groups.values()) {
    const laneKeys = Array.from(new Set(rows.map((event) => (
      clean(event.agent_id || event.execution_id)
    )).filter(Boolean)));
    const laneByKey = new Map(laneKeys.map((key, index) => [key, index]));
    for (const event of rows) {
      const key = clean(event.agent_id || event.execution_id);
      if (!key) continue;
      event.agent_lane = laneByKey.get(key) ?? 0;
      event.agent_lane_count = laneKeys.length;
      event.agent_lane_label = clean(event.role) || roles.get(key) || key;
    }
  }
}

export function causalActivityTimeline(events: ActivityEvent[], limit = 160) {
  const ordered = events
    .map((event) => ({ ...event, causal_parent_ids: [...(event.causal_parent_ids || [])] }))
    .sort(compareActivity);
  decorateAgentLanes(ordered);
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
