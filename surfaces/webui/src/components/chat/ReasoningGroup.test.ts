import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReasoningGroup from './ReasoningGroup.vue';

describe('ReasoningGroup', () => {
  const group = {
    scope: 'agent' as const,
    ownerActivityId: 'agent:researcher',
    items: [
      {
        id: 'reasoning:1',
        text: '先确认问题边界。',
        status: 'completed',
        sequence: 1,
      },
      {
        id: 'reasoning:2',
        text: '读取代码证据并核对实际调用链。',
        status: 'running',
        sequence: 2,
      },
    ],
    latest: {
      id: 'reasoning:2',
      text: '读取代码证据并核对实际调用链。',
      status: 'running',
      sequence: 2,
    },
    running: true,
    count: 2,
  };

  it('shows one latest line by default and expands segments in place', async () => {
    const wrapper = mount(ReasoningGroup, {
      props: { group, variant: 'agent' },
    });

    expect(wrapper.text()).toContain('思考（2）');
    expect(wrapper.text()).toContain('读取代码证据并核对实际调用链。');
    expect(wrapper.find('.reasoning-segments').exists()).toBe(false);

    await wrapper.get('.reasoning-group-summary').trigger('click');
    expect(wrapper.findAll('.reasoning-segments li')).toHaveLength(2);

    const segment = wrapper.findAll('.reasoning-segments button')[0];
    expect(segment.classes()).not.toContain('expanded');
    await segment.trigger('click');
    expect(segment.classes()).toContain('expanded');
  });
});
