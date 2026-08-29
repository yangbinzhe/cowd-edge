export const minimumReflowWidth = 320;

export function layoutViewport(viewport) {
  if (viewport.scenario !== 'zoom-200') {
    return { width: viewport.width, height: viewport.height };
  }
  return {
    width: Math.max(minimumReflowWidth, Math.floor(viewport.width / 2)),
    height: Math.max(1, Math.floor(viewport.height / 2)),
  };
}
