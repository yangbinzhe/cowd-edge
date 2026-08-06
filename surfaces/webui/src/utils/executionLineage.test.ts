import { describe, expect, it } from 'vitest';
import type {
  ExecutionActivityProjection,
  ExecutionActivityRelation,
  ExecutionProjection,
} from '../types';
import {
  combineExecutionLineage,
  executionProjectionLinks,
  selectTurnExecutionEntry,
} from './executionLineage';

function activity(
  id: string,
  kind: ExecutionActivityProjection['kind'],
  executionId: string,
  parent?: string,
): ExecutionActivityProjection {
  return {
    schema_version: 1,
    activity_id: id,
    scope: {
      workspace_id: 'workspace',
      mission_id: 'mission',
      task_id: 'task',
      session_id: 'session',
      turn_id: 'turn',
      execution_id: executionId,
    },
    kind,
    visibility: ['narrative', 'operational', 'audit'],
    parent_activity_id: parent,
    causal_parent_ids: [],
    dependency_ids: [],
    parallel_group_id: kind === 'tool' ? 'parallel-search' : undefined,
    status: kind === 'tool' ? 'completed' : 'running',
    started_at_ms: kind === 'tool' ? 2 : 1,
    completed_at_ms: kind === 'tool' ? 5 : undefined,
    duration_ms: kind === 'tool' ? 3 : undefined,
    sequence: kind === 'tool' ? 2 : 1,
    commit_cursor: kind === 'tool' ? 2 : 1,
    public_summary: id,
    artifact_refs: kind === 'tool' ? ['artifact'] : [],
    evidence_refs: kind === 'tool' ? ['evidence'] : [],
  };
}

function projection(
  executionId: string,
  activities: ExecutionActivityProjection[],
  relations: ExecutionActivityRelation[] = [],
  childExecutions: any[] = [],
): ExecutionProjection {
  return {
    schema_version: 2,
    execution_id: executionId,
    revision: 1,
    cursor: 2,
    authorization_revision: 1,
    redaction_revision: '1',
    detail_scope: 'full',
    graph: {
      graph_id: executionId,
      objective: 'Coordinate work',
      revision: 1,
      commit_cursor: 2,
      nodes: [],
      edges: [],
    },
    child_executions: childExecutions,
    activities,
    activity_relations: relations,
    admissions: [],
    agents: [],
    approvals: [],
    available_commands: [],
    context: [],
    evidence: [],
    goals: [],
    health: [],
    interventions: [],
    outcomes: [],
    recovery: [],
    relations: [],
    teams: [],
    usage: [],
  } as unknown as ExecutionProjection;
}

describe('execution lineage', () => {
  it('selects the Session root when Agent child executions precede it', () => {
    const entries = [{
      execution_id: 'runtime-team:run:researcher:1',
      graph_id: 'execution-graph-researcher',
      turn_id: 'turn-1',
      updated_at_ms: 10,
    }, {
      execution_id: 'runtime-team:run:synthesizer:1',
      graph_id: 'execution-graph-synthesizer',
      turn_id: 'turn-1',
      updated_at_ms: 20,
    }, {
      execution_id: 'session-ingress-graph:root',
      graph_id: 'session-ingress-graph:root',
      turn_id: 'turn-1',
      updated_at_ms: 30,
    }];

    expect(selectTurnExecutionEntry(entries, 'turn-1')?.execution_id)
      .toBe('session-ingress-graph:root');
  });

  it('uses an exact transcript execution identity before Turn heuristics', () => {
    const entries = [{
      execution_id: 'runtime-team:run:researcher:1',
      graph_id: 'execution-graph-researcher',
      turn_id: 'turn-1',
      updated_at_ms: 10,
    }, {
      execution_id: 'session-ingress-graph:root',
      graph_id: 'session-ingress-graph:root',
      turn_id: 'turn-1',
      updated_at_ms: 30,
    }];

    expect(selectTurnExecutionEntry(
      entries,
      'turn-1',
      'runtime-team:run:researcher:1',
    )?.execution_id).toBe('runtime-team:run:researcher:1');
  });

  it('renders only canonical business activities and relations', () => {
    const execution = activity('execution', 'execution', 'root');
    const team = activity('team', 'team', 'root', 'execution');
    const agent = activity('agent', 'agent', 'root', 'team');
    const tool = activity('tool', 'tool', 'root', 'agent');
    const context = activity('context', 'context', 'root', 'execution');
    const relations: ExecutionActivityRelation[] = [
      {
        relation_id: 'r1',
        kind: 'delegated_to',
        from_activity_id: 'execution',
        to_activity_id: 'team',
      },
      {
        relation_id: 'r2',
        kind: 'delegated_to',
        from_activity_id: 'team',
        to_activity_id: 'agent',
      },
      {
        relation_id: 'r3',
        kind: 'invoked',
        from_activity_id: 'agent',
        to_activity_id: 'tool',
      },
    ];
    const root = projection('root', [execution, team, agent, tool, context], relations, [{
      execution_id: 'child',
      parent_execution_id: 'root',
      parent_node_id: 'agent',
      status: 'running',
      revision: 1,
      cursor: 1,
      objective: 'child',
    }]);

    expect(executionProjectionLinks(root)).toEqual(['child']);
    const graph = combineExecutionLineage('root', [root]);
    expect(graph?.nodes.map((node) => node.node_id)).toEqual([
      'execution',
      'team',
      'agent',
      'tool',
    ]);
    expect(graph?.nodes.map((node) => node.kind)).not.toContain('context');
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'execution', to: 'team', kind: 'delegates' }),
      expect.objectContaining({
        from: 'agent',
        to: 'tool',
        kind: 'invokes',
      }),
    ]));
    expect(graph?.nodes.find((node) => node.node_id === 'tool')).toEqual(
      expect.objectContaining({
        parallel_group_id: 'parallel-search',
        evidence_refs: ['evidence'],
        artifact_refs: ['artifact'],
      }),
    );
  });

  it('projects canonical parent identities into a connected business hierarchy', () => {
    const execution = activity('execution', 'execution', 'root');
    const team = activity('team', 'team', 'root', 'execution');
    const agent = activity('agent', 'agent', 'root', 'team');
    const tool = activity('tool', 'tool', 'root', 'agent');

    const graph = combineExecutionLineage('root', [
      projection('root', [execution, team, agent, tool]),
    ]);

    expect(graph?.nodes.map((node) => node.node_id))
      .toEqual(['execution', 'team', 'agent', 'tool']);
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'execution', to: 'team', kind: 'delegates' }),
      expect.objectContaining({ from: 'team', to: 'agent', kind: 'delegates' }),
      expect.objectContaining({ from: 'agent', to: 'tool', kind: 'invokes' }),
    ]));
  });

  it('does not invent a graph when canonical activities are absent', () => {
    expect(combineExecutionLineage('root', [projection('root', [])])).toBeNull();
  });

  it('uses the Runtime terminal state for the root execution node', () => {
    const execution = activity('execution', 'execution', 'root');
    const root = projection('root', [execution]);
    root.live = { status: 'error' } as any;

    expect(combineExecutionLineage('root', [root])?.nodes[0]?.status).toBe('error');
  });

  it('preserves a canonical completed-with-warnings root status', () => {
    const execution = {
      ...activity('execution', 'execution', 'root'),
      status: 'completed_with_warnings',
    };
    const root = projection('root', [execution]);
    root.live = { status: 'completed' } as any;

    expect(combineExecutionLineage('root', [root])?.status)
      .toBe('completed_with_warnings');
    expect(combineExecutionLineage('root', [root])?.nodes[0]?.status)
      .toBe('completed_with_warnings');
  });

  it('preserves separate canonical tool activities and parallel groups', () => {
    const execution = activity('execution', 'execution', 'root');
    const agent = activity('agent', 'agent', 'root', 'execution');
    const first = {
      ...activity('tool:first', 'tool', 'root', 'agent'),
      tool_call_id: 'call:first',
      parallel_group_id: 'batch:first',
    };
    const second = {
      ...activity('tool:second', 'tool', 'root', 'agent'),
      tool_call_id: 'call:second',
      parallel_group_id: 'batch:second',
    };

    const graph = combineExecutionLineage('root', [
      projection('root', [execution, agent, first, second]),
    ]);
    const tools = graph?.nodes.filter((node) => node.kind === 'tool') || [];
    expect(tools.map((node) => node.node_id)).toEqual([
      'tool:first',
      'tool:second',
    ]);
    expect(tools.map((node) => node.parallel_group_id))
      .toEqual(['batch:first', 'batch:second']);
  });

  it('does not present internal event codes as business output summaries', () => {
    const execution = activity('execution', 'execution', 'root');
    const agent = {
      ...activity('agent', 'agent', 'root', 'execution'),
      output: 'runtime.outcome.recorded.v1',
    };

    const graph = combineExecutionLineage('root', [projection('root', [execution, agent])]);

    expect(graph?.nodes.find((node) => node.node_id === 'agent')?.output_summary).toBe('');
  });

  it('folds canonical tool batches and internal result artifacts out of the business graph', () => {
    const executionId = 'session-ingress-graph:root';
    const execution = {
      ...activity(`activity:execution:${executionId}`, 'execution', executionId),
      public_summary: 'Investigate the requested issue',
    };
    const toolBatch = {
      ...activity(`activity:execution:${executionId}:tools`, 'tool_batch', executionId, execution.activity_id),
      public_summary: 'tool_batch',
    };
    const result = {
      ...activity(`activity:execution:${executionId}:result`, 'artifact', executionId, execution.activity_id),
      public_summary: `${executionId}:model-result`,
    };

    const graph = combineExecutionLineage(executionId, [
      projection(executionId, [execution, toolBatch, result], [{
        relation_id: 'execution-tools',
        kind: 'invoked',
        from_activity_id: execution.activity_id,
        to_activity_id: toolBatch.activity_id,
      }]),
    ]);

    expect(graph?.nodes.map((node) => node.node_id)).toEqual([
      execution.activity_id,
    ]);
    expect(graph?.edges).toEqual([]);
  });

  it('connects a real tool through a folded canonical tool batch', () => {
    const execution = activity('execution', 'execution', 'root');
    const batch = activity('batch', 'tool_batch', 'root', 'execution');
    const tool = activity('tool', 'tool', 'root', 'batch');

    const graph = combineExecutionLineage('root', [
      projection('root', [execution, batch, tool]),
    ]);

    expect(graph?.nodes.map((node) => node.node_id)).toEqual(['execution', 'tool']);
    expect(graph?.edges).toContainEqual(expect.objectContaining({
      from: 'execution',
      to: 'tool',
      kind: 'invokes',
    }));
  });

  it('folds output nodes into the producer and preserves proven cross-Agent data delivery', () => {
    const execution = activity('execution', 'execution', 'root');
    const team = activity('team', 'team', 'root', 'execution');
    const researcher = activity('researcher', 'agent', 'root', 'team');
    const search = {
      ...activity('search', 'tool', 'root', 'researcher'),
      artifact_refs: ['artifact://research'],
      evidence_refs: ['evidence://search'],
      result_summary: '完成供应链风险调查',
    };
    const artifact = {
      ...activity('artifact', 'artifact', 'root', 'search'),
      artifact_refs: ['artifact://research'],
      evidence_refs: ['evidence://search'],
      result_summary: '供应链风险清单',
    };
    const synthesizer = activity('synthesizer', 'agent', 'root', 'team');
    const relations: ExecutionActivityRelation[] = [{
      relation_id: 'produced',
      kind: 'produced',
      from_activity_id: 'search',
      to_activity_id: 'artifact',
      evidence_ref: 'artifact://research',
    }, {
      relation_id: 'consumed',
      kind: 'consumed',
      from_activity_id: 'artifact',
      to_activity_id: 'synthesizer',
      evidence_ref: 'artifact://research',
    }];

    const graph = combineExecutionLineage('root', [
      projection('root', [
        execution,
        team,
        researcher,
        search,
        artifact,
        synthesizer,
      ], relations),
    ]);

    expect(graph?.nodes.map((node) => node.node_id)).not.toContain('artifact');
    expect(graph?.nodes.find((node) => node.node_id === 'search')).toMatchObject({
      artifact_refs: ['artifact://research'],
      evidence_refs: ['evidence://search'],
      output_summary: '完成供应链风险调查',
    });
    expect(graph?.edges).toContainEqual(expect.objectContaining({
      from: 'search',
      to: 'synthesizer',
      kind: 'consumed',
      evidence_refs: ['artifact://research'],
    }));
  });

  it('keeps raw output references and internal runtime ids out of graph cards', () => {
    const execution = activity('execution', 'execution', 'root');
    const team = {
      ...activity('team', 'team', 'root', 'execution'),
      public_summary: 'Team `runtime-team:private:1` completed child graph revision 4',
      result_summary: 'Team `runtime-team:private:1` completed child graph revision 4',
      artifact_refs: ['artifact://team-result'],
    };
    const researcher = {
      ...activity('researcher', 'agent', 'root', 'team'),
      agent_instance_id: 'runtime-team:private:1:run:researcher:1',
      result_summary: JSON.stringify({
        findings: [{
          observation: '确认供应链约束与交付路径',
          evidence: 'evidence://research',
        }],
        summary: '研究结果已经交付综合智能体',
      }),
    };
    const tool = {
      ...activity('tool', 'tool', 'root', 'researcher'),
      result_summary: 'tool://tool-raw-private',
      artifact_refs: ['artifact://tool-result'],
    };

    const graph = combineExecutionLineage('root', [
      projection('root', [execution, team, researcher, tool]),
    ]);

    expect(graph?.nodes.find((node) => node.node_id === 'team')).toMatchObject({
      summary: '协作团队',
      output_summary: '团队已汇总成员执行状态与产出',
    });
    expect(graph?.nodes.find((node) => node.node_id === 'researcher')).toMatchObject({
      summary: '研究智能体',
      output_summary: '研究结果已经交付综合智能体',
    });
    expect(graph?.nodes.find((node) => node.node_id === 'tool')).toMatchObject({
      output_summary: '1 项产出',
    });
    const visibleText = graph?.nodes.flatMap((node) => [
      node.summary,
      node.description,
      node.output_summary,
    ]).join(' ');
    expect(visibleText).not.toContain('runtime-team:private');
    expect(graph?.nodes.find((node) => node.node_id === 'tool')?.output_summary).not.toContain('tool://');
  });

  it('keeps a high-cardinality business graph connected without output-node expansion', () => {
    const execution = activity('execution', 'execution', 'root');
    const team = activity('team', 'team', 'root', 'execution');
    const rows: ExecutionActivityProjection[] = [execution, team];
    for (let index = 0; index < 20; index += 1) {
      const agentId = `agent-${index}`;
      rows.push(activity(agentId, 'agent', 'root', 'team'));
      for (let tool = 0; tool < 5; tool += 1) {
        const toolId = `${agentId}:tool-${tool}`;
        rows.push(activity(toolId, 'tool', 'root', agentId));
        rows.push({
          ...activity(`${toolId}:artifact`, 'artifact', 'root', toolId),
          artifact_refs: [`artifact://${toolId}`],
        });
      }
    }
    const graph = combineExecutionLineage('root', [projection('root', rows)]);
    const nodeIds = new Set(graph?.nodes.map((node) => node.node_id));
    const connected = new Set(graph?.edges.flatMap((edge) => [edge.from, edge.to]));

    expect(graph?.nodes).toHaveLength(122);
    expect(graph?.nodes.some((node) => node.kind === 'artifact')).toBe(false);
    expect([...nodeIds].filter((id) => id !== 'execution' && !connected.has(id))).toEqual([]);
  });

  it('removes provider mechanics and internal result references from the business graph', () => {
    const execution = activity('execution', 'execution', 'root');
    const team = activity('team', 'team', 'root', 'execution');
    const agent = activity('agent', 'agent', 'root', 'team');
    const model = {
      ...activity('inline_model:1', 'model', 'root', 'agent'),
      public_summary: 'provider.call',
    };
    const internalArtifact = {
      ...activity('turn-result:root:1', 'artifact', 'root', 'agent'),
      public_summary: 'session-ingress-graph:root:tool-results:1:model-result',
    };
    const authorization = {
      ...activity('authorization:1', 'tool', 'root', 'agent'),
      public_summary: 'authorization.lease_transition',
    };
    const providerReplan = {
      ...activity('replan:1', 'replan', 'root', 'agent'),
      public_summary: 'provider intent advanced the turn graph',
    };
    const unlinkedApproval = {
      ...activity('approval:1', 'approval', 'root', 'agent'),
      public_summary: 'approval.grant_issued',
    };

    const graph = combineExecutionLineage('root', [
      projection('root', [
        execution,
        team,
        agent,
        model,
        internalArtifact,
        authorization,
        providerReplan,
        unlinkedApproval,
      ]),
    ]);

    expect(graph?.nodes.map((node) => node.node_id)).toEqual([
      'execution',
      'team',
      'agent',
    ]);
  });
});
