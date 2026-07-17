import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import { api } from '../api/client';
import { MfgLiveTransport, MfgLiveTransportError, type MfgLiveTransportState } from '../api/mfgLiveTransport';
import { createMfgMutationIntent } from './mutationIntents';
import type {
  MfgAlertOccurrence,
  MfgAssignment,
  MfgCockpitProfile,
  MfgCockpitCatalogContract,
  MfgCockpitProjection,
  MfgCockpitWidget,
  MfgLiveEnvelope,
  MfgLiveEvent,
  MfgLiveSnapshotState,
  MfgEntitlementProjection,
  MfgFrontendContract,
  MfgReportDeliveryReview,
  MfgWidgetDefinition,
  MfgWidgetInstance,
} from '../types/mfg';

function collection(value: any, key = 'items') {
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function profileFrom(value: any): MfgCockpitProfile | null {
  const profile = value?.profile || value?.projection?.profile || value;
  return typeof profile?.profile_id === 'string' ? profile as MfgCockpitProfile : null;
}

function readError(...values: any[]) {
  const failed = values.find((value) => value?.__state && value.__state !== 'ready' && value.__state !== 'stale');
  return failed?.__error ? String(failed.__error) : '';
}

function readable(value: any) {
  return !value?.__state || value.__state === 'ready' || value.__state === 'stale';
}

export const useMfgCockpitStore = defineStore('mfg-cockpit', () => {
  let liveTransport: MfgLiveTransport | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let projectionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshInFlight = false;
  let refreshQueued = false;
  let saveOperationGeneration = 0;
  let authorizationRecovery: Promise<void> | null = null;
  let activeRecoverySignature = '';
  let queuedRecoverySignature = '';
  const widgetEpochs = new Map<string, number>();
  const widgetControllers = new Map<string, AbortController>();
  const profiles = ref<MfgCockpitProfile[]>([]);
  const contract = ref<MfgFrontendContract | null>(null);
  const entitlement = ref<MfgEntitlementProjection | null>(null);
  const authRequired = ref<boolean | null>(null);
  const catalog = ref<MfgWidgetDefinition[]>([]);
  const globalFilterSchema = ref<MfgCockpitCatalogContract['global_filter_schema']>();
  const filterMergePolicy = ref<MfgCockpitCatalogContract['filter_merge_policy']>();
  const selectedProfileId = ref('');
  const projection = ref<MfgCockpitProjection | null>(null);
  const alerts = ref<MfgAlertOccurrence[]>([]);
  const alertRules = ref<any[]>([]);
  const alertSubscriptions = ref<any[]>([]);
  const forecasts = ref<any[]>([]);
  const assignments = ref<MfgAssignment[]>([]);
  const incidents = ref<any[]>([]);
  const workflows = ref<any[]>([]);
  const analyses = ref<any[]>([]);
  const memoryCases = ref<any[]>([]);
  const playbooks = ref<any[]>([]);
  const executions = ref<any[]>([]);
  const skillRuns = ref<any[]>([]);
  const reports = ref<any[]>([]);
  const reviews = ref<MfgReportDeliveryReview[]>([]);
  const receipts = ref<any[]>([]);
  const dataCompute = ref<Record<string, unknown>>({});
  const live = ref<MfgLiveEnvelope | null>(null);
  const lastReceipt = ref<any>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  const liveStatus = ref<'connecting' | 'live' | 'reconnecting' | 'stopped'>('stopped');
  const liveRecoveryReason = ref<'authentication' | 'forbidden' | null>(null);
  const liveConsumerGeneration = ref(0);
  const lastUpdatedAt = ref('');
  const requestEpoch = ref(0);
  const activeProjectionFilters = ref<Record<string, string>>({});
  const widgetRefreshState = ref<Record<string, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string; updated_at?: string }>>({});

  const selectedProfile = computed(() => projection.value?.profile?.profile_id === selectedProfileId.value
    ? projection.value.profile
    : profiles.value.find((profile) => profile.profile_id === selectedProfileId.value) || null);
  const widgetsByInstance = computed(() => new Map((projection.value?.widgets || []).map((widget) => [widget.instance_id, widget])));
  const attentionAlerts = computed(() => alerts.value.filter((item) => !['resolved', 'snoozed'].includes(String(item.status))));
  const activeAssignments = computed(() => assignments.value.filter((item) => !['unassigned', 'resolved', 'done'].includes(String(item.status))));
  const grantedCapabilities = computed(() => new Set(entitlement.value?.granted || []));
  const liveAccessGranted = computed(() => (
    authRequired.value === false
    || grantedCapabilities.value.has('mfg.read')
  ));
  const availableActions = computed(() => new Set(
    (contract.value?.actions || [])
      .filter((action) => action.availability === 'active')
      .filter((action) => (action.required_capabilities || []).every((capability) => grantedCapabilities.value.has(capability)))
      .map((action) => action.action_id),
  ));
  const handleEntitlementStale = () => {
    liveTransport?.stop();
    liveTransport = null;
    clearAuthorizedLiveState();
    liveRecoveryReason.value = 'forbidden';
    void recoverLiveAuthorization('entitlement-stale');
  };
  const handleAuthSessionRefreshed = (event: Event) => {
    const entitlement = (event as CustomEvent)?.detail?.entitlement;
    const signature = JSON.stringify({
      granted: [...(entitlement?.granted || [])].sort(),
      denied: [...(entitlement?.denied || [])].sort(),
      core_profile_id: entitlement?.core_profile_id || '',
      mfg_profile_id: entitlement?.mfg_profile_id || '',
      profile_revision: entitlement?.profile_revision ?? null,
      credential_epoch: entitlement?.credential_epoch ?? null,
    });
    void recoverLiveAuthorization(`auth-session:${signature}`);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('cowd:mfg-entitlement-stale', handleEntitlementStale);
    window.addEventListener('cowd:auth-session-refreshed', handleAuthSessionRefreshed);
    onScopeDispose(() => {
      window.removeEventListener('cowd:mfg-entitlement-stale', handleEntitlementStale);
      window.removeEventListener('cowd:auth-session-refreshed', handleAuthSessionRefreshed);
    });
  }

  async function refresh(filters?: Record<string, string>) {
    if (filters) activeProjectionFilters.value = { ...filters };
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }
    refreshInFlight = true;
    const epoch = ++requestEpoch.value;
    loading.value = true;
    error.value = '';
    try {
      const [contractResult, authResult, profileResult, catalogResult, ruleResult, alertResult, subscriptionResult, assignmentResult, reviewResult] = await Promise.all([
        api.mfgContract(), api.authVerify(), api.mfgCockpitProfiles(), api.mfgCockpitWidgetCatalog(), api.mfgAlertRules(), api.mfgAlertOccurrences(), api.mfgAlertSubscriptions(), api.mfgAssignments(), api.mfgReportReviews(),
      ]);
      const failure = readError(contractResult, authResult, profileResult, catalogResult, ruleResult, alertResult, subscriptionResult, assignmentResult, reviewResult);
      if (epoch !== requestEpoch.value) return;
      error.value = failure;
      if (readable(contractResult)) contract.value = contractResult as MfgFrontendContract;
      if (readable(authResult)) {
        authRequired.value = typeof authResult.auth_required === 'boolean'
          ? authResult.auth_required
          : null;
        entitlement.value = authResult.entitlement || null;
      }
      if (readable(profileResult)) profiles.value = collection(profileResult).map(profileFrom).filter(Boolean) as MfgCockpitProfile[];
      if (readable(catalogResult)) {
        const catalogContract = catalogResult as MfgCockpitCatalogContract;
        catalog.value = collection(catalogContract) as MfgWidgetDefinition[];
        globalFilterSchema.value = catalogContract.global_filter_schema;
        filterMergePolicy.value = catalogContract.filter_merge_policy;
      }
      if (readable(ruleResult)) alertRules.value = collection(ruleResult);
      if (readable(alertResult)) alerts.value = collection(alertResult) as MfgAlertOccurrence[];
      if (readable(subscriptionResult)) alertSubscriptions.value = collection(subscriptionResult);
      if (readable(assignmentResult)) assignments.value = collection(assignmentResult) as MfgAssignment[];
      if (readable(reviewResult)) reviews.value = collection(reviewResult) as MfgReportDeliveryReview[];
      if (!profiles.value.some((profile) => profile.profile_id === selectedProfileId.value)) {
        selectedProfileId.value = profiles.value[0]?.profile_id || '';
        if (!selectedProfileId.value) projection.value = null;
      }
      if (selectedProfileId.value) {
        await loadProfile(selectedProfileId.value, epoch, activeProjectionFilters.value)
          .catch(() => undefined);
      }
      if (epoch !== requestEpoch.value) return;
      await loadForecasts(undefined, 'next_period', epoch).catch(() => undefined);
      if (epoch !== requestEpoch.value) return;
      lastUpdatedAt.value = new Date().toISOString();
    } catch (cause) {
      if (epoch === requestEpoch.value) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      loading.value = false;
      refreshInFlight = false;
      if (refreshQueued) {
        refreshQueued = false;
        scheduleRefresh();
      }
    }
  }

  async function loadProfile(profileId: string, inheritedEpoch?: number, filters?: Record<string, string>) {
    if (filters) activeProjectionFilters.value = { ...filters };
    const epoch = inheritedEpoch ?? ++requestEpoch.value;
    error.value = '';
    try {
      selectedProfileId.value = profileId;
      const [profileResult, projectionResult] = await Promise.all([
        api.mfgCockpitProfile(profileId), api.mfgCockpitProjection(profileId, activeProjectionFilters.value),
      ]);
      const failure = readError(profileResult, projectionResult);
      if (failure) throw new Error(failure);
      if (epoch !== requestEpoch.value) return;
      const profile = profileFrom(profileResult);
      if (profile) {
        const index = profiles.value.findIndex((item) => item.profile_id === profile.profile_id);
        if (index >= 0) profiles.value.splice(index, 1, profile);
        else profiles.value.unshift(profile);
      }
      const nextProjection = (projectionResult?.projection || projectionResult) as MfgCockpitProjection;
      if (!nextProjection?.profile?.profile_id) throw new Error('mfg.cockpit.invalid_projection_response');
      projection.value = nextProjection;
    } catch (cause) {
      if (epoch === requestEpoch.value) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
      throw cause;
    }
  }

  async function loadForecasts(
    metricRefs?: string[],
    horizon = 'next_period',
    inheritedEpoch = requestEpoch.value,
  ) {
    const refs = metricRefs || selectedProfile.value?.focus_metric_ids || [];
    const result = await api.mfgForecasts(refs, horizon);
    const failure = readError(result);
    if (failure) throw new Error(failure);
    if (inheritedEpoch !== requestEpoch.value) return;
    forecasts.value = collection(result);
  }

  async function saveProfile(profile: MfgCockpitProfile) {
    const authorizationEpoch = requestEpoch.value;
    const operationGeneration = ++saveOperationGeneration;
    saving.value = true;
    error.value = '';
    try {
      const exists = profiles.value.some((item) => item.profile_id === profile.profile_id);
      const payload = {
        ...profile,
        expected_revision: exists ? profile.revision : undefined,
        owner_ref: '',
      };
      const intent = createMfgMutationIntent(
        exists ? 'mfg.cockpit.profile.update' : 'mfg.cockpit.profile.create',
        `mfg:cockpit-profile:${profile.profile_id}`,
        payload,
        { expectedRevision: exists ? profile.revision : undefined, risk: 'medium' },
      );
      const result = await api.mfgUpsertProfile(payload, intent);
      const next = profileFrom(result);
      if (!next) throw new Error('mfg.cockpit.invalid_profile_response');
      if (authorizationEpoch !== requestEpoch.value) return next;
      lastReceipt.value = result?.receipt || null;
      selectedProfileId.value = next.profile_id;
      const index = profiles.value.findIndex((item) => item.profile_id === next.profile_id);
      if (index >= 0) profiles.value.splice(index, 1, next);
      else profiles.value.unshift(next);
      await loadProfile(next.profile_id);
      return next;
    } catch (cause) {
      if (authorizationEpoch === requestEpoch.value) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
      throw cause;
    } finally {
      if (operationGeneration === saveOperationGeneration) saving.value = false;
    }
  }

  async function refreshWidget(instanceId: string) {
    const profileId = selectedProfileId.value;
    if (!profileId) throw new Error('mfg.cockpit.profile_required');
    const widgetEpoch = (widgetEpochs.get(instanceId) || 0) + 1;
    widgetEpochs.set(instanceId, widgetEpoch);
    widgetControllers.get(instanceId)?.abort();
    const controller = new AbortController();
    widgetControllers.set(instanceId, controller);
    widgetRefreshState.value = {
      ...widgetRefreshState.value,
      [instanceId]: { status: 'loading' },
    };
    try {
      const result = await api.mfgCockpitWidgetProjection(profileId, instanceId, activeProjectionFilters.value, controller.signal);
      if (controller.signal.aborted || widgetEpochs.get(instanceId) !== widgetEpoch) return undefined;
      if (result?.__state && result.__state !== 'ready') {
        throw new Error(String(result.__error || result.__state));
      }
      const failure = readError(result);
      if (failure) throw new Error(failure);
      const next = (result?.projection?.widget || result?.widget) as MfgCockpitWidget | undefined;
      if (!next?.instance_id) throw new Error('mfg.cockpit.invalid_widget_projection_response');
      if (widgetEpochs.get(instanceId) !== widgetEpoch) return next;
      if (projection.value?.profile.profile_id === profileId) {
        const widgets = [...projection.value.widgets];
        const index = widgets.findIndex((widget) => widget.instance_id === instanceId);
        if (index >= 0) widgets.splice(index, 1, next);
        else widgets.push(next);
        projection.value = {
          ...projection.value,
          widgets,
          generated_at: result?.projection?.generated_at || new Date().toISOString(),
        };
      }
      widgetRefreshState.value = {
        ...widgetRefreshState.value,
        [instanceId]: { status: 'ready', updated_at: result?.projection?.generated_at || new Date().toISOString() },
      };
      return next;
    } catch (cause) {
      if (controller.signal.aborted || widgetEpochs.get(instanceId) !== widgetEpoch) return undefined;
      const message = cause instanceof Error ? cause.message : String(cause);
      widgetRefreshState.value = {
        ...widgetRefreshState.value,
        [instanceId]: { status: 'error', error: message },
      };
      throw cause;
    } finally {
      if (widgetControllers.get(instanceId) === controller) widgetControllers.delete(instanceId);
    }
  }

  function cancelWidgetRefresh(instanceId: string) {
    widgetEpochs.set(instanceId, (widgetEpochs.get(instanceId) || 0) + 1);
    widgetControllers.get(instanceId)?.abort();
    widgetControllers.delete(instanceId);
    widgetRefreshState.value = {
      ...widgetRefreshState.value,
      [instanceId]: { status: 'idle' },
    };
  }

  function addWidget(profile: MfgCockpitProfile, definitionId: string) {
    const definition = catalog.value.find((item) => item.definition_id === definitionId);
    if (!definition) return;
    const columns = profile.layout.columns || 12;
    const placement = { ...definition.default_placement };
    let placed = false;
    for (let y = 0; y < 128 && !placed; y += 1) {
      for (let x = 0; x <= columns - placement.width; x += 1) {
        const overlaps = profile.widget_instances.some((item) => item.visible !== false
          && x < item.placement.x + item.placement.width
          && x + placement.width > item.placement.x
          && y < item.placement.y + item.placement.height
          && y + placement.height > item.placement.y);
        if (!overlaps) {
          placement.x = x;
          placement.y = y;
          placed = true;
          break;
        }
      }
    }
    const instance: MfgWidgetInstance = {
      instance_id: `webui-${definitionId.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}`,
      definition_id: definition.definition_id,
      placement,
      config: {},
      query: {},
      visible: true,
    };
    profile.widget_instances.push(instance);
  }

  async function commandAlert(occurrence: MfgAlertOccurrence, command: string, until?: string, reason?: string) {
    const authorizationEpoch = requestEpoch.value;
    const payload = {
      command, expected_revision: occurrence.revision,
      ...(until ? { until } : {}),
      ...(reason ? { reason } : {}),
    };
    const intent = createMfgMutationIntent(
      `mfg.alert.${command}`,
      `mfg:alert:${occurrence.occurrence_id}`,
      payload,
      { expectedRevision: occurrence.revision, risk: command === 'escalate' ? 'high' : 'medium' },
    );
    const result = await api.mfgAlertCommand(occurrence.occurrence_id, payload, intent);
    if (authorizationEpoch !== requestEpoch.value) return result;
    const next = result?.occurrence || occurrence;
    const index = alerts.value.findIndex((item) => item.occurrence_id === next.occurrence_id);
    if (index >= 0) alerts.value.splice(index, 1, next);
    return result;
  }

  async function commandAssignment(assignment: MfgAssignment, command: string, targetRef?: string, reason?: string) {
    const authorizationEpoch = requestEpoch.value;
    const payload = {
      command, target_ref: targetRef, expected_revision: assignment.revision,
      ...(reason ? { reason } : {}),
    };
    const intent = createMfgMutationIntent(
      `mfg.assignment.${command}`,
      `mfg:assignment:${assignment.assignment_id}`,
      payload,
      { expectedRevision: assignment.revision, risk: ['transfer', 'unassign', 'escalate', 'start', 'complete'].includes(command) ? 'high' : 'medium' },
    );
    const result = await api.mfgAssignmentCommand(assignment.assignment_id, payload, intent);
    if (authorizationEpoch !== requestEpoch.value) return result;
    const next = result?.assignment || assignment;
    const index = assignments.value.findIndex((item) => item.assignment_id === next.assignment_id);
    if (index >= 0) assignments.value.splice(index, 1, next);
    return result;
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, 250);
  }

  function scheduleAffectedProjectionRefresh() {
    if (projectionRefreshTimer || !selectedProfileId.value) return;
    projectionRefreshTimer = setTimeout(() => {
      projectionRefreshTimer = null;
      void loadProfile(selectedProfileId.value, undefined, activeProjectionFilters.value);
    }, 250);
  }

  function applyLiveSnapshot(state: MfgLiveSnapshotState) {
    profiles.value = collection(state.cockpit, 'profiles').map(profileFrom).filter(Boolean) as MfgCockpitProfile[];
    alertRules.value = collection(state.alerts, 'rules');
    alertSubscriptions.value = collection(state.alerts, 'subscriptions');
    alerts.value = collection(state.alerts, 'occurrences') as MfgAlertOccurrence[];
    assignments.value = collection(state.assignments) as MfgAssignment[];
    incidents.value = collection(state.incidents);
    workflows.value = collection(state.incidents, 'workflows');
    analyses.value = collection(state.incidents, 'analyses');
    memoryCases.value = collection(state.incidents, 'memory_cases');
    playbooks.value = collection(state.incidents, 'playbooks');
    executions.value = collection(state.executions, 'actions');
    skillRuns.value = collection(state.executions, 'skills');
    reports.value = collection(state.reports);
    reviews.value = collection(state.reviews) as MfgReportDeliveryReview[];
    receipts.value = [
      ...collection(state.receipts, 'commands'),
      ...collection(state.receipts, 'mutations'),
    ];
    dataCompute.value = { ...state.data_compute };
    if (!profiles.value.some((profile) => profile.profile_id === selectedProfileId.value)) {
      selectedProfileId.value = profiles.value[0]?.profile_id || '';
      if (!selectedProfileId.value) projection.value = null;
    }
    if (selectedProfileId.value) scheduleAffectedProjectionRefresh();
  }

  function applyLiveEvent(event: MfgLiveEvent) {
    const payload = event.payload || {};
    const upsert = <T extends Record<string, any>>(target: T[], value: T | undefined, id: keyof T) => {
      if (!value || typeof value[id] !== 'string') return;
      const index = target.findIndex((item) => item[id] === value[id]);
      if (index >= 0) target.splice(index, 1, value);
      else target.unshift(value);
    };
    upsert(alertRules.value, payload.rule as any, 'rule_id');
    upsert(alerts.value as any[], payload.occurrence as any, 'occurrence_id');
    upsert(alertSubscriptions.value, payload.subscription as any, 'subscription_id');
    upsert(assignments.value as any[], payload.assignment as any, 'assignment_id');
    upsert(incidents.value, payload.incident as any, 'incident_id');
    upsert(workflows.value, payload.workflow as any, 'workflow_id');
    upsert(analyses.value, payload.analysis as any, 'analysis_id');
    upsert(memoryCases.value, payload.memory_case as any, 'case_id');
    upsert(playbooks.value, payload.playbook as any, 'playbook_id');
    upsert(executions.value, payload.execution as any, 'execution_id');
    upsert(skillRuns.value, payload.skill_run as any, 'execution_id');
    upsert(reports.value, payload.report as any, 'report_id');
    upsert(reviews.value as any[], payload.review as any, 'review_id');
    upsert(receipts.value, payload.receipt as any, 'receipt_id');
    const upsertDataCompute = (key: string, value: any, id: string | string[]) => {
      const keys = Array.isArray(id) ? id : [id];
      if (!value || keys.some((field) => typeof value[field] !== 'string')) return;
      const items = collection(dataCompute.value, key).slice();
      const identity = (item: any) => keys.map((field) => item[field]).join('\u0000');
      const index = items.findIndex((item: any) => identity(item) === identity(value));
      if (index >= 0) items.splice(index, 1, value);
      else items.unshift(value);
      dataCompute.value = { ...dataCompute.value, [key]: items };
    };
    upsertDataCompute('metric_states', payload.metric_state, 'state_id');
    upsertDataCompute('watermarks', payload.watermark, ['source_ref', 'fact_type', 'partition_ref']);
    upsertDataCompute('jobs', payload.job, 'job_id');
    upsertDataCompute('changes', payload.change, 'change_id');
    upsertDataCompute('entities', payload.entity, 'entity_id');
    upsertDataCompute('relations', payload.relation, 'relation_id');
    upsertDataCompute('facts', payload.fact, 'fact_id');
    upsertDataCompute('attention', payload.attention, 'attention_id');
    upsertDataCompute('evidence', payload.evidence, 'packet_id');
    upsertDataCompute('quality_gates', payload.quality_gate, 'gate_id');
    upsertDataCompute('metric_definitions', payload.metric_definition, 'metric_id');
    upsertDataCompute('metric_dependencies', payload.metric_dependency, 'dependency_id');
    upsertDataCompute('metric_snapshots', payload.metric_snapshot, 'snapshot_id');
    upsertDataCompute('source_packs', payload.source_pack, 'source_pack_id');
    upsertDataCompute('connector_runs', payload.connector_run, 'run_id');
    upsertDataCompute('ontology_packs', payload.ontology, 'ontology_id');
    upsertDataCompute('entity_match_candidates', payload.entity_match_candidate, 'candidate_id');
    upsertDataCompute('entity_conflict_decisions', payload.entity_conflict_decision, 'decision_id');
    if ([
      'profile', 'rule', 'subscription', 'occurrence', 'assignment', 'incident', 'workflow',
      'analysis', 'memory_case', 'playbook', 'execution', 'skill_run',
      'report', 'review', 'receipt',
      'entity', 'relation', 'fact', 'attention', 'evidence', 'quality_gate',
      'metric_definition', 'metric_dependency', 'metric_state', 'metric_snapshot',
      'watermark', 'job', 'change', 'source_pack', 'connector_run', 'ontology',
      'entity_match_candidate', 'entity_conflict_decision',
    ].some((field) => payload[field])) {
      scheduleAffectedProjectionRefresh();
    }
    const profile = profileFrom(payload.profile);
    if (profile) upsert(profiles.value as any[], profile as any, 'profile_id');
    if (event.event_type.endsWith('.deleted')) {
      const id = event.subject_ref.split(':').at(-1);
      if (id) {
        profiles.value = profiles.value.filter((item) => item.profile_id !== id);
        alertRules.value = alertRules.value.filter((item) => item.rule_id !== id);
        alerts.value = alerts.value.filter((item) => item.occurrence_id !== id);
        assignments.value = assignments.value.filter((item) => item.assignment_id !== id);
        incidents.value = incidents.value.filter((item) => item.incident_id !== id);
        workflows.value = workflows.value.filter((item) => item.workflow_id !== id);
        analyses.value = analyses.value.filter((item) => item.analysis_id !== id);
        memoryCases.value = memoryCases.value.filter((item) => item.case_id !== id);
        playbooks.value = playbooks.value.filter((item) => item.playbook_id !== id);
        executions.value = executions.value.filter((item) => item.execution_id !== id);
        skillRuns.value = skillRuns.value.filter((item) => item.execution_id !== id);
        reports.value = reports.value.filter((item) => item.report_id !== id);
        reviews.value = reviews.value.filter((item) => item.review_id !== id);
        receipts.value = receipts.value.filter((item) => item.receipt_id !== id);
      }
    }
  }

  function receiveLiveEnvelope(envelope: MfgLiveEnvelope) {
    live.value = envelope;
    if (envelope.kind === 'snapshot') {
      applyLiveSnapshot(envelope.state);
      lastUpdatedAt.value = envelope.generated_at;
    } else if (envelope.kind === 'delta') {
      envelope.events.forEach(applyLiveEvent);
      lastUpdatedAt.value = new Date().toISOString();
    } else if (envelope.kind === 'heartbeat') {
      lastUpdatedAt.value = envelope.generated_at;
    }
  }

  function clearAuthorizedLiveState() {
    requestEpoch.value += 1;
    saveOperationGeneration += 1;
    saving.value = false;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (projectionRefreshTimer) clearTimeout(projectionRefreshTimer);
    refreshTimer = null;
    projectionRefreshTimer = null;
    refreshQueued = false;
    widgetControllers.forEach((controller) => controller.abort());
    widgetControllers.clear();
    widgetEpochs.clear();
    widgetRefreshState.value = {};
    profiles.value = [];
    contract.value = null;
    entitlement.value = null;
    authRequired.value = null;
    catalog.value = [];
    globalFilterSchema.value = undefined;
    filterMergePolicy.value = undefined;
    selectedProfileId.value = '';
    projection.value = null;
    alerts.value = [];
    alertRules.value = [];
    alertSubscriptions.value = [];
    forecasts.value = [];
    assignments.value = [];
    incidents.value = [];
    workflows.value = [];
    analyses.value = [];
    memoryCases.value = [];
    playbooks.value = [];
    executions.value = [];
    skillRuns.value = [];
    reports.value = [];
    reviews.value = [];
    receipts.value = [];
    dataCompute.value = {};
    live.value = null;
    lastReceipt.value = null;
    lastUpdatedAt.value = '';
  }

  function applyLiveTransportState(state: MfgLiveTransportState, transportError?: MfgLiveTransportError) {
    liveStatus.value = state;
    if (transportError) error.value = transportError.message;
    else if (state === 'live') {
      error.value = '';
      liveRecoveryReason.value = null;
    }
    if (
      state === 'stopped'
      && transportError
      && (
        [401, 403].includes(transportError.status)
        || ['authentication_required', 'capability_denied'].includes(transportError.apiError?.code || '')
      )
    ) {
      // The transport never owns the human credential. Release the terminal
      // reader and remove every authorization-derived projection; a product
      // login event will refresh contract/entitlement and create one new
      // consumer.
      liveTransport = null;
      clearAuthorizedLiveState();
      liveRecoveryReason.value = (
        transportError.status === 403
        || transportError.apiError?.code === 'capability_denied'
      ) ? 'forbidden' : 'authentication';
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cowd:mfg-live-authorization-required', {
          detail: {
            status: transportError.status,
            error: transportError.apiError,
          },
        }));
      }
    }
  }

  function recoverLiveAuthorization(signature = 'manual') {
    if (authorizationRecovery) {
      if (signature !== activeRecoverySignature) queuedRecoverySignature = signature;
      return authorizationRecovery;
    }
    activeRecoverySignature = signature;
    const recovery = (async () => {
      let currentSignature = signature;
      do {
        activeRecoverySignature = currentSignature;
        queuedRecoverySignature = '';
        liveTransport?.stop();
        liveTransport = null;
        while (refreshInFlight) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        // An older authorization read may have completed while we waited.
        // Clear once more after it is unable to write, then fetch only under
        // the new request epoch.
        clearAuthorizedLiveState();
        await refresh();
        while (refreshInFlight) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (liveAccessGranted.value) {
          startLive();
        } else {
          liveStatus.value = 'stopped';
          liveRecoveryReason.value = 'forbidden';
          error.value = 'MFG live access requires the mfg.read capability. Replace the current credential or ask an administrator to grant access.';
        }
        currentSignature = queuedRecoverySignature;
      } while (currentSignature);
    })();
    const tracked = recovery.finally(() => {
      if (authorizationRecovery === tracked) {
        authorizationRecovery = null;
        activeRecoverySignature = '';
        queuedRecoverySignature = '';
      }
    });
    authorizationRecovery = tracked;
    return tracked;
  }

  function startLive() {
    if (liveTransport) return;
    if (!liveAccessGranted.value) {
      liveStatus.value = 'stopped';
      liveRecoveryReason.value = 'forbidden';
      error.value = 'MFG live access requires the mfg.read capability. Replace the current credential or ask an administrator to grant access.';
      return;
    }
    liveConsumerGeneration.value += 1;
    liveTransport = new MfgLiveTransport({
      onEnvelope: receiveLiveEnvelope,
      onState: applyLiveTransportState,
    });
    liveTransport.start();
  }

  function stopLive() {
    liveTransport?.stop();
    liveTransport = null;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (projectionRefreshTimer) clearTimeout(projectionRefreshTimer);
    refreshTimer = null;
    projectionRefreshTimer = null;
    refreshQueued = false;
    liveStatus.value = 'stopped';
  }

  return {
    profiles, contract, entitlement, authRequired, catalog, globalFilterSchema, filterMergePolicy, selectedProfileId, projection, alerts, alertRules, alertSubscriptions, forecasts, assignments, incidents, workflows, analyses, memoryCases, playbooks, executions, skillRuns, reports, reviews, receipts, dataCompute, live, lastReceipt, loading, saving, error, liveStatus, lastUpdatedAt, requestEpoch, activeProjectionFilters, widgetRefreshState,
    liveRecoveryReason, liveConsumerGeneration,
    selectedProfile, widgetsByInstance, attentionAlerts, activeAssignments, grantedCapabilities, liveAccessGranted, availableActions,
    refresh, loadProfile, loadForecasts, saveProfile, refreshWidget, cancelWidgetRefresh, addWidget, commandAlert, commandAssignment, receiveLiveEnvelope, clearAuthorizedLiveState, applyLiveTransportState, recoverLiveAuthorization, startLive, stopLive,
  };
});
