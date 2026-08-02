import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

self.onmessage = async (event: MessageEvent<{ id: number; graph: Record<string, unknown> }>) => {
  const { id, graph } = event.data;
  try {
    const result = await elk.layout(graph);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
