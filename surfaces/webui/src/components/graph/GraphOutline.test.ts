import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GraphOutline from './GraphOutline.vue';

describe('virtual graph outline', () => {
  it.each([100, 1000, 10000])('keeps DOM bounded and selects the last of %i nodes by keyboard', async count => {
    const nodes = Array.from({ length: count }, (_, i) => ({ id: `${i}`, type: 'task', label: `Task ${i}`, status: 'running' }));
    const wrapper = mount(GraphOutline, { attachTo: document.body, props: {
      nodes, parents: new Map(), children: new Map(), depths: new Map(), collapsed: new Set<string>(), selectedId: '', filtering: false,
    } });
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(30);
    await wrapper.get('[data-row-index="0"]').trigger('keydown', { key: 'End' });
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(30);
    const last = wrapper.get(`[data-row-index="${count - 1}"]`);
    expect(document.activeElement).toBe(last.element);
    await last.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('select')?.[0]).toEqual([nodes[count - 1]]);
    await last.trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(wrapper.get('[data-row-index="0"]').element);
    wrapper.unmount();
  });
  it('uses hierarchy keyboard semantics and prevents folding temporary search paths', async () => {
    const wrapper = mount(GraphOutline, { props: {
      nodes: [{ id: 'root', type: 'goal', label: 'Goal', status: 'running' }],
      parents: new Map(), children: new Map([['root', ['child']]]), depths: new Map(), collapsed: new Set(['root']), selectedId: '', filtering: false,
    } });
    await wrapper.get('[role="treeitem"]').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('toggle')).toEqual([['root']]);
    await wrapper.setProps({ filtering: true });
    await wrapper.get('[role="treeitem"]').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('toggle')).toHaveLength(1);
    wrapper.unmount();
  });
});
