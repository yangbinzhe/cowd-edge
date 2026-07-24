import { afterEach, describe, expect, it, vi } from 'vitest';
import { mfgApi as api } from '@cowd/app-mfg-webui/api/mfgApi';
import type { MfgMutationIntent } from '@cowd/app-mfg-webui/types/mfg';
import { canonicalMfgMutationResponse } from '../testing/mfgReceiptMock';

function intent(actionId: string, resourceRef: string): MfgMutationIntent {
  const identity = `test:${actionId}:${resourceRef}`;
  return {
    intent_id: `mfg-intent:${identity}`,
    action_id: actionId,
    resource_ref: resourceRef,
    idempotency_key: identity,
    correlation_id: `mfg-correlation:${identity}`,
    payload_digest: 'sha256:test-semantic-payload',
    semantic_digest: 'sha256:test-semantic-payload',
    risk: 'medium',
    status: 'draft',
    error: null,
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
}

describe('external MFG APP request contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('keeps every critical governed write connected to its declared APP route', async () => {
    const fetchMock = vi.fn((_request, init?: RequestInit) => Promise.resolve(
      canonicalMfgMutationResponse(init, {
        receipt_projection: { status: 'completed' },
      }),
    ));
    vi.stubGlobal('fetch', fetchMock);

    const sourcePack = { source_pack_id: 'sp-1' };
    const run = { resource_ref: 'file:///tmp/events.json' };
    await api.mfgSourcePackUpsert(sourcePack, intent('mfg.reality.source_pack.create', 'mfg:source-pack:sp-1'));
    await api.mfgSourcePackValidate(
      'sp-1',
      intent('mfg.reality.source_pack.validate', 'matrix:source_pack:sp-1'),
    );
    await api.mfgSourcePackDeltaPlan(
      'sp-1',
      intent('mfg.reality.source_pack.delta_plan', 'matrix:source_pack:sp-1'),
    );
    await api.mfgSourcePackConnectorPlan('sp-1', run, intent('mfg.reality.connector_run.plan', 'mfg:source-pack:sp-1'));
    await api.mfgSourcePackConnectorRun('sp-1', run, intent('mfg.reality.connector_run.execute', 'mfg:source-pack:sp-1'));
    await api.mfgComputeJobPlan({ metric_ids: ['event_count'] }, intent('mfg.reality.compute_job.plan', 'mfg:compute:test'));
    await api.mfgComputeJobRun('job-1', intent('mfg.reality.compute_job.execute', 'mfg:compute-job:job-1'));
    await api.mfgEvidenceQualityGate('evidence-1', intent('mfg.reality.evidence.quality_gate', 'mfg:evidence:evidence-1'));
    await api.mfgRecommendPlaybooks(
      'incident-1',
      5,
      intent('mfg.incident.playbook.recommend', 'mfg:incident:incident-1'),
    );
    await api.mfgExecuteAction('analysis-1', 'action-1', { mode: 'dry_run', operator_id: 'forged' }, intent('mfg.analysis.action.dry_run', 'mfg:analysis:analysis-1'));
    await api.mfgExecutionBridge('execution-1', { mode: 'dry_run', actor_principal: 'forged' }, intent('mfg.execution.cross_plane.dry_run', 'mfg:execution:execution-1'));
    await api.mfgExecutionFeedback('execution-1', { outcome: 'resolved', actor_ref: 'forged' }, intent('mfg.execution.feedback.create', 'mfg:execution:execution-1'));
    await api.mfgDeleteCockpitProfile('profile-1', 1, intent('mfg.cockpit.profile.delete', 'mfg:cockpit-profile:profile-1'));
    await api.mfgCloneCockpitProfile('profile-1', {}, intent('mfg.cockpit.profile.clone', 'mfg:cockpit-profile:profile-1'));
    await api.mfgShareCockpitProfile('profile-1', { expected_revision: 1 }, intent('mfg.cockpit.profile.share', 'mfg:cockpit-profile:profile-1'));
    await api.mfgUpsertAlertRule({ rule_id: 'rule-1' }, intent('mfg.alert_rule.update', 'mfg:alert-rule:rule-1'));
    await api.mfgAlertCommand('alert-1', { command: 'acknowledge' }, intent('mfg.alert.acknowledge', 'mfg:alert:alert-1'));
    await api.mfgUpsertAlertSubscription({ subscription_id: 'sub-1' }, intent('mfg.alert_subscription.update', 'mfg:alert-subscription:sub-1'));
    await api.mfgUpsertAssignment({ assignment_id: 'assignment-1' }, intent('mfg.assignment.update', 'mfg:assignment:assignment-1'));
    await api.mfgRetryReportDelivery('report-1', { mode: 'dry_run' }, intent('mfg.report.delivery.retry_dry_run', 'mfg:report:report-1'));
    await api.mfgIngestFact([{ fact_type: 'quality' }], intent('mfg.reality.fact.ingest', 'mfg:fact-batch:test'));

    const requested = fetchMock.mock.calls.map(([request]) => String(request));
    for (const endpoint of [
      '/api/apps/mfg/reality/source-packs/upsert',
      '/api/apps/mfg/reality/source-packs/sp-1/validate',
      '/api/apps/mfg/reality/source-packs/sp-1/delta-plan',
      '/api/apps/mfg/reality/source-packs/sp-1/connector-runs/plan',
      '/api/apps/mfg/reality/source-packs/sp-1/connector-runs/run',
      '/api/apps/mfg/reality/compute/jobs/plan',
      '/api/apps/mfg/reality/compute/jobs/job-1/run',
      '/api/apps/mfg/reality/evidence/evidence-1/quality-gate',
      '/api/apps/mfg/incidents/incident-1/playbooks/recommend',
      '/api/apps/mfg/analyses/analysis-1/actions/action-1/execute',
      '/api/apps/mfg/executions/execution-1/cross-plane/execute',
      '/api/apps/mfg/executions/execution-1/feedback',
      '/api/apps/mfg/cockpit/profiles/profile-1?expected_revision=1',
      '/api/apps/mfg/cockpit/profiles/profile-1/clone',
      '/api/apps/mfg/cockpit/profiles/profile-1/share',
      '/api/apps/mfg/focus/alert-rules',
      '/api/apps/mfg/focus/alerts/alert-1/command',
      '/api/apps/mfg/focus/alert-subscriptions',
      '/api/apps/mfg/assignments',
      '/api/apps/mfg/cockpit/reports/report-1/delivery/retry',
      '/api/apps/mfg/reality/facts/ingest',
    ]) {
      expect(requested.some((request) => request.startsWith(endpoint))).toBe(true);
    }

    const serializedBodies = fetchMock.mock.calls
      .map(([, init]) => String((init as RequestInit | undefined)?.body || ''))
      .join('\n');
    expect(serializedBodies).not.toContain('forged');
    expect(serializedBodies).not.toContain('"idempotency_key"');
    expect(fetchMock.mock.calls.every(([, init]) => (
      new Headers((init as RequestInit).headers).has('Idempotency-Key')
    ))).toBe(true);
  });
});
