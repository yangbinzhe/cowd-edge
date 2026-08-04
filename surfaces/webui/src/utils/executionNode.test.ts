import { describe, expect, it } from 'vitest';
import { activeExecutionNode, executionNodeDetail } from './executionNode';

describe('execution node inspection', () => {
  it('follows the currently running node before queued or completed nodes', () => {
    const nodes = [
      { node_id: 'done', status: 'completed' },
      { node_id: 'queued', status: 'ready' },
      { node_id: 'active', status: 'running' },
    ];
    expect(activeExecutionNode(nodes)?.node_id).toBe('active');
  });

  it('joins authorized activity payloads to safe graph metadata', () => {
    const detail = executionNodeDetail({
      node_id: 'research',
      kind: 'tool_batch',
      status: 'running',
      executor_kind: 'WebSearch',
      payload_ref: 'payload://research',
      acceptance: { criteria: ['current sources'], required_evidence: ['web'] },
      summary: 'sources collected',
      result_ref: 'result://research',
    }, 'Investigate current evidence', [{
      id: 'call-1',
      kind: 'tool',
      title: 'WebSearch',
      refs: ['research'],
      input: { query: 'distributed runtime standard' },
      output: { sources: 4 },
    }]);

    expect(detail).toMatchObject({
      id: 'research',
      description: 'Investigate current evidence',
      input: { query: 'distributed runtime standard' },
      output: { sources: 4 },
    });
  });

  it('falls back to durable references and semantic output when raw activity is unavailable', () => {
    const detail = executionNodeDetail({
      node_id: 'verify',
      kind: 'verify',
      status: 'completed',
      executor_kind: 'reviewer',
      payload_ref: 'payload://verify',
      resource_scopes: ['workspace:read'],
      summary: 'verification passed',
      result_ref: 'result://verify',
    }, 'Verify changes', []);

    expect(detail?.input).toMatchObject({
      payload_ref: 'payload://verify',
      resource_scopes: ['workspace:read'],
    });
    expect(detail?.output).toMatchObject({
      summary: 'verification passed',
      result_ref: 'result://verify',
    });
  });
});
