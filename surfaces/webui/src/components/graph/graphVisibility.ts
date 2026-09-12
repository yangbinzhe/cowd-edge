import type { GraphNodeView, GraphViewModel } from '../../types/graph';
import { graphEdgeVisualKind } from './graphRuntime';

export type GraphBranchPreferences = Record<string, boolean>;
const completed = new Set(['completed', 'accepted', 'verified', 'succeeded', 'cancelled']);
const active = new Set(['running', 'active', 'blocked', 'waiting', 'error', 'failed']);

/** A presentation forest only: canonical nodes and all original edges remain owned by the model. */
export function graphHierarchy(model: GraphViewModel) {
  const nodes = new Map(model.nodes.map(node => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of model.edges) {
    if (graphEdgeVisualKind(edge.type) !== 'hierarchy' || edge.source === edge.target
      || !nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const children = adjacency.get(edge.source) || [];
    children.push(edge.target);
    adjacency.set(edge.source, children);
    incoming.add(edge.target);
  }
  const parent = new Map<string, string>();
  const depths = new Map<string, number>();
  const children = new Map<string, string[]>();
  const order: string[] = [];
  const roots: string[] = [];
  const seen = new Set<string>();
  const seeds = [...nodes.keys()].filter(id => !incoming.has(id)).concat([...nodes.keys()]);
  for (const seed of seeds) {
    if (seen.has(seed)) continue;
    roots.push(seed);
    seen.add(seed);
    const queue = [seed];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      order.push(id);
      for (const child of adjacency.get(id) || []) {
        if (seen.has(child)) continue;
        seen.add(child);
        parent.set(child, id);
        depths.set(child, (depths.get(id) || 0) + 1);
        const siblings = children.get(id) || [];
        siblings.push(child);
        children.set(id, siblings);
        queue.push(child);
      }
    }
  }
  const descendants = new Map<string, number>();
  const blocked = new Map<string, number>();
  const activePath = new Set<string>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const node = nodes.get(id)!;
    if (active.has(node.status)) activePath.add(id);
    if (node.status === 'blocked') blocked.set(id, (blocked.get(id) || 0) + 1);
    const ancestor = parent.get(id);
    if (ancestor) {
      descendants.set(ancestor, (descendants.get(ancestor) || 0) + 1 + (descendants.get(id) || 0));
      blocked.set(ancestor, (blocked.get(ancestor) || 0) + (blocked.get(id) || 0));
      if (activePath.has(id)) activePath.add(ancestor);
    }
  }
  return { nodes, parent, children, roots, order, descendants, blocked, activePath, depths };
}

export function graphVisibility(
  hierarchy: ReturnType<typeof graphHierarchy>,
  preferences: GraphBranchPreferences,
  query = '',
  status = 'all',
) {
  const { nodes, parent, children, roots, activePath } = hierarchy;
  const filtering = Boolean(query.trim()) || status !== 'all';
  const needle = query.trim().toLowerCase();
  const included = new Set<string>();
  const matches = new Set<string>();
  if (filtering) {
    for (const node of nodes.values()) {
      if ((status !== 'all' && node.status !== status)
        || !`${node.id} ${node.label} ${node.type} ${node.summary || ''}`.toLowerCase().includes(needle)) continue;
      matches.add(node.id);
      let id: string | undefined = node.id;
      while (id && !included.has(id)) {
        included.add(id);
        id = parent.get(id);
      }
    }
  }
  const collapsed = new Set<string>();
  for (const [id, node] of nodes) {
    const expanded = Object.hasOwn(preferences, id)
      ? preferences[id]
      : !parent.has(id) || node.type === 'team' || !completed.has(node.status) || activePath.has(id);
    if (!expanded && children.has(id)) collapsed.add(id);
  }
  const visible: GraphNodeView[] = [];
  const stack = [...roots].reverse();
  while (stack.length) {
    const id = stack.pop()!;
    if (filtering && !included.has(id)) continue;
    visible.push(nodes.get(id)!);
    if (!filtering && collapsed.has(id)) continue;
    const branch = children.get(id) || [];
    for (let i = branch.length - 1; i >= 0; i--) stack.push(branch[i]!);
  }
  return { visible, collapsed, matches, filtering };
}

const storageKey = 'cowd.graph.branches.v1';
export function loadGraphBranches(scope: string): GraphBranchPreferences {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(values)) return {};
    const row = values.find(value => Array.isArray(value) && value[0] === scope);
    if (!row || typeof row[1] !== 'object' || row[1] === null) return {};
    return Object.fromEntries(Object.entries(row[1]).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch { return {}; }
}
export function saveGraphBranches(scope: string, preferences: GraphBranchPreferences) {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const rows = Array.isArray(saved) ? saved.filter(row => Array.isArray(row) && row[0] !== scope) : [];
    localStorage.setItem(storageKey, JSON.stringify([...rows.slice(-23), [scope, preferences]]));
  } catch { /* Browser storage is optional; the current view still works. */ }
}
