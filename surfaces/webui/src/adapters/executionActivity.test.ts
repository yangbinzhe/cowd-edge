import { describe, expect, it } from 'vitest';
import type {
  ExecutionActivityProjection,
  ExecutionActivityRelation,
  ExecutionProjection,
} from '../types';
import {
  activityAutoCollapsed,
  activityTree,
  canonicalActivityEvents,
} from './executionActivity';

function activity(
  id: string,
  kind: ExecutionActivityProjection['kind'],
  parent?: string,
): ExecutionActivityProjection {
  return {
    schema_version: 1,
    activity_id: id,
    scope: {
      workspace_id: 'workspace',
      execution_id: 'execution',
      session_id: 'session',
      turn_id: 'turn',
    },
    kind,
    visibility: ['narrative', 'operational', 'audit'],
    parent_activity_id: parent,
    causal_parent_ids: [],
    dependency_ids: [],
    status: kind === 'tool' ? 'completed' : 'running',
    started_at_ms: kind === 'tool' ? 2 : 1,
    completed_at_ms: kind === 'tool' ? 3 : undefined,
    duration_ms: kind === 'tool' ? 1 : undefined,
    sequence: kind === 'tool' ? 2 : 1,
    commit_cursor: kind === 'tool' ? 2 : 1,
    public_summary: id,
    artifact_refs: [],
    evidence_refs: [],
  };
}

describe('canonical execution activity adapter', () => {
  it('keeps stable IDs and builds the Runtime-owned hierarchy', () => {
    const agent = activity('agent', 'agent');
    const tool = activity('tool', 'tool', 'agent');
    const projection = {
      execution_id: 'execution',
      activities: [tool, agent],
      activity_relations: [{
        relation_id: 'agent-tool',
        kind: 'invoked',
        from_activity_id: 'agent',
        to_activity_id: 'tool',
      } satisfies ExecutionActivityRelation],
    } as unknown as ExecutionProjection;
    const events = canonicalActivityEvents([projection], 'narrative');
    const tree = activityTree(events, projection.activity_relations || []);

    expect(events.map((event) => event.id)).toEqual(['agent', 'tool']);
    expect(tree).toHaveLength(1);
    expect(tree[0].activity.id).toBe('agent');
    expect(tree[0].children[0].activity.id).toBe('tool');
    expect(activityAutoCollapsed(tree[0].children[0].activity)).toBe(true);
  });

  it('deduplicates reconnect replay by activity ID and commit cursor', () => {
    const old = activity('tool', 'tool');
    const current = { ...old, status: 'failed', commit_cursor: 9 };
    const projectionA = { execution_id: 'execution', activities: [old] } as unknown as ExecutionProjection;
    const projectionB = { execution_id: 'execution', activities: [current] } as unknown as ExecutionProjection;

    const events = canonicalActivityEvents([projectionA, projectionB]);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('failed');
  });
});
