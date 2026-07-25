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
    Object.defineProperty(details.element, 'open', {
      configurable: true,
      value: true,
    });
    await details.trigger('toggle');
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(wrapper.get('pre').text()).toContain('payload');
  });
});
