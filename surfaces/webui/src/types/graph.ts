export type GraphDirection = 'RIGHT' | 'DOWN';

export interface GraphNodeView {
  id: string;
  type: string;
  label: string;
  status: string;
  group?: string;
  summary?: string;
  evidenceRefs?: string[];
  badges?: string[];
  raw?: Record<string, unknown>;
}

export interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
  status?: string;
  evidenceRefs?: string[];
  raw?: Record<string, unknown>;
}

export interface GraphViewModel {
  id: string;
  title: string;
  revision?: number;
  status?: string;
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  truncated?: boolean;
}
