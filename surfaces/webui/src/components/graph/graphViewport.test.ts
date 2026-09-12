import { describe, expect, it } from 'vitest';
import { loadGraphPositions, saveGraphPositions, validGraphPosition, restorableGraphViewport, saveGraphViewport } from './graphViewport';

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

describe('personal node positions', () => {
  it('restores only the selected model and validates stored coordinates', () => {
    localStorage.clear();
    saveGraphPositions('scope-a', { task: { x: -30, y: 400 } });
    saveGraphPositions('scope-b', { task: { x: 700, y: 20 } });
    expect(loadGraphPositions('scope-a')).toEqual({ task: { x: -30, y: 400 } });
    expect(loadGraphPositions('scope-c')).toEqual({});
    expect(validGraphPosition({ x: NaN, y: 0 })).toBe(false);
    expect(validGraphPosition({ x: 0, y: Infinity })).toBe(false);
    localStorage.setItem('cowd.graph.positions.v1', JSON.stringify([['bad', { task: { x: '12', y: 0 } }]]));
    expect(loadGraphPositions('bad')).toEqual({});
    localStorage.clear();
  });
});
