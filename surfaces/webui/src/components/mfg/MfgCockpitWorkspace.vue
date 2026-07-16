<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Copy, LayoutGrid, Plus, Redo2, RefreshCw, Save, Settings2, Share2, Trash2, Undo2 } from 'lucide-vue-next';
import { api } from '../../api/client';
import { t } from '../../i18n';
import { useMfgCockpitStore } from '../../stores/mfgCockpit';
import type { MfgCockpitProfile, MfgWidgetInstance } from '../../types/mfg';

const cockpit = useMfgCockpitStore();
const editMode = ref(false);
const newWidgetId = ref('');
const working = ref<MfgCockpitProfile | null>(null);
const shareVisibility = ref('private');
const shareViewers = ref('');
const shareEditors = ref('');
const undoStack = ref<MfgCockpitProfile[]>([]);
const redoStack = ref<MfgCockpitProfile[]>([]);
const conflict = ref(false);
const operationError = ref('');

function copyProfile(profile: MfgCockpitProfile | null) {
  return profile ? JSON.parse(JSON.stringify(profile)) as MfgCockpitProfile : null;
}

watch(() => cockpit.selectedProfile, (profile) => {
  working.value = copyProfile(profile);
  shareVisibility.value = profile?.sharing_policy?.visibility || 'private';
  shareViewers.value = (profile?.sharing_policy?.viewer_refs || []).join(', ');
  shareEditors.value = (profile?.sharing_policy?.editor_refs || []).join(', ');
}, { immediate: true });

const displayedWidgets = computed(() => (working.value?.widget_instances || []).filter((widget) => widget.visible !== false));
const definitionOptions = computed(() => cockpit.catalog);
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
  undoStack.value = [];
  redoStack.value = [];
  conflict.value = false;
}

async function selectProfile(event: Event) {
  try { await cockpit.loadProfile((event.target as HTMLSelectElement).value); }
  catch { /* store error is rendered by the workspace shell */ }
}

function createProfile() {
  const now = new Date().toISOString();
  working.value = {
    profile_id: `cockpit-profile-${Date.now()}`,
    owner_ref: 'webui',
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
  conflict.value = false;
  editMode.value = true;
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

function moveWidget(instance: MfgWidgetInstance, axis: 'x' | 'y', direction: number) {
  rememberEdit();
  const limit = axis === 'x' ? Math.max(0, (working.value?.layout.columns || 12) - instance.placement.width) : 64;
  instance.placement[axis] = Math.min(limit, Math.max(0, instance.placement[axis] + direction));
}

async function save() {
  if (!working.value) return;
  try {
    const saved = await cockpit.saveProfile(working.value);
    working.value = copyProfile(saved);
    editMode.value = false;
    undoStack.value = [];
    redoStack.value = [];
    conflict.value = false;
  } catch {
    conflict.value = true;
  }
}

async function cloneProfile() {
  if (!cockpit.selectedProfile) return;
  operationError.value = '';
  try {
    await api.mfgCloneCockpitProfile(cockpit.selectedProfile.profile_id, {});
    await cockpit.refresh();
  } catch (cause) { operationError.value = cause instanceof Error ? cause.message : String(cause); }
}

async function shareProfile() {
  if (!cockpit.selectedProfile) return;
  operationError.value = '';
  try {
    await api.mfgShareCockpitProfile(cockpit.selectedProfile.profile_id, {
      expected_revision: cockpit.selectedProfile.revision,
      sharing_policy: { visibility: shareVisibility.value, viewer_refs: commaList(shareViewers.value), editor_refs: commaList(shareEditors.value) },
    });
    await cockpit.loadProfile(cockpit.selectedProfile.profile_id);
  } catch (cause) { operationError.value = cause instanceof Error ? cause.message : String(cause); }
}

async function deleteProfile() {
  if (!cockpit.selectedProfile) return;
  operationError.value = '';
  try {
    await api.mfgDeleteCockpitProfile(cockpit.selectedProfile.profile_id, cockpit.selectedProfile.revision);
    cockpit.selectedProfileId = '';
    await cockpit.refresh();
  } catch (cause) { operationError.value = cause instanceof Error ? cause.message : String(cause); }
}

function widgetData(instance: MfgWidgetInstance) {
  return cockpit.widgetsByInstance.get(instance.instance_id);
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
        <button class="ghost-action" type="button" @click="createProfile"><Plus :size="15" />{{ t('mfg.cockpit.new') }}</button>
        <button class="ghost-action" type="button" :disabled="!cockpit.selectedProfile" @click="cloneProfile"><Copy :size="15" />{{ t('mfg.cockpit.clone') }}</button>
        <button class="ghost-action" type="button" :disabled="!cockpit.selectedProfile" @click="deleteProfile"><Trash2 :size="15" />{{ t('mfg.cockpit.delete') }}</button>
        <button class="primary-action" type="button" :disabled="!working" @click="editMode = !editMode"><Settings2 :size="15" />{{ editMode ? t('mfg.cockpit.closeEdit') : t('mfg.cockpit.edit') }}</button>
      </div>
    </header>
    <p v-if="operationError" class="settings-alert">{{ operationError }}</p>

    <div class="mfg-cockpit__toolbar">
      <label>
        <span>{{ t('mfg.cockpit.profile') }}</span>
        <select :value="cockpit.selectedProfileId" @change="selectProfile">
          <option v-for="profile in cockpit.profiles" :key="profile.profile_id" :value="profile.profile_id">{{ profile.display_name }}</option>
        </select>
      </label>
      <span v-if="working" class="mfg-revision">{{ t('mfg.cockpit.revision', { revision: working.revision }) }}</span>
      <span v-if="cockpit.projection?.generated_at" class="mfg-freshness">{{ cockpit.projection.generated_at }}</span>
    </div>

    <form v-if="editMode && working" class="mfg-cockpit__editor" @submit.prevent="save">
      <label><span>{{ t('mfg.cockpit.name') }}</span><input v-model="working.display_name" required /></label>
      <label><span>{{ t('mfg.cockpit.metrics') }}</span><input :value="working.focus_metric_ids.join(', ')" @input="working.focus_metric_ids = commaList(($event.target as HTMLInputElement).value)" /></label>
      <label><span>{{ t('mfg.cockpit.entities') }}</span><input :value="working.focus_refs.join(', ')" @input="working.focus_refs = commaList(($event.target as HTMLInputElement).value)" /></label>
      <label><span>{{ t('mfg.cockpit.cadence') }}</span><select v-model="working.cadence"><option value="daily">daily</option><option value="weekly">weekly</option><option value="on_demand">{{ t('mfg.cockpit.cadence.onDemand') }}</option></select></label>
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
        <button class="ghost-action" type="button" @click="shareProfile"><Share2 :size="15" />{{ t('mfg.cockpit.saveSharing') }}</button>
      </fieldset>
      <button class="primary-action" type="submit" :disabled="cockpit.saving"><Save :size="15" />{{ t('mfg.cockpit.save') }}</button>
      <div class="mfg-cockpit__history"><button class="ghost-action" type="button" :disabled="!undoStack.length" @click="undo"><Undo2 :size="15" />{{ t('mfg.cockpit.undo') }}</button><button class="ghost-action" type="button" :disabled="!redoStack.length" @click="redo"><Redo2 :size="15" />{{ t('mfg.cockpit.redo') }}</button><button class="ghost-action" type="button" @click="revert"><RefreshCw :size="15" />{{ t('mfg.cockpit.revert') }}</button></div>
      <p v-if="conflict" class="mfg-widget__error">{{ t('mfg.cockpit.conflict') }}</p>
    </form>

    <div v-if="working" class="mfg-cockpit__grid" :style="{ gridTemplateColumns: `repeat(${working.layout.columns || 12}, minmax(0, 1fr))`, gap: `${working.layout.gap || 12}px` }">
      <article v-for="instance in displayedWidgets" :key="instance.instance_id" class="mfg-widget" :data-status="widgetData(instance)?.status || 'unknown'" :style="{ gridColumn: `${instance.placement.x + 1} / span ${instance.placement.width}`, gridRow: `${instance.placement.y + 1} / span ${instance.placement.height}` }">
        <header><div><span>{{ widgetData(instance)?.definition_id || instance.definition_id }}</span><h3>{{ widgetData(instance)?.title || instance.definition_id }}</h3></div><strong>{{ compactWidgetValue(instance) }}</strong></header>
        <p v-if="widgetData(instance)?.error" class="mfg-widget__error">{{ widgetData(instance)?.error }}</p>
        <dl v-else class="mfg-widget__details"><template v-for="(value, key) in (widgetData(instance)?.data || {})" :key="String(key)"><dt v-if="typeof value !== 'object'">{{ key }}</dt><dd v-if="typeof value !== 'object'">{{ value }}</dd></template></dl>
        <footer v-if="editMode" class="mfg-widget__controls">
          <button type="button" :aria-label="t('mfg.cockpit.moveLeft')" @click="moveWidget(instance, 'x', -1)">←</button><button type="button" :aria-label="t('mfg.cockpit.moveRight')" @click="moveWidget(instance, 'x', 1)">→</button><button type="button" :aria-label="t('mfg.cockpit.moveUp')" @click="moveWidget(instance, 'y', -1)">↑</button><button type="button" :aria-label="t('mfg.cockpit.moveDown')" @click="moveWidget(instance, 'y', 1)">↓</button><button type="button" :aria-label="t('mfg.cockpit.removeWidget')" @click="removeWidget(instance.instance_id)"><Trash2 :size="14" /></button>
        </footer>
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
.mfg-live-state, .mfg-revision, .mfg-freshness { color: var(--text-muted); font-size: 12px; }
.mfg-live-state { border: 1px solid var(--border); border-radius: 999px; padding: 4px 8px; }
.mfg-live-state[data-status="live"] { color: var(--success); border-color: color-mix(in srgb, var(--success) 45%, var(--border)); }
.mfg-live-state[data-status="reconnecting"] { color: var(--warn); }
.mfg-cockpit__toolbar { justify-content: flex-start; flex-wrap: wrap; }
.mfg-cockpit__toolbar label, .mfg-cockpit__editor label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }
.mfg-cockpit__toolbar select, .mfg-cockpit__editor input, .mfg-cockpit__editor select { min-height: 34px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 0 9px; }
.mfg-cockpit__editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }
.mfg-cockpit__add-widget { grid-column: 1 / -1; flex-wrap: wrap; }
.mfg-cockpit__add-widget select { min-width: min(100%, 280px); }
.mfg-cockpit__sharing { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; min-width: 0; border: 1px solid var(--border); border-radius: 8px; }
.mfg-cockpit__sharing legend { padding: 0 5px; color: var(--text-muted); font-size: 12px; }
.mfg-cockpit__sharing button { align-self: end; }
.mfg-cockpit__history { flex-wrap: wrap; }
.mfg-cockpit__grid { display: grid; grid-auto-rows: 46px; min-width: 0; }
.mfg-widget { min-width: 0; overflow: hidden; display: grid; align-content: start; gap: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 12px; }
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
.mfg-widget__controls { margin-top: auto; }
.mfg-widget__controls button { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text-muted); }
.mfg-widget__controls button:hover { color: var(--text); border-color: var(--border-2); }
.mfg-cockpit__empty { margin: 0; padding: 24px; color: var(--text-muted); border: 1px dashed var(--border-2); border-radius: 10px; }
@media (max-width: 820px) { .mfg-cockpit__editor, .mfg-cockpit__sharing { grid-template-columns: 1fr; } .mfg-cockpit__grid { grid-template-columns: 1fr !important; grid-auto-rows: auto; } .mfg-widget { grid-column: 1 !important; grid-row: auto !important; min-height: 180px; } }
</style>
