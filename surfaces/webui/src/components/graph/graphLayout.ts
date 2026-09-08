type LayoutGraph = Record<string, any>;

interface LayoutResponse {
  id: number;
  result?: LayoutGraph;
  error?: string;
}

let worker: Worker | null = null;
let nextRequestId = 1;
// Bounds layout optimization, never the size or lifetime of business work.
const LAYOUT_TIMEOUT_MS = 10_000;
const pending = new Map<number, {
  resolve: (graph: LayoutGraph) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function rejectPending(error: Error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function layoutWorker() {
  if (worker || typeof Worker === 'undefined') return worker;
  worker = new Worker(new URL('./graphLayout.worker.ts', import.meta.url), { type: 'module' });
  const currentWorker = worker;
  worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
    if (worker !== currentWorker) return;
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    clearTimeout(request.timer);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result || {});
  };
  worker.onerror = (event) => {
    if (worker !== currentWorker) return;
    rejectPending(new Error(event.message || 'Graph layout worker failed'));
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function fallbackLayout(graph: LayoutGraph) {
  const children = Array.isArray(graph.children) ? graph.children : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const ids = new Set<string>(children.map((child: LayoutGraph) => String(child.id || '')));
  const successors = new Map<string, Set<string>>();
  const remaining = new Map<string, number>([...ids].map((id) => [id, 0]));
  for (const edge of edges) {
    const target = String(edge.targets?.[0] || '');
    const source = String(edge.sources?.[0] || '');
    if (!ids.has(source) || !ids.has(target)) continue;
    const next = successors.get(source) || new Set<string>();
    if (next.has(target)) continue;
    next.add(target);
    successors.set(source, next);
    remaining.set(target, (remaining.get(target) || 0) + 1);
  }
  const depths = new Map<string, number>();
  const ready = [...ids].filter((id) => remaining.get(id) === 0);
  // Iterative topological waves avoid stack overflow on deep Agent lineages.
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index];
    const depth = depths.get(id) || 0;
    depths.set(id, depth);
    for (const target of successors.get(id) || []) {
      depths.set(target, Math.max(depths.get(target) || 0, depth + 1));
      const count = (remaining.get(target) || 0) - 1;
      remaining.set(target, count);
      if (!count) ready.push(target);
    }
  }
  // Cyclic relations remain visible in a separate wave, not recursively erased.
  let cycleDepth = 0;
  for (const depth of depths.values()) cycleDepth = Math.max(cycleDepth, depth + 1);
  for (const id of ids) if (remaining.get(id)) depths.set(id, cycleDepth);
  const lanes = new Map<number, number>();
  const direction = String(graph.layoutOptions?.['elk.direction'] || 'RIGHT');
  let stepX = direction === 'DOWN' ? 238 : 278;
  let stepY = direction === 'DOWN' ? 158 : 118;
  for (const child of children) {
    stepX = Math.max(stepX, Number(child.width || 0) + 40);
    stepY = Math.max(stepY, Number(child.height || 0) + 40);
  }
  return {
    ...graph,
    children: children.map((child: LayoutGraph) => {
      const depth = depths.get(String(child.id || '')) || 0;
      const lane = lanes.get(depth) || 0;
      lanes.set(depth, lane + 1);
      return {
        ...child,
        x: direction === 'DOWN' ? lane * stepX : depth * stepX,
        y: direction === 'DOWN' ? depth * stepY : lane * stepY,
      };
    }),
  };
}

export async function runGraphLayout(graph: LayoutGraph) {
  try {
    const activeWorker = layoutWorker();
    if (!activeWorker) return fallbackLayout(graph);
    const id = nextRequestId++;
    return await new Promise<LayoutGraph>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (worker !== activeWorker) return;
        rejectPending(new Error('Graph layout worker timed out'));
        activeWorker.terminate();
        worker = null;
      }, LAYOUT_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        activeWorker.postMessage({ id, graph });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  } catch {
    return fallbackLayout(graph);
  }
}
