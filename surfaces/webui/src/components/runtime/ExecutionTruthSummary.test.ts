import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { PROJECTION_GOLDEN } from '../../generated/projection-golden';
import type { ExecutionProjection } from '../../types';
import ExecutionTruthSummary from './ExecutionTruthSummary.vue';

describe('ExecutionTruthSummary', () => {
  it('renders canonical truth and isolates collaboration to the current Session', async () => {
    const projection = structuredClone(
      PROJECTION_GOLDEN.expected,
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
      workspace_materializations: [],
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
    projection.agentic_collaboration = { schema_version: 1, programs: [{
      program_id: 'program-1', revision: 7, required_team_count: 1,
      session_id: projection.session_id!, turn_id: projection.turn_id!, root_execution_id: projection.execution_id,
      objective_id: 'objective-1', objective_summary: 'Research with independent review',
      status: 'open', model_lease: 'test', permission_ceiling: 'read-only', resource_scopes: [],
      completion: {}, unresolved: ['independent review required'],
      teams: [{ team_id: 'team-1', name: 'Research', mission: 'Review inputs', created_by: 'root', lifecycle: 'active', member_ids: [], task_ids: [], topic_ref: 'topic-1' }],
      tasks: [], agents: [], memberships: [], artifacts: [], topics: [],
      semantic_refs: { program_ref: 'program-1', objective_ref: 'objective-1', agent_refs: [], artifact_refs: [], task_refs: [], team_refs: [], topic_refs: [] },
    }] };
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
    expect(wrapper.text()).toContain('协同编排');
    expect(wrapper.text()).toContain('program-1');
    expect(wrapper.text()).toContain('independent review required');
    expect(wrapper.text()).toContain('目标是否完成');
    expect(wrapper.findAll('.execution-truth-evidence article')).toHaveLength(1);
    await wrapper.setProps({ projection: { ...projection, session_id: 'another-session' } });
    expect(wrapper.find('.collaboration-program-summary').exists()).toBe(false);
    wrapper.unmount();
  });
});
