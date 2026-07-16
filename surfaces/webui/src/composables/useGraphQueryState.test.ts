import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { useGraphQueryState } from './useGraphQueryState';

describe('graph URL state', () => {
  it('restores focus, filter, depth, cursor and time range across route navigation', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/graph', component: { template: '<div />' } }],
    });
    await router.push('/graph?focus=node-a&filter=failed&depth=4&cursor=80&from=2026-07-01&to=2026-07-16');
    await router.isReady();
    let state!: ReturnType<typeof useGraphQueryState>;
    const Probe = defineComponent({
      setup() {
        state = useGraphQueryState({ depth: 2 });
        return () => null;
      },
    });
    const wrapper = mount(Probe, { global: { plugins: [router] } });
    expect([state.focus.value, state.filter.value, state.depth.value, state.cursor.value, state.from.value, state.to.value]).toEqual([
      'node-a', 'failed', 4, 80, '2026-07-01', '2026-07-16',
    ]);

    await router.push('/graph?focus=node-b&depth=1');
    await nextTick();
    expect(state.focus.value).toBe('node-b');
    expect(state.filter.value).toBe('');
    state.filter.value = 'running';
    state.cursor.value = 160;
    await state.sync({ section: 'runtime' });
    expect(router.currentRoute.value.query).toMatchObject({ focus: 'node-b', filter: 'running', cursor: '160', section: 'runtime' });
    wrapper.unmount();
  });
});
