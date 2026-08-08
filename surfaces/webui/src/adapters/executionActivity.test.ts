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
  businessGraphActivities,
  canonicalActivityEvents,
  compactStructuredSummary,
  conversationActivityTree,
  presentActivityDetail,
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
  it('extracts a readable summary from bounded structured output without exposing raw JSON', () => {
    expect(compactStructuredSummary(
      '{"findings":{"boundary_risks":[{"description":"GPU dependency requires review","id":"R1"}],"truncated":"…',
    )).toBe('GPU dependency requires review');
    expect(compactStructuredSummary(
      '{"evidence_refs":["tool://call/evidence/…',
    )).toBe('');
  });

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

  it('folds Runtime tool waves into one Agent-owned conversation summary', () => {
    const root = activity('execution', 'execution');
    const agent = activity('agent:research', 'agent', root.activity_id);
    const batch = activity('tool-batch:research', 'tool_batch', agent.activity_id);
    const tools = Array.from({ length: 12 }, (_, index) => ({
      ...activity(`tool:${index}`, 'tool', batch.activity_id),
      tool_call_id: `call:${index}`,
      status: index === 10 ? 'failed' : index === 11 ? 'running' : 'completed',
      public_summary: `tool_${index}`,
    } satisfies ExecutionActivityProjection));
    const events = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, agent, batch, ...tools],
    } as unknown as ExecutionProjection]);
    const tree = conversationActivityTree(events, []);
    const executionNode = tree.find((node) => node.activity.id === root.activity_id);
    const agentNode = executionNode?.children.find((node) => node.activity.id === agent.activity_id);
    const toolGroup = agentNode?.children.find((node) => node.activity.kind === 'tool_batch');

    expect(agentNode?.children.filter((node) => node.activity.kind === 'tool_batch')).toHaveLength(1);
    expect(toolGroup?.activity.id).toBe(`activity:view:tool-group:${agent.activity_id}`);
    expect(toolGroup?.activity.tool_summary).toEqual({
      total: 12,
      executed: 12,
      succeeded: 10,
      failed: 1,
      running: 1,
      pending: 0,
    });
    expect(toolGroup?.children).toHaveLength(12);
  });

  it('keeps cross-execution Team, Agent and Tool ownership in one canonical tree', () => {
    const root = activity('session-root', 'execution');
    const team = {
      ...activity('team', 'team', root.activity_id),
      scope: { ...root.scope, execution_id: 'mission-execution' },
    };
    const agent = {
      ...activity('agent', 'agent', team.activity_id),
      scope: { ...root.scope, execution_id: 'team-execution' },
    };
    const firstBatch = activity('batch:1', 'tool_batch', agent.activity_id);
    const secondBatch = activity('batch:2', 'tool_batch', agent.activity_id);
    const firstTool = {
      ...activity('tool:1', 'tool', firstBatch.activity_id),
      tool_call_id: 'call:1',
    };
    const secondTool = {
      ...activity('tool:2', 'tool', secondBatch.activity_id),
      tool_call_id: 'call:2',
    };
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'session-root',
      activities: [root, team, agent, firstBatch, secondBatch, firstTool, secondTool],
    } as unknown as ExecutionProjection]), []);
    const teamNode = tree[0].children.find((node) => node.activity.id === team.activity_id);
    const agentNode = teamNode?.children.find((node) => node.activity.id === agent.activity_id);

    expect(teamNode?.children).toHaveLength(1);
    expect(agentNode?.children).toHaveLength(1);
    expect(agentNode?.children[0].activity.tool_summary?.total).toBe(2);
    expect(agentNode?.children[0].children.map((node) => node.activity.id))
      .toEqual(['tool:1', 'tool:2']);
  });

  it('restores a missing Tool parent from its canonical Agent runtime identity', () => {
    const root = activity('execution', 'execution');
    const agent = {
      ...activity('agent:researcher', 'agent', root.activity_id),
      agent_instance_id: 'instance:researcher:1',
      agent_run_id: 'run:researcher:1',
    } satisfies ExecutionActivityProjection;
    const tool = {
      ...activity('tool:read', 'tool'),
      parent_activity_id: 'missing-child-wrapper',
      agent_instance_id: agent.agent_instance_id,
      agent_run_id: agent.agent_run_id,
      tool_call_id: 'call:read',
      status: 'completed',
    } satisfies ExecutionActivityProjection;
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, agent, tool],
    } as unknown as ExecutionProjection]), []);
    const agentNode = tree[0].children.find((node) => node.activity.id === agent.activity_id);

    expect(agentNode?.children).toHaveLength(1);
    expect(agentNode?.children[0].activity.tool_summary?.total).toBe(1);
    expect(agentNode?.children[0].children[0].activity.id).toBe(tool.activity_id);
  });

  it('repairs a valid but stale Tool parent from its exact Agent runtime identity', () => {
    const root = activity('execution', 'execution');
    const first = {
      ...activity('agent:first', 'agent', root.activity_id),
      agent_instance_id: 'instance:first',
      agent_run_id: 'run:first',
    } satisfies ExecutionActivityProjection;
    const second = {
      ...activity('agent:second', 'agent', root.activity_id),
      agent_instance_id: 'instance:second',
      agent_run_id: 'run:second',
    } satisfies ExecutionActivityProjection;
    const tool = {
      ...activity('tool:read', 'tool', first.activity_id),
      agent_instance_id: second.agent_instance_id,
      agent_run_id: second.agent_run_id,
      tool_call_id: 'call:read',
      status: 'completed',
    } satisfies ExecutionActivityProjection;
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, first, second, tool],
    } as unknown as ExecutionProjection]), []);
    const firstNode = tree[0].children.find((node) => node.activity.id === first.activity_id);
    const secondNode = tree[0].children.find((node) => node.activity.id === second.activity_id);

    expect(firstNode?.children).toHaveLength(0);
    expect(secondNode?.children[0].activity.tool_summary?.total).toBe(1);
    expect(secondNode?.children[0].children[0].activity.id).toBe(tool.activity_id);
  });

  it('does not guess Tool ownership from a shared Agent definition id', () => {
    const root = activity('execution', 'execution');
    const first = {
      ...activity('agent:first', 'agent', root.activity_id),
      agent_id: 'researcher',
      agent_instance_id: 'instance:first',
      agent_run_id: 'run:first',
    } satisfies ExecutionActivityProjection;
    const second = {
      ...activity('agent:second', 'agent', root.activity_id),
      agent_id: 'researcher',
      agent_instance_id: 'instance:second',
      agent_run_id: 'run:second',
    } satisfies ExecutionActivityProjection;
    const tool = {
      ...activity('tool:ambiguous', 'tool', root.activity_id),
      agent_id: 'researcher',
      tool_call_id: 'call:ambiguous',
      status: 'completed',
    } satisfies ExecutionActivityProjection;
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, first, second, tool],
    } as unknown as ExecutionProjection]), []);
    const firstNode = tree[0].children.find((node) => node.activity.id === first.activity_id);
    const secondNode = tree[0].children.find((node) => node.activity.id === second.activity_id);

    expect(JSON.stringify([firstNode, secondNode])).not.toContain('tool:ambiguous');
  });

  it('collects Tool activities through an internal child execution wrapper', () => {
    const root = activity('execution', 'execution');
    const agent = activity('agent:researcher', 'agent', root.activity_id);
    const childExecution = activity('execution:child', 'execution', agent.activity_id);
    const tool = {
      ...activity('tool:read', 'tool', childExecution.activity_id),
      tool_call_id: 'call:read',
      status: 'completed',
    } satisfies ExecutionActivityProjection;
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, agent, childExecution, tool],
    } as unknown as ExecutionProjection]), []);
    const agentNode = tree[0].children.find((node) => node.activity.id === agent.activity_id);

    expect(agentNode?.children).toHaveLength(1);
    expect(agentNode?.children[0].activity.tool_summary?.total).toBe(1);
    expect(agentNode?.children[0].children[0].activity.id).toBe(tool.activity_id);
  });

  it('removes duplicate nested execution wrappers and summarizes structured Agent output', () => {
    const root = activity('root', 'execution');
    const team = activity('team', 'team', root.activity_id);
    const agent = {
      ...activity('agent', 'agent', team.activity_id),
      public_summary: JSON.stringify({
        findings: [{ description: '发现两个高风险边界问题', evidence_refs: ['evidence://1'] }],
      }),
      result_summary: JSON.stringify({
        findings: [{ description: '发现两个高风险边界问题', evidence_refs: ['evidence://1'] }],
      }),
    };
    const childExecution = activity('child-execution', 'execution', agent.activity_id);
    const model = activity('model', 'model', childExecution.activity_id);
    const verify = activity('verify', 'verify', childExecution.activity_id);
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'root',
      activities: [root, team, agent, childExecution, model, verify],
    } as unknown as ExecutionProjection]), []);
    const agentNode = tree[0].children[0].children[0];

    expect(agentNode.activity.kind).toBe('agent');
    expect(agentNode.activity.detail).toBe('发现两个高风险边界问题');
    expect(agentNode.activity.result_summary).toBe('发现两个高风险边界问题');
    expect(agentNode.children).toEqual([]);
    expect(JSON.stringify(tree)).not.toContain('child-execution');
  });

  it('keeps tools under the exact canonical parent without owner inference', () => {
    const root = activity('execution', 'execution');
    const research = activity('agent:research', 'agent', root.activity_id);
    const verify = activity('agent:verify', 'agent', root.activity_id);
    const tools = [
      {
        ...activity('tool:search-a', 'tool', research.activity_id),
        tool_call_id: 'call:search-a',
        parallel_group_id: 'research-batch',
      },
      {
        ...activity('tool:search-b', 'tool', research.activity_id),
        tool_call_id: 'call:search-b',
        parallel_group_id: 'research-batch',
      },
      {
        ...activity('tool:read', 'tool', verify.activity_id),
        tool_call_id: 'call:read',
        parallel_group_id: 'verify-batch',
      },
    ] satisfies ExecutionActivityProjection[];
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, research, verify, ...tools],
    } as unknown as ExecutionProjection]), []);
    const execution = tree.find((node) => node.activity.id === root.activity_id);
    const researchNode = execution?.children.find((node) => node.activity.id === research.activity_id);
    const verifyNode = execution?.children.find((node) => node.activity.id === verify.activity_id);
    const researchBatch = researchNode?.children[0];
    const verifyBatch = verifyNode?.children[0];

    expect(researchBatch?.activity.kind).toBe('tool_batch');
    expect(researchBatch?.activity.parent_activity_id).toBe(research.activity_id);
    expect(researchBatch?.children.map((node) => node.activity.id))
      .toEqual(['tool:search-a', 'tool:search-b']);
    expect(verifyNode?.children).toHaveLength(1);
    expect(verifyBatch?.activity.kind).toBe('tool_batch');
    expect(verifyBatch?.activity.parent_activity_id).toBe(verify.activity_id);
    expect(verifyBatch?.children[0].activity.id).toBe('tool:read');
  });

  it('keeps running and failed tool groups open but folds successful terminal groups', () => {
    const agent = activity('agent:worker', 'agent');
    const tool = {
      ...activity('tool:worker', 'tool', agent.activity_id),
      tool_call_id: 'call:worker',
      status: 'running',
      completed_at_ms: undefined,
    } satisfies ExecutionActivityProjection;
    const treeFor = (status: string) => conversationActivityTree(
      canonicalActivityEvents([{
        execution_id: 'execution',
        activities: [agent, { ...tool, status }],
      } as unknown as ExecutionProjection]),
      [],
    )[0].children[0].activity;

    expect(activityAutoCollapsed(treeFor('running'))).toBe(false);
    expect(activityAutoCollapsed(treeFor('failed'))).toBe(false);
    expect(activityAutoCollapsed(treeFor('completed'))).toBe(true);
  });

  it('keeps Session activity events in the technical view instead of merging business topology', () => {
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
    const tree = conversationActivityTree(canonical, []);
    const text = JSON.stringify(tree);

    expect(observed).toHaveLength(4);
    expect(canonical.filter((event) => event.tool_call_id === 'call')).toHaveLength(1);
    expect(text).not.toContain('分析问题');
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

  it('removes internal session routing artifacts from the body tree', () => {
    const execution = activity('execution', 'execution');
    const artifact = {
      ...activity('session-routing-artifact', 'artifact', execution.activity_id),
      display_label: 'session-ingress-confirmed:webui:request',
      public_summary: 'Session input was routed to the target execution graph',
    };
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [execution, artifact],
    } as unknown as ExecutionProjection]), []);

    expect(JSON.stringify(tree)).not.toContain('session-ingress-confirmed');
    expect(JSON.stringify(tree)).not.toContain('Session input was routed');
  });

  it('keeps audit-only tool policy events out of business projections', () => {
    const policyEvent = {
      ...activity('tool-policy', 'tool'),
      visibility: ['operational', 'audit'] as ExecutionActivityProjection['visibility'],
      phase: 'lease_transition',
    };
    const views = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [policyEvent],
    } as unknown as ExecutionProjection], 'audit');

    expect(businessGraphActivities(views)).toEqual([]);
  });

  it('keeps legacy target-guard details out of business projections', () => {
    const targetGuard = {
      ...activity('legacy-target-guard', 'verify'),
      display_label: '结果验证',
      detail: 'Target guard accepted the execution target',
      visibility: ['narrative', 'audit'] as ExecutionActivityProjection['visibility'],
    };
    const views = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [targetGuard],
    } as unknown as ExecutionProjection], 'audit');

    expect(businessGraphActivities(views)).toEqual([]);
  });

  it('humanizes agent instance identifiers without changing canonical evidence', () => {
    const agent = {
      ...activity('agent:researcher-1', 'agent'),
      agent_instance_id: 'researcher-1',
      public_summary: 'Agent researcher-1 · lane 1/3',
    };
    const tree = conversationActivityTree(canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [agent],
    } as unknown as ExecutionProjection]), []);

    expect(tree[0].activity.detail).toContain('researcher 1');
    expect(tree[0].activity.canonical.agent_instance_id).toBe('researcher-1');
  });

  it('presents typed Activity input and output while keeping raw facts behind one drill-down', () => {
    const canonical = activity('tool:render', 'tool', 'agent:writer');
    const detail = presentActivityDetail({
      schema_version: 1,
      execution_id: 'execution',
      activity: canonical,
      input: {
        kind: 'object',
        summary: '2 fields',
        structured: { source: 'artifact://report', format: 'markdown' },
        truncated: false,
      },
      output: {
        kind: 'object',
        summary: 'Report generated',
        structured: { path: 'workspace://report.md', status: 'completed' },
        truncated: false,
      },
      relations: [],
      related_entities: [],
    } as any, { id: 'tool:render', title: 'Render report' });

    expect(detail.input).toEqual({
      source: 'artifact://report',
      format: 'markdown',
    });
    expect(detail.output).toEqual({
      path: 'workspace://report.md',
      status: 'completed',
    });
    expect(detail.detail).toBe('Report generated');
    expect(detail.raw).toMatchObject({
      activity: { activity_id: 'tool:render' },
      input: { kind: 'object' },
      output: { kind: 'object' },
    });
  });
});
