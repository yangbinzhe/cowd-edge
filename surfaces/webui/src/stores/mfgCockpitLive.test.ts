import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MfgLiveTransportError } from '../api/mfgLiveTransport';
import { api } from '../api/client';
import type { MfgLiveEnvelope } from '../types/mfg';
import { useMfgCockpitStore } from './mfgCockpit';

describe('MFG cockpit live reducer', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('installs every snapshot domain and reduces every durable event payload in place', () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    const store = useMfgCockpitStore();
    const snapshot: MfgLiveEnvelope = {
      kind: 'snapshot',
      view_epoch: 'view-1',
      cursor: 'cursor-1',
      generated_at: '2026-07-16T00:00:00Z',
      contract_version: 'mfg.frontend.v1',
      state: {
        cockpit: { profiles: [{ profile_id: 'profile-1', owner_ref: 'principal:operator' }] },
        alerts: {
          rules: [{ rule_id: 'rule-1' }],
          subscriptions: [{ subscription_id: 'subscription-1' }],
          occurrences: [{ occurrence_id: 'alert-1', status: 'open' }],
        },
        assignments: { items: [{ assignment_id: 'assignment-1', status: 'assigned' }] },
        incidents: {
          items: [{ incident_id: 'incident-1' }],
          workflows: [{ workflow_id: 'workflow-1' }],
          analyses: [{ analysis_id: 'analysis-1' }],
          memory_cases: [{ case_id: 'case-1' }],
          playbooks: [{ playbook_id: 'playbook-1' }],
        },
        executions: {
          actions: [{ execution_id: 'execution-1' }],
          skills: [{ execution_id: 'skill-1' }],
        },
        reports: { items: [{ report_id: 'report-1' }] },
        reviews: { items: [{ review_id: 'review-1' }] },
        receipts: {
          commands: [{ receipt_id: 'command-receipt-1' }],
          mutations: [{ receipt_id: 'mutation-receipt-1' }],
        },
        data_compute: {
          entities: [{ entity_id: 'entity-1' }],
          relations: [{ relation_id: 'relation-1' }],
          facts: [{ fact_id: 'fact-1' }],
          attention: [{ attention_id: 'attention-1' }],
          evidence: [{ packet_id: 'evidence-1' }],
          quality_gates: [{ gate_id: 'gate-1' }],
          metric_definitions: [{ metric_id: 'metric-1' }],
          metric_dependencies: [{ dependency_id: 'dependency-1' }],
          metric_states: [{ state_id: 'state-1' }],
          metric_snapshots: [{ snapshot_id: 'snapshot-1' }],
          watermarks: [{ source_ref: 'source-1', fact_type: 'fact-1', partition_ref: 'p-1' }],
          jobs: [{ job_id: 'job-1' }],
          changes: [{ change_id: 'change-1' }],
          source_packs: [{ source_pack_id: 'source-pack-1' }],
          connector_runs: [{ run_id: 'connector-1' }],
          ontology_packs: [{ ontology_id: 'ontology-1' }],
          entity_match_candidates: [{ candidate_id: 'candidate-1' }],
          entity_conflict_decisions: [{ decision_id: 'decision-1' }],
        },
      },
    };
    store.receiveLiveEnvelope(snapshot);
    expect([
      store.profiles, store.alertRules, store.alertSubscriptions, store.alerts,
      store.assignments, store.incidents, store.workflows, store.analyses,
      store.memoryCases, store.playbooks, store.executions, store.skillRuns,
      store.reports, store.reviews,
    ].every((items) => items.length === 1)).toBe(true);
    expect(store.receipts).toHaveLength(2);
    for (const field of [
      'entities', 'relations', 'facts', 'attention', 'evidence', 'quality_gates',
      'metric_definitions', 'metric_dependencies', 'metric_states', 'metric_snapshots',
      'watermarks', 'jobs', 'changes', 'source_packs', 'connector_runs', 'ontology_packs',
      'entity_match_candidates', 'entity_conflict_decisions',
    ]) {
      expect(store.dataCompute[field]).toHaveLength(1);
    }

    const updates: Array<[string, string, Record<string, unknown>]> = [
      ['profile.upserted', 'mfg:cockpit-profile:profile-2', { profile: { profile_id: 'profile-2', owner_ref: 'principal:operator' } }],
      ['alert_rule.upserted', 'mfg:alert-rule:rule-2', { rule: { rule_id: 'rule-2' } }],
      ['alert_subscription.upserted', 'mfg:alert-subscription:subscription-2', { subscription: { subscription_id: 'subscription-2' } }],
      ['alert.opened', 'mfg:alert-occurrence:alert-2', { occurrence: { occurrence_id: 'alert-2', status: 'open' } }],
      ['assignment.upserted', 'mfg:assignment:assignment-2', { assignment: { assignment_id: 'assignment-2', status: 'assigned' } }],
      ['incident.updated', 'mfg:incident:incident-2', { incident: { incident_id: 'incident-2' } }],
      ['workflow.updated', 'mfg:workflow:workflow-2', { workflow: { workflow_id: 'workflow-2' } }],
      ['analysis.updated', 'mfg:analysis:analysis-2', { analysis: { analysis_id: 'analysis-2' } }],
      ['memory_case.updated', 'mfg:memory-case:case-2', { memory_case: { case_id: 'case-2' } }],
      ['playbook.updated', 'mfg:playbook:playbook-2', { playbook: { playbook_id: 'playbook-2' } }],
      ['execution.updated', 'mfg:execution:execution-2', { execution: { execution_id: 'execution-2' } }],
      ['skill_run.updated', 'mfg:skill-execution:skill-2', { skill_run: { execution_id: 'skill-2' } }],
      ['report.updated', 'mfg:cockpit-report:report-2', { report: { report_id: 'report-2' } }],
      ['report_review.requested', 'mfg:report-review:review-2', { review: { review_id: 'review-2' } }],
      ['receipt.completed', 'mfg:receipt:receipt-2', { receipt: { receipt_id: 'receipt-2' } }],
      ['entity.updated', 'matrix:entity:entity-2', { entity: { entity_id: 'entity-2' } }],
      ['relation.updated', 'matrix:relation:relation-2', { relation: { relation_id: 'relation-2' } }],
      ['fact.ingested', 'matrix:fact:fact-2', { fact: { fact_id: 'fact-2' } }],
      ['attention.updated', 'matrix:attention:attention-2', { attention: { attention_id: 'attention-2' } }],
      ['evidence.updated', 'matrix:evidence:evidence-2', { evidence: { packet_id: 'evidence-2' } }],
      ['quality_gate.updated', 'matrix:quality-gate:gate-2', { quality_gate: { gate_id: 'gate-2' } }],
      ['metric_definition.updated', 'matrix:metric-definition:metric-2', { metric_definition: { metric_id: 'metric-2' } }],
      ['metric_dependency.updated', 'matrix:metric-dependency:dependency-2', { metric_dependency: { dependency_id: 'dependency-2' } }],
      ['metric_state.updated', 'matrix:metric-state:state-2', { metric_state: { state_id: 'state-2' } }],
      ['metric_snapshot.updated', 'matrix:metric-snapshot:snapshot-2', { metric_snapshot: { snapshot_id: 'snapshot-2' } }],
      ['data_watermark.updated', 'matrix:watermark:source-2:fact-2:p-2', { watermark: { source_ref: 'source-2', fact_type: 'fact-2', partition_ref: 'p-2' } }],
      ['compute_job.updated', 'matrix:compute-job:job-2', { job: { job_id: 'job-2' } }],
      ['metric_change.detected', 'matrix:change:change-2', { change: { change_id: 'change-2' } }],
      ['source_pack.updated', 'matrix:source-pack:source-pack-2', { source_pack: { source_pack_id: 'source-pack-2' } }],
      ['connector_run.updated', 'matrix:connector-run:connector-2', { connector_run: { run_id: 'connector-2' } }],
      ['ontology.updated', 'matrix:ontology:ontology-2', { ontology: { ontology_id: 'ontology-2' } }],
      ['entity.match_candidate_updated', 'matrix:entity-match:candidate-2', { entity_match_candidate: { candidate_id: 'candidate-2' } }],
      ['entity.conflict_decided', 'matrix:entity-conflict:decision-2', { entity_conflict_decision: { decision_id: 'decision-2' } }],
    ];
    store.receiveLiveEnvelope({
      kind: 'delta',
      view_epoch: 'view-1',
      base_cursor: 'cursor-1',
      target_cursor: 'cursor-2',
      events: updates.map(([event_type, subject_ref, payload]) => ({
        event_type,
        subject_ref,
        revision: 2,
        occurred_at: '2026-07-16T00:00:01Z',
        payload,
      })),
    });
    expect(store.profiles.some((item) => item.profile_id === 'profile-2')).toBe(true);
    expect(store.receipts.some((item) => item.receipt_id === 'receipt-2')).toBe(true);
    for (const [field, idField, id] of [
      ['entities', 'entity_id', 'entity-2'],
      ['relations', 'relation_id', 'relation-2'],
      ['facts', 'fact_id', 'fact-2'],
      ['attention', 'attention_id', 'attention-2'],
      ['evidence', 'packet_id', 'evidence-2'],
      ['quality_gates', 'gate_id', 'gate-2'],
      ['metric_definitions', 'metric_id', 'metric-2'],
      ['metric_dependencies', 'dependency_id', 'dependency-2'],
      ['metric_states', 'state_id', 'state-2'],
      ['metric_snapshots', 'snapshot_id', 'snapshot-2'],
      ['jobs', 'job_id', 'job-2'],
      ['changes', 'change_id', 'change-2'],
      ['source_packs', 'source_pack_id', 'source-pack-2'],
      ['connector_runs', 'run_id', 'connector-2'],
      ['ontology_packs', 'ontology_id', 'ontology-2'],
      ['entity_match_candidates', 'candidate_id', 'candidate-2'],
      ['entity_conflict_decisions', 'decision_id', 'decision-2'],
    ] as const) {
      expect((store.dataCompute[field] as any[]).some((item) => item[idField] === id)).toBe(true);
    }
    expect((store.dataCompute.watermarks as any[]).some((item) => (
      item.source_ref === 'source-2'
      && item.fact_type === 'fact-2'
      && item.partition_ref === 'p-2'
    ))).toBe(true);
    store.stopLive();
  });

  it('releases terminal authorization transport state and removes every cropped projection', () => {
    setActivePinia(createPinia());
    const store = useMfgCockpitStore();
    store.receiveLiveEnvelope({
      kind: 'snapshot',
      view_epoch: 'authorized-view',
      cursor: 'authorized-cursor',
      generated_at: '2026-07-16T00:00:00Z',
      contract_version: 'mfg.frontend.v1',
      state: {
        cockpit: { profiles: [{ profile_id: 'private-profile' }] },
        alerts: { rules: [], subscriptions: [], occurrences: [] },
        assignments: { items: [{ assignment_id: 'private-assignment' }] },
        incidents: { items: [] },
        executions: { actions: [] },
        reports: { items: [{ report_id: 'private-report' }] },
        reviews: { items: [] },
        receipts: { commands: [], mutations: [{ receipt_id: 'private-receipt' }] },
        data_compute: { entities: [{ entity_id: 'private-entity' }] },
      },
    });

    store.applyLiveTransportState('stopped', new MfgLiveTransportError(
      'authenticate again',
      401,
      {
        code: 'authentication_required',
        message: 'authenticate again',
        http_status: 401,
        retryable: false,
        recovery_actions: [],
      },
    ));

    expect(store.liveStatus).toBe('stopped');
    expect(store.liveRecoveryReason).toBe('authentication');
    expect(store.live).toBeNull();
    expect(store.profiles).toEqual([]);
    expect(store.assignments).toEqual([]);
    expect(store.reports).toEqual([]);
    expect(store.receipts).toEqual([]);
    expect(store.dataCompute).toEqual({});
  });

  it('exposes a forbidden credential-replacement recovery without starting an unauthorized consumer', () => {
    setActivePinia(createPinia());
    const store = useMfgCockpitStore();
    store.applyLiveTransportState('stopped', new MfgLiveTransportError(
      'mfg.read is required',
      403,
      {
        code: 'capability_denied',
        message: 'mfg.read is required',
        http_status: 403,
        retryable: false,
        recovery_actions: [],
      },
    ));

    store.startLive();
    expect(store.liveStatus).toBe('stopped');
    expect(store.liveRecoveryReason).toBe('forbidden');
    expect(store.liveConsumerGeneration).toBe(0);
  });

  it('keeps MFG live available when the local Gateway has authentication disabled', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      kind: 'snapshot',
      view_epoch: 'internal-view',
      cursor: 'internal-cursor',
      generated_at: '2026-07-16T00:00:00Z',
      contract_version: 'mfg.frontend.v1',
      state: {
        cockpit: {}, alerts: {}, assignments: {}, incidents: {}, executions: {},
        reports: {}, reviews: {}, receipts: {}, data_compute: {},
      },
    }))));
    setActivePinia(createPinia());
    const store = useMfgCockpitStore();
    store.authRequired = false;
    store.startLive();
    expect(store.liveAccessGranted).toBe(true);
    expect(store.liveConsumerGeneration).toBe(1);
    store.stopLive();
  });

  it('never lets an older authorized refresh refill projections after authorization is cleared', async () => {
    let releaseContract!: (value: any) => void;
    const delayedContract = new Promise((resolve) => {
      releaseContract = resolve;
    });
    vi.spyOn(api, 'mfgContract').mockReturnValue(delayedContract as any);
    vi.spyOn(api, 'authVerify').mockResolvedValue({
      valid: true,
      auth_required: true,
      entitlement: { granted: ['mfg.read'], denied: [] },
    } as any);
    vi.spyOn(api, 'mfgCockpitProfiles').mockResolvedValue({
      items: [{ profile_id: 'old-private-profile' }],
    } as any);
    vi.spyOn(api, 'mfgCockpitWidgetCatalog').mockResolvedValue({ items: [] } as any);
    vi.spyOn(api, 'mfgAlertRules').mockResolvedValue({ items: [] } as any);
    vi.spyOn(api, 'mfgAlertOccurrences').mockResolvedValue({ items: [] } as any);
    vi.spyOn(api, 'mfgAlertSubscriptions').mockResolvedValue({ items: [] } as any);
    vi.spyOn(api, 'mfgAssignments').mockResolvedValue({
      items: [{ assignment_id: 'old-private-assignment' }],
    } as any);
    vi.spyOn(api, 'mfgReportReviews').mockResolvedValue({ items: [] } as any);

    setActivePinia(createPinia());
    const store = useMfgCockpitStore();
    const pending = store.refresh();
    await Promise.resolve();
    const epochBeforeClear = store.requestEpoch;
    store.clearAuthorizedLiveState();
    expect(store.requestEpoch).toBeGreaterThan(epochBeforeClear);
    releaseContract({ contract_version: 'old-authorized-contract' });
    await pending;

    expect(store.contract).toBeNull();
    expect(store.entitlement).toBeNull();
    expect(store.profiles).toEqual([]);
    expect(store.assignments).toEqual([]);
  });

  it('never applies profile, alert, or assignment mutation responses from an old authorization epoch', async () => {
    let releaseProfile!: (value: any) => void;
    let releaseAlert!: (value: any) => void;
    let releaseAssignment!: (value: any) => void;
    vi.spyOn(api, 'mfgUpsertProfile').mockReturnValue(new Promise((resolve) => {
      releaseProfile = resolve;
    }) as any);
    vi.spyOn(api, 'mfgAlertCommand').mockReturnValue(new Promise((resolve) => {
      releaseAlert = resolve;
    }) as any);
    vi.spyOn(api, 'mfgAssignmentCommand').mockReturnValue(new Promise((resolve) => {
      releaseAssignment = resolve;
    }) as any);

    setActivePinia(createPinia());
    const store = useMfgCockpitStore();
    const profilePromise = store.saveProfile({
      profile_id: 'old-private-profile',
      revision: 1,
      widget_instances: [],
      layout: { columns: 12, row_height: 72, gap: 12 },
      sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] },
    } as any);
    store.clearAuthorizedLiveState();
    releaseProfile({
      profile: {
        profile_id: 'old-private-profile',
        revision: 2,
        widget_instances: [],
      },
      receipt: { receipt_id: 'old-profile-receipt' },
    });
    await profilePromise;
    expect(store.profiles).toEqual([]);
    expect(store.lastReceipt).toBeNull();

    const alertPromise = store.commandAlert({
      occurrence_id: 'old-private-alert',
      revision: 1,
      status: 'open',
    } as any, 'acknowledge');
    store.clearAuthorizedLiveState();
    releaseAlert({
      occurrence: {
        occurrence_id: 'old-private-alert',
        revision: 2,
        status: 'acknowledged',
      },
    });
    await alertPromise;
    expect(store.alerts).toEqual([]);

    const assignmentPromise = store.commandAssignment({
      assignment_id: 'old-private-assignment',
      revision: 1,
      status: 'assigned',
    } as any, 'unassign');
    store.clearAuthorizedLiveState();
    releaseAssignment({
      assignment: {
        assignment_id: 'old-private-assignment',
        revision: 2,
        status: 'unassigned',
      },
    });
    await assignmentPromise;
    expect(store.assignments).toEqual([]);
  });

  it('coalesces identical recovery signals but reruns for a newer credential and profile revision', async () => {
    let releaseFirstContract!: (value: any) => void;
    const firstContract = new Promise((resolve) => {
      releaseFirstContract = resolve;
    });
    const contractSpy = vi.spyOn(api, 'mfgContract')
      .mockReturnValueOnce(firstContract as any)
      .mockResolvedValue({ contract_version: 'latest' } as any);
    vi.spyOn(api, 'authVerify')
      .mockResolvedValueOnce({
        valid: true,
        auth_required: true,
        entitlement: {
          granted: [],
          denied: ['mfg.read'],
          profile_revision: 1,
          credential_epoch: 1,
        },
      } as any)
      .mockResolvedValue({
        valid: true,
        auth_required: true,
        entitlement: {
          granted: [],
          denied: ['mfg.read'],
          profile_revision: 2,
          credential_epoch: 2,
        },
      } as any);
    for (const method of [
      'mfgCockpitProfiles', 'mfgCockpitWidgetCatalog', 'mfgAlertRules',
      'mfgAlertOccurrences', 'mfgAlertSubscriptions', 'mfgAssignments',
      'mfgReportReviews',
    ] as const) {
      vi.spyOn(api, method).mockResolvedValue({ items: [] } as any);
    }
    vi.spyOn(api, 'mfgForecasts').mockResolvedValue({ items: [] } as any);

    setActivePinia(createPinia());
    const store = useMfgCockpitStore();
    const first = store.recoverLiveAuthorization('auth-session:profile=1:credential=1');
    const duplicate = store.recoverLiveAuthorization('auth-session:profile=1:credential=1');
    const newer = store.recoverLiveAuthorization('auth-session:profile=2:credential=2');
    expect(duplicate).toBe(first);
    expect(newer).toBe(first);
    releaseFirstContract({ contract_version: 'old' });
    await first;

    expect(contractSpy).toHaveBeenCalledTimes(2);
    expect(api.authVerify).toHaveBeenCalledTimes(2);
    expect(store.liveConsumerGeneration).toBe(0);
    expect(store.entitlement?.profile_revision).toBe(2);
    expect(store.entitlement?.credential_epoch).toBe(2);
  });
});
