import { describe, expect, it } from 'vitest';
import { graphDiagnostics } from '../../components/graph/graphRuntime';
import { adaptMfgDecisionTrace } from './mfgDecisionTrace';

describe('MFG decision trace graph adapter', () => {
  it('preserves source through report order, endpoint correlation, evidence stage and terminal delivery state', () => {
    const model = adaptMfgDecisionTrace({
      status: 'ready',
      refs: { incident_id: 'incident-1', report_id: 'report-1' },
      rows: [
        { stage: 'source', ref: 'source-pack://erp', domain: 'Matrix', signal: 'validated', next: 'ingest', endpoint: '/api/matrix/source-packs/:id' },
        { stage: 'evidence', ref: 'evidence-1', domain: 'Evidence', signal: 'quality pass', next: 'incident', endpoint: '/api/matrix/evidence/:id' },
        { stage: 'action', ref: 'execution-1', domain: 'MFG', signal: 'feedback_resolved', next: 'report', endpoint: '/api/apps/mfg/executions/:id' },
        { stage: 'report', ref: 'report-1', domain: 'Cockpit', signal: 'sent', next: 'complete', endpoint: '/api/apps/mfg/cockpit/reports/:id/delivery-state' },
      ],
    });

    expect(model.id).toBe('incident-1');
    expect(model.nodes.map((node) => node.type)).toEqual(['source', 'evidence', 'action', 'report']);
    expect(model.nodes[1].correlationRefs).toContain('/api/matrix/evidence/:id');
    expect(model.nodes[3]).toMatchObject({ status: 'ready' });
    expect(model.edges.map((edge) => edge.label)).toEqual(['ingest', 'incident', 'report']);
    expect(graphDiagnostics(model.nodes, model.edges).danglingEdgeIds).toEqual([]);
  });
});
