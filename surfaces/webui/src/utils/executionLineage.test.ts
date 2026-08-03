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
  } as unknown as ExecutionProjection;
}

describe('execution lineage', () => {
  it('projects a team run into goal, team, and Agent dependencies with tool evidence attached', () => {
    const teamId = 'team-graph:team';
    const researcherOne = `${teamId}:researcher:1`;
    const researcherTwo = `${teamId}:researcher:2`;
    const synthesizer = `${teamId}:synthesizer:1`;
    const root = projection('root', {
      graph_id: 'root',
      objective: 'Coordinate work',
      revision: 1,
      nodes: [{ node_id: 'model', kind: 'inline_model', status: 'completed' }],
      edges: [],
    }, [{
      execution_id: teamId,
      parent_execution_id: 'root',
      parent_node_id: 'delegate',
      objective: 'Run team',
      status: 'running',
      cursor: 1,
      revision: 1,
    }]);
    root.teams = [{ detail: { graph_id: teamId } }] as any;
    root.live = { metrics: { tool_calls: 5 } } as any;
    const team = projection(teamId, {
      graph_id: teamId,
      objective: 'Run team',
      revision: 1,
      nodes: [
        { node_id: researcherOne, kind: 'agent_task', status: 'completed', usage: { tool_calls: 2 }, summary: '{"findings":[{"description":"first result"}' },
        { node_id: researcherTwo, kind: 'agent_task', status: 'completed', usage: { tool_calls: 1 }, summary: '{"summary":"second result"}' },
        { node_id: synthesizer, kind: 'agent_task', status: 'running', usage: { tool_calls: 0 } },
        { node_id: `${teamId}:verify`, kind: 'verify', status: 'planned' },
      ],
      edges: [
        { from: researcherOne, to: synthesizer, kind: 'depends_on' },
        { from: researcherTwo, to: synthesizer, kind: 'depends_on' },
      ],
    }, [{
      execution_id: 'agent-1',
      parent_execution_id: teamId,
      parent_node_id: researcherOne,
      status: 'terminal',
    }, {
      execution_id: 'agent-2',
      parent_execution_id: teamId,
      parent_node_id: researcherTwo,
      status: 'terminal',
    }]);
    const agentOne = projection('agent-1', {
      graph_id: 'agent-1',
      objective: 'Focus: architecture',
      nodes: [{
        node_id: 'batch-1',
        kind: 'tool_batch',
        status: 'completed',
        payload_ref: JSON.stringify({
          calls: [
            { id: 'read-1', name: 'read_file', input: '{}', depends_on: [] },
            { id: 'grep-1', name: 'grep_search', input: '{}', depends_on: [] },
          ],
        }),
        usage: { duration_ms: 10, tool_calls: 2 },
      }],
      edges: [],
    });
    const agentTwo = projection('agent-2', {
      graph_id: 'agent-2',
      objective: 'Focus: contradictions',
      nodes: [{
        node_id: 'batch-2',
        kind: 'tool_batch',
        status: 'completed',
        payload_ref: JSON.stringify({
          calls: [{ id: 'read-2', name: 'read_file', input: '{}', depends_on: [] }],
        }),
        usage: { duration_ms: 8, tool_calls: 1 },
      }],
      edges: [],
    });

    expect(executionProjectionLinks(root)).toEqual([teamId]);
    const graph = combineExecutionLineage('root', [root, team, agentOne, agentTwo]);
    const nodeKinds = graph?.nodes.map((node: any) => node.kind);
    const semanticAgentOne = `semantic::agent::${teamId}::${researcherOne}`;
    const semanticAgentTwo = `semantic::agent::${teamId}::${researcherTwo}`;
    const semanticSynthesizer = `semantic::agent::${teamId}::${synthesizer}`;

    expect(graph?.semantic_view).toBe(true);
    expect(graph?.lineage_execution_ids).toEqual(['root', teamId, 'agent-1', 'agent-2']);
    expect(nodeKinds).toEqual(expect.arrayContaining([
      'execution',
      'team',
      'agent_task',
    ]));
    expect(nodeKinds).not.toContain('inline_model');
    expect(nodeKinds).not.toContain('verify');
    expect(graph?.nodes.filter((node: any) => node.kind === 'tool_group')).toHaveLength(0);
    expect(graph?.nodes).toHaveLength(5);
    expect(graph?.nodes.map((node: any) => node.node_id)).toEqual(expect.arrayContaining([
      'semantic::goal::root',
      `semantic::team::${teamId}`,
      semanticAgentOne,
      semanticAgentTwo,
      semanticSynthesizer,
    ]));
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'semantic::goal::root', to: `semantic::team::${teamId}`, kind: 'delegates' }),
      expect.objectContaining({ from: semanticAgentOne, to: semanticSynthesizer, kind: 'depends_on' }),
      expect.objectContaining({ from: semanticAgentTwo, to: semanticSynthesizer, kind: 'depends_on' }),
    ]));
    expect(graph?.nodes.find((node: any) => node.node_id === semanticAgentOne)).toEqual(
      expect.objectContaining({
        semantic_metrics: expect.objectContaining({
          tool_calls: 2,
          batches: 1,
          max_parallel_width: 2,
        }),
        output_summary: '1 项发现',
        canonical_node_ids: ['batch-1'],
      }),
    );
    expect(graph?.nodes.find((node: any) => node.kind === 'execution')).toEqual(
      expect.objectContaining({
        semantic_metrics: expect.objectContaining({
          teams: 1,
          agents: 3,
          tool_calls: 5,
          orchestration_calls: 2,
        }),
      }),
    );
  });

  it('keeps a direct run compact while retaining aggregated tool evidence', () => {
    const root = projection('root', {
      graph_id: 'root',
      objective: 'Inspect one file',
      revision: 1,
      nodes: [
        { node_id: 'model', kind: 'inline_model', status: 'completed' },
        {
          node_id: 'tools',
          kind: 'tool_batch',
          status: 'completed',
          payload_ref: JSON.stringify({
            calls: [{ id: 'read', name: 'read_file', input: '{}', depends_on: [] }],
          }),
        },
      ],
      edges: [{ from: 'model', to: 'tools', kind: 'depends_on' }],
    });

    const graph = combineExecutionLineage('root', [root]);

    expect(graph?.nodes.map((node: any) => node.kind)).toEqual(['execution', 'agent_task']);
    expect(graph?.edges).toEqual([expect.objectContaining({ kind: 'produces' })]);
    expect(graph?.nodes[1]).toEqual(expect.objectContaining({
      semantic_metrics: expect.objectContaining({ tool_calls: 1, batches: 1 }),
      canonical_node_ids: ['tools'],
    }));
  });

  it('preserves a full bounded team lineage beyond twelve child graphs', () => {
    const children = Array.from({ length: 32 }, (_, index) => ({
      execution_id: `agent-${index + 1}`,
      parent_execution_id: 'team',
      parent_node_id: `researcher-${index + 1}`,
      objective: `focus ${index + 1}`,
      status: 'running',
      cursor: index + 1,
      revision: 1,
    }));
    const root = projection('root', {
      graph_id: 'root',
      objective: 'Coordinate a large team',
      revision: 1,
      nodes: [],
      edges: [],
    }, children);

    expect(executionProjectionLinks(root)).toHaveLength(32);
    expect(executionProjectionLinks(root).at(-1)).toBe('agent-32');
  });
});
