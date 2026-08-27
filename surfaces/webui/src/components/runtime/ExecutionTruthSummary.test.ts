import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { PROJECTION_V3_GOLDEN } from '../../generated/projection-v3-golden';
import type { ExecutionProjection } from '../../types';
import ExecutionTruthSummary from './ExecutionTruthSummary.vue';

describe('ExecutionTruthSummary', () => {
  it('renders canonical admission, outcome, and evidence payloads', () => {
    const projection = structuredClone(
      PROJECTION_V3_GOLDEN.expected,
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
    projection.graph.orchestration = {
      mutation_id: 'mutation-1',
      semantic_revision: 4,
      source_generation: 2,
      applied_mutation_ids: ['mutation-1', 'escalation-mutation-2'],
      collaboration_escalations: [{
        escalation_id: 'escalation-1',
        source_attempt: 'team-1:attempt:2',
        base_program_revision: 6,
        request_kind: 'add_team',
        reason: 'independent review required',
        evidence_refs: [],
        applied_graph_revision: 9,
      }],
      completion: {
        acceptance_contract_id: 'acceptance-1',
        required_evidence_refs: [],
        required_obligation_ids: [],
      },
      collaboration_program: {
        program_id: 'program-1',
        revision: 7,
        required_team_count: 1,
        semantic_node_instances: { research: ['team-1'] },
        team_instances: [{ instance_id: 'team-1', semantic_node_id: 'research', required: true }],
        control: {
          lifecycle: 'awaiting_resource',
          obligations: [{
            instance_id: 'team-1',
            binding_ref: 'binding-1',
            state: 'awaiting_resource',
            reason_kind: 'resource',
            revision: 7,
          }],
          resource_ledger: {
            context_reservation_tokens: 1_000,
            output_reservation_tokens: 500,
            parallel_demand: 2,
            deadline_at_ms: 123,
            confidence_basis_points: 9_500,
            revision: 7,
          },
          waiting_relation: 'resource-pool-1',
          blocker_ref: 'resource-admission-1',
          next_action: 'await_resource',
        },
        edges: [{
          edge_id: 'edge-1',
          from: 'team-1',
          to: 'team-2',
          kind: 'handoff',
          state: 'claimed',
          input_contract: {
            required_artifact_kinds: [],
            required_fact_kinds: [],
            require_committed_effect: false,
            require_satisfied_acceptance: false,
          },
          delivery_receipt: {
            receipt_ref: 'delivery-1',
            producer_node_id: 'node-1',
            producer_attempt: 1,
            producer_result_ref: 'result-1',
            evidence_refs: [],
          },
          claim_receipt: {
            claim_ref: 'claim-1',
            consumer_node_id: 'node-2',
            consumer_attempt: 1,
          },
        }],
      },
    } as any;
    projection.graph.nodes[0] = {
      ...projection.graph.nodes[0],
      node_id: 'team-1',
      work: {
        role: 'evidence_analyze',
        required: true,
        dependency: 'all',
        expected_input_tokens: 0,
        expected_output_tokens: 0,
        expected_duration_ms: 0,
        scheduling_priority: 200,
      },
    } as any;
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
    expect(wrapper.text()).toContain('等待资源');
    expect(wrapper.text()).toContain('delivery-1');
    expect(wrapper.text()).toContain('claim-1');
    expect(wrapper.text()).toContain('已应用升级');
    expect(wrapper.text()).toContain('escalation-1');
    expect(wrapper.text()).toContain('200');
    expect(wrapper.findAll('.execution-truth-evidence article')).toHaveLength(1);
  });
});
