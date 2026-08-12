import { describe, expect, it } from 'vitest';
import { restorableGraphViewport, saveGraphViewport } from './graphViewport';

describe('graph viewport persistence', () => {
  it('restores only when the layout signature still matches', () => {
    const store = new Map();
    saveGraphViewport(store, 'graph-1', { x: 12, y: 34, zoom: 2.5 }, 'sig-a');
    expect(restorableGraphViewport(store, 'graph-1', 'sig-a')).toMatchObject({
      x: 12,
      y: 34,
      zoom: 2.5,
    });
    expect(restorableGraphViewport(store, 'graph-1', 'sig-b')).toBeNull();
    expect(restorableGraphViewport(store, 'graph-2', 'sig-a')).toBeNull();
  });

  it('ignores incomplete viewports and empty signatures', () => {
    const store = new Map();
    saveGraphViewport(store, 'graph-1', undefined, 'sig-a');
    saveGraphViewport(store, 'graph-1', { x: 0, y: 0, zoom: 1 }, '');
    expect(store.size).toBe(0);
  });

  it('overwrites the saved viewport on a newer user interaction', () => {
    const store = new Map();
    saveGraphViewport(store, 'graph-1', { x: 1, y: 2, zoom: 1 }, 'sig-a');
    saveGraphViewport(store, 'graph-1', { x: 9, y: 8, zoom: 3 }, 'sig-a');
    expect(restorableGraphViewport(store, 'graph-1', 'sig-a')).toMatchObject({
      x: 9,
      y: 8,
      zoom: 3,
    });
  });
});
