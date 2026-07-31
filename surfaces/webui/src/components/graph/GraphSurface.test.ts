import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import GraphSurface from './GraphSurface.vue';

const VueFlowStub = defineComponent({
  props: {
    nodes: { type: Array, default: () => [] },
  },
  template: `
    <div data-test="flow">
      <div v-for="node in nodes" :key="node.id">
        <slot name="node-default" :data="node.data" />
      </div>
      <slot />
    </div>
  `,
});

describe('GraphSurface', () => {
  it('keeps icon controls visible and gives every node a short localized description', async () => {
    const wrapper = mount(GraphSurface, {
      props: {
        model: {
          id: 'execution-graph',
          title: 'WAIC research',
          nodes: [{
            id: 'search',
            type: 'tool_batch',
            label: 'WebSearch',
            status: 'completed',
          }],
          edges: [],
        },
        delegateFullscreen: true,
      },
      global: {
        stubs: {
          VueFlow: VueFlowStub,
          Panel: { template: '<div><slot /></div>' },
          RouterLink: { template: '<a><slot /></a>' },
        },
      },
    });

    // ELK layout is asynchronous and may take longer when the full WebUI suite
    // runs in parallel. Wait for the actual node projection instead of relying
    // on a scheduler-sensitive fixed delay.
    await vi.waitFor(() => {
      expect(wrapper.find('.graph-node-content strong').exists()).toBe(true);
    });
    expect(wrapper.get('.graph-node-content strong').text()).toBe('WebSearch');
    expect(wrapper.get('.graph-node-content small').text()).toBe('工具调用');
    expect(wrapper.findAll('.graph-toolbar .graph-icon-action').length).toBe(4);
    expect(wrapper.findAll('[aria-label="从上到下"]')).toHaveLength(1);
    await wrapper.get('[aria-label="从上到下"]').trigger('click');
    expect(wrapper.findAll('[aria-label="从左到右"]')).toHaveLength(1);

    await wrapper.get('[aria-label="全屏"]').trigger('click');
    expect(wrapper.emitted('toggleFullscreen')).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps the shared icon toolbar available in compact graph surfaces', async () => {
    const wrapper = mount(GraphSurface, {
      props: {
        compact: true,
        delegateFullscreen: true,
        model: {
          id: 'compact-execution-graph',
          nodes: [{ id: 'node-1', type: 'execution', label: 'Run', status: 'running' }],
          edges: [],
        },
      },
      global: {
        stubs: {
          VueFlow: VueFlowStub,
          Panel: { template: '<div><slot /></div>' },
          RouterLink: { template: '<a><slot /></a>' },
        },
      },
    });

    expect(wrapper.find('.graph-surface-header').exists()).toBe(false);
    expect(wrapper.findAll('.graph-toolbar .graph-icon-action').length).toBe(5);
    expect(wrapper.find('.graph-icon-select').exists()).toBe(true);
    await wrapper.get('[aria-label="全屏"]').trigger('click');
    expect(wrapper.emitted('toggleFullscreen')).toHaveLength(1);
    wrapper.unmount();
  });
});
