import { describe, expect, it } from 'vitest';
import type { ExecutionProjection } from '../types';
import { combineExecutionLineage, executionProjectionLinks } from './executionLineage';

function projection(
  executionId: string,
  graph: Record<string, any>,
  childExecutions: any[] = [],
): ExecutionProjection {
  return {
    schema_version: 2,
    execution_id: executionId,
    revision: 1,
    cursor: 1,
    authorization_revision: 1,
    redaction_revision: '1',
    detail_scope: 'full',
    graph,
    child_executions: childExecutions,
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
  } as ExecutionProjection;
}

describe('execution lineage', () => {
  it('keeps root, team, and parallel member work in one graph', () => {
    const root = projection('root', {
      graph_id: 'root',
      objective: 'Coordinate work',
      revision: 1,
      nodes: [{ node_id: 'delegate', kind: 'subgraph', status: 'completed' }],
      edges: [],
    }, [{
      execution_id: 'team',
      parent_execution_id: 'root',
      parent_node_id: 'delegate',
      objective: 'Run team',
      status: 'running',
      cursor: 1,
      revision: 1,
    }]);
    const team = projection('team', {
      graph_id: 'team',
      objective: 'Run team',
      revision: 1,
      nodes: [
        { node_id: 'research:1', kind: 'agent_task', status: 'running' },
        { node_id: 'research:2', kind: 'agent_task', status: 'running' },
        { node_id: 'synthesize', kind: 'synthesize', status: 'planned' },
      ],
      edges: [
        { from: 'research:1', to: 'synthesize', kind: 'depends_on' },
        { from: 'research:2', to: 'synthesize', kind: 'depends_on' },
      ],
    });

    expect(executionProjectionLinks(root)).toEqual(['team']);
    const graph = combineExecutionLineage('root', [root, team]);

    expect(graph?.lineage_execution_ids).toEqual(['root', 'team']);
    expect(graph?.nodes.map((node: any) => node.node_id)).toEqual(expect.arrayContaining([
      'lineage::root',
      'root::delegate',
      'lineage::team',
      'team::research:1',
      'team::research:2',
      'team::synthesize',
    ]));
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'root::delegate', to: 'lineage::team' }),
      expect.objectContaining({ from: 'team::research:1', to: 'team::synthesize' }),
      expect.objectContaining({ from: 'team::research:2', to: 'team::synthesize' }),
    ]));
  });
});
