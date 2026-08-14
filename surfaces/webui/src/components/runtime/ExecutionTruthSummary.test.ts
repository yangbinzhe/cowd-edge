import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { PROJECTION_V2_GOLDEN } from '../../generated/projection-v2-golden';
import type { ExecutionProjection } from '../../types';
import ExecutionTruthSummary from './ExecutionTruthSummary.vue';

describe('ExecutionTruthSummary', () => {
  it('renders canonical admission, outcome, and evidence payloads', () => {
    const projection = structuredClone(
      PROJECTION_V2_GOLDEN.expected,
    ) as unknown as ExecutionProjection;
    projection.delivery_envelope = {
      envelope_id: 'envelope-1',
      revision: 4,
      objective_id: 'objective-1',
      pipeline_status: 'completed',
      delivery_status: 'partial',
      branch_terminals: [],
      verified_receipts: [],
      verified_artifacts: [],
      verified_effects: [{ effect_id: 'effect-1', kind: 'write', status: 'applied' }],
      coverage: {
        required_obligation_ids: ['read', 'write'],
        satisfied_obligation_ids: ['read'],
        coverage_basis_points: 5_000,
      },
      unresolved: [{ unresolved_id: 'write', kind: 'effect', summary: 'not applied' }],
      conflicts: [],
      user_answer_contract: {
        language: 'en',
        format: 'markdown',
        detail: 'balanced',
        conclusion_only: false,
        evidence_preference: 'when_useful',
        citation_preference: 'when_available',
        structural_constraints: [],
      },
      created_at_ms: 10,
    };
    projection.terminal_presentation = {
      presentation_id: 'presentation-1',
      attempt_id: 'attempt-1',
      envelope_id: 'envelope-1',
      envelope_revision: 4,
      state: 'committed',
      answer_origin: 'terminal_narrator',
      models_attempted: [],
      validation: { status: 'valid', findings: [] },
      generated_at_ms: 11,
      committed_at_ms: 12,
    };
    const wrapper = mount(ExecutionTruthSummary, {
      props: {
        projection,
        connectionState: 'live',
      },
    });

    expect(wrapper.text()).toContain('8 ms');
    expect(wrapper.text()).toContain('12 ms');
    expect(wrapper.text()).toContain('deepseek');
    expect(wrapper.text()).toContain('1');
    expect(wrapper.text()).toContain('50%');
    expect(wrapper.text()).toContain('终态总结模型');
    expect(wrapper.findAll('.execution-truth-evidence article')).toHaveLength(1);
  });
});
