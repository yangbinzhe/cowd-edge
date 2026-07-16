import { describe, expect, it } from 'vitest';
import { graphDiagnostics } from '../../components/graph/graphRuntime';
import { adaptCrossPlaneGraph } from './crossPlane';
import { adaptEvolutionGraph } from './evolution';
import { adaptHarnessEvalGraph } from './harnessEval';
import { adaptSurfaceTopology } from './surfaceTopology';
import { adaptToolOperationsGraph } from './toolOperations';

function expectComplete(model: ReturnType<typeof adaptEvolutionGraph>) {
  expect(model.nodes.length).toBeGreaterThan(0);
  expect(graphDiagnostics(model.nodes, model.edges)).toEqual({ duplicateNodeIds: [], duplicateEdgeIds: [], danglingEdgeIds: [] });
  expect(model.nodes.every((node) => Boolean(node.href))).toBe(true);
}

describe('public runtime graph adapters', () => {
  it('maps Evolution signal through governed review and report evidence', () => {
    const model = adaptEvolutionGraph({
      signals: [{ signal_id: 'signal-1', signal_type: 'regression', evidence_refs: ['ev-signal'] }],
      diagnoses: [{ diagnosis_id: 'diagnosis-1', source_signal_ids: ['signal-1'], evidence_refs: ['ev-diagnosis'] }],
      missions: [{ mission_id: 'mission-1', diagnosis_id: 'diagnosis-1', proposal_ids: ['proposal-1'], candidate_ids: ['candidate-1'] }],
      proposals: [{ proposal_id: 'proposal-1', diagnosis_id: 'diagnosis-1', source_signal_ids: ['signal-1'] }],
      candidates: [{ candidate_id: 'candidate-1', proposal_id: 'proposal-1', comparison_report_ref: 'comparison-1' }],
      reviews: [{ review_id: 'review-1', candidate_id: 'candidate-1', action: 'approve', evidence_refs: ['ev-review'] }],
    });
    expectComplete(model);
    expect(model.nodes.find((node) => node.id === 'signal-1')?.evidenceRefs).toEqual(['ev-signal']);
    expect(model.edges.some((edge) => edge.type === 'evidence_for')).toBe(true);
  });

  it('maps Cross-plane principal, identity, grant, capability, execution and audit stages', () => {
    const model = adaptCrossPlaneGraph({
      identities: [{ id: 'identity-1', principal_id: 'principal-1', identity_ref: 'user:1' }],
      grants: [{ id: 'grant-1', principal_id: 'principal-1', capability: 'service.read', resource_ref: 'service://docs', evidence_refs: ['ev-grant'] }],
      executions: [{ execution_id: 'cross-1', actor_principal: 'principal-1', requested_capability: 'service.read', status: 'complete' }],
      action: { request_id: 'request-1', preflight: { status: 'ready' }, policy: { status: 'allowed' }, execution: { execution_id: 'cross-1', status: 'complete' }, audit: { audit_ref: 'audit-1' } },
    });
    expectComplete(model);
    expect(model.nodes.find((node) => node.id === 'grant:grant-1')?.evidenceRefs).toEqual(['ev-grant']);
    expect(model.edges.map((edge) => edge.type)).toContain('permits');
  });

  it('maps Tool plan, calls, mutations and checkpoints with governed correlation', () => {
    const model = adaptToolOperationsGraph({
      request_id: 'operation-1',
      status: 'planned',
      data: { request_id: 'operation-1', tool_calls: [{ id: 'call-1', name: 'workspace.read', evidence_refs: ['ev-call'] }], files: [{ path: 'README.md', expected_hash: 'sha256:a' }] },
    }, [{ checkpoint_id: 'checkpoint-1', request_id: 'operation-1' }], []);
    expectComplete(model);
    expect(model.nodes.find((node) => node.type === 'tool-call')?.evidenceRefs).toEqual(['ev-call']);
    expect(model.edges.map((edge) => edge.type)).toContain('mutates');
  });

  it('maps Surface delivery, retry, replay and dead-letter facts in addition to static topology', () => {
    const model = adaptSurfaceTopology({
      selectedSurface: 'webui',
      surfaces: [{ id: 'webui', status: 'ready' }],
      connectors: [{ id: 'connector-1', surface_id: 'webui' }],
      endpoints: [{ endpoint_id: 'endpoint-1', connector: 'connector-1' }],
      routes: [{ route_id: 'route-1', connector: 'connector-1', surface_id: 'webui' }],
      bindings: [{ binding_id: 'binding-1', connector: 'connector-1', endpoint: 'endpoint-1' }],
      inbox: [{ message_id: 'message-1', status: 'admitted', session_id: 'session-1' }],
      outbox: [{ delivery_id: 'delivery-1', message_id: 'message-1', status: 'retry_scheduled', attempts: 2 }],
      deliveries: [{ delivery_id: 'delivery-1', kind: 'retry', status: 'failed' }],
      triggerEvents: [{ idempotency_key: 'trigger-1', message_id: 'message-1', status: 'retry_scheduled' }],
      deadLetters: [{ delivery_id: 'delivery-1', reason: 'exhausted' }],
    });
    expectComplete(model);
    expect(model.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(['inbox', 'outbox', 'delivery', 'trigger-event', 'dead-letter']));
    expect(model.edges.map((edge) => edge.type)).toEqual(expect.arrayContaining(['replies_via', 'retry', 'retry_scheduled', 'dead_letters']));
  });

  it('maps Harness scenario through run, report, gates, runtime rounds, artifacts and score results', () => {
    const model = adaptHarnessEvalGraph({
      scenarios: [{ id: 'scenario-1', kind: 'recovery', required_evidence: ['ev-scenario'] }],
      runs: [{ run_id: 'run-1', scenario_ids: ['scenario-1'], report_id: 'report-1', status: 'complete' }],
      reports: [{ report_id: 'report-1', status: 'passed' }],
      detail: { report: {
        report_id: 'report-1', status: 'passed',
        report_gate: { items: [{ name: 'business-goals', status: 'passed', required_evidence: ['ev-gate'] }] },
        execution_trace: { rounds: [{ round_index: 0, name: 'deterministic-provider', status: 'complete', detail_path: 'round-0' }] },
        scenarios: [{ scenario_id: 'scenario-1', status: 'passed', evidence_refs: ['ev-result'] }],
      }, artifacts: [{ path: 'reports/report-1.json' }] },
    });
    expectComplete(model);
    expect(model.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(['eval-scenario', 'eval-run', 'eval-report', 'eval-gate', 'eval-runtime-round', 'eval-evidence', 'eval-scenario-result']));
    expect(model.edges.map((edge) => edge.type)).toEqual(expect.arrayContaining(['executes', 'produces', 'gates', 'traces', 'evidence', 'evaluates']));
  });
});
