import { describe, expect, it } from 'vitest';
import { runGraphLayout } from './graphLayout';

describe('graph layout fallback', () => {
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
