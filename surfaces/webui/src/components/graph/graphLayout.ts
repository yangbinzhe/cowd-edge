type LayoutGraph = Record<string, any>;
const FAST_LAYOUT_NODE_THRESHOLD = 72;

interface LayoutResponse {
  id: number;
  result?: LayoutGraph;
  error?: string;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, {
  resolve: (graph: LayoutGraph) => void;
  reject: (error: Error) => void;
}>();

function rejectPending(error: Error) {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function layoutWorker() {
  if (worker || typeof Worker === 'undefined') return worker;
  worker = new Worker(new URL('./graphLayout.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result || {});
  };
  worker.onerror = (event) => {
    rejectPending(new Error(event.message || 'Graph layout worker failed'));
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function fallbackLayout(graph: LayoutGraph) {
  const children = Array.isArray(graph.children) ? graph.children : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    const target = String(edge.targets?.[0] || '');
    const source = String(edge.sources?.[0] || '');
    if (target && source) predecessors.set(target, [...(predecessors.get(target) || []), source]);
  }
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const depth = Math.max(0, ...(predecessors.get(id) || []).map((source) => depthOf(source) + 1));
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };
  const lanes = new Map<number, number>();
  const direction = String(graph.layoutOptions?.['elk.direction'] || 'RIGHT');
  return {
    ...graph,
    children: children.map((child: LayoutGraph) => {
      const depth = depthOf(String(child.id || ''));
      const lane = lanes.get(depth) || 0;
      lanes.set(depth, lane + 1);
      return {
        ...child,
        x: direction === 'DOWN' ? lane * 238 : depth * 278,
        y: direction === 'DOWN' ? depth * 158 : lane * 118,
      };
    }),
  };
}

export async function runGraphLayout(graph: LayoutGraph) {
  if ((Array.isArray(graph.children) ? graph.children.length : 0) > FAST_LAYOUT_NODE_THRESHOLD) {
    return fallbackLayout(graph);
  }
  const activeWorker = layoutWorker();
  if (!activeWorker) return fallbackLayout(graph);
  const id = nextRequestId++;
  return new Promise<LayoutGraph>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    activeWorker.postMessage({ id, graph });
  }).catch(() => fallbackLayout(graph));
}
