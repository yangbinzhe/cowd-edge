import { describe, expect, it } from 'vitest';
import type {
  ActivityEvent,
  ExecutionActivityProjection,
  ExecutionActivityRelation,
  ExecutionProjection,
} from '../types';
import {
  activityAutoCollapsed,
  activityEventViews,
  activityTree,
  canonicalActivityEvents,
  conversationActivityTree,
  mergeActivityViews,
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

  it('uses one compact tool aggregate while retaining every tool for drill-down', () => {
    const root = activity('execution', 'execution');
    const agent = activity('agent:research', 'agent', root.activity_id);
    const tools = Array.from({ length: 12 }, (_, index) => ({
      ...activity(`tool:${index}`, 'tool', agent.activity_id),
      tool_call_id: `call:${index}`,
      status: index === 10 ? 'failed' : index === 11 ? 'running' : 'completed',
      public_summary: `tool_${index}`,
    } satisfies ExecutionActivityProjection));
    const events = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, agent, ...tools],
    } as unknown as ExecutionProjection]);
    const tree = conversationActivityTree(events, []);
    const toolGroup = tree[0].children.find((node) => node.activity.kind === 'tool_batch');

    expect(toolGroup?.activity.tool_summary).toEqual({
      total: 12,
      executed: 12,
      succeeded: 10,
      failed: 1,
      running: 1,
      pending: 0,
    });
    expect(toolGroup?.children).toHaveLength(12);
    expect(tree.flatMap((node) => node.children).filter((node) => node.activity.kind === 'tool'))
      .toHaveLength(0);
  });

  it('merges durable history into the same business tree and prunes internal nodes', () => {
    const durable: ActivityEvent[] = [
      {
        id: 'context',
        kind: 'context',
        title: 'Context assembled',
        status: 'complete',
      },
      {
        id: 'think',
        kind: 'think',
        title: 'Thinking',
        detail: '分析问题',
        status: 'complete',
      },
      {
        id: 'result-ref',
        kind: 'artifact',
        title: 'session-ingress-graph:abc:tool-results:4',
        status: 'complete',
      },
      {
        id: 'tool',
        kind: 'tool',
        title: 'read_file',
        tool_call_id: 'call',
        status: 'complete',
      },
    ];
    const observed = activityEventViews(durable, {
      sessionId: 'session',
      turnId: 'turn',
      executionId: 'execution',
    });
    const canonical = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [{
        ...activity('tool-canonical', 'tool'),
        tool_call_id: 'call',
        status: 'completed',
      }],
    } as unknown as ExecutionProjection]);
    const merged = mergeActivityViews(canonical, observed);
    const tree = conversationActivityTree(merged, []);
    const text = JSON.stringify(tree);

    expect(merged.filter((event) => event.tool_call_id === 'call')).toHaveLength(1);
    expect(text).toContain('分析问题');
    expect(text).toContain('工具调用');
    expect(text).not.toContain('Context assembled');
    expect(text).not.toContain('session-ingress-graph:abc:tool-results:4');
  });

  it('removes provider mechanics and compacts approval lifecycle events in the body tree', () => {
    const execution = activity('execution', 'execution');
    const model = {
      ...activity('inline_model:4', 'model', execution.activity_id),
      public_summary: 'inline_model',
    };
    const providerRecovery = {
      ...activity('provider_intervention:retry', 'recovery', execution.activity_id),
      public_summary: 'provider intervention prepared',
    };
    const approvalStarted = {
      ...activity('approval:started', 'approval', execution.activity_id),
      approval_id: 'approval-1',
      status: 'running',
      commit_cursor: 2,
    };
    const approvalFinished = {
      ...activity('approval:finished', 'approval', execution.activity_id),
      approval_id: 'approval-1',
      status: 'completed',
      commit_cursor: 3,
    };
    const events = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [
        execution,
        model,
        providerRecovery,
        approvalStarted,
        approvalFinished,
      ],
    } as unknown as ExecutionProjection]);
    const tree = conversationActivityTree(events, []);
    const text = JSON.stringify(tree);
    const approvalNodes = tree.flatMap(function visit(node): typeof tree {
      return [
        ...(node.activity.kind === 'approval' ? [node] : []),
        ...node.children.flatMap(visit),
      ];
    });

    expect(text).not.toContain('inline_model');
    expect(text).not.toContain('provider intervention');
    expect((text.match(/approval-1/g) || []).length).toBeGreaterThan(0);
    expect(approvalNodes).toHaveLength(1);
  });

  it('humanizes agent instance identifiers without changing canonical evidence', () => {
    const agent = {
      ...activity('agent:researcher-1', 'agent'),
      agent_id: 'researcher-1',
      public_summary: 'Agent researcher-1 · lane 1/3',
    };
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [agent],
    } as unknown as ExecutionProjection]), []);

    expect(tree[0].activity.detail).toContain('researcher 1');
    expect(tree[0].activity.canonical.agent_id).toBe('researcher-1');
  });
});
