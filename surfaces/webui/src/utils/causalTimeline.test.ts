import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../types';
import {
  activityIdentityKey,
  appendReasoningSummary,
  causalActivityTimeline,
} from './causalTimeline';

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: String(overrides.id || 'event'),
    kind: overrides.kind || 'tool',
    title: String(overrides.title || overrides.id || 'event'),
    execution_id: 'execution-1',
    model_step_id: 'step-1',
    ...overrides,
  };
}

describe('causal activity timeline', () => {
  it('orders same-execution causal items while preserving parallel tool lanes', () => {
    const rows = causalActivityTimeline([
      event({
        id: 'reasoning-2',
        kind: 'think',
        segment_id: 'reasoning-2:summary:0',
        commit_cursor: 18,
      }),
      event({
        id: 'tool-b',
        tool_call_id: 'tool-b',
        causal_sequence: 3,
        commit_cursor: 14,
      }),
      event({
        id: 'reasoning-1',
        kind: 'think',
        segment_id: 'reasoning-1:summary:0',
        commit_cursor: 10,
      }),
      event({
        id: 'tool-a',
        tool_call_id: 'tool-a',
        causal_sequence: 2,
        commit_cursor: 12,
      }),
    ]);

    expect(rows.map((row) => row.id)).toEqual([
      'reasoning-1',
      'tool-a',
      'tool-b',
      'reasoning-2',
    ]);
    expect(rows.find((row) => row.id === 'tool-a')).toMatchObject({ wave: 0, lane: 0, lane_count: 2 });
    expect(rows.find((row) => row.id === 'tool-b')).toMatchObject({ wave: 0, lane: 1, lane_count: 2 });
  });

  it('projects concurrent child agents into stable parallel lanes', () => {
    const rows = causalActivityTimeline([
      event({
        id: 'agent-a-started',
        kind: 'agent',
        execution_id: 'agent-run-a',
        parent_execution_id: 'root',
        graph_id: 'team-graph',
        team_id: 'team-1',
        agent_id: 'agent-a',
        role: 'researcher',
        phase: 'started',
        at: 10,
      }),
      event({
        id: 'agent-b-started',
        kind: 'agent',
        execution_id: 'agent-run-b',
        parent_execution_id: 'root',
        graph_id: 'team-graph',
        team_id: 'team-1',
        agent_id: 'agent-b',
        role: 'reviewer',
        phase: 'started',
        at: 11,
      }),
      event({
        id: 'tool-a',
        execution_id: 'agent-run-a',
        parent_execution_id: 'root',
        graph_id: 'team-graph',
        team_id: 'team-1',
        agent_id: 'agent-a',
        tool_call_id: 'tool-a',
        at: 12,
      }),
      event({
        id: 'tool-b',
        execution_id: 'agent-run-b',
        parent_execution_id: 'root',
        graph_id: 'team-graph',
        team_id: 'team-1',
        agent_id: 'agent-b',
        tool_call_id: 'tool-b',
        at: 12,
      }),
    ]);

    expect(rows.find((row) => row.id === 'tool-a')).toMatchObject({
      agent_lane: 0,
      agent_lane_count: 2,
      agent_lane_label: 'researcher',
    });
    expect(rows.find((row) => row.id === 'tool-b')).toMatchObject({
      agent_lane: 1,
      agent_lane_count: 2,
      agent_lane_label: 'reviewer',
    });
  });

  it('derives dependency waves from canonical tool call parent ids', () => {
    const rows = causalActivityTimeline([
      event({ id: 'a', tool_call_id: 'a', commit_cursor: 1 }),
      event({ id: 'b', tool_call_id: 'b', commit_cursor: 2 }),
      event({
        id: 'c',
        tool_call_id: 'c',
        causal_parent_ids: ['a', 'b'],
        commit_cursor: 3,
      }),
    ]);

    expect(rows.find((row) => row.id === 'c')).toMatchObject({
      wave: 1,
      lane: 0,
      lane_count: 1,
    });
  });

  it('uses one stable identity for live and durable tool projections', () => {
    expect(activityIdentityKey(event({
      id: 'live',
      execution_id: 'execution-1',
      tool_call_id: 'call-1',
    }))).toBe(activityIdentityKey(event({
      id: 'call-1#cowd-0',
      execution_id: 'execution-1',
      tool_call_id: 'call-1',
    })));
  });

  it('uses the Runtime activity binding before lifecycle phase heuristics', () => {
    const binding = {
      activity_id: 'activity:execution:root:agent:researcher',
    };
    expect(activityIdentityKey(event({
      id: 'agent:run:started',
      kind: 'agent',
      phase: 'started',
      activity_id: binding.activity_id,
      activity_binding: binding,
    }))).toBe(activityIdentityKey(event({
      id: 'agent:run:completed',
      kind: 'agent',
      phase: 'completed',
      activity_id: binding.activity_id,
      activity_binding: binding,
    })));
  });

  it('retains public reasoning line structure while bounding memory', () => {
    expect(appendReasoningSummary('inspect\n', 'decide')).toBe('inspect\ndecide');
    const bounded = appendReasoningSummary('a'.repeat(20), '\nanswer', 12);
    expect(bounded).toContain('[earlier public reasoning omitted]');
    expect(bounded.endsWith('\nanswer')).toBe(true);
  });

  it('keeps only the newest bounded window after sorting a large stream', () => {
    const rows = causalActivityTimeline(
      Array.from({ length: 100_000 }, (_, index) => event({
        id: `event-${index}`,
        kind: 'runtime',
        execution_id: `execution-${Math.floor(index / 10)}`,
        commit_cursor: index,
      })),
      160,
    );
    expect(rows).toHaveLength(160);
    expect(rows[0].id).toBe('event-99840');
    expect(rows[159].id).toBe('event-99999');
  });
});
