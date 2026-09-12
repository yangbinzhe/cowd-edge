export type GraphDirection = 'RIGHT' | 'DOWN';

export type GraphNodeView = {
  id: string;
  type: string;
  label: string;
  status: string;
  group?: string;
  description?: string;
  summary?: string;
  outputSummary?: string;
  metrics?: string[];
  evidenceRefs?: string[];
  correlationRefs?: string[];
  href?: string;
  badges?: string[];
  raw?: Record<string, unknown>;
}

export type GraphEdgeView = {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
  status?: string;
  evidenceRefs?: string[];
  correlationRefs?: string[];
  href?: string;
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
  work?: {
    nodeCount: number;
    width: number;
    depth: number;
    expectedSerialMs: number;
    expectedCriticalPathMs: number;
    expectedSpeedupBasisPoints?: number;
    actualSerialMs: number;
    actualCriticalPathMs: number;
    actualSpeedupBasisPoints?: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    optionalNodes: number;
    cancelledOptionalNodes: number;
  };
}
