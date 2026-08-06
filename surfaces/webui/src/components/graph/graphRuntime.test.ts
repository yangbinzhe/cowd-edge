import { describe, expect, it } from 'vitest';
import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';
import {
  graphDiagnostics,
  graphExportPayload,
  semanticHierarchyLayoutEdges,
  graphLayoutSignature,
  semanticToolColumnLayoutEdges,
} from './graphRuntime';

const nodes: GraphNodeView[] = [
  { id: 'a', type: 'mission', label: 'Mission A', status: 'running' },
  { id: 'b', type: 'agent', label: 'Agent B', status: 'ready', evidenceRefs: ['ev-1'] },
];
const edges: GraphEdgeView[] = [
  { id: 'a-b', source: 'a', target: 'b', type: 'owns' },
  { id: 'b-missing', source: 'b', target: 'missing', type: 'depends_on' },
];

describe('graph runtime contracts', () => {
  it('reports dangling and duplicate identities instead of silently dropping integrity failures', () => {
    const result = graphDiagnostics([...nodes, nodes[0]], [...edges, edges[0]]);
    expect(result.duplicateNodeIds).toEqual(['a']);
    expect(result.duplicateEdgeIds).toEqual(['a-b']);
    expect(result.danglingEdgeIds).toEqual(['b-missing']);
  });

  it('produces a deterministic layout signature independent of transport ordering', () => {
    expect(graphLayoutSignature('g', 'RIGHT', nodes, edges)).toBe(
      graphLayoutSignature('g', 'RIGHT', [...nodes].reverse(), [...edges].reverse()),
    );
    expect(graphLayoutSignature('g', 'RIGHT', nodes, edges)).not.toBe(graphLayoutSignature('g', 'DOWN', nodes, edges));
  });

  it('exports only the selected view while preserving graph provenance and diagnostics', () => {
    const rawNodes = [{ ...nodes[0], raw: { internal_reasoning: 'must not export' } }, nodes[1]];
    const model: GraphViewModel = { id: 'g', title: 'Runtime', revision: 9, status: 'live', nodes: rawNodes, edges, truncated: true };
    const diagnostics = graphDiagnostics(nodes, edges);
    const payload = graphExportPayload(model, rawNodes.slice(0, 1), [], 'RIGHT', diagnostics, new Date('2026-07-16T00:00:00.000Z'));
    expect(payload.graph).toMatchObject({ id: 'g', revision: 9, truncated: true, direction: 'RIGHT' });
    expect(payload.selection).toEqual({ node_count: 1, edge_count: 0 });
    expect(payload.diagnostics.danglingEdgeIds).toEqual(['b-missing']);
    expect(payload.generated_at).toBe('2026-07-16T00:00:00.000Z');
    expect(payload.nodes[0]).not.toHaveProperty('raw');
    expect(JSON.stringify(payload)).not.toContain('internal_reasoning');
  });

  it('keeps a 500-node view complete for list fallback decisions', () => {
    const large = Array.from({ length: 500 }, (_, index) => ({
      id: `node-${index}`,
      type: 'task',
      label: `Task ${index}`,
      status: 'ready',
    }));
    expect(graphDiagnostics(large, []).duplicateNodeIds).toEqual([]);
    expect(graphExportPayload({ id: 'large', title: 'Large', nodes: large, edges: [] }, large, [], 'RIGHT', graphDiagnostics(large, [])).nodes).toHaveLength(500);
  });

  it('adds layout-only ordering for tools under one Agent without exporting a false relation', () => {
    const semanticNodes: GraphNodeView[] = [{
      id: 'agent',
      type: 'agent_task',
      label: 'Agent',
      status: 'running',
      raw: { executor_kind: 'agent' },
    }, {
      id: 'tool-b',
      type: 'tool',
      label: 'Tool B',
      status: 'running',
      raw: { executor_kind: 'tool', sequence: 2 },
    }, {
      id: 'tool-a',
      type: 'tool',
      label: 'Tool A',
      status: 'completed',
      raw: { executor_kind: 'tool', sequence: 1 },
    }];
    const semanticEdges: GraphEdgeView[] = [{
      id: 'agent-a',
      source: 'agent',
      target: 'tool-a',
      type: 'invokes',
    }, {
      id: 'agent-b',
      source: 'agent',
      target: 'tool-b',
      type: 'invokes',
    }];

    expect(semanticToolColumnLayoutEdges(
      'activity-lineage:execution',
      'DOWN',
      semanticNodes,
      semanticEdges,
    )).toEqual([expect.objectContaining({
      source: 'tool-a',
      target: 'tool-b',
      type: 'layout_only',
    })]);
    expect(graphExportPayload(
      { id: 'activity-lineage:execution', title: 'Execution', nodes: semanticNodes, edges: semanticEdges },
      semanticNodes,
      semanticEdges,
      'DOWN',
      graphDiagnostics(semanticNodes, semanticEdges),
    ).edges).toHaveLength(2);
  });

  it('uses only organization edges to lay out semantic graphs', () => {
    const semanticEdges: GraphEdgeView[] = [{
      id: 'owns',
      source: 'team',
      target: 'agent',
      type: 'delegates',
    }, {
      id: 'data',
      source: 'tool',
      target: 'agent',
      type: 'consumed',
    }, {
      id: 'dependency',
      source: 'agent',
      target: 'agent-2',
      type: 'depends_on',
    }];
    expect(semanticHierarchyLayoutEdges(
      'activity-lineage:execution',
      semanticEdges,
    )).toEqual([semanticEdges[0]]);
    expect(semanticHierarchyLayoutEdges('generic', semanticEdges)).toEqual(semanticEdges);
  });
});
