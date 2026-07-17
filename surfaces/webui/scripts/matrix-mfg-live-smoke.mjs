#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { evidenceContext } from './evidence-context.mjs';

const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);
const workspaceRoot = path.resolve(webuiRoot, '..');
const provenance = evidenceContext('matrix-mfg-live-smoke');
const planRoot = provenance.plan_root;
const reportDir = path.join(planRoot, 'reports', provenance.version);
const version = provenance.version;
const baseUrl = process.env.COWD_GATEWAY_URL || 'http://127.0.0.1:8642';

function readTokenFromConfig() {
  const config = path.join(process.env.HOME || '', '.cowd/config.yaml');
  if (!fs.existsSync(config)) return '';
  const lines = fs.readFileSync(config, 'utf8').split(/\r?\n/);
  let inApiServer = false;
  for (const line of lines) {
    if (/platformType:\s*api_server/.test(line)) inApiServer = true;
    if (inApiServer && /^\s*token:\s*/.test(line)) {
      return line.replace(/^\s*token:\s*/, '').trim().replace(/^["']|["']$/g, '');
    }
    if (inApiServer && /^\s*-\s*platformType:/.test(line) && !/api_server/.test(line)) inApiServer = false;
  }
  return '';
}

const token = process.env.COWD_API_TOKEN || process.env.COWD_AUTH_TOKEN || readTokenFromConfig();
const headers = {
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

async function request(step, method, route, body, {
  allowDegraded = false,
  expectedStatus,
  validate,
} = {}) {
  const started = Date.now();
  const durableMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
  // MFG accepts a legacy body/query key for compatibility, but the canonical
  // contract is the Idempotency-Key header.  Keep body keys (where endpoint
  // payloads model them) equal to the header so this smoke exercises the same
  // durable-mutation path as the WebUI client.
  const legacyIdempotencyKey = typeof body?.idempotency_key === 'string'
    ? body.idempotency_key
    : '';
  const queryIdempotencyKey = new URL(route, baseUrl).searchParams.get('idempotency_key') || '';
  const idempotencyKey = legacyIdempotencyKey || queryIdempotencyKey
    || `matrix-mfg-live-smoke:${stamp}:${step.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const requestHeaders = {
    ...headers,
    ...(durableMutation ? { 'idempotency-key': idempotencyKey } : {}),
  };
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    const statusMatches = expectedStatus === undefined
      ? response.ok
      : (Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]).includes(response.status);
    let validationError = '';
    if (statusMatches && validate) {
      try {
        const outcome = validate(data, response);
        if (outcome === false) validationError = 'response assertion returned false';
        else if (typeof outcome === 'string' && outcome) validationError = outcome;
      } catch (error) {
        validationError = error instanceof Error ? error.message : String(error);
      }
    }
    const ok = statusMatches && !validationError;
    return {
      step,
      method,
      route,
      status: ok ? 'pass' : allowDegraded ? 'degraded' : 'fail',
      http_status: response.status,
      duration_ms: Date.now() - started,
      summary: summarize(data),
      ...(validationError ? { validation_error: validationError } : {}),
      data,
    };
  } catch (error) {
    return {
      step,
      method,
      route,
      status: allowDegraded ? 'degraded' : 'fail',
      http_status: 0,
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarize(data) {
  if (!data || typeof data !== 'object') return String(data ?? '');
  const keys = ['kind', 'status', 'app_id', 'name', 'batch_id', 'job_id', 'incident_id', 'analysis_id', 'request_id', 'report_id'];
  const picked = {};
  for (const key of keys) {
    if (data[key] !== undefined) picked[key] = data[key];
    if (data.health?.[key] !== undefined) picked[`health.${key}`] = data.health[key];
    if (data.plan?.[key] !== undefined) picked[`plan.${key}`] = data.plan[key];
    if (data.job?.[key] !== undefined) picked[`job.${key}`] = data.job[key];
    if (data.packet?.[key] !== undefined) picked[`packet.${key}`] = data.packet[key];
    if (data.incident?.[key] !== undefined) picked[`incident.${key}`] = data.incident[key];
    if (data.analysis?.[key] !== undefined) picked[`analysis.${key}`] = data.analysis[key];
    if (data.report?.[key] !== undefined) picked[`report.${key}`] = data.report[key];
    if (data.delivery_state?.[key] !== undefined) picked[`delivery_state.${key}`] = data.delivery_state[key];
  }
  return Object.keys(picked).length ? picked : Object.fromEntries(Object.entries(data).slice(0, 5));
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const sourcePackId = `webui-live-smoke-${stamp}`;
const sourceRef = `source-pack://${sourcePackId}`;
const factType = 'manufacturing.event';
const metricId = 'manufacturing_event_count';
const entityRef = `asset:line-A-${stamp}`;
const principalRef = 'principal:local-human';

const steps = [];
steps.push(await request('gateway health', 'GET', '/health'));
steps.push(await request('matrix health', 'GET', '/api/apps/mfg/reality/health'));
steps.push(await request('mfg app descriptor', 'GET', '/api/apps/mfg/app'));
steps.push(await request('seed manufacturing domain', 'POST', '/api/apps/mfg/domain/server-manufacturing/seed', {}));
steps.push(await request('seed manufacturing ontology', 'POST', '/api/apps/mfg/ontology/server-manufacturing/seed', {}));
steps.push(await request('source pack upsert', 'POST', '/api/apps/mfg/reality/source-packs/upsert', {
  source_pack: {
    source_pack_id: sourcePackId,
    source_name: 'WebUI live smoke source',
    owner: 'manufacturing-ops',
    access_mode: 'file',
    refresh_mode: 'manual',
    entity_mappings: [{ source_entity: 'asset', matrix_entity_type: 'asset', source_key_field: 'asset_id' }],
    fact_mappings: [{ source_table: 'manufacturing_events', fact_type: factType, metric_key: metricId, entity_ref_fields: ['asset_id'], measure_fields: ['value'], dedup_key: 'event_id', delta_signature: 'updated_at' }],
    reconciliation_rules: ['deduplicate_by_source_key'],
    quality_rules: ['required_identifiers_present'],
    metadata: { configured_by: 'matrix-mfg-live-smoke' },
  },
  session_id: 'matrix-mfg-live-smoke',
}, { validate: (data) => data.source_pack?.source_pack_id === sourcePackId || 'source pack id did not round-trip' }));
steps.push(await request('source pack validate', 'POST', `/api/apps/mfg/reality/source-packs/${encodeURIComponent(sourcePackId)}/validate`, {}, {
  validate: (data) => data.validation?.valid !== false || 'source pack validation failed',
}));
steps.push(await request('source pack delta plan', 'POST', `/api/apps/mfg/reality/source-packs/${encodeURIComponent(sourcePackId)}/delta-plan`, {}, {
  validate: (data) => Boolean(data.delta_plan) || 'delta plan missing',
}));
const connectorPlan = await request('connector plan', 'POST', `/api/apps/mfg/reality/source-packs/${encodeURIComponent(sourcePackId)}/connector-runs/plan`, {
  run: { resource_ref: `file:///tmp/${sourcePackId}.json`, expected_rows: 1 },
  session_id: 'matrix-mfg-live-smoke',
}, { validate: (data) => data.run?.status === 'planned' || 'connector plan is not planned' });
steps.push(connectorPlan);
const connectorRun = await request('connector run', 'POST', `/api/apps/mfg/reality/source-packs/${encodeURIComponent(sourcePackId)}/connector-runs/run`, {
  run: { resource_ref: `file:///tmp/${sourcePackId}.json`, expected_rows: 1 },
  session_id: 'matrix-mfg-live-smoke',
}, { validate: (data) => Boolean(data.run?.run_id) || 'connector run id missing' });
steps.push(connectorRun);
const connectorRunId = connectorRun.data?.run?.run_id || connectorPlan.data?.run?.run_id;
if (connectorRunId) {
  steps.push(await request('connector inspect', 'GET', `/api/apps/mfg/reality/connector-runs/${encodeURIComponent(connectorRunId)}`, undefined, {
    validate: (data) => data.run?.run_id === connectorRunId || 'connector inspect returned another run',
  }));
}
const factIngest = await request('source pack fact ingest', 'POST', `/api/apps/mfg/reality/source-packs/${encodeURIComponent(sourcePackId)}/ingest-file`, {
  facts: [{
    fact_id: `fact-${stamp}`,
    fact_type: factType,
    entity_refs: [entityRef],
    metric_key: metricId,
    dimensions: { line: 'A', shift: 'day' },
    measures: { value: 12, previous_value: 4 },
    source_ref: sourceRef,
    confidence: 0.98,
    raw_hash: `sha256:${stamp}`,
  }],
  session_id: 'matrix-mfg-live-smoke',
}, { validate: (data) => data.ingested === 1 && data.attention?.length === 1 || 'fact ingest did not materialize one attention item' });
steps.push(factIngest);
const attentionId = factIngest.data?.attention?.[0]?.attention_id;
steps.push(await request('structured ingest plan', 'POST', '/api/cowd/structured/ingest-plan', {
  source_ref: sourceRef,
  fact_type: factType,
  estimated_rows: 16,
  raw_checksum: `sha256:${stamp}`,
  metric_ids: [metricId],
}));
steps.push(await request('matrix data-plane ingest plan', 'POST', '/api/apps/mfg/reality/data-plane/ingest-plan', {
  ingest: {
    source_ref: sourceRef,
    fact_type: factType,
    partition_ref: 'line:A',
    estimated_rows: 16,
    raw_checksum: `sha256:${stamp}`,
    metric_ids: [metricId],
  },
}));
steps.push(await request('metric attention plan', 'POST', '/api/apps/mfg/reality/metrics/attention-plan', {
  trigger_fact_type: factType,
  entity_scope: entityRef,
  period: 'latest',
  limit: 5,
}, { validate: (data) => Boolean(data.plan) || 'attention plan missing' }));
const computePlan = await request('compute job plan', 'POST', '/api/apps/mfg/reality/compute/jobs/plan', {
  job: {
    trigger_fact_type: factType,
    trigger_fact_refs: [`fact-${stamp}`],
    entity_scope: entityRef,
    period: 'latest',
    metric_ids: [metricId],
    priority: 0.7,
  },
}, { validate: (data) => Boolean(data.plan) || 'compute plan missing' });
steps.push(computePlan);
const computeJobId = computePlan.data?.plan?.job?.job_id || computePlan.data?.plan?.jobs?.[0]?.job_id || computePlan.data?.job?.job_id;
if (computeJobId) {
  steps.push(await request('compute job run', 'POST', `/api/apps/mfg/reality/compute/jobs/${encodeURIComponent(computeJobId)}/run`, {}, {
    validate: (data) => data.job?.job_id === computeJobId || 'compute run returned another job',
  }));
  steps.push(await request('compute job inspect', 'GET', `/api/apps/mfg/reality/compute/jobs/${encodeURIComponent(computeJobId)}`, undefined, {
    validate: (data) => data.job?.job_id === computeJobId || 'compute inspect returned another job',
  }));
}

const alertRule = await request('alert rule create', 'POST', '/api/apps/mfg/focus/alert-rules', {
  idempotency_key: `live-smoke-alert-${stamp}`,
  rule: {
    owner_ref: 'client-owner-is-ignored',
    name: 'Live smoke manufacturing risk',
    metric_refs: [metricId],
    entity_refs: [entityRef],
    condition: { field: 'priority_score', operator: 'gte', threshold: 0, window_minutes: 15 },
    severity: 'critical',
    enabled: true,
  },
}, { validate: (data) => data.rule?.condition?.window_minutes === 15 || 'alert condition window did not persist' });
steps.push(alertRule);
const alertRuleId = alertRule.data?.rule?.rule_id;
const alertList = await request('alert occurrence list', 'GET', '/api/apps/mfg/focus/alerts', undefined, {
  validate: (data) => Array.isArray(data.items) || 'alert occurrence list missing',
});
steps.push(alertList);
let alertOccurrence = alertList.data?.items?.find((item) => item.rule_id === alertRuleId);
for (const command of ['acknowledge', 'snooze', 'escalate', 'resolve']) {
  if (!alertOccurrence?.occurrence_id) break;
  const commandStep = await request(`alert ${command}`, 'POST', `/api/apps/mfg/focus/alerts/${encodeURIComponent(alertOccurrence.occurrence_id)}/command`, {
    command,
    expected_revision: alertOccurrence.revision,
    idempotency_key: `live-smoke-alert-${command}-${stamp}`,
    ...(command === 'snooze' ? { until: new Date(Date.now() + 15 * 60_000).toISOString(), reason: 'live smoke snooze' } : {}),
    ...(command === 'escalate' ? { reason: 'live smoke escalation' } : {}),
  }, { validate: (data) => data.occurrence?.status === ({ acknowledge: 'acknowledged', snooze: 'snoozed', escalate: 'escalated', resolve: 'resolved' })[command] || `alert ${command} state mismatch` });
  steps.push(commandStep);
  alertOccurrence = commandStep.data?.occurrence || alertOccurrence;
}

steps.push(await request('forecast available and unavailable truth', 'GET', `/api/apps/mfg/focus/forecasts?metric_refs=${encodeURIComponent(`${metricId},missing_metric_${stamp}`)}&horizon=${encodeURIComponent('next_7_days')}`, undefined, {
  validate: (data) => {
    const items = data.items || [];
    if (!Array.isArray(items) || items.length < 2) return 'forecast responses missing requested metrics';
    if (!items.every((item) => item.horizon && item.interval && item.generated_at && item.expires_at && Array.isArray(item.evidence_refs))) return 'forecast contract is incomplete';
    const unavailable = items.find((item) => item.status === 'unavailable');
    return unavailable?.unavailable_reason ? true : 'unavailable forecast lacks reason';
  },
}));

const evidence = await request('evidence build', 'POST', '/api/apps/mfg/reality/evidence/build', {
  attention_id: attentionId,
  problem_statement: 'Live smoke validates Matrix to MFG decision trace.',
}, { validate: (data) => Boolean(data.packet?.packet_id || data.evidence_packet?.packet_id) || 'evidence packet id missing' });
steps.push(evidence);
const evidencePacketId = evidence.data?.packet?.packet_id || evidence.data?.evidence_packet?.packet_id;
if (evidencePacketId) {
  steps.push(await request('evidence inspect', 'GET', `/api/apps/mfg/reality/evidence/${encodeURIComponent(evidencePacketId)}`, undefined, {
    validate: (data) => Boolean(data.packet || data.evidence_packet) || 'evidence packet missing',
  }));
  steps.push(await request('evidence context', 'GET', `/api/apps/mfg/reality/evidence/${encodeURIComponent(evidencePacketId)}/context`, undefined, {
    validate: (data) => Boolean(data.context_item || data.context) || 'evidence context missing',
  }));
  const quality = await request('evidence quality gate', 'POST', `/api/apps/mfg/reality/evidence/${encodeURIComponent(evidencePacketId)}/quality-gate`, {}, {
    validate: (data) => Boolean(data.quality_gate?.gate_id || data.gate?.gate_id) || 'quality gate id missing',
  });
  steps.push(quality);
  const qualityGateId = quality.data?.quality_gate?.gate_id || quality.data?.gate?.gate_id;
  if (qualityGateId) {
    steps.push(await request('quality gate inspect', 'GET', `/api/apps/mfg/reality/quality-gates/${encodeURIComponent(qualityGateId)}`, undefined, {
      validate: (data) => {
        const gate = data.quality_gate || data.gate;
        return gate?.gate_id === qualityGateId && Array.isArray(gate.required_actions) || 'quality remediation contract missing';
      },
    }));
  }
}
const incident = await request('incident create', 'POST', '/api/apps/mfg/incidents', {
  title: 'Live smoke Matrix/MFG decision trace',
  attention_id: attentionId,
  evidence_packet_id: evidencePacketId,
}, { validate: (data) => Boolean(data.incident?.incident_id && data.incident?.task_id) || 'incident did not bind a canonical task' });
steps.push(incident);
const incidentId = incident.data?.incident?.incident_id || incident.data?.incident_id;
const incidentTaskId = incident.data?.incident?.task_id;
let analysis;
let room;
if (incidentId) {
  analysis = await request('incident analyze', 'POST', `/api/apps/mfg/incidents/${encodeURIComponent(incidentId)}/analyze`, {}, {
    validate: (data) => Boolean(data.analysis?.analysis_id && data.analysis?.recommended_actions?.length) || 'analysis or action recommendations missing',
  });
  steps.push(analysis);
  room = await request('incident room', 'GET', `/api/apps/mfg/incidents/${encodeURIComponent(incidentId)}/room`, undefined, {
    validate: (data) => Boolean(data.workflow_graph && data.canonical_task_ref && data.quality_gate) || 'incident room lacks workflow/task/quality state',
  });
  steps.push(room);
} else {
  steps.push({
    step: 'incident analyze',
    method: 'POST',
    route: '/api/apps/mfg/incidents/:id/analyze',
    status: 'fail',
    http_status: 0,
    summary: 'skipped because incident create did not return an incident id',
  });
}

const analysisId = analysis?.data?.analysis?.analysis_id;
const actionId = analysis?.data?.analysis?.recommended_actions?.[0]?.action_id;
const governanceIntent = {
  actor_identity_ref: null,
  source_channel: 'channel://webui/mfg',
  session_id: incidentId || 'matrix-mfg-live-smoke',
  requested_capability: 'channel.chat.send_text',
  provider_account: null,
  target_ref: incidentId ? `mfg:incident:${incidentId}` : null,
  resource_ref: null,
  risk: 'medium',
  data_classification: 'internal',
  identity_trust: 'unknown',
};
if (analysisId && actionId) {
  steps.push(await request('action policy simulation', 'POST', '/api/cross-plane/policy/simulate', governanceIntent, {
    validate: (data) => Boolean(data.decision || data.policy || data.allowed !== undefined) || 'policy simulation decision missing',
  }));
  steps.push(await request('action preflight', 'POST', '/api/cross-plane/action/preflight', governanceIntent, {
    validate: (data) => (
      typeof data.executable === 'boolean'
      && typeof data.decision?.decision === 'string'
      && Array.isArray(data.blockers)
    ) || 'action preflight result missing',
  }));
  steps.push(await request('forged action actor rejected', 'POST', `/api/apps/mfg/analyses/${encodeURIComponent(analysisId)}/actions/${encodeURIComponent(actionId)}/execute`, {
    mode: 'dry_run',
    note: 'forged actor must be rejected',
    operator_id: 'principal:forged-client',
  }, { expectedStatus: 422 }));
  const actionExecution = await request('action commit execute', 'POST', `/api/apps/mfg/analyses/${encodeURIComponent(analysisId)}/actions/${encodeURIComponent(actionId)}/execute`, {
    mode: 'commit',
    expected_revision: analysis.data?.analysis?.revision,
    note: 'matrix mfg terminal smoke commits only to the isolated MFG fixture',
  }, {
    validate: (data) => Boolean(data.execution?.execution_id) && data.execution?.operator_id !== 'principal:forged-client' || 'server-derived action operator missing',
  });
  steps.push(actionExecution);
  const executionId = actionExecution.data?.execution?.execution_id;
  if (executionId) {
    steps.push(await request('action execution inspect', 'GET', `/api/apps/mfg/executions/${encodeURIComponent(executionId)}`, undefined, {
      validate: (data) => data.execution?.execution_id === executionId || 'execution inspect mismatch',
    }));
    steps.push(await request('action cross-plane dry-run', 'POST', `/api/apps/mfg/executions/${encodeURIComponent(executionId)}/cross-plane/execute`, {
      mode: 'dry_run',
      source_channel: 'channel://webui/mfg',
      requested_capability: 'channel.chat.send_text',
      target_ref: incidentId ? `mfg:incident:${incidentId}` : undefined,
      resource_ref: `mfg:execution:${executionId}`,
    }, { validate: (data) => Boolean(data.status || data.execution || data.receipt) || 'cross-plane execution receipt missing' }));
    steps.push(await request('action feedback', 'POST', `/api/apps/mfg/executions/${encodeURIComponent(executionId)}/feedback`, {
      outcome: 'resolved',
      note: 'terminal smoke feedback closes the action loop',
      metric_delta: -1,
    }, { validate: (data) => data.execution?.status === 'feedback_resolved' || 'feedback did not close execution' }));
    steps.push(await request('action after-state inspect', 'GET', `/api/apps/mfg/executions/${encodeURIComponent(executionId)}`, undefined, {
      validate: (data) => data.execution?.status === 'feedback_resolved' || 'after-state does not include feedback result',
    }));
  }
}

let assignment;
if (incidentTaskId) {
  assignment = await request('assignment create', 'POST', '/api/apps/mfg/assignments', {
    idempotency_key: `live-smoke-assignment-${stamp}`,
    assignment: {
      task_ref: `task:${incidentTaskId}`,
      workflow_id: room?.data?.workflow_graph?.workflow_id,
      incident_id: incidentId,
      assignee_ref: principalRef,
      assignee_kind: 'user',
      watcher_refs: ['role:operations'],
      priority: 'high',
      sla_minutes: 30,
      visibility: 'team',
      notification_targets: [],
    },
  }, { validate: (data) => Boolean(data.assignment?.assignment_id && data.assignment?.sla_minutes === 30) || 'assignment contract incomplete' });
  steps.push(assignment);
  let current = assignment.data?.assignment;
  for (const command of ['watch', 'request_update', 'escalate', 'transfer', 'unassign', 'assign', 'claim']) {
    if (!current?.assignment_id) break;
    const targetRef = command === 'transfer' ? 'agent:live-smoke-agent' : command === 'assign' ? principalRef : undefined;
    const commandStep = await request(`assignment ${command}`, 'POST', `/api/apps/mfg/assignments/${encodeURIComponent(current.assignment_id)}/command`, {
      command,
      expected_revision: current.revision,
      idempotency_key: `live-smoke-assignment-${command}-${stamp}`,
      ...(targetRef ? { target_ref: targetRef } : {}),
      reason: `terminal smoke ${command}`,
    }, { validate: (data) => (
      data.assignment?.revision === current.revision + 1
      && Boolean(
        data.business_receipt?.response?.audit_ref
        || data.receipt?.response?.business_receipt?.response?.audit_ref,
      )
    ) || `assignment ${command} receipt/revision mismatch` });
    steps.push(commandStep);
    current = commandStep.data?.assignment || current;
  }
  if (current?.assignment_id) {
    steps.push(await request('assignment inspect', 'GET', `/api/apps/mfg/assignments/${encodeURIComponent(current.assignment_id)}`, undefined, {
      validate: (data) => data.assignment?.assignment_id === current.assignment_id || 'assignment inspect mismatch',
    }));
  }
}

const profileId = `live-smoke-profile-${stamp}`;
const profileStep = await request('cockpit profile upsert', 'POST', '/api/apps/mfg/cockpit/profiles/upsert', {
  idempotency_key: `live-smoke-profile-${stamp}`,
  profile: {
    profile_id: profileId,
    owner_ref: 'client-owner-is-ignored',
    display_name: 'Live Smoke Manufacturing Cockpit',
    focus_refs: [entityRef],
    focus_metric_ids: [metricId],
    thresholds: { [metricId]: 0.08 },
    template_id: 'mfg.default_ops',
    cadence: 'daily',
    scope: { kind: 'personal' },
    layout: { columns: 12, row_height: 72, gap: 12 },
    global_filters: { entity_refs: [entityRef], metric_ids: [metricId], from: '2026-07-01T00:00:00Z' },
    widget_instances: [],
    sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] },
  },
}, { validate: (data) => data.profile?.owner_ref !== 'client-owner-is-ignored' && data.profile?.widget_instances?.length === 4 || 'profile defaults or server owner missing' });
steps.push(profileStep);
const savedProfile = profileStep.data?.profile;
if (savedProfile) {
  steps.push(await request('cockpit stale revision rejected', 'POST', '/api/apps/mfg/cockpit/profiles/upsert', {
    idempotency_key: `live-smoke-profile-stale-${stamp}`,
    profile: { ...savedProfile, display_name: 'stale overwrite must fail', expected_revision: 0 },
  }, { expectedStatus: 409, validate: (data) => (
    data.code === 'revision_conflict'
    && data.details?.legacy_code === 'mfg_revision_conflict'
  ) || 'stale profile did not return canonical revision conflict' }));
  const projectionQuery = new URLSearchParams({ entity: entityRef, metric: metricId, from: '2026-07-01T00:00:00Z' });
  const projection = await request('cockpit filtered projection', 'GET', `/api/apps/mfg/cockpit/profiles/${encodeURIComponent(profileId)}/projection?${projectionQuery}`, undefined, {
    validate: (data) => data.projection?.profile?.profile_id === profileId && data.projection?.widgets?.length === 4 || 'cockpit projection incomplete',
  });
  steps.push(projection);
  const firstWidgetId = savedProfile.widget_instances?.[0]?.instance_id;
  if (firstWidgetId) {
    steps.push(await request('single widget projection', 'GET', `/api/apps/mfg/cockpit/profiles/${encodeURIComponent(profileId)}/widgets/${encodeURIComponent(firstWidgetId)}/projection?${projectionQuery}`, undefined, {
      validate: (data) => data.projection?.widget?.instance_id === firstWidgetId || 'single widget projection mismatch',
    }));
  }
  steps.push(await request('cockpit profile clone', 'POST', `/api/apps/mfg/cockpit/profiles/${encodeURIComponent(profileId)}/clone`, {
    profile_id: `${profileId}-copy`,
    display_name: 'Live Smoke Manufacturing Cockpit Copy',
    idempotency_key: `live-smoke-profile-clone-${stamp}`,
  }, { validate: (data) => data.profile?.profile_id === `${profileId}-copy` || 'profile clone missing' }));
}
const reportStep = await request(
  'cockpit report generate',
  'POST',
  `/api/apps/mfg/cockpit/profiles/${encodeURIComponent(profileId)}/reports/generate`,
  {
    report: {
      report_id: `live-smoke-report-${stamp}`,
      cadence: 'daily',
      delivery_ref: 'channel://webui/live-smoke',
      note: 'generated by Matrix/MFG live smoke',
    },
  },
);
steps.push(reportStep);
const reportId = reportStep.data?.report?.report_id || reportStep.data?.report_id;
if (reportId) {
  steps.push(await request('cockpit report inspect', 'GET', `/api/apps/mfg/cockpit/reports/${encodeURIComponent(reportId)}`, undefined, {
    validate: (data) => data.report?.report_id === reportId || 'report inspect mismatch',
  }));
  steps.push(await request('cockpit report history', 'GET', `/api/apps/mfg/cockpit/reports?profile_id=${encodeURIComponent(profileId)}`, undefined, {
    validate: (data) => data.items?.some((item) => item.report_id === reportId) || 'generated report is absent from history',
  }));
  const delivery = await request('cockpit report dry-run delivery', 'POST', `/api/apps/mfg/cockpit/reports/${encodeURIComponent(reportId)}/deliver`, {
    mode: 'dry_run',
    idempotency_key: `live-smoke-report-deliver-${stamp}`,
    source_channel: 'mfg.report.delivery',
  }, { validate: (data) => (
    data.status === 'blocked'
    && data.dispatch_status === 'policy_blocked'
    && data.report?.delivery_receipts?.length === 0
  ) || 'dry-run delivery did not preserve its policy-blocked, no-attempt truth' });
  steps.push(delivery);
  steps.push(await request('cockpit delivery state probe', 'GET', `/api/apps/mfg/cockpit/reports/${encodeURIComponent(reportId)}/delivery-state`, undefined, {
    validate: (data) => (
      data.delivery_state?.attempt_count === 0
      && data.delivery_state?.classification === 'not_delivered'
      && data.delivery_state?.retryable === true
    ) || 'policy-blocked dry-run delivery state is not truthful',
  }));
  steps.push(await request('cockpit delivery retry', 'POST', `/api/apps/mfg/cockpit/reports/${encodeURIComponent(reportId)}/delivery/retry`, {
    mode: 'dry_run',
    idempotency_key: `live-smoke-report-retry-${stamp}`,
    source_channel: 'mfg.report.retry',
  }, { validate: (data) => Boolean(data.before_state && data.after_state && data.delivery) || 'delivery retry state transition missing' }));
  steps.push(await request('cockpit report schedule', 'POST', '/api/apps/mfg/cockpit/reports/schedules/run', {
    cadence: 'daily',
    deliver: false,
    report_id_prefix: `live-smoke-scheduled-${stamp}`,
    source_channel: 'webui.mfg',
  }, { validate: (data) => data.generated_report_count >= 1 && Array.isArray(data.items) || 'schedule did not generate reports' }));
  steps.push(await request('decision trace aggregate', 'GET', `/api/apps/mfg/decision-trace?${new URLSearchParams({
    ...(incidentId ? { incident_id: incidentId } : {}),
    report_id: reportId,
  }).toString()}`, undefined, {
    validate: (data) => (
      data.status === 'ready'
      && Array.isArray(data.rows)
      && data.rows.length > 0
      && data.objects
      && typeof data.objects === 'object'
    ) || 'decision trace aggregate is empty',
  }));
  steps.push(await request('mfg live projection', 'GET', '/api/apps/mfg/live/snapshot', undefined, {
    validate: (data) => (
      data.kind === 'snapshot'
      && typeof data.cursor === 'string'
      && typeof data.view_epoch === 'string'
    ) || 'typed live snapshot contract missing',
  }));
} else {
  steps.push({
    step: 'cockpit delivery state probe',
    method: 'GET',
    route: '/api/apps/mfg/cockpit/reports/:id/delivery-state',
    status: 'fail',
    http_status: 0,
    summary: 'skipped because report generate did not return a report id',
  });
  steps.push({
    step: 'decision trace aggregate',
    method: 'GET',
    route: '/api/apps/mfg/decision-trace',
    status: 'fail',
    http_status: 0,
    summary: 'skipped because report generate did not return a report id',
  });
}

if (savedProfile?.revision) {
  steps.push(await request('cockpit profile delete', 'DELETE', `/api/apps/mfg/cockpit/profiles/${encodeURIComponent(profileId)}?expected_revision=${encodeURIComponent(savedProfile.revision)}&idempotency_key=${encodeURIComponent(`live-smoke-profile-delete-${stamp}`)}`, undefined, {
    validate: (data) => data.kind === 'mfg.cockpit.profile_deleted' || 'profile cleanup failed',
  }));
}

const failed = steps.filter((step) => step.status === 'fail');
const degraded = steps.filter((step) => step.status === 'degraded');
const report = {
  provenance,
  version,
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  status: failed.length ? 'fail' : 'pass',
  degraded_count: degraded.length,
  failed_count: failed.length,
  decision_chain: [
    'gateway health',
    'matrix health',
    'mfg app descriptor',
    'seed manufacturing domain',
    'seed manufacturing ontology',
    'source pack upsert',
    'source pack validate',
    'source pack delta plan',
    'connector plan',
    'connector run',
    'source pack fact ingest',
    'structured ingest plan',
    'matrix data-plane ingest plan',
    'metric attention plan',
    'compute job plan',
    'alert rule create',
    'alert occurrence list',
    'forecast available and unavailable truth',
    'evidence build',
    'evidence quality gate',
    'incident create',
    'incident analyze',
    'incident room',
    'action policy simulation',
    'action preflight',
    'action commit execute',
    'action feedback',
    'assignment create',
    'assignment claim',
    'cockpit profile upsert',
    'cockpit stale revision rejected',
    'cockpit filtered projection',
    'single widget projection',
    'cockpit report generate',
    'cockpit report history',
    'cockpit report dry-run delivery',
    'cockpit delivery retry',
    'cockpit report schedule',
    'cockpit delivery state probe',
    'decision trace aggregate',
  ],
  steps,
};

fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${version}-matrix-mfg-live-smoke.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failed.length) {
  console.error(`Matrix/MFG live smoke failed. Report: ${reportPath}`);
  for (const step of failed) console.error(`- ${step.step}: ${step.http_status} ${step.error || JSON.stringify(step.summary)}`);
  process.exit(1);
}

console.log(`Matrix/MFG live smoke passed with ${degraded.length} degraded step(s): ${reportPath}`);
