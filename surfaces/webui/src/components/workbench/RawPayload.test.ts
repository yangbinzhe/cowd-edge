import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import RawPayload from './RawPayload.vue';

describe('RawPayload', () => {
  it('does not serialize raw JSON until the operator opens the detail view', async () => {
    const toJSON = vi.fn(() => ({ large: 'payload' }));
    const wrapper = mount(RawPayload, {
      props: { data: { toJSON } },
    });

    expect(toJSON).not.toHaveBeenCalled();
    const details = wrapper.get('details');
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger('toggle');
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(wrapper.get('pre').text()).toContain('payload');
  });

  it('supports an explicitly open detail surface without changing the global default', () => {
    const wrapper = mount(RawPayload, {
      props: {
        data: { input: 'query', output: 'result' },
        defaultOpen: true,
      },
    });

    expect(wrapper.get('details').attributes('open')).toBeDefined();
    expect(wrapper.get('pre').text()).toContain('query');
    expect(wrapper.get('pre').text()).toContain('result');
  });
});
