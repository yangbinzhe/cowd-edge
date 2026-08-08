import { describe, expect, it } from 'vitest';
import type {
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
    const reasoning = {
      ...activity('reasoning:root', 'reasoning', root.activity_id),
      public_summary: '先核对目标，再读取证据。',
    } satisfies ExecutionActivityProjection;
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, reasoning],
    } as unknown as ExecutionProjection]);
    const result = reasoningPresentation([], activities, 'execution');

    expect(result.global?.latest.text).toBe('先核对目标，再读取证据。');
    expect(result.byOwner).toEqual({});
    expect(activities).toHaveLength(2);
    expect(JSON.stringify(conversationActivityTree(activities, [])))
      .not.toContain('reasoning:root');
  });

  it('attaches reasoning only to an exact Agent identity', () => {
    const root = activity('execution', 'execution');
    const agent = {
      ...activity('agent:researcher', 'agent', root.activity_id, 'agent-run-1'),
      agent_run_id: 'agent-run-1',
      agent_instance_id: 'researcher-1',
    } satisfies ExecutionActivityProjection;
    const reasoning = {
      ...activity('reasoning:agent', 'reasoning', agent.activity_id, 'agent-run-1'),
      public_summary: '交叉验证三个来源。',
    } satisfies ExecutionActivityProjection;
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, agent, reasoning],
    } as unknown as ExecutionProjection]);
    const result = reasoningPresentation([], activities, 'execution');

    expect(result.global).toBeNull();
    expect(result.byOwner[agent.activity_id]?.latest.text).toBe('交叉验证三个来源。');
  });

  it('repairs a valid but stale reasoning parent from exact Agent identity', () => {
    const root = activity('execution', 'execution');
    const first = {
      ...activity('agent:first', 'agent', root.activity_id, 'agent-run-1'),
      agent_run_id: 'agent-run-1',
      agent_instance_id: 'researcher-1',
    } satisfies ExecutionActivityProjection;
    const second = {
      ...activity('agent:second', 'agent', root.activity_id, 'agent-run-2'),
      agent_run_id: 'agent-run-2',
      agent_instance_id: 'researcher-2',
    } satisfies ExecutionActivityProjection;
    const reasoning = {
      ...activity('reasoning:second', 'reasoning', first.activity_id, 'agent-run-2'),
      agent_run_id: 'agent-run-2',
      agent_instance_id: 'researcher-2',
      public_summary: '归属第二个智能体。',
    } satisfies ExecutionActivityProjection;
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, first, second, reasoning],
    } as unknown as ExecutionProjection]);

    const result = reasoningPresentation([], activities, 'execution');

    expect(result.byOwner[first.activity_id]).toBeUndefined();
    expect(result.byOwner[second.activity_id]?.latest.text).toBe('归属第二个智能体。');
  });

  it('attaches streamed think segments through the canonical Agent runtime identity', () => {
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
    const result = reasoningPresentation([{
      id: 'think:agent',
      activity_id: 'think:agent',
      kind: 'think',
      title: '思考',
      detail: '先读取模块入口，再交叉核验测试。',
      execution_id: 'agent-run-1',
      agent_instance_id: 'researcher-1',
      status: 'running',
    }], activities, 'execution');

    expect(result.global).toBeNull();
    expect(result.byOwner[agent.activity_id]?.latest.text)
      .toBe('先读取模块入口，再交叉核验测试。');
  });

  it('keeps a streamed root think segment in the single global group', () => {
    const root = activity('execution', 'execution');
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root],
    } as unknown as ExecutionProjection]);
    const result = reasoningPresentation([{
      id: 'think:root',
      activity_id: 'think:root',
      kind: 'think',
      title: '思考',
      detail: '先判断是否需要团队。',
      execution_id: 'execution',
      status: 'running',
    }], activities, 'execution');

    expect(result.global?.latest.text).toBe('先判断是否需要团队。');
    expect(result.byOwner).toEqual({});
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

  it('does not attach reasoning through an ambiguous shared Agent definition id', () => {
    const root = activity('execution', 'execution');
    const first = {
      ...activity('agent:first', 'agent', root.activity_id, 'agent-run-1'),
      agent_id: 'researcher',
      agent_run_id: 'agent-run-1',
      agent_instance_id: 'researcher-1',
    } satisfies ExecutionActivityProjection;
    const second = {
      ...activity('agent:second', 'agent', root.activity_id, 'agent-run-2'),
      agent_id: 'researcher',
      agent_run_id: 'agent-run-2',
      agent_instance_id: 'researcher-2',
    } satisfies ExecutionActivityProjection;
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, first, second],
    } as unknown as ExecutionProjection]);
    const result = reasoningPresentation([{
      id: 'think:ambiguous',
      activity_id: 'think:ambiguous',
      kind: 'think',
      title: '思考',
      detail: '不能猜测归属。',
      execution_id: 'child-run',
      agent_id: 'researcher',
    }], activities, 'execution');

    expect(result).toEqual({ global: null, byOwner: {} });
  });

  it('filters structured outputs and deduplicates durable reasoning replay', () => {
    const root = activity('execution', 'execution');
    const durable = {
      ...activity('reasoning:durable', 'reasoning', root.activity_id),
      public_summary: '检查已有证据。',
    } satisfies ExecutionActivityProjection;
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, durable],
    } as unknown as ExecutionProjection]);
    const result = reasoningPresentation(
      [
      {
        id: 'reasoning:structured',
        kind: 'think',
        title: '思考',
        detail: '{"findings":[{"id":"F1"}]}',
        execution_id: 'execution',
      },
      ],
      activities,
      'execution',
    );

    expect(result.global?.items).toHaveLength(1);
    expect(result.global?.latest.text).toBe('检查已有证据。');
    expect(JSON.stringify(conversationActivityTree(activities, [])))
      .not.toContain('reasoning:durable');
  });
});
