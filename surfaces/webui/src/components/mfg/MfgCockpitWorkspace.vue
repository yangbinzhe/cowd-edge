<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Copy, Grip, LayoutGrid, Maximize2, Plus, Redo2, RefreshCw, RotateCw, Save, Settings2, Share2, Trash2, Undo2 } from 'lucide-vue-next';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import { api, ApiWriteError } from '../../api/client';
import { t } from '../../i18n';
import { useMfgCockpitStore } from '../../stores/mfgCockpit';
import { createMfgMutationIntent } from '../../stores/mutationIntents';
import type { MfgCockpitProfile, MfgJsonSchema, MfgWidgetDefinition, MfgWidgetInstance } from '../../types/mfg';
import RequestReceipt from '../workbench/RequestReceipt.vue';

const cockpit = useMfgCockpitStore();
const route = useRoute();
const router = useRouter();
const editMode = ref(false);
const newWidgetId = ref('');
const working = ref<MfgCockpitProfile | null>(null);
const baseProfile = ref<MfgCockpitProfile | null>(null);
const shareVisibility = ref('private');
const shareViewers = ref('');
const shareEditors = ref('');
const undoStack = ref<MfgCockpitProfile[]>([]);
const redoStack = ref<MfgCockpitProfile[]>([]);
const conflict = ref<{
  code: string;
  expected?: number;
  actual?: number;
  draft: MfgCockpitProfile;
  remote: MfgCockpitProfile | null;
} | null>(null);
const operationError = ref('');
const receipt = ref<any>(null);
const gridEl = ref<HTMLElement | null>(null);
const openWidgetSettings = ref<Record<string, boolean>>({});
const dragState = ref<{
  mode: 'move' | 'resize';
  instance: MfgWidgetInstance;
  startX: number;
  startY: number;
  initial: MfgWidgetInstance['placement'];
} | null>(null);

function copyProfile(profile: MfgCockpitProfile | null) {
  return profile ? JSON.parse(JSON.stringify(profile)) as MfgCockpitProfile : null;
}

function queryString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

const cockpitFilterQueryKeys: Record<string, string> = {
  entity_refs: 'entity',
  metric_ids: 'metric',
  severities: 'severity',
  statuses: 'status',
  from: 'from',
  to: 'to',
};

function cockpitQuery(profile: MfgCockpitProfile | null, widgetId?: string, focus?: string): LocationQueryRaw {
  const query: LocationQueryRaw = {
    ...route.query,
    profile: profile?.profile_id || undefined,
    widget: widgetId || undefined,
    focus: focus || queryString(route.query.focus) || undefined,
  };
  for (const [filterKey, queryKey] of Object.entries(cockpitFilterQueryKeys)) {
    const value = profile?.global_filters?.[filterKey];
    query[queryKey] = Array.isArray(value)
      ? value.join(',') || undefined
      : typeof value === 'string' ? value || undefined : undefined;
  }
  return query;
}

async function syncCockpitUrl(profile = working.value, widgetId = queryString(route.query.widget)) {
  await router.replace({ query: cockpitQuery(profile, widgetId) });
}

watch(() => cockpit.selectedProfile, (profile) => {
  if (editMode.value && profile?.profile_id === working.value?.profile_id) return;
  working.value = copyProfile(profile);
  baseProfile.value = copyProfile(profile);
  shareVisibility.value = profile?.sharing_policy?.visibility || 'private';
  shareViewers.value = (profile?.sharing_policy?.viewer_refs || []).join(', ');
  shareEditors.value = (profile?.sharing_policy?.editor_refs || []).join(', ');
  const requestedProfile = queryString(route.query.profile);
  const requestedExists = cockpit.profiles.some((item) => item.profile_id === requestedProfile);
  if (profile && (!requestedProfile || !requestedExists)) void syncCockpitUrl(profile, '');
}, { immediate: true });

watch(
  [() => queryString(route.query.widget), () => working.value?.profile_id, () => working.value?.widget_instances.length],
  ([widgetId]) => {
    const requestedProfile = queryString(route.query.profile);
    if (requestedProfile && requestedProfile !== working.value?.profile_id) return;
    const exists = Boolean(widgetId && working.value?.widget_instances.some((widget) => widget.instance_id === widgetId));
    openWidgetSettings.value = exists ? { [widgetId]: true } : {};
  },
  { immediate: true },
);

const displayedWidgets = computed(() => (working.value?.widget_instances || []).filter((widget) => editMode.value || widget.visible !== false));
const definitionOptions = computed(() => cockpit.catalog);
const isDirty = computed(() => JSON.stringify(working.value) !== JSON.stringify(baseProfile.value));
const layoutConflicts = computed(() => {
  const widgets = displayedWidgets.value.filter((widget) => widget.visible !== false);
  const conflicts = new Set<string>();
  for (let index = 0; index < widgets.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < widgets.length; otherIndex += 1) {
      const left = widgets[index];
      const right = widgets[otherIndex];
      const overlaps = left.placement.x < right.placement.x + right.placement.width
        && left.placement.x + left.placement.width > right.placement.x
        && left.placement.y < right.placement.y + right.placement.height
        && left.placement.y + left.placement.height > right.placement.y;
      if (overlaps) {
        conflicts.add(left.instance_id);
        conflicts.add(right.instance_id);
      }
    }
  }
  return conflicts;
});
const canManageCockpit = computed(() => cockpit.grantedCapabilities.has('mfg.cockpit.manage'));
const conflictDifferences = computed(() => {
  if (!conflict.value?.remote) return [];
  const keys: Array<keyof MfgCockpitProfile> = ['display_name', 'focus_refs', 'focus_metric_ids', 'thresholds', 'scope', 'template_id', 'global_filters', 'layout', 'widget_instances', 'sharing_policy'];
  return keys.filter((key) => JSON.stringify(conflict.value?.draft[key]) !== JSON.stringify(conflict.value?.remote?.[key]));
});

function conflictValue(profile: MfgCockpitProfile, key: keyof MfgCockpitProfile) {
  const value = JSON.stringify(profile[key]);
  if (!value) return '—';
  return value.length > 180 ? `${value.slice(0, 180)}…` : value;
}

function conflictRemoteValue(key: keyof MfgCockpitProfile) {
  return conflict.value?.remote ? conflictValue(conflict.value.remote, key) : '—';
}
const liveLabel = computed(() => ({
  connecting: t('mfg.live.connecting'),
  live: t('mfg.live.live'),
  reconnecting: t('mfg.live.reconnecting'),
  stopped: t('mfg.live.stopped'),
}[cockpit.liveStatus]));

function commaList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function rememberEdit() {
  if (!working.value) return;
  undoStack.value.push(copyProfile(working.value)!);
  if (undoStack.value.length > 32) undoStack.value.shift();
  redoStack.value = [];
}

function undo() {
  if (!working.value || !undoStack.value.length) return;
  redoStack.value.push(copyProfile(working.value)!);
  working.value = undoStack.value.pop() || working.value;
}

function redo() {
  if (!working.value || !redoStack.value.length) return;
  undoStack.value.push(copyProfile(working.value)!);
  working.value = redoStack.value.pop() || working.value;
}

function revert() {
  working.value = copyProfile(cockpit.selectedProfile);
  baseProfile.value = copyProfile(cockpit.selectedProfile);
  undoStack.value = [];
  redoStack.value = [];
  conflict.value = null;
  void syncCockpitUrl(working.value);
}

async function selectProfile(event: Event) {
  try {
    await cockpit.loadProfile((event.target as HTMLSelectElement).value);
    openWidgetSettings.value = {};
    await syncCockpitUrl(cockpit.selectedProfile, '');
  }
  catch { /* store error is rendered by the workspace shell */ }
}

function createProfile() {
  if (!canManageCockpit.value) return;
  const now = new Date().toISOString();
  working.value = {
    profile_id: `cockpit-profile-${Date.now()}`,
    owner_ref: '',
    display_name: t('mfg.cockpit.newProfile'),
    focus_refs: [],
    focus_metric_ids: [],
    thresholds: {},
    cadence: 'daily',
    revision: 1,
    scope: { kind: 'personal' },
    layout: { columns: 12, row_height: 72, gap: 12 },
    global_filters: {},
    widget_instances: [],
    sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] },
    created_at: now,
    updated_at: now,
  } as MfgCockpitProfile;
  undoStack.value = [];
  redoStack.value = [];
  baseProfile.value = null;
  conflict.value = null;
  editMode.value = true;
  void router.replace({ query: cockpitQuery(null) });
}

function addWidget() {
  if (!working.value || !newWidgetId.value) return;
  rememberEdit();
  cockpit.addWidget(working.value, newWidgetId.value);
  newWidgetId.value = '';
}

function removeWidget(instanceId: string) {
  if (!working.value) return;
  rememberEdit();
  working.value.widget_instances = working.value.widget_instances.filter((widget) => widget.instance_id !== instanceId);
}

function toggleWidgetVisibility(instance: MfgWidgetInstance) {
  rememberEdit();
  instance.visible = instance.visible === false;
}

function moveWidget(instance: MfgWidgetInstance, axis: 'x' | 'y', direction: number) {
  rememberEdit();
  const limit = axis === 'x' ? Math.max(0, (working.value?.layout.columns || 12) - instance.placement.width) : 64;
  instance.placement[axis] = Math.min(limit, Math.max(0, instance.placement[axis] + direction));
}

function resizeWidget(instance: MfgWidgetInstance, axis: 'width' | 'height', direction: number) {
  rememberEdit();
  const definition = definitionFor(instance);
  const minimum = axis === 'width' ? definition?.min_width || 1 : definition?.min_height || 1;
  const catalogMax = axis === 'width' ? definition?.max_width || 12 : definition?.max_height || 12;
  const gridMax = axis === 'width' ? (working.value?.layout.columns || 12) - instance.placement.x : 128;
  instance.placement[axis] = Math.min(catalogMax, gridMax, Math.max(minimum, instance.placement[axis] + direction));
}

function beginDirectManipulation(event: PointerEvent, instance: MfgWidgetInstance, mode: 'move' | 'resize') {
  if (!editMode.value || !gridEl.value) return;
  event.preventDefault();
  rememberEdit();
  dragState.value = {
    mode,
    instance,
    startX: event.clientX,
    startY: event.clientY,
    initial: { ...instance.placement },
  };
  window.addEventListener('pointermove', directManipulationMove);
  window.addEventListener('pointerup', endDirectManipulation, { once: true });
}

function directManipulationMove(event: PointerEvent) {
  const drag = dragState.value;
  const grid = gridEl.value;
  if (!drag || !grid || !working.value) return;
  const columns = working.value.layout.columns || 12;
  const gap = working.value.layout.gap || 12;
  const columnWidth = Math.max(1, (grid.clientWidth - gap * (columns - 1)) / columns);
  const rowHeight = 46 + gap;
  const dx = Math.round((event.clientX - drag.startX) / (columnWidth + gap));
  const dy = Math.round((event.clientY - drag.startY) / rowHeight);
  if (drag.mode === 'move') {
    drag.instance.placement.x = Math.max(0, Math.min(columns - drag.initial.width, drag.initial.x + dx));
    drag.instance.placement.y = Math.max(0, drag.initial.y + dy);
    return;
  }
  const definition = definitionFor(drag.instance);
  drag.instance.placement.width = Math.max(
    definition?.min_width || 1,
    Math.min(definition?.max_width || columns, columns - drag.initial.x, drag.initial.width + dx),
  );
  drag.instance.placement.height = Math.max(
    definition?.min_height || 1,
    Math.min(definition?.max_height || 12, drag.initial.height + dy),
  );
}

function endDirectManipulation() {
  window.removeEventListener('pointermove', directManipulationMove);
  window.removeEventListener('pointerup', endDirectManipulation);
  dragState.value = null;
}

onBeforeUnmount(endDirectManipulation);

function definitionFor(instance: MfgWidgetInstance): MfgWidgetDefinition | undefined {
  return cockpit.catalog.find((definition) => definition.definition_id === instance.definition_id);
}

function schemaFields(schema?: MfgJsonSchema) {
  return Object.entries(schema?.properties || {}).map(([key, value]) => ({ key, schema: value }));
}

function schemaInputValue(instance: MfgWidgetInstance, scope: 'config' | 'query', key: string) {
  const value = instance[scope]?.[key];
  return Array.isArray(value) ? value.join(', ') : value ?? '';
}

function updateSchemaValue(instance: MfgWidgetInstance, scope: 'config' | 'query', key: string, schema: MfgJsonSchema, event: Event) {
  rememberEdit();
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const container = { ...(instance[scope] || {}) };
  let value: unknown = target.value;
  if (schema.type === 'integer' || schema.type === 'number') value = Number(target.value);
  else if (schema.type === 'boolean') value = target.value === 'true';
  else if (schema.type === 'array') value = commaList(target.value);
  if (target.value === '') delete container[key];
  else container[key] = value;
  instance[scope] = container;
  void syncCockpitUrl(working.value, instance.instance_id);
}

function globalFilterValue(key: string) {
  const value = working.value?.global_filters?.[key];
  return Array.isArray(value) ? value.join(', ') : value ?? '';
}

function thresholdValue(metricId: string) {
  const value = working.value?.thresholds?.[metricId];
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'critical' in value) return Number((value as Record<string, unknown>).critical);
  return '';
}

function updateThreshold(metricId: string, event: Event) {
  if (!working.value) return;
  rememberEdit();
  const target = event.target as HTMLInputElement;
  const thresholds = { ...(working.value.thresholds || {}) };
  if (!target.value) delete thresholds[metricId];
  else thresholds[metricId] = { critical: Number(target.value) };
  working.value.thresholds = thresholds;
}

function updateGlobalFilter(key: string, schema: MfgJsonSchema, event: Event) {
  if (!working.value) return;
  rememberEdit();
  const target = event.target as HTMLInputElement;
  const filters = { ...(working.value.global_filters || {}) };
  if (!target.value) delete filters[key];
  else filters[key] = schema.type === 'array' ? commaList(target.value) : target.value;
  working.value.global_filters = filters;
  void syncCockpitUrl(working.value);
}

function toggleWidgetSettings(instanceId: string) {
  const next = !openWidgetSettings.value[instanceId];
  openWidgetSettings.value = next ? { [instanceId]: true } : {};
  void syncCockpitUrl(working.value, next ? instanceId : '');
}

function parseConflict(cause: unknown) {
  if (!(cause instanceof ApiWriteError) || cause.status !== 409) return null;
  return {
    code: cause.code,
    details: cause.details || {},
  };
}

function profileFromResponse(value: any): MfgCockpitProfile | null {
  const profile = value?.profile || value?.projection?.profile || value;
  return typeof profile?.profile_id === 'string' ? profile as MfgCockpitProfile : null;
}

async function save() {
  if (!working.value || !canManageCockpit.value) return;
  operationError.value = '';
  if (working.value.scope.kind === 'personal') working.value.scope.scope_ref = null;
  working.value.sharing_policy = {
    visibility: shareVisibility.value,
    viewer_refs: commaList(shareViewers.value),
    editor_refs: commaList(shareEditors.value),
  };
  try {
    const saved = await cockpit.saveProfile(working.value);
    receipt.value = cockpit.lastReceipt;
    working.value = copyProfile(saved);
    baseProfile.value = copyProfile(saved);
    editMode.value = false;
    undoStack.value = [];
    redoStack.value = [];
    conflict.value = null;
    await syncCockpitUrl(saved);
  } catch (cause) {
    const payload = parseConflict(cause);
    if ((payload?.code === 'revision_conflict'
      || payload?.code === 'mfg_revision_conflict'
      || payload?.details?.legacy_code === 'mfg_revision_conflict') && working.value) {
      const draft = copyProfile(working.value)!;
      const remoteResult = await api.mfgCockpitProfile(working.value.profile_id);
      conflict.value = {
        code: payload.code,
        expected: payload.details?.expected_revision,
        actual: payload.details?.actual_revision,
        draft,
        remote: profileFromResponse(remoteResult),
      };
    } else {
      operationError.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
}

async function reloadLatest() {
  if (!conflict.value) return;
  if (!conflict.value.remote) {
    await cockpit.loadProfile(conflict.value.draft.profile_id);
    working.value = copyProfile(cockpit.selectedProfile);
  } else {
    working.value = copyProfile(conflict.value.remote);
  }
  baseProfile.value = copyProfile(working.value);
  conflict.value = null;
  undoStack.value = [];
  redoStack.value = [];
  await syncCockpitUrl(working.value);
}

async function saveAsCopy() {
  const source = conflict.value?.draft || working.value;
  if (!source) return;
  const copy = copyProfile(source)!;
  const now = new Date().toISOString();
  copy.profile_id = `cockpit-profile-${Date.now()}`;
  copy.display_name = `${copy.display_name} · ${t('mfg.cockpit.copySuffix')}`;
  copy.revision = 1;
  copy.created_at = now;
  copy.updated_at = now;
  working.value = copy;
  baseProfile.value = null;
  conflict.value = null;
  await save();
}

async function retryWidget(instanceId: string) {
  operationError.value = '';
  try {
    await cockpit.refreshWidget(instanceId);
    await syncCockpitUrl(working.value, instanceId);
  }
  catch (cause) { operationError.value = cause instanceof Error ? cause.message : String(cause); }
}

function cancelWidgetRefresh(instanceId: string) {
  cockpit.cancelWidgetRefresh(instanceId);
}

async function cloneProfile() {
  if (!cockpit.selectedProfile || !canManageCockpit.value) return;
  operationError.value = '';
  try {
    const payload = {};
    const intent = createMfgMutationIntent(
      'mfg.cockpit.profile.clone',
      `mfg:cockpit-profile:${cockpit.selectedProfile.profile_id}`,
      payload,
      { risk: 'medium' },
    );
    receipt.value = await api.mfgCloneCockpitProfile(cockpit.selectedProfile.profile_id, payload, intent);
    await cockpit.refresh();
  } catch (cause) { operationError.value = cause instanceof Error ? cause.message : String(cause); }
}

async function shareProfile() {
  if (!cockpit.selectedProfile || !canManageCockpit.value) return;
  if (!window.confirm(`${cockpit.selectedProfile.profile_id} @ revision ${cockpit.selectedProfile.revision}`)) return;
  operationError.value = '';
  try {
    const payload = {
      expected_revision: cockpit.selectedProfile.revision,
      sharing_policy: { visibility: shareVisibility.value, viewer_refs: commaList(shareViewers.value), editor_refs: commaList(shareEditors.value) },
    };
    const intent = createMfgMutationIntent(
      'mfg.cockpit.profile.share',
      `mfg:cockpit-profile:${cockpit.selectedProfile.profile_id}`,
      payload,
      { expectedRevision: cockpit.selectedProfile.revision, risk: 'high' },
    );
    receipt.value = await api.mfgShareCockpitProfile(cockpit.selectedProfile.profile_id, payload, intent);
    await cockpit.loadProfile(cockpit.selectedProfile.profile_id);
  } catch (cause) { operationError.value = cause instanceof Error ? cause.message : String(cause); }
}

async function deleteProfile() {
  if (!cockpit.selectedProfile || !canManageCockpit.value) return;
  if (!window.confirm(`${cockpit.selectedProfile.profile_id} @ revision ${cockpit.selectedProfile.revision}`)) return;
  operationError.value = '';
  try {
    const intent = createMfgMutationIntent(
      'mfg.cockpit.profile.delete',
      `mfg:cockpit-profile:${cockpit.selectedProfile.profile_id}`,
      { expected_revision: cockpit.selectedProfile.revision },
      { expectedRevision: cockpit.selectedProfile.revision, risk: 'high' },
    );
    receipt.value = await api.mfgDeleteCockpitProfile(
      cockpit.selectedProfile.profile_id,
      cockpit.selectedProfile.revision,
      intent,
    );
    cockpit.selectedProfileId = '';
    await cockpit.refresh();
    await syncCockpitUrl(cockpit.selectedProfile, '');
  } catch (cause) { operationError.value = cause instanceof Error ? cause.message : String(cause); }
}

function widgetData(instance: MfgWidgetInstance) {
  return cockpit.widgetsByInstance.get(instance.instance_id);
}

function widgetFreshness(instance: MfgWidgetInstance) {
  return widgetData(instance)?.freshness as Record<string, unknown> | null | undefined;
}

function workflowIncidentId(sourceRef: string, instanceId: string) {
  if (!sourceRef.startsWith('mfg:workflow:')) return '';
  const instance = working.value?.widget_instances.find((item) => item.instance_id === instanceId);
  if (!instance) return '';
  const workflowId = sourceRef.slice('mfg:workflow:'.length);
  const data = widgetData(instance)?.data as any;
  const match = Array.isArray(data?.items)
    ? data.items.find((item: any) => String(item?.workflow_id) === workflowId)
    : null;
  return String(match?.incident_id || '');
}

function sourceHref(sourceRef: string, instanceId: string) {
  const query = cockpitQuery(working.value, instanceId, sourceRef);
  query.return_section = 'dashboard';
  if (sourceRef.startsWith('matrix:')) return { path: '/reality', query: { ...query, section: 'matrix' } };
  if (sourceRef.startsWith('mfg:incident:')) {
    return {
      path: '/apps/mfg',
      query: { ...query, section: 'operations', incident: sourceRef.slice('mfg:incident:'.length) },
    };
  }
  if (sourceRef.startsWith('mfg:workflow:')) {
    return {
      path: '/apps/mfg',
      query: { ...query, section: 'collaboration', incident: workflowIncidentId(sourceRef, instanceId) || undefined },
    };
  }
  if (sourceRef.startsWith('mfg:cockpit-profile:')) {
    return { path: '/apps/mfg', query: { ...query, section: 'reports' } };
  }
  return { path: '/audit', query };
}

function compactWidgetValue(instance: MfgWidgetInstance) {
  const data = widgetData(instance)?.data || {};
  const count = Number((data as any).count ?? (data as any).active_count ?? 0);
  if (Number.isFinite(count) && count) return String(count);
  return String((data as any).status || (data as any).summary || '—');
}
</script>

<template>
  <section class="mfg-cockpit" :aria-label="t('mfg.cockpit.aria')">
    <header class="mfg-cockpit__header">
      <div>
        <h2>{{ working?.display_name || t('mfg.cockpit.title') }}</h2>
        <p>{{ cockpit.projection?.summary || t('mfg.cockpit.emptySummary') }}</p>
      </div>
      <div class="mfg-cockpit__actions">
        <span class="mfg-live-state" :data-status="cockpit.liveStatus">{{ liveLabel }}</span>
        <button class="ghost-action" type="button" :disabled="!canManageCockpit" @click="createProfile"><Plus :size="15" />{{ t('mfg.cockpit.new') }}</button>
        <button class="ghost-action" type="button" :disabled="!cockpit.selectedProfile || !canManageCockpit" @click="cloneProfile"><Copy :size="15" />{{ t('mfg.cockpit.clone') }}</button>
        <button class="ghost-action" type="button" :disabled="!cockpit.selectedProfile || !canManageCockpit" @click="deleteProfile"><Trash2 :size="15" />{{ t('mfg.cockpit.delete') }}</button>
        <button class="primary-action" type="button" :disabled="!working || !canManageCockpit" @click="editMode = !editMode"><Settings2 :size="15" />{{ editMode ? t('mfg.cockpit.closeEdit') : t('mfg.cockpit.edit') }}</button>
      </div>
    </header>
    <p v-if="operationError" class="settings-alert">{{ operationError }}</p>
    <RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" />

    <div class="mfg-cockpit__toolbar">
      <label>
        <span>{{ t('mfg.cockpit.profile') }}</span>
        <select :value="cockpit.selectedProfileId" @change="selectProfile">
          <option v-for="profile in cockpit.profiles" :key="profile.profile_id" :value="profile.profile_id">{{ profile.display_name }}</option>
        </select>
      </label>
      <span v-if="working" class="mfg-revision">{{ t('mfg.cockpit.revision', { revision: working.revision }) }}</span>
      <span v-if="editMode" class="mfg-dirty" :data-dirty="isDirty">{{ isDirty ? t('mfg.cockpit.unsaved') : t('mfg.cockpit.saved') }}</span>
      <span v-if="cockpit.projection?.generated_at" class="mfg-freshness">{{ cockpit.projection.generated_at }}</span>
    </div>

    <form v-if="editMode && working" class="mfg-cockpit__editor" @submit.prevent="save">
      <label><span>{{ t('mfg.cockpit.name') }}</span><input v-model="working.display_name" required @focus="rememberEdit" /></label>
      <label><span>{{ t('mfg.cockpit.template') }}</span><input v-model="working.template_id" @focus="rememberEdit" /></label>
      <label><span>{{ t('mfg.cockpit.scopeKind') }}</span><select v-model="working.scope.kind" @focus="rememberEdit"><option value="personal">personal</option><option value="team">team</option><option value="role">role</option><option value="organization">organization</option></select></label>
      <label v-if="working.scope.kind !== 'personal'"><span>{{ t('mfg.cockpit.scopeRef') }}</span><input v-model="working.scope.scope_ref" required @focus="rememberEdit" /></label>
      <label><span>{{ t('mfg.cockpit.metrics') }}</span><input :value="working.focus_metric_ids.join(', ')" @focus="rememberEdit" @input="working.focus_metric_ids = commaList(($event.target as HTMLInputElement).value)" /></label>
      <label><span>{{ t('mfg.cockpit.entities') }}</span><input :value="working.focus_refs.join(', ')" @focus="rememberEdit" @input="working.focus_refs = commaList(($event.target as HTMLInputElement).value)" /></label>
      <label><span>{{ t('mfg.cockpit.cadence') }}</span><select v-model="working.cadence" @focus="rememberEdit"><option value="daily">daily</option><option value="weekly">weekly</option><option value="on_demand">{{ t('mfg.cockpit.cadence.onDemand') }}</option></select></label>
      <fieldset v-if="working.focus_metric_ids.length" class="mfg-cockpit__thresholds">
        <legend>{{ t('mfg.cockpit.thresholds') }}</legend>
        <label v-for="metricId in working.focus_metric_ids" :key="metricId"><span>{{ metricId }}</span><input type="number" step="any" :value="thresholdValue(metricId)" :placeholder="t('mfg.cockpit.criticalThreshold')" @change="updateThreshold(metricId, $event)" /></label>
      </fieldset>
      <fieldset v-if="schemaFields(cockpit.globalFilterSchema).length" class="mfg-cockpit__filters">
        <legend>{{ t('mfg.cockpit.globalFilters') }}</legend>
        <label v-for="field in schemaFields(cockpit.globalFilterSchema)" :key="field.key">
          <span>{{ field.key }}</span>
          <input :value="globalFilterValue(field.key)" :placeholder="field.schema.items?.enum?.join(', ') || ''" @change="updateGlobalFilter(field.key, field.schema, $event)" />
        </label>
        <p v-if="cockpit.filterMergePolicy?.semantics">{{ cockpit.filterMergePolicy.semantics }}</p>
      </fieldset>
      <div class="mfg-cockpit__add-widget">
        <LayoutGrid :size="15" />
        <select v-model="newWidgetId"><option value="">{{ t('mfg.cockpit.addWidget') }}</option><option v-for="definition in definitionOptions" :key="definition.definition_id" :value="definition.definition_id">{{ definition.title }}</option></select>
        <button class="ghost-action" type="button" :disabled="!newWidgetId" @click="addWidget"><Plus :size="15" />{{ t('mfg.cockpit.add') }}</button>
      </div>
      <fieldset class="mfg-cockpit__sharing">
        <legend>{{ t('mfg.cockpit.sharing') }}</legend>
        <label><span>{{ t('mfg.cockpit.visibility') }}</span><select v-model="shareVisibility"><option value="private">private</option><option value="team">team</option><option value="public">public</option></select></label>
        <label><span>{{ t('mfg.cockpit.viewers') }}</span><input v-model="shareViewers" /></label>
        <label><span>{{ t('mfg.cockpit.editors') }}</span><input v-model="shareEditors" /></label>
        <button class="ghost-action" type="button" :disabled="!canManageCockpit" @click="shareProfile"><Share2 :size="15" />{{ t('mfg.cockpit.saveSharing') }}</button>
      </fieldset>
      <p v-if="layoutConflicts.size" class="mfg-widget__error mfg-cockpit__layout-error">{{ t('mfg.cockpit.layoutConflict', { count: layoutConflicts.size }) }}</p>
      <button class="primary-action" type="submit" :disabled="!canManageCockpit || cockpit.saving || layoutConflicts.size > 0"><Save :size="15" />{{ t('mfg.cockpit.save') }}</button>
      <div class="mfg-cockpit__history"><button class="ghost-action" type="button" :disabled="!undoStack.length" @click="undo"><Undo2 :size="15" />{{ t('mfg.cockpit.undo') }}</button><button class="ghost-action" type="button" :disabled="!redoStack.length" @click="redo"><Redo2 :size="15" />{{ t('mfg.cockpit.redo') }}</button><button class="ghost-action" type="button" @click="revert"><RefreshCw :size="15" />{{ t('mfg.cockpit.revert') }}</button></div>
      <section v-if="conflict" class="mfg-cockpit__conflict" role="alert">
        <strong>{{ t('mfg.cockpit.conflict') }}</strong>
        <p>{{ t('mfg.cockpit.conflictRevisions', { expected: conflict.expected ?? '—', actual: conflict.actual ?? '—' }) }}</p>
        <p v-if="conflict.remote">{{ t('mfg.cockpit.conflictFields', { fields: conflictDifferences.join(', ') || '—' }) }}</p>
        <p v-else>{{ t('mfg.cockpit.conflictRemoteUnavailable') }}</p>
        <div v-if="conflict.remote && conflictDifferences.length" class="mfg-cockpit__conflict-compare">
          <div class="mfg-cockpit__compare-head"><strong>{{ t('mfg.cockpit.compareField') }}</strong><strong>{{ t('mfg.cockpit.compareDraft') }}</strong><strong>{{ t('mfg.cockpit.compareRemote') }}</strong></div>
          <div v-for="field in conflictDifferences" :key="field" class="mfg-cockpit__compare-row"><code>{{ field }}</code><span>{{ conflictValue(conflict.draft, field) }}</span><span>{{ conflictRemoteValue(field) }}</span></div>
        </div>
        <div>
          <button class="ghost-action" type="button" @click="reloadLatest"><RefreshCw :size="14" />{{ t('mfg.cockpit.reloadLatest') }}</button>
          <button class="primary-action" type="button" @click="saveAsCopy"><Copy :size="14" />{{ t('mfg.cockpit.saveAs') }}</button>
        </div>
      </section>
    </form>

    <div v-if="working" ref="gridEl" class="mfg-cockpit__grid" :style="{ gridTemplateColumns: `repeat(${working.layout.columns || 12}, minmax(0, 1fr))`, gap: `${working.layout.gap || 12}px` }">
      <article v-for="instance in displayedWidgets" :key="instance.instance_id" class="mfg-widget" :class="{ 'has-layout-conflict': layoutConflicts.has(instance.instance_id), 'is-manipulating': dragState?.instance.instance_id === instance.instance_id, 'is-hidden-widget': instance.visible === false, 'is-url-focus': route.query.widget === instance.instance_id }" :data-status="['loading', 'error'].includes(cockpit.widgetRefreshState[instance.instance_id]?.status || '') ? cockpit.widgetRefreshState[instance.instance_id]?.status : widgetData(instance)?.status || 'unknown'" :style="{ gridColumn: `${instance.placement.x + 1} / span ${instance.placement.width}`, gridRow: `${instance.placement.y + 1} / span ${instance.placement.height}` }">
        <header><div><span>{{ widgetData(instance)?.definition_id || instance.definition_id }}</span><h3>{{ widgetData(instance)?.title || instance.definition_id }}</h3></div><strong>{{ compactWidgetValue(instance) }}</strong></header>
        <p v-if="cockpit.widgetRefreshState[instance.instance_id]?.status === 'loading'" class="mfg-widget__state" role="status">{{ t('mfg.cockpit.refreshingWidget') }}</p>
        <p v-if="widgetData(instance)?.error || cockpit.widgetRefreshState[instance.instance_id]?.error" class="mfg-widget__error">{{ cockpit.widgetRefreshState[instance.instance_id]?.error || widgetData(instance)?.error }}</p>
        <dl v-else class="mfg-widget__details"><template v-for="(value, key) in (widgetData(instance)?.data || {})" :key="String(key)"><dt v-if="typeof value !== 'object'">{{ key }}</dt><dd v-if="typeof value !== 'object'">{{ value }}</dd></template></dl>
        <nav v-if="widgetData(instance)?.source_refs?.length" class="mfg-widget__sources" :aria-label="t('mfg.cockpit.sources')">
          <RouterLink v-for="source in widgetData(instance)?.source_refs" :key="source" :to="sourceHref(source, instance.instance_id)">{{ source }}</RouterLink>
        </nav>
        <small v-if="widgetFreshness(instance)" class="mfg-widget__freshness">{{ widgetFreshness(instance)?.status || 'current' }} · {{ widgetFreshness(instance)?.generated_at || cockpit.projection?.generated_at }}</small>
        <div class="mfg-widget__request-actions">
          <button v-if="cockpit.widgetRefreshState[instance.instance_id]?.status === 'loading'" class="ghost-action mfg-widget__retry" type="button" @click="cancelWidgetRefresh(instance.instance_id)">{{ t('mfg.cockpit.cancelWidgetRefresh') }}</button>
          <button v-else class="ghost-action mfg-widget__retry" type="button" @click="retryWidget(instance.instance_id)"><RotateCw :size="14" />{{ widgetData(instance)?.error || cockpit.widgetRefreshState[instance.instance_id]?.status === 'error' ? t('mfg.cockpit.retryWidget') : t('mfg.cockpit.refreshWidget') }}</button>
        </div>
        <footer v-if="editMode" class="mfg-widget__controls">
          <button class="mfg-widget__drag" type="button" :aria-label="t('mfg.cockpit.dragWidget')" @pointerdown="beginDirectManipulation($event, instance, 'move')"><Grip :size="14" /></button>
          <button type="button" :aria-label="t('mfg.cockpit.moveLeft')" @click="moveWidget(instance, 'x', -1)">←</button><button type="button" :aria-label="t('mfg.cockpit.moveRight')" @click="moveWidget(instance, 'x', 1)">→</button><button type="button" :aria-label="t('mfg.cockpit.moveUp')" @click="moveWidget(instance, 'y', -1)">↑</button><button type="button" :aria-label="t('mfg.cockpit.moveDown')" @click="moveWidget(instance, 'y', 1)">↓</button>
          <button type="button" :aria-label="t('mfg.cockpit.narrower')" @click="resizeWidget(instance, 'width', -1)">−W</button><button type="button" :aria-label="t('mfg.cockpit.wider')" @click="resizeWidget(instance, 'width', 1)">+W</button><button type="button" :aria-label="t('mfg.cockpit.shorter')" @click="resizeWidget(instance, 'height', -1)">−H</button><button type="button" :aria-label="t('mfg.cockpit.taller')" @click="resizeWidget(instance, 'height', 1)">+H</button>
          <button type="button" :aria-label="t('mfg.cockpit.configureWidget')" @click="toggleWidgetSettings(instance.instance_id)"><Settings2 :size="14" /></button><button type="button" :aria-label="instance.visible === false ? t('mfg.cockpit.showWidget') : t('mfg.cockpit.hideWidget')" @click="toggleWidgetVisibility(instance)">{{ instance.visible === false ? '○' : '●' }}</button><button type="button" :aria-label="t('mfg.cockpit.removeWidget')" @click="removeWidget(instance.instance_id)"><Trash2 :size="14" /></button>
        </footer>
        <section v-if="editMode && openWidgetSettings[instance.instance_id]" class="mfg-widget__settings">
          <fieldset v-if="schemaFields(definitionFor(instance)?.config_schema).length">
            <legend>{{ t('mfg.cockpit.widgetConfig') }}</legend>
            <label v-for="field in schemaFields(definitionFor(instance)?.config_schema)" :key="`config-${field.key}`">
              <span>{{ field.key }}</span>
              <select v-if="field.schema.type === 'boolean'" :value="String(schemaInputValue(instance, 'config', field.key))" @change="updateSchemaValue(instance, 'config', field.key, field.schema, $event)"><option value="">—</option><option value="true">true</option><option value="false">false</option></select>
              <input v-else :type="field.schema.type === 'integer' || field.schema.type === 'number' ? 'number' : 'text'" :min="field.schema.minimum" :max="field.schema.maximum" :value="schemaInputValue(instance, 'config', field.key)" @change="updateSchemaValue(instance, 'config', field.key, field.schema, $event)" />
            </label>
          </fieldset>
          <fieldset v-if="schemaFields(definitionFor(instance)?.query_schema).length">
            <legend>{{ t('mfg.cockpit.widgetQuery') }}</legend>
            <label v-for="field in schemaFields(definitionFor(instance)?.query_schema)" :key="`query-${field.key}`">
              <span>{{ field.key }}</span>
              <input :type="field.schema.type === 'integer' || field.schema.type === 'number' ? 'number' : 'text'" :min="field.schema.minimum" :max="field.schema.maximum" :placeholder="field.schema.items?.enum?.join(', ') || ''" :value="schemaInputValue(instance, 'query', field.key)" @change="updateSchemaValue(instance, 'query', field.key, field.schema, $event)" />
            </label>
          </fieldset>
        </section>
        <button v-if="editMode" class="mfg-widget__resize-handle" type="button" :aria-label="t('mfg.cockpit.dragResizeWidget')" @pointerdown="beginDirectManipulation($event, instance, 'resize')"><Maximize2 :size="13" /></button>
      </article>
    </div>
    <p v-else class="mfg-cockpit__empty">{{ t('mfg.cockpit.empty') }}</p>
  </section>
</template>

<style scoped>
.mfg-cockpit { display: grid; gap: 14px; min-width: 0; }
.mfg-cockpit__header, .mfg-cockpit__toolbar, .mfg-cockpit__actions, .mfg-cockpit__add-widget, .mfg-cockpit__history, .mfg-widget header, .mfg-widget__controls { display: flex; align-items: center; gap: 9px; }
.mfg-cockpit__header { justify-content: space-between; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.mfg-cockpit__header h2, .mfg-widget h3 { margin: 0; color: var(--text); text-wrap: balance; }
.mfg-cockpit__header h2 { font-size: 18px; }
.mfg-cockpit__header p { margin: 5px 0 0; max-width: 70ch; color: var(--text-muted); font-size: 13px; }
.mfg-cockpit__actions { flex-wrap: wrap; }
.mfg-live-state, .mfg-revision, .mfg-freshness, .mfg-dirty { color: var(--text-muted); font-size: 12px; }
.mfg-dirty[data-dirty="true"] { color: var(--warn); }
.mfg-live-state { border: 1px solid var(--border); border-radius: 999px; padding: 4px 8px; }
.mfg-live-state[data-status="live"] { color: var(--success); border-color: color-mix(in srgb, var(--success) 45%, var(--border)); }
.mfg-live-state[data-status="reconnecting"] { color: var(--warn); }
.mfg-cockpit__toolbar { justify-content: flex-start; flex-wrap: wrap; }
.mfg-cockpit__toolbar label, .mfg-cockpit__editor label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }
.mfg-cockpit__toolbar select, .mfg-cockpit__editor input, .mfg-cockpit__editor select { min-height: 34px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 0 9px; }
.mfg-cockpit__editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }
.mfg-cockpit__add-widget { grid-column: 1 / -1; flex-wrap: wrap; }
.mfg-cockpit__add-widget select { min-width: min(100%, 280px); }
.mfg-cockpit__sharing, .mfg-cockpit__filters, .mfg-cockpit__thresholds { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; min-width: 0; border: 1px solid var(--border); border-radius: 8px; }
.mfg-cockpit__sharing legend, .mfg-cockpit__filters legend, .mfg-cockpit__thresholds legend, .mfg-widget__settings legend { padding: 0 5px; color: var(--text-muted); font-size: 12px; }
.mfg-cockpit__sharing button { align-self: end; }
.mfg-cockpit__filters p { grid-column: 1 / -1; margin: 0; color: var(--text-faint); font-size: 11px; }
.mfg-cockpit__history { flex-wrap: wrap; }
.mfg-cockpit__layout-error { grid-column: 1 / -1; }
.mfg-cockpit__conflict { grid-column: 1 / -1; display: grid; gap: 8px; padding: 12px; border: 1px solid color-mix(in srgb, var(--warn) 55%, var(--border)); border-radius: 9px; background: color-mix(in srgb, var(--warn) 6%, var(--surface)); }
.mfg-cockpit__conflict strong { color: var(--text); }
.mfg-cockpit__conflict p { margin: 0; color: var(--text-muted); font-size: 12px; }
.mfg-cockpit__conflict > div { display: flex; gap: 8px; flex-wrap: wrap; }
.mfg-cockpit__conflict > .mfg-cockpit__conflict-compare { display: grid; max-height: 250px; overflow: auto; border: 1px solid var(--border); border-radius: 7px; }
.mfg-cockpit__compare-head, .mfg-cockpit__compare-row { display: grid; grid-template-columns: minmax(100px, .55fr) repeat(2, minmax(180px, 1fr)); }
.mfg-cockpit__compare-head { position: sticky; top: 0; background: var(--surface-2); }
.mfg-cockpit__compare-head > *, .mfg-cockpit__compare-row > * { min-width: 0; margin: 0; padding: 7px; border-right: 1px solid var(--border); overflow-wrap: anywhere; font-size: 11px; }
.mfg-cockpit__compare-row > span { color: var(--text-muted); font-family: var(--font-mono); }
.mfg-cockpit__grid { display: grid; grid-auto-rows: 46px; min-width: 0; }
.mfg-widget { position: relative; min-width: 0; overflow: auto; display: grid; align-content: start; gap: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 12px; content-visibility: auto; contain-intrinsic-size: 280px; }
.mfg-widget.has-layout-conflict { border-color: var(--danger); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 35%, transparent); }
.mfg-widget.is-url-focus { border-color: var(--accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent); }
.mfg-widget.is-manipulating { opacity: .82; box-shadow: 0 10px 28px color-mix(in srgb, var(--text) 14%, transparent); }
.mfg-widget.is-hidden-widget { opacity: .5; border-style: dashed; }
.mfg-widget[data-status="critical"], .mfg-widget[data-status="fail"], .mfg-widget[data-status="escalated"] { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }
.mfg-widget[data-status="unavailable"] { border-color: color-mix(in srgb, var(--warn) 55%, var(--border)); }
.mfg-widget header { justify-content: space-between; align-items: start; }
.mfg-widget header span { display: block; overflow: hidden; color: var(--text-faint); font: 11px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.mfg-widget h3 { font-size: 14px; margin-top: 3px; }
.mfg-widget header strong { color: var(--text); font-size: 20px; font-variant-numeric: tabular-nums; }
.mfg-widget__details { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 9px; margin: 0; color: var(--text-muted); font-size: 12px; }
.mfg-widget__details dt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfg-widget__details dd { margin: 0; color: var(--text); font-variant-numeric: tabular-nums; }
.mfg-widget__error { margin: 0; color: var(--warn); font-size: 12px; overflow-wrap: anywhere; }
.mfg-widget__state, .mfg-widget__freshness { margin: 0; color: var(--text-faint); font-size: 11px; }
.mfg-widget__sources { display: flex; gap: 5px; flex-wrap: wrap; }
.mfg-widget__sources a { max-width: 100%; overflow: hidden; padding: 3px 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--accent); font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.mfg-widget__retry { justify-self: start; }
.mfg-widget__controls { margin-top: auto; flex-wrap: wrap; }
.mfg-widget__controls button { min-width: 26px; width: auto; height: 26px; padding: 0 5px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text-muted); font-size: 10px; }
.mfg-widget__controls button:hover { color: var(--text); border-color: var(--border-2); }
.mfg-widget__drag, .mfg-widget__resize-handle { cursor: grab; touch-action: none; }
.mfg-widget__settings { display: grid; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.mfg-widget__settings fieldset { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; min-width: 0; border: 1px solid var(--border); border-radius: 7px; }
.mfg-widget__settings label { display: grid; gap: 4px; min-width: 0; color: var(--text-muted); font-size: 11px; }
.mfg-widget__settings input, .mfg-widget__settings select { min-width: 0; min-height: 30px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); padding: 0 7px; }
.mfg-widget__resize-handle { position: absolute; right: 4px; bottom: 4px; width: 24px; height: 24px; display: grid; place-items: center; border: 0; background: transparent; color: var(--text-faint); }
.mfg-cockpit__empty { margin: 0; padding: 24px; color: var(--text-muted); border: 1px dashed var(--border-2); border-radius: 10px; }
@media (max-width: 820px) { .mfg-cockpit__toolbar select, .mfg-cockpit__editor input, .mfg-cockpit__editor select { min-width: 44px; min-height: 44px; } .mfg-cockpit__editor, .mfg-cockpit__sharing, .mfg-cockpit__filters, .mfg-cockpit__thresholds, .mfg-widget__settings fieldset { grid-template-columns: 1fr; } .mfg-cockpit__grid { grid-template-columns: 1fr !important; grid-auto-rows: auto; } .mfg-widget { grid-column: 1 !important; grid-row: auto !important; min-height: 180px; } .mfg-widget__drag, .mfg-widget__resize-handle { display: none; } .mfg-cockpit__compare-head, .mfg-cockpit__compare-row { grid-template-columns: 1fr; } }
</style>
