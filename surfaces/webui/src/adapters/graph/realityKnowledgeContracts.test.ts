import { describe, expect, it } from 'vitest';
import { graphDiagnostics } from '../../components/graph/graphRuntime';
import { adaptContextFanout } from './contextFanout';
import { adaptEntityImpact } from './entityImpact';
import { adaptKnowledgeGraph } from './knowledge';
import { adaptMetricLineage } from './metricLineage';
import { adaptRealityFlow } from './realityFlow';

describe('Context, Memory, Reality, and Matrix graph contracts', () => {
  it('keeps selected and omitted context with omission reasons and evidence', () => {
    const model = adaptContextFanout({
      envelope_id: 'ctx-1',
      selected: [{ id: 'selected', source: 'memory', text: 'selected fact', evidence_refs: ['ev-selected'] }],
      omitted: [{ id: 'omitted', source: 'matrix', reason: 'token budget', evidence_refs: ['ev-omitted'] }],
    });
    expect(model.nodes.find((node) => node.group === 'selected')?.evidenceRefs).toEqual(['ev-selected']);
    expect(model.nodes.find((node) => node.group === 'omitted')).toMatchObject({ status: 'omitted', summary: 'token budget' });
    expect(graphDiagnostics(model.nodes, model.edges).danglingEdgeIds).toEqual([]);
  });

  it('preserves Memory cycles, version refs and evidence rather than flattening relations', () => {
    const model = adaptKnowledgeGraph({ entities: [
      { entity_id: 'a', display_name: 'A', evidence_refs: ['ev-a'], version_id: 'v1' },
      { entity_id: 'b', display_name: 'B' },
    ] }, { triples: [
      { relation_id: 'a-b', subject_id: 'a', object_id: 'b', predicate: 'supports', evidence_refs: ['ev-a-b'], version_id: 'rv1' },
      { relation_id: 'b-a', subject_id: 'b', object_id: 'a', predicate: 'challenges' },
    ] }, null, null);
    expect(model.edges.map((edge) => edge.type)).toEqual(['supports', 'challenges']);
    expect(model.nodes.find((node) => node.id === 'a')?.evidenceRefs).toEqual(['ev-a']);
    expect(model.edges[0].correlationRefs).toContain('rv1');
    expect(graphDiagnostics(model.nodes, model.edges).danglingEdgeIds).toEqual([]);
  });

  it('maps Reality correlation and explicit edge evidence', () => {
    const model = adaptRealityFlow({
      flow_id: 'flow-1',
      stages: [
        { id: 'event', kind: 'event', source_ref: 'source-1', evidence_refs: ['ev-event'] },
        { id: 'fact', kind: 'fact_decision', target_ref: 'fact-1', correlation_ref: 'source-1' },
      ],
      edges: [{ id: 'event-fact', source: 'event', target: 'fact', kind: 'promotes', evidence_refs: ['ev-edge'] }],
    });
    expect(model.nodes[1].correlationRefs).toContain('source-1');
    expect(model.edges[0].evidenceRefs).toEqual(['ev-edge']);
  });

  it('keeps Matrix entity impact and metric lineage quality/version evidence', () => {
    const impact = adaptEntityImpact({
      entity: { entity: { entity_id: 'root', display_name: 'Root', evidence_refs: ['ev-root'], version_id: 'entity-v2' } },
      relations: { relations: [{ relation_id: 'root-child', from_entity_id: 'root', to_entity_id: 'child', relation_type: 'impacts', evidence_refs: ['ev-rel'] }] },
      impact: { root_entity_id: 'root', entities: [{ entity_id: 'child' }] },
    });
    const lineage = adaptMetricLineage({
      detail: { metric: { metric_id: 'margin', unit: '%', quality_gate_id: 'quality-1', evidence_refs: ['ev-margin'] } },
      lineage: { metric_id: 'margin', downstream_dependencies: [{ dependency_id: 'margin-profit', upstream_metric_id: 'margin', downstream_metric_id: 'profit', version_id: 'dep-v3', evidence_refs: ['ev-dep'] }] },
    });
    expect(impact.nodes.find((node) => node.id === 'root')?.correlationRefs).toContain('entity-v2');
    expect(impact.edges[0].evidenceRefs).toEqual(['ev-rel']);
    expect(lineage.nodes.find((node) => node.id === 'margin')?.correlationRefs).toContain('quality-1');
    expect(lineage.edges[0].correlationRefs).toContain('dep-v3');
  });
});
