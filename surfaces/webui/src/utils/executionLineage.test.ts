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
      'activity:view:tool-group:agent',
    ]);
    expect(graph?.nodes.map((node) => node.kind)).not.toContain('context');
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'execution', to: 'team', kind: 'delegates' }),
      expect.objectContaining({
        from: 'agent',
        to: 'activity:view:tool-group:agent',
        kind: 'invokes',
      }),
    ]));
    expect(graph?.nodes.find((node) => node.node_id === 'activity:view:tool-group:agent')).toEqual(
      expect.objectContaining({
        parallel_group_id: 'parallel-search',
        evidence_refs: ['evidence'],
        artifact_refs: ['artifact'],
        grouped_activity_ids: ['tool'],
      }),
    );
  });

  it('derives parent edges when old projections omitted canonical relations', () => {
    const execution = activity('execution', 'execution', 'root');
    const team = activity('team', 'team', 'root', 'execution');
    const agent = activity('agent', 'agent', 'root', 'team');
    const tool = activity('tool', 'tool', 'root', 'agent');

    const graph = combineExecutionLineage('root', [
      projection('root', [execution, team, agent, tool]),
    ]);

    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'execution', to: 'team', kind: 'contains' }),
      expect.objectContaining({ from: 'team', to: 'agent', kind: 'contains' }),
      expect.objectContaining({
        from: 'agent',
        to: 'activity:view:tool-group:agent',
        kind: 'invokes',
      }),
    ]));
    const toolGroup = graph?.nodes.find((node) => node.kind === 'tool_batch');
    expect(toolGroup?.output.tool_execution).toMatchObject({
      call_count: 1,
      batch_count: 1,
      max_parallel_width: 1,
      calls: [expect.objectContaining({
        id: 'tool',
        name: 'tool',
        status: 'completed',
      })],
    });
    expect(toolGroup?.semantic_view).toBe(true);
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

  it('does not present internal event codes as business output summaries', () => {
    const execution = activity('execution', 'execution', 'root');
    const agent = {
      ...activity('agent', 'agent', 'root', 'execution'),
      output: 'runtime.outcome.recorded.v1',
    };

    const graph = combineExecutionLineage('root', [projection('root', [execution, agent])]);

    expect(graph?.nodes.find((node) => node.node_id === 'agent')?.output_summary).toBe('');
  });

  it('keeps a session ingress execution while hiding its internal result artifacts', () => {
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
      projection(executionId, [execution, toolBatch, result]),
    ]);

    expect(graph?.nodes.map((node) => node.node_id)).toEqual([
      execution.activity_id,
    ]);
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
