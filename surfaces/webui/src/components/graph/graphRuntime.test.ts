import { describe, expect, it } from 'vitest';
import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';
import { graphDiagnostics, graphExportPayload, graphLayoutSignature } from './graphRuntime';

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
    const model: GraphViewModel = { id: 'g', title: 'Runtime', revision: 9, status: 'live', nodes, edges, truncated: true };
    const diagnostics = graphDiagnostics(nodes, edges);
    const payload = graphExportPayload(model, nodes.slice(0, 1), [], 'RIGHT', diagnostics, new Date('2026-07-16T00:00:00.000Z'));
    expect(payload.graph).toMatchObject({ id: 'g', revision: 9, truncated: true, direction: 'RIGHT' });
    expect(payload.selection).toEqual({ node_count: 1, edge_count: 0 });
    expect(payload.diagnostics.danglingEdgeIds).toEqual(['b-missing']);
    expect(payload.generated_at).toBe('2026-07-16T00:00:00.000Z');
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
});
