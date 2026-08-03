import { describe, expect, it } from 'vitest';
import { adaptExecutionGraph } from '../adapters/graph/execution';
import {
  applyExecutionActivityState,
  expandExecutionToolBatches,
} from './executionToolGraph';

describe('execution tool graph projection', () => {
  const graph = {
    graph_id: 'execution-1',
    nodes: [
      { node_id: 'model-1', kind: 'inline_model', status: 'completed' },
      {
        node_id: 'tools-1',
        kind: 'tool_batch',
        status: 'completed',
        execution_id: 'execution-1',
        payload_ref: JSON.stringify({
          calls: [
            { id: 'call-a', name: 'web_search', input: '{"query":"a"}', depends_on: [] },
            { id: 'call-b', name: 'glob_search', input: '{"pattern":"**/*"}', depends_on: [] },
            { id: 'call-c', name: 'web_fetch', input: '{"url":"https://example.com"}', depends_on: ['call-a'] },
          ],
        }),
      },
      { node_id: 'model-2', kind: 'inline_model', status: 'completed' },
    ],
    edges: [
      { from: 'model-1', to: 'tools-1', kind: 'depends_on' },
      { from: 'tools-1', to: 'model-2', kind: 'depends_on' },
    ],
  };

  it('expands independent calls into one dependency wave and preserves dependent work', () => {
    const expanded = expandExecutionToolBatches(graph)!;
    const callA = 'tools-1:call:call-a';
    const callB = 'tools-1:call:call-b';
    const callC = 'tools-1:call:call-c';

    expect(expanded.nodes.map((node: any) => node.node_id)).toEqual(expect.arrayContaining([
      callA,
      callB,
      callC,
    ]));
    expect(expanded.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'model-1', to: callA }),
      expect.objectContaining({ from: 'model-1', to: callB }),
      expect.objectContaining({ from: callA, to: callC }),
      expect.objectContaining({ from: callB, to: 'tools-1', kind: 'joins' }),
      expect.objectContaining({ from: callC, to: 'tools-1', kind: 'joins' }),
    ]));
    expect(expanded.edges).not.toContainEqual(expect.objectContaining({
      from: 'model-1',
      to: 'tools-1',
    }));

    const model = adaptExecutionGraph(expanded);
    expect(model.nodes.find((node) => node.id === callA)?.badges).toContain('2 路并行');
    expect(model.nodes.find((node) => node.id === callB)?.badges).toContain('2 路并行');
    expect(model.nodes.find((node) => node.id === callC)?.badges).toContain('第 3 波');
  });

  it('attaches actual status, duration, input, output, and evidence to each call', () => {
    const expanded = expandExecutionToolBatches(graph, [
      {
        id: 'call-a',
        kind: 'tool',
        title: 'web_search',
        status: 'running',
        at: 100,
        tool_call_id: 'call-a',
        input: '{"query":"a"}',
      },
      {
        id: 'call-a',
        kind: 'tool',
        title: 'web_search',
        status: 'complete',
        at: 140,
        duration_ms: 40,
        tool_call_id: 'call-a',
        output: '{"results":2}',
        refs: ['evidence://search-a'],
      },
    ])!;
    const node = expanded.nodes.find((value: any) => value.tool_call_id === 'call-a');
    const model = adaptExecutionGraph(expanded);

    expect(node).toMatchObject({
      kind: 'tool_call',
      executor_kind: 'web_search',
      status: 'complete',
      duration_ms: 40,
      input: { query: 'a' },
      output: '{"results":2}',
      evidence_refs: ['evidence://search-a'],
    });
    expect(model.nodes.find((value) => value.id === node.node_id)?.badges).toContain('40 ms');
  });

  it('updates an existing semantic Agent node without creating topology', () => {
    const semantic = {
      graph_id: 'semantic-lineage:root',
      nodes: [{
        node_id: 'semantic::agent::team::researcher',
        original_node_id: 'team:researcher:1',
        child_execution_id: 'agent-run-1',
        kind: 'agent_task',
        status: 'planned',
        semantic_view: true,
        evidence_refs: [],
      }],
      edges: [],
    };
    const projected = applyExecutionActivityState(semantic, [{
      id: 'agent:agent-run-1:completed',
      kind: 'agent',
      title: 'researcher',
      execution_id: 'agent-run-1',
      node_id: 'team:researcher:1',
      phase: 'completed',
      status: 'completed',
      output: 'verified result',
      refs: ['evidence://agent/1'],
    }])!;

    expect(projected.nodes).toHaveLength(1);
    expect(projected.edges).toHaveLength(0);
    expect(projected.nodes[0]).toMatchObject({
      status: 'completed',
      output_summary: 'verified result',
      evidence_refs: ['evidence://agent/1'],
    });
  });
});
