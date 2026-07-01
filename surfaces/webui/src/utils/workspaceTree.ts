import type { WorkspaceFile } from '../types';

export interface WorkspaceTreeNode extends WorkspaceFile {
  depth: number;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  children: WorkspaceTreeNode[];
}

export interface WorkspaceContextTarget {
  path: string;
  name: string;
  kind: 'blank' | 'dir' | 'file';
}

export function parentPathOf(path: string) {
  const parts = String(path || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function fileNameOf(path: string) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts.at(-1) || path || 'root';
}

export function joinWorkspacePath(parent: string, name: string) {
  const cleanParent = String(parent || '').replace(/^\/+|\/+$/g, '');
  const cleanName = String(name || '').replace(/^\/+|\/+$/g, '');
  return [cleanParent, cleanName].filter(Boolean).join('/');
}

export function createWorkspaceTreeNode(file: WorkspaceFile, depth = 0, expanded = false): WorkspaceTreeNode {
  return {
    ...file,
    name: file.name || fileNameOf(file.path),
    kind: file.kind || (file.is_dir ? 'dir' : 'file'),
    depth,
    expanded: file.kind === 'dir' ? expanded : false,
    loading: false,
    loaded: false,
    children: [],
  };
}

export function createWorkspaceRoot(): WorkspaceTreeNode {
  return createWorkspaceTreeNode({ name: 'root', path: '', kind: 'dir' }, 0, true);
}

function sortFiles(files: WorkspaceFile[]) {
  return [...files].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function mergeWorkspaceTreeChildren(
  root: WorkspaceTreeNode,
  dir: string,
  files: WorkspaceFile[],
  expandedPaths: Set<string>,
): WorkspaceTreeNode {
  const normalizedDir = String(dir || '');
  const mergeNode = (node: WorkspaceTreeNode): WorkspaceTreeNode => {
    if (node.path === normalizedDir) {
      return {
        ...node,
        expanded: true,
        loading: false,
        loaded: true,
        children: sortFiles(files).map((file) => {
          const existing = node.children.find((child) => child.path === file.path);
          const child = existing || createWorkspaceTreeNode(file, node.depth + 1, expandedPaths.has(file.path));
          return {
            ...child,
            ...file,
            name: file.name || fileNameOf(file.path),
            kind: file.kind || (file.is_dir ? 'dir' : 'file'),
            depth: node.depth + 1,
            expanded: expandedPaths.has(file.path),
          };
        }),
      };
    }
    if (!node.children.length) return node;
    return { ...node, children: node.children.map(mergeNode) };
  };
  return mergeNode(root);
}

export function markWorkspaceTreeLoading(root: WorkspaceTreeNode, dir: string, loading: boolean): WorkspaceTreeNode {
  const normalizedDir = String(dir || '');
  const markNode = (node: WorkspaceTreeNode): WorkspaceTreeNode => {
    if (node.path === normalizedDir) return { ...node, loading };
    if (!node.children.length) return node;
    return { ...node, children: node.children.map(markNode) };
  };
  return markNode(root);
}

export function setWorkspaceTreeExpanded(root: WorkspaceTreeNode, dir: string, expanded: boolean): WorkspaceTreeNode {
  const normalizedDir = String(dir || '');
  const setNode = (node: WorkspaceTreeNode): WorkspaceTreeNode => {
    if (node.path === normalizedDir) return { ...node, expanded };
    if (!node.children.length) return node;
    return { ...node, children: node.children.map(setNode) };
  };
  return setNode(root);
}

export function findWorkspaceTreeNode(root: WorkspaceTreeNode, path: string): WorkspaceTreeNode | null {
  if (root.path === path) return root;
  for (const child of root.children) {
    const found = findWorkspaceTreeNode(child, path);
    if (found) return found;
  }
  return null;
}

export function flattenWorkspaceTree(root: WorkspaceTreeNode): WorkspaceTreeNode[] {
  const rows: WorkspaceTreeNode[] = [];
  const visit = (node: WorkspaceTreeNode) => {
    rows.push(node);
    if (node.kind === 'dir' && node.expanded) node.children.forEach(visit);
  };
  root.children.forEach(visit);
  return rows;
}
