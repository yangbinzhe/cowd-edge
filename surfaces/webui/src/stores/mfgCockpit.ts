import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api/client';
import type {
  MfgAlertOccurrence,
  MfgAssignment,
  MfgCockpitProfile,
  MfgCockpitCatalogContract,
  MfgCockpitProjection,
  MfgCockpitWidget,
  MfgLiveProjection,
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

export const useMfgCockpitStore = defineStore('mfg-cockpit', () => {
  let stream: EventSource | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshInFlight = false;
  let refreshQueued = false;
  const profiles = ref<MfgCockpitProfile[]>([]);
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
  const live = ref<MfgLiveProjection | null>(null);
  const lastReceipt = ref<any>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  const liveStatus = ref<'connecting' | 'live' | 'reconnecting' | 'stopped'>('stopped');
  const lastUpdatedAt = ref('');
  const requestEpoch = ref(0);
  const widgetRefreshState = ref<Record<string, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string; updated_at?: string }>>({});

  const selectedProfile = computed(() => profiles.value.find((profile) => profile.profile_id === selectedProfileId.value) || projection.value?.profile || null);
  const widgetsByInstance = computed(() => new Map((projection.value?.widgets || []).map((widget) => [widget.instance_id, widget])));
  const attentionAlerts = computed(() => alerts.value.filter((item) => !['resolved', 'snoozed'].includes(String(item.status))));
  const activeAssignments = computed(() => assignments.value.filter((item) => !['unassigned', 'resolved', 'done'].includes(String(item.status))));

  async function refresh() {
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }
    refreshInFlight = true;
    const epoch = ++requestEpoch.value;
    loading.value = true;
    error.value = '';
    try {
      const [profileResult, catalogResult, ruleResult, alertResult, subscriptionResult, assignmentResult, liveResult] = await Promise.all([
        api.mfgCockpitProfiles(), api.mfgCockpitWidgetCatalog(), api.mfgAlertRules(), api.mfgAlertOccurrences(), api.mfgAlertSubscriptions(), api.mfgAssignments(), api.mfgLive(),
      ]);
      const failure = readError(profileResult, catalogResult, ruleResult, alertResult, subscriptionResult, assignmentResult, liveResult);
      if (failure) throw new Error(failure);
      if (epoch !== requestEpoch.value) return;
      profiles.value = collection(profileResult).map(profileFrom).filter(Boolean) as MfgCockpitProfile[];
      const catalogContract = catalogResult as MfgCockpitCatalogContract;
      catalog.value = collection(catalogContract) as MfgWidgetDefinition[];
      globalFilterSchema.value = catalogContract.global_filter_schema;
      filterMergePolicy.value = catalogContract.filter_merge_policy;
      alertRules.value = collection(ruleResult);
      alerts.value = collection(alertResult) as MfgAlertOccurrence[];
      alertSubscriptions.value = collection(subscriptionResult);
      assignments.value = collection(assignmentResult) as MfgAssignment[];
      live.value = liveResult as MfgLiveProjection;
      if (!profiles.value.some((profile) => profile.profile_id === selectedProfileId.value)) {
        selectedProfileId.value = profiles.value[0]?.profile_id || '';
        if (!selectedProfileId.value) projection.value = null;
      }
      if (selectedProfileId.value) await loadProfile(selectedProfileId.value, epoch);
      if (epoch !== requestEpoch.value) return;
      await loadForecasts();
      if (epoch !== requestEpoch.value) return;
      lastUpdatedAt.value = new Date().toISOString();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
      refreshInFlight = false;
      if (refreshQueued) {
        refreshQueued = false;
        scheduleRefresh();
      }
    }
  }

  async function loadProfile(profileId: string, inheritedEpoch?: number) {
    const epoch = inheritedEpoch ?? ++requestEpoch.value;
    error.value = '';
    try {
      selectedProfileId.value = profileId;
      const [profileResult, projectionResult] = await Promise.all([
        api.mfgCockpitProfile(profileId), api.mfgCockpitProjection(profileId),
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
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
  }

  async function loadForecasts(metricRefs?: string[]) {
    const refs = metricRefs || selectedProfile.value?.focus_metric_ids || [];
    const result = await api.mfgForecasts(refs);
    const failure = readError(result);
    if (failure) throw new Error(failure);
    forecasts.value = collection(result);
  }

  async function saveProfile(profile: MfgCockpitProfile) {
    saving.value = true;
    error.value = '';
    try {
      const result = await api.mfgUpsertProfile({
        ...profile,
        expected_revision: profiles.value.some((item) => item.profile_id === profile.profile_id) ? profile.revision : undefined,
        owner_ref: profile.owner_ref || 'webui',
      });
      const next = profileFrom(result);
      if (!next) throw new Error('mfg.cockpit.invalid_profile_response');
      lastReceipt.value = result?.receipt || null;
      selectedProfileId.value = next.profile_id;
      const index = profiles.value.findIndex((item) => item.profile_id === next.profile_id);
      if (index >= 0) profiles.value.splice(index, 1, next);
      else profiles.value.unshift(next);
      await loadProfile(next.profile_id);
      return next;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  async function refreshWidget(instanceId: string) {
    const profileId = selectedProfileId.value;
    if (!profileId) throw new Error('mfg.cockpit.profile_required');
    widgetRefreshState.value = {
      ...widgetRefreshState.value,
      [instanceId]: { status: 'loading' },
    };
    try {
      const result = await api.mfgCockpitWidgetProjection(profileId, instanceId);
      if (result?.__state && result.__state !== 'ready') {
        throw new Error(String(result.__error || result.__state));
      }
      const failure = readError(result);
      if (failure) throw new Error(failure);
      const next = (result?.projection?.widget || result?.widget) as MfgCockpitWidget | undefined;
      if (!next?.instance_id) throw new Error('mfg.cockpit.invalid_widget_projection_response');
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
      const message = cause instanceof Error ? cause.message : String(cause);
      widgetRefreshState.value = {
        ...widgetRefreshState.value,
        [instanceId]: { status: 'error', error: message },
      };
      throw cause;
    }
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

  async function commandAlert(occurrence: MfgAlertOccurrence, command: string, until?: string) {
    const result = await api.mfgAlertCommand(occurrence.occurrence_id, {
      command, expected_revision: occurrence.revision, idempotency_key: `webui-alert-${occurrence.occurrence_id}-${occurrence.revision}-${command}`,
      ...(until ? { until } : {}),
    });
    const next = result?.occurrence || occurrence;
    const index = alerts.value.findIndex((item) => item.occurrence_id === next.occurrence_id);
    if (index >= 0) alerts.value.splice(index, 1, next);
    return result;
  }

  async function commandAssignment(assignment: MfgAssignment, command: string, targetRef?: string) {
    const result = await api.mfgAssignmentCommand(assignment.assignment_id, {
      command, target_ref: targetRef, expected_revision: assignment.revision,
      idempotency_key: `webui-assignment-${assignment.assignment_id}-${assignment.revision}-${command}`,
    });
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

  function startLive() {
    if (stream || typeof EventSource === 'undefined') return;
    liveStatus.value = 'connecting';
    const cursor = live.value?.cursor;
    stream = new EventSource(`/api/apps/mfg/live${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`);
    const receive = (event: MessageEvent) => {
      try {
        live.value = JSON.parse(event.data) as MfgLiveProjection;
        liveStatus.value = 'live';
        scheduleRefresh();
      } catch {
        liveStatus.value = 'reconnecting';
      }
    };
    stream.addEventListener('mfg_snapshot', receive);
    stream.addEventListener('mfg_delta', receive);
    stream.addEventListener('mfg_resync', receive);
    stream.onerror = () => { liveStatus.value = 'reconnecting'; };
  }

  function stopLive() {
    stream?.close();
    stream = null;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    refreshQueued = false;
    liveStatus.value = 'stopped';
  }

  return {
    profiles, catalog, globalFilterSchema, filterMergePolicy, selectedProfileId, projection, alerts, alertRules, alertSubscriptions, forecasts, assignments, live, lastReceipt, loading, saving, error, liveStatus, lastUpdatedAt, requestEpoch, widgetRefreshState,
    selectedProfile, widgetsByInstance, attentionAlerts, activeAssignments,
    refresh, loadProfile, loadForecasts, saveProfile, refreshWidget, addWidget, commandAlert, commandAssignment, startLive, stopLive,
  };
});
