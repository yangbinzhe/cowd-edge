import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { PROJECTION_V2_GOLDEN } from '../../generated/projection-v2-golden';
import type { ExecutionProjection } from '../../types';
import ExecutionTruthSummary from './ExecutionTruthSummary.vue';

describe('ExecutionTruthSummary', () => {
  it('renders canonical admission, outcome, and evidence payloads', () => {
    const wrapper = mount(ExecutionTruthSummary, {
      props: {
        projection: structuredClone(
          PROJECTION_V2_GOLDEN.expected,
        ) as unknown as ExecutionProjection,
        connectionState: 'live',
      },
    });

    expect(wrapper.text()).toContain('8 ms');
    expect(wrapper.text()).toContain('12 ms');
    expect(wrapper.text()).toContain('deepseek');
    expect(wrapper.text()).toContain('1');
    expect(wrapper.findAll('.execution-truth-evidence article')).toHaveLength(1);
  });
});
