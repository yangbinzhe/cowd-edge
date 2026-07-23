import { describe, expect, it } from 'vitest';
import fixture from './fixtures/strategy-projection-v1.json';
import redactionCorpus from './fixtures/strategy-public-redaction-corpus.json';
import { adaptStrategyDecision, resolveAppRuntimeExecutionId } from './strategyDecision';
import type { StrategyDecisionProjection } from '../types';

describe('adaptStrategyDecision', () => {
  it('maps the shared canonical fixture without inferring fields', () => {
    const view = adaptStrategyDecision(fixture as unknown as StrategyDecisionProjection);

    expect(view).not.toBeNull();
    expect(view?.selectedCandidate).toBe('team');
    expect(view?.pattern).toBe('collaborate');
    expect(view?.estimateMode).toBe('calibrated');
    expect(view?.proofMode).toBe('calibrated');
    expect(view?.degraded).toBe(true);
    expect(view?.actualStatus).toBe('observed');
    expect(view?.actual?.duration_ms).toBe(51_000);
    expect(view?.graph.nodes.map((node) => node.type)).toEqual([
      'strategy-decision',
      'evidence-scope',
      'evidence-scope',
      'team',
      'strategy-outcome',
    ]);
    expect(view?.graph.nodes.find((node) => node.type === 'team')?.href).toContain('/mission?');
    expect(view?.graph.nodes.find((node) => node.type === 'evidence-scope')?.href).toContain('/reality?');
    expect(view?.graph.nodes.find((node) => node.type === 'strategy-outcome')?.href).toContain('/runtime?');
    expect(view?.timeline.map((item) => item.revision)).toEqual([null, 2, 3, 4]);
    expect(view?.timeline[0]).toMatchObject({ status: 'selected', order: 0 });
  });

  it('keeps running actuals unknown and marks unproved decisions explicitly', () => {
    const strategy: StrategyDecisionProjection = {
      id: 'strategy-running',
      kind: 'strategy_decision',
      revision: 1,
      status: 'running',
      evidence_refs: [],
      decision_id: 'decision-running',
      execution_id: 'execution-running',
      selected_candidate: 'parallel_tools',
      selected_pattern: 'execute',
      candidate_estimates: [],
      benefit_reason: [],
      cost_reason: [],
      evidence_scopes: [],
      downgrade: [],
      early_stop: [],
      proof_status: 'not_proven',
      actual_status: 'unknown',
    };

    const view = adaptStrategyDecision(strategy);
    expect(view?.running).toBe(true);
    expect(view?.actual).toBeNull();
    expect(view?.actualStatus).toBe('unknown');
    expect(view?.proofMode).toBe('not_proven');
    expect(view?.actualMode).toBe('running');
  });

  it('does not guess a candidate from legacy summary or detail text', () => {
    const legacy = adaptStrategyDecision({
      id: 'legacy',
      kind: 'strategy',
      revision: 3,
      evidence_refs: [],
      summary: 'team collaborate selected',
      detail: { candidate: 'team', pattern: 'collaborate' },
    } as unknown as StrategyDecisionProjection);

    expect(legacy?.legacy).toBe(true);
    expect(legacy?.selectedCandidate).toBe('unknown');
    expect(legacy?.pattern).toBe('unknown');
    expect(legacy?.actualStatus).toBe('unknown');
    expect(legacy?.proofMode).toBe('unknown');
    expect(legacy?.actualMode).toBe('unavailable');
  });

  it('never forwards legacy detail, prompt, reasoning, or path fields to graph inspectors', () => {
    const legacy = adaptStrategyDecision({
      id: 'legacy-sensitive',
      kind: 'strategy',
      revision: 3,
      evidence_refs: ['/home/operator/secret', 'file:///tmp/hidden'],
      summary: 'hidden prompt at /home/operator/secret',
      detail: {
        prompt: 'private provider prompt',
        reasoning: 'hidden chain of thought',
        workspace_path: '/home/operator/project',
      },
    } as unknown as StrategyDecisionProjection);
    const wire = JSON.stringify(legacy?.graph);

    expect(legacy?.graph.nodes[0]?.evidenceRefs).toEqual([]);
    expect(wire).not.toContain('/home/operator');
    expect(wire).not.toContain('private provider prompt');
    expect(wire).not.toContain('hidden chain of thought');
    expect(wire).not.toContain('file:///tmp/hidden');
    expect(wire).toContain('redacted by strategy surface policy');
  });

  it('redacts every absolute or traversal path from legacy text, outcome, and agent evidence', () => {
    const strategy = {
      ...fixture,
      summary: 'legacy /etc/shadow should never become a strategy title',
      evidence_refs: ['/var/lib/private', '../relative-secret', 'evidence-safe'],
      actual: {
        ...(fixture as any).actual,
        terminal_reason: 'file:///srv/secret-output',
      },
      evidence_scopes: [{
        ...(fixture as any).evidence_scopes[0],
        responsibility_summary: 'C:\\secrets\\operator',
        capability_cropped_refs: ['/etc/passwd', '..\\windows-secret', 'evidence-scope-safe'],
      }],
    } as unknown as StrategyDecisionProjection;
    const view = adaptStrategyDecision(strategy, '', [{
      id: 'agent-safe',
      kind: 'agent',
      revision: 1,
      status: 'running',
      summary: '/opt/hidden-agent-summary',
      evidence_refs: ['/etc/agent-secret', '../agent-traversal', 'agent-evidence-safe'],
      detail: { graph_id: 'execution-547' },
    }] as any);
    const wire = JSON.stringify(view?.graph);

    for (const secret of [
      '/etc/shadow',
      '/var/lib/private',
      '../relative-secret',
      'file:///srv/secret-output',
      'C:\\secrets\\operator',
      '/etc/agent-secret',
      '../agent-traversal',
      '/opt/hidden-agent-summary',
    ]) expect(wire).not.toContain(secret);
    expect(view?.graph.nodes.find((node) => node.type === 'strategy-outcome')?.label)
      .toBe('redacted by strategy surface policy');
    expect(view?.graph.nodes.find((node) => node.type === 'agent')?.evidenceRefs)
      .toEqual(['agent-evidence-safe']);
    expect(wire).toContain('evidence-safe');
    expect(wire).toContain('evidence-scope-safe');
  });

  it('fails closed for every shared public-redaction corpus form in graph inspector and export data', () => {
    for (const secret of redactionCorpus) {
      const view = adaptStrategyDecision({
        ...(fixture as unknown as StrategyDecisionProjection),
        summary: `strategy payload ${secret}`,
        selected_pattern: secret,
        source: secret,
        policy_version: secret,
      }, '', [{
        id: `agent-${secret}`,
        kind: secret,
        revision: 1,
        status: 'running',
        summary: secret,
        evidence_refs: [secret],
        detail: { graph_id: 'execution-547' },
      }] as any);
      const wire = JSON.stringify(view?.graph);
      expect(wire).not.toContain(secret);
      expect(wire).toContain('redacted by strategy surface policy');
    }
  });

  it('normalizes untrusted status-like compatibility values before rendering or export', () => {
    const secret = '/etc/strategy-status';
    const view = adaptStrategyDecision({
      ...(fixture as unknown as StrategyDecisionProjection),
      status: secret,
      proof_status: secret,
      actual_status: secret,
      downgrade: [{
        kind: 'runtime.strategy.downgraded',
        revision: 2,
        status: secret,
        summary: 'safe transition summary',
      }],
      early_stop: [],
    } as any, '', [{
      id: 'agent-status-safe',
      kind: 'agent',
      revision: 1,
      status: secret,
      summary: 'safe',
      evidence_refs: [],
      detail: { graph_id: 'execution-547' },
    }] as any);

    const wire = JSON.stringify(view?.graph);
    expect(wire).not.toContain(secret);
    expect(view?.status).toBe('unknown');
    expect(view?.proofMode).toBe('unknown');
    expect(view?.actualStatus).toBe('unknown');
    expect(view?.downgrades[0]?.status).toBe('unknown');
    expect(view?.graph.nodes.find((node) => node.type === 'agent')?.status).toBe('unknown');
  });

  it('uses only explicit MFG Runtime backlinks and never the MFG execution id', () => {
    expect(resolveAppRuntimeExecutionId({
      execution: { execution_id: 'mfg-execution' },
      cross_plane_execution_receipt: { execution_graph_id: 'runtime-graph-1' },
    }, {})).toBe('runtime-graph-1');
    expect(resolveAppRuntimeExecutionId({
      execution: { execution_id: 'mfg-only' },
    }, {})).toBe('');
    expect(resolveAppRuntimeExecutionId({
      skill_run: { runtime_execution_ref: 'runtime-execution://skill-graph-1' },
    }, {})).toBe('skill-graph-1');
  });

  it('links only Agents explicitly bound to the selected Team execution graph', () => {
    const view = adaptStrategyDecision(
      fixture as unknown as StrategyDecisionProjection,
      '',
      [
        {
          id: 'agent-matching',
          kind: 'agent',
          revision: 2,
          status: 'completed',
          evidence_refs: ['agent-evidence'],
          detail: { graph_id: 'execution-547' },
        },
        {
          id: 'agent-other-graph',
          kind: 'agent',
          revision: 2,
          status: 'completed',
          evidence_refs: [],
          detail: { graph_id: 'execution-other' },
        },
      ] as any,
    );

    const agentNodes = view?.graph.nodes.filter((node) => node.type === 'agent') || [];
    expect(agentNodes).toHaveLength(1);
    expect(agentNodes[0]?.label).toBe('agent-matching');
    expect(agentNodes[0]?.href).toContain('/mission?section=agents');
    expect(agentNodes[0]?.href).toContain('agent_id=agent-matching');
  });
});
