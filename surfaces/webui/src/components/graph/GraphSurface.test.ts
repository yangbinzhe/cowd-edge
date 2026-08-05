import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GraphSurface from './GraphSurface.vue';

const { runGraphLayout } = vi.hoisted(() => ({
  runGraphLayout: vi.fn(async (graph: any) => ({
    ...graph,
    children: graph.children.map((node: any, index: number) => ({
      ...node,
      x: index * 240,
      y: 0,
    })),
  })),
}));

vi.mock('./graphLayout', () => ({ runGraphLayout }));

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
  beforeEach(() => {
    runGraphLayout.mockClear();
  });

  it('keeps icon controls visible and gives every node a short localized description', async () => {
    const wrapper = mount(GraphSurface, {
      props: {
        model: {
          id: 'execution-graph',
          title: 'Technical research',
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
    expect(wrapper.findAll('.graph-toolbar .graph-icon-action').length).toBe(5);
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

    expect(wrapper.find('.graph-surface-header').exists()).toBe(true);
    expect(wrapper.findAll('.graph-toolbar .graph-icon-action').length).toBe(5);
    expect(wrapper.find('.graph-icon-select').exists()).toBe(true);
    await wrapper.get('[aria-label="全屏"]').trigger('click');
    expect(wrapper.emitted('toggleFullscreen')).toHaveLength(1);
    wrapper.unmount();
  });

  it('updates live node status without re-running the topology layout', async () => {
    const wrapper = mount(GraphSurface, {
      props: {
        model: {
          id: 'stable-live-graph',
          revision: 1,
          nodes: [{
            id: 'agent',
            type: 'agent_task',
            label: 'Research',
            status: 'running',
          }],
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

    await vi.waitFor(() => expect(runGraphLayout).toHaveBeenCalledTimes(1));
    await wrapper.setProps({
      model: {
        id: 'stable-live-graph',
        revision: 2,
        nodes: [{
          id: 'agent',
          type: 'agent_task',
          label: 'Research',
          status: 'completed',
        }],
        edges: [],
      },
    });
    await vi.waitFor(() => {
      expect(wrapper.get('.graph-node-status').text()).toBe('完成');
    });
    await new Promise((resolve) => window.setTimeout(resolve, 120));

    expect(runGraphLayout).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
