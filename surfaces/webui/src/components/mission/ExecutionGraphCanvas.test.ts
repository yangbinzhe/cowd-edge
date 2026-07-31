import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExecutionGraphCanvas from './ExecutionGraphCanvas.vue';

const GraphSurfaceStub = defineComponent({
  props: {
    fullscreen: Boolean,
  },
  emits: ['toggleFullscreen', 'selectNode'],
  template: `
    <div>
      <button data-test="fullscreen" :data-fullscreen="fullscreen" @click="$emit('toggleFullscreen')">toggle</button>
      <button data-test="node" @click="$emit('selectNode', { raw: { node_id: 'node-1', kind: 'inline_model', status: 'completed' } })">node</button>
    </div>
  `,
});

describe('ExecutionGraphCanvas', () => {
  const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
  const originalExitFullscreen = document.exitFullscreen;
  const originalFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: originalRequestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: originalExitFullscreen,
    });
    if (originalFullscreenDescriptor) {
      Object.defineProperty(document, 'fullscreenElement', originalFullscreenDescriptor);
    }
  });

  it('enters and exits fullscreen for the complete graph and detail canvas', async () => {
    let fullscreenElement: Element | null = null;
    const requestFullscreen = vi.fn(async function request(this: Element) {
      fullscreenElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });

    const wrapper = mount(ExecutionGraphCanvas, {
      props: {
        graph: {
          graph_id: 'graph-1',
          nodes: [{ node_id: 'node-1', kind: 'inline_model', status: 'completed' }],
          edges: [],
        },
      },
      global: {
        stubs: {
          GraphSurface: GraphSurfaceStub,
          ExecutionNodeDetail: true,
        },
      },
    });

    await wrapper.get('[data-test="fullscreen"]').trigger('click');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-test="fullscreen"]').attributes('data-fullscreen')).toBe('true');

    await wrapper.get('[data-test="fullscreen"]').trigger('click');
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-test="fullscreen"]').attributes('data-fullscreen')).toBe('false');
    wrapper.unmount();
  });

  it('delegates compact graph expansion to the owning chat surface', async () => {
    const wrapper = mount(ExecutionGraphCanvas, {
      props: {
        compact: true,
        graph: {
          graph_id: 'compact-graph',
          nodes: [{ node_id: 'node-1', kind: 'inline_model', status: 'running' }],
          edges: [],
        },
      },
      global: {
        stubs: {
          GraphSurface: GraphSurfaceStub,
          ExecutionNodeDetail: true,
        },
      },
    });

    await wrapper.get('[data-test="fullscreen"]').trigger('click');
    expect(wrapper.emitted('expand')).toHaveLength(1);
    wrapper.unmount();
  });

  it('opens node details only on selection and lets the operator collapse them', async () => {
    const wrapper = mount(ExecutionGraphCanvas, {
      props: {
        graph: {
          graph_id: 'graph-details',
          objective: 'Inspect a turn',
          nodes: [{ node_id: 'node-1', kind: 'inline_model', status: 'completed' }],
          edges: [],
        },
      },
      global: {
        stubs: {
          GraphSurface: GraphSurfaceStub,
        },
      },
    });

    expect(wrapper.find('.execution-node-detail').exists()).toBe(false);
    await wrapper.get('[data-test="node"]').trigger('click');
    expect(wrapper.find('.execution-node-detail').exists()).toBe(true);

    await wrapper.get('[data-test="node"]').trigger('click');
    expect(wrapper.find('.execution-node-detail').exists()).toBe(false);

    await wrapper.get('[data-test="node"]').trigger('click');
    await wrapper.get('.execution-node-actions button:last-child').trigger('click');
    expect(wrapper.find('.execution-node-detail').exists()).toBe(false);
  });
});
