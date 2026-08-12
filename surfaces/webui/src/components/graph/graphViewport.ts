export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface SavedGraphViewport extends GraphViewport {
  signature: string;
}

/**
 * Viewport persistence for GraphSurface (F3). One entry per graph model id;
 * an entry is restorable only when the layout signature that produced it
 * still matches, so a topology change always fits instead of restoring a
 * stale position.
 */
export function saveGraphViewport(
  store: Map<string, SavedGraphViewport>,
  modelId: string,
  viewport: GraphViewport | undefined,
  signature: string,
) {
  if (!viewport || !modelId || !signature) return;
  store.set(modelId, {
    x: Number(viewport.x) || 0,
    y: Number(viewport.y) || 0,
    zoom: Number(viewport.zoom) || 1,
    signature,
  });
}

export function restorableGraphViewport(
  store: Map<string, SavedGraphViewport>,
  modelId: string,
  signature: string,
): SavedGraphViewport | null {
  if (!modelId || !signature) return null;
  const saved = store.get(modelId);
  return saved && saved.signature === signature ? saved : null;
}
