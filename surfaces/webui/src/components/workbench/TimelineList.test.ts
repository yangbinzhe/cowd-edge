import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TimelineList from './TimelineList.vue';

describe('TimelineList', () => {
  it('summarizes structured payloads instead of rendering raw JSON', () => {
    const wrapper = mount(TimelineList, {
      props: {
        filterable: false,
        items: [{
          id: 'tool-1',
          title: 'read_file',
          status: 'complete',
          detail: JSON.stringify({
            type: 'text',
            truncated: true,
            guidance: 'bounded output',
            file: { path: 'README.md' },
          }),
        }],
      },
    });

    expect(wrapper.text()).toContain('4');
    expect(wrapper.text()).not.toContain('bounded output');
    expect(wrapper.text()).not.toContain('"truncated"');
  });

  it('keeps long prose collapsed by default', () => {
    const wrapper = mount(TimelineList, {
      props: {
        filterable: false,
        items: [{
          id: 'event-1',
          title: 'analysis',
          status: 'running',
          detail: 'x'.repeat(180),
        }],
      },
    });

    expect(wrapper.find('details').exists()).toBe(true);
    expect(wrapper.find('details').attributes('open')).toBeUndefined();
    expect(wrapper.find('summary').text()).toHaveLength(120);
  });

  it('renders canonical agent instance IDs as readable lane labels', () => {
    const wrapper = mount(TimelineList, {
      props: {
        filterable: false,
        items: [{
          id: 'agent-1',
          kind: 'agent',
          title: 'Research Agent',
          status: 'completed',
          agent_lane_label: 'researcher-1',
          agent_lane: 0,
          agent_lane_count: 3,
        }],
      },
    });

    expect(wrapper.text()).toContain('researcher 1');
    expect(wrapper.text()).not.toContain('researcher-1');
  });
});
