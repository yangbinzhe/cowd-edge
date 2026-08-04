import { describe, expect, it } from 'vitest';
import type {
  ExecutionActivityProjection,
  ExecutionActivityRelation,
  ExecutionProjection,
} from '../types';
import { combineExecutionLineage, executionProjectionLinks } from './executionLineage';

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
      expect.objectContaining({ from: 'agent', to: 'tool', kind: 'invokes' }),
    ]));
    expect(graph?.nodes.find((node) => node.node_id === 'tool')).toEqual(
      expect.objectContaining({
        parallel_group_id: 'parallel-search',
        evidence_refs: ['evidence'],
        artifact_refs: ['artifact'],
      }),
    );
  });

  it('does not invent a graph when canonical activities are absent', () => {
    expect(combineExecutionLineage('root', [projection('root', [])])).toBeNull();
  });
});
