import { describe, expect, it } from 'vitest';
import type {
  ActivityEvent,
  ExecutionActivityProjection,
  ExecutionProjection,
} from '../types';
import {
  canonicalActivityEvents,
  conversationActivityTree,
} from './executionActivity';
import { reasoningPresentation } from './reasoningPresentation';

function activity(
  id: string,
  kind: ExecutionActivityProjection['kind'],
  parent?: string,
  executionId = 'execution',
): ExecutionActivityProjection {
  return {
    schema_version: 1,
    activity_id: id,
    scope: {
      workspace_id: 'workspace',
      session_id: 'session',
      turn_id: 'turn',
      execution_id: executionId,
    },
    kind,
    visibility: ['narrative', 'operational', 'audit'],
    parent_activity_id: parent,
    causal_parent_ids: [],
    dependency_ids: [],
    status: 'running',
    sequence: 1,
    commit_cursor: 1,
    public_summary: id,
    artifact_refs: [],
    evidence_refs: [],
  };
}

describe('reasoning presentation', () => {
  it('keeps root reasoning outside the canonical business graph', () => {
    const root = activity('execution', 'execution');
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root],
    } as unknown as ExecutionProjection]);
    const events: ActivityEvent[] = [{
      id: 'reasoning:root',
      kind: 'think',
      title: '思考',
      detail: '先核对目标，再读取证据。',
      status: 'running',
      execution_id: 'execution',
      turn_id: 'turn',
    }];

    const result = reasoningPresentation(events, activities, 'execution');

    expect(result.global?.latest.text).toBe('先核对目标，再读取证据。');
    expect(result.byOwner).toEqual({});
    expect(activities).toHaveLength(1);
  });

  it('attaches reasoning only to an exact Agent identity', () => {
    const root = activity('execution', 'execution');
    const agent = {
      ...activity('agent:researcher', 'agent', root.activity_id, 'agent-run-1'),
      agent_run_id: 'agent-run-1',
      agent_instance_id: 'researcher-1',
    } satisfies ExecutionActivityProjection;
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, agent],
    } as unknown as ExecutionProjection]);
    const events: ActivityEvent[] = [{
      id: 'reasoning:agent',
      kind: 'think',
      title: '思考',
      detail: '交叉验证三个来源。',
      status: 'complete',
      execution_id: 'agent-run-1',
      agent_id: 'researcher-1',
    }];

    const result = reasoningPresentation(events, activities, 'execution');

    expect(result.global).toBeNull();
    expect(result.byOwner[agent.activity_id]?.latest.text).toBe('交叉验证三个来源。');
  });

  it('does not guess unknown child ownership into the global or Agent view', () => {
    const root = activity('execution', 'execution');
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root],
    } as unknown as ExecutionProjection]);
    const result = reasoningPresentation([{
      id: 'reasoning:unknown',
      kind: 'think',
      title: '思考',
      detail: '未知委派执行中的内容。',
      execution_id: 'unknown-agent-run',
      agent_id: 'unknown-agent',
    }], activities, 'execution');

    expect(result).toEqual({ global: null, byOwner: {} });
  });

  it('filters structured outputs and deduplicates durable reasoning replay', () => {
    const root = activity('execution', 'execution');
    const durable = {
      ...activity('reasoning:durable', 'model', root.activity_id),
      phase: 'public_reasoning',
      public_summary: '检查已有证据。',
    } satisfies ExecutionActivityProjection;
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, durable],
    } as unknown as ExecutionProjection]);
    const result = reasoningPresentation([
      {
        id: 'reasoning:replay',
        kind: 'think',
        title: '思考',
        detail: '检查已有证据。',
        execution_id: 'execution',
      },
      {
        id: 'reasoning:structured',
        kind: 'think',
        title: '思考',
        detail: '{"findings":[{"id":"F1"}]}',
        execution_id: 'execution',
      },
    ], activities, 'execution');

    expect(result.global?.items).toHaveLength(1);
    expect(result.global?.latest.text).toBe('检查已有证据。');
    expect(JSON.stringify(conversationActivityTree(activities, [])))
      .not.toContain('reasoning:durable');
  });
});
