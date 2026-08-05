import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ExecutionNodeDetail from './ExecutionNodeDetail.vue';

describe('ExecutionNodeDetail', () => {
  it('keeps input and output concise until the operator opens one structured detail', async () => {
    const wrapper = mount(ExecutionNodeDetail, {
      props: {
        node: {
          node_id: 'node-search',
          kind: 'tool_batch',
          executor_kind: 'WebSearch',
          status: 'completed',
          summary: 'Found current sources',
        },
        objective: 'Research current evidence',
        activityEvents: [{
          id: 'tool-call',
          kind: 'tool',
          title: 'WebSearch',
          refs: ['node-search'],
          input: { query: 'distributed runtime standard', status: 'running' },
          output: { summary: 'Four sources', status: 'completed' },
        }],
      },
    });

    expect(wrapper.find('.execution-node-payload').exists()).toBe(false);
    const actions = wrapper.findAll('.execution-node-actions button');
    expect(actions).toHaveLength(3);

    await actions[0]!.trigger('click');
    expect(wrapper.find('.execution-node-payload').exists()).toBe(true);
    expect(wrapper.find('.structured-object').text()).toContain('distributed runtime standard');
    expect(wrapper.find('.structured-object').text()).not.toContain('"query"');
    expect(wrapper.get('.raw-payload').attributes('open')).toBeUndefined();

    await actions[1]!.trigger('click');
    expect(wrapper.find('.structured-object').text()).toContain('Four sources');
    expect(actions[0]!.attributes('aria-pressed')).toBe('false');
    expect(actions[1]!.attributes('aria-pressed')).toBe('true');
  });

  it('emits close from the fixed icon action', async () => {
    const wrapper = mount(ExecutionNodeDetail, {
      props: {
        node: {
          node_id: 'node-close',
          kind: 'inline_model',
          status: 'completed',
        },
      },
    });

    await wrapper.get('.execution-node-actions button:last-child').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('renders a semantic ToolGroup schedule without expanding every tool into graph nodes', () => {
    const wrapper = mount(ExecutionNodeDetail, {
      props: {
        node: {
          node_id: 'tool-group',
          semantic_view: true,
          kind: 'tool_batch',
          executor_kind: 'tool',
          status: 'completed',
          summary: 'Tool call · 2',
          output: {
            tool_execution: {
              call_count: 2,
              batch_count: 1,
              max_parallel_width: 2,
              batches: [{ node_id: 'batch-1', status: 'completed' }],
              calls: [{
                id: 'call-1',
                name: 'glob_search',
                status: 'completed',
                batch_node_id: 'batch-1',
                depends_on: [],
              }, {
                id: 'call-2',
                name: 'read_file',
                status: 'completed',
                batch_node_id: 'batch-1',
                depends_on: [],
              }],
            },
          },
        },
      },
    });

    expect(wrapper.get('.execution-node-tool-schedule').text()).toContain('2');
    expect(wrapper.get('.execution-node-tool-schedule').text()).toContain('glob_search');
    expect(wrapper.get('.execution-node-tool-schedule').text()).toContain('read_file');
  });
});
