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

export type GraphPositions = Record<string, { x: number; y: number }>;
const positionStorageKey = 'cowd.graph.positions.v1';
export function validGraphPosition(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y);
}
export function loadGraphPositions(modelId: string): GraphPositions {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(positionStorageKey) || '[]');
    if (!Array.isArray(rows)) return {};
    const row = rows.find(row => Array.isArray(row) && row[0] === modelId);
    if (!row || typeof row[1] !== 'object' || row[1] === null) return {};
    return Object.fromEntries(Object.entries(row[1]).filter((entry): entry is [string, { x: number; y: number }] => validGraphPosition(entry[1])));
  } catch { return {}; }
}
export function saveGraphPositions(modelId: string, positions: GraphPositions) {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(positionStorageKey) || '[]');
    const rows = Array.isArray(saved) ? saved.filter(row => Array.isArray(row) && row[0] !== modelId) : [];
    localStorage.setItem(positionStorageKey, JSON.stringify([...rows.slice(-23), [modelId, positions]]));
  } catch { /* Storage can be disabled or full; retain current in-memory positions. */ }
}
