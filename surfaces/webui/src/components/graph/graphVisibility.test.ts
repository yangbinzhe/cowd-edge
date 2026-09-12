import { describe, expect, it } from 'vitest';
import type { GraphViewModel } from '../../types/graph';
import { graphHierarchy, graphVisibility, loadGraphBranches, saveGraphBranches } from './graphVisibility';
function chain(count: number): GraphViewModel {
  return { id: 'scope-a', title: 'Research',
    nodes: Array.from({ length: count }, (_, i) => ({ id: `${i}`, label: `Task ${i}`, type: 'task', status: 'completed' })),
    edges: Array.from({ length: count - 1 }, (_, i) => ({ id: `edge-${i}`, source: `${i}`, target: `${i + 1}`, type: 'contains' })),
  };
}
describe('canonical graph branch navigation', () => {
  it.each([100, 1000, 10000])('finds the last of %i nodes through collapsed ancestors without recursion', count => {
    const model = chain(count), hierarchy = graphHierarchy(model);
    expect(graphVisibility(hierarchy, {}).visible.map(node => node.id)).toEqual(['0', '1']);
    const found = graphVisibility(hierarchy, { '0': false }, `Task ${count - 1}`);
    expect(found.visible).toHaveLength(count);
    expect([...found.matches]).toEqual([`${count - 1}`]);
    expect(graphVisibility(hierarchy, { '0': false }).visible).toHaveLength(1);
    expect(model.nodes).toHaveLength(count);
  });
  it('keeps manual collapse despite a newly blocked descendant and reports its count', () => {
    const model = chain(4); model.nodes[3]!.status = 'blocked';
    const hierarchy = graphHierarchy(model);
    expect(graphVisibility(hierarchy, {}).visible).toHaveLength(4);
    expect(graphVisibility(hierarchy, { '0': false }).visible).toHaveLength(1);
    expect(hierarchy.blocked.get('0')).toBe(1);
    expect(hierarchy.descendants.get('0')).toBe(3);
    expect(graphVisibility(hierarchy, { '0': false }, '', 'blocked').visible).toHaveLength(4);
  });
  it('preserves dependency roots and retains cycle/diamond nodes once', () => {
    const model = chain(5); model.edges[0]!.type = 'depends_on';
    model.edges.push({ id: 'cycle', source: '4', target: '1', type: 'contains' }, { id: 'diamond', source: '1', target: '4', type: 'contains' });
    const hierarchy = graphHierarchy(model);
    expect(hierarchy.parent.has('0')).toBe(false);
    expect(hierarchy.parent.has('1')).toBe(false);
    const all = graphVisibility(hierarchy, Object.fromEntries(model.nodes.map(node => [node.id, true]))).visible;
    expect(all).toHaveLength(5);
    expect(new Set(all.map(node => node.id)).size).toBe(5);
  });
  it('isolates persisted scope and tolerates malformed storage', () => {
    localStorage.clear();
    saveGraphBranches('session-a:goal-a', { '0': false });
    saveGraphBranches('session-b:goal-a', { '0': true });
    expect(loadGraphBranches('session-a:goal-a')).toEqual({ '0': false });
    expect(loadGraphBranches('session-b:goal-a')).toEqual({ '0': true });
    expect(loadGraphBranches('session-c:goal-a')).toEqual({});
    localStorage.setItem('cowd.graph.branches.v1', 'not json');
    expect(loadGraphBranches('session-a:goal-a')).toEqual({});
    localStorage.clear();
  });
});
