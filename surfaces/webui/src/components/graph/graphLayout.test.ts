import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGraphLayout } from './graphLayout';

describe('graph layout fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lays out deep chains and cycles without recursion or dropping nodes', async () => {
    const children = Array.from({ length: 20_000 }, (_, index) => ({ id: `n${index}` }));
    const edges = children.slice(1).map((node, index) => ({ sources: [`n${index}`], targets: [node.id] }));
    const graph = await runGraphLayout({ children, edges });
    expect(graph.children).toHaveLength(20_000);
    expect(graph.children[19_999].x).toBe(19_999 * 278);
    const cycle = await runGraphLayout({
      children: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [
        { sources: ['a'], targets: ['b'] }, { sources: ['b'], targets: ['a'] },
        { sources: ['b'], targets: ['c'] },
      ],
    });
    expect(new Set(cycle.children.map((node: any) => `${node.x}:${node.y}`)).size).toBe(3);
  });

  it('recovers all pending layouts from a hung worker and creates a fresh worker', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const instances: any[] = [];
    vi.stubGlobal('Worker', class {
      onmessage: any;
      onerror: any;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() { instances.push(this); }
    });
    const { runGraphLayout: layout } = await import('./graphLayout');
    const first = layout({ children: [{ id: 'one' }] });
    const second = layout({ children: [{ id: 'two' }] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await first).children[0].id).toBe('one');
    expect((await second).children[0].id).toBe('two');
    expect(instances[0].terminate).toHaveBeenCalledOnce();
    const third = layout({ children: [{ id: 'three' }] });
    expect(instances).toHaveLength(2);
    const request = instances[1].postMessage.mock.calls[0][0];
    instances[1].onmessage({ data: { id: request.id, result: { children: [{ id: 'three', x: 42 }] } } });
    expect((await third).children[0].x).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['construct', 'send', 'runtime'])('falls back on worker %s failure', async (failure) => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('Worker', class {
      onmessage: any;
      onerror: any;
      terminate = vi.fn();
      constructor() { if (failure === 'construct') throw new Error('blocked'); }
      postMessage() {
        if (failure === 'send') throw new Error('clone failed');
        this.onerror({ message: 'worker failed' });
      }
    });
    const { runGraphLayout: layout } = await import('./graphLayout');
    const result = await layout({ children: [{ id: 'retained' }] });
    expect(result.children[0]).toMatchObject({ id: 'retained', x: 0, y: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps dependency waves readable when a Worker is unavailable', async () => {
    const result = await runGraphLayout({
      id: 'fallback',
      layoutOptions: { 'elk.direction': 'RIGHT' },
      children: [{ id: 'a' }, { id: 'b' }, { id: 'merge' }],
      edges: [
        { sources: ['a'], targets: ['merge'] },
        { sources: ['b'], targets: ['merge'] },
      ],
    });

    expect(result.children[0]).toMatchObject({ id: 'a', x: 0, y: 0 });
    expect(result.children[1]).toMatchObject({ id: 'b', x: 0, y: 118 });
    expect(result.children[2]).toMatchObject({ id: 'merge', x: 278, y: 0 });
  });
});
