<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Brain, ChevronLeft, ChevronRight, CircleDot, Clock3, Code2, Download, ExternalLink, Eye, Folder, Info, Link2, RotateCcw, Save, Search, Upload, Workflow, Wrench, X, ZoomIn, ZoomOut } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import MarkdownBlock from './MarkdownBlock.vue';
import RawPayload from './workbench/RawPayload.vue';
import { useEscapeKey } from '../composables/useEscapeKey';
import { displayStatus } from '../i18n/domain/status';
import WorkspaceTree from './workspace/WorkspaceTree.vue';
import TimelineList from './workbench/TimelineList.vue';
import ExecutionGraphCanvas from './mission/ExecutionGraphCanvas.vue';
import { isWorkspaceEditablePreview, workspacePreviewKind } from '../utils/workspacePreview';
import type { ActivityEvent } from '../types';
import { activityIdentityKey, causalActivityTimeline } from '../utils/causalTimeline';

const store = useAppStore();
const chat = useChatSessionsStore();
const projections = useProjectionRegistryStore();
const fileInput = ref<HTMLInputElement | null>(null);
const previewOpen = ref(false);
const activityDetailOpen = ref(false);
const selectedExecutionNode = ref<Record<string, any> | null>(null);
const previewMode = ref<'render' | 'source'>('render');
const imageZoom = ref(1);
const resizing = ref(false);
const executionHistoryLimit = ref(50);

const previewKind = computed(() => store.selectedFile ? workspacePreviewKind(store.selectedFile) : 'binary');
const rawFileUrl = computed(() => store.rawWorkspaceFileUrl(store.selectedFile));
const canEdit = computed(() => !!store.selectedFile && isWorkspaceEditablePreview(store.selectedFile));
const previewableFiles = computed(() => store.filteredWorkspaceFiles.filter((file) => file.kind === 'file'));
const selectedFileIndex = computed(() => previewableFiles.value.findIndex((file) => file.path === store.selectedFile));
const workspaceMetaEntries = computed(() => {
  const meta = store.workspaceMeta || {};
  return Object.entries(meta).slice(0, 8).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
});
const activityEvents = computed(() => {
  const sessionActivity = chat.active?.activity || [];
  const rows = new Map<string, ActivityEvent>();
  for (const item of [...store.activity, ...sessionActivity]) {
    const event = item as ActivityEvent;
    const identity = activityIdentityKey(event);
    const previous = rows.get(identity);
    rows.set(identity, previous ? {
      ...previous,
      ...event,
      detail: event.detail || previous.detail,
      status: event.status || previous.status,
      duration_ms: event.duration_ms ?? previous.duration_ms,
      input: event.input ?? previous.input,
      output: event.output ?? previous.output,
      raw: { ...(previous.raw || {}), ...(event.raw || {}) },
    } : event);
  }
  return causalActivityTimeline([...rows.values()], 2_000);
});
const thinkingEvents = computed(() => activityEvents.value.filter((event) => event.kind === 'think'));
const inspectorEvents = computed(() => activityEvents.value.filter((event) => event.kind === 'error' || event.status === 'error'));
const contextItems = computed(() => {
  const envelope = store.currentContextEnvelope || {};
  return [
    ...(Array.isArray(envelope.items) ? envelope.items : []),
    ...(Array.isArray(envelope.context_items) ? envelope.context_items : []),
    ...(Array.isArray(envelope.evidence) ? envelope.evidence : []),
  ].slice(0, 12);
});
const realityStages = computed(() => (Array.isArray(store.currentRealityFlow?.stages) ? store.currentRealityFlow.stages : []).slice(0, 12));
const timelineEvents = computed(() => store.runtimeTimelineRows.slice(0, 14));
const runtimeInputItems = computed(() => {
  const seen = new Set<string>();
  const rows = [
    ...(Array.isArray(store.turnInbox?.items) ? store.turnInbox.items : []),
    ...(Array.isArray(store.sessionInputProjection?.inputs) ? store.sessionInputProjection.inputs : []),
  ];
  return rows.filter((item: any) => {
    const id = String(item?.input_id || item?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 12);
});
const rootProjectionId = computed(() => (
  chat.active?.executionGraphId || chat.active?.executionId || ''
));
const rootProjection = computed(() => rootProjectionId.value
  ? projections.projectionFor(rootProjectionId.value)
  : null);
const activeTeamExecutionGraphId = computed(() => {
  const projection = rootProjection.value as any;
  const strategyGraphId = String(projection?.strategy?.team_execution_id || '').trim();
  if (strategyGraphId && strategyGraphId !== rootProjectionId.value) return strategyGraphId;
  const linked = (Array.isArray(projection?.teams) ? projection.teams : [])
    .map((team: any) => String(team?.detail?.graph_id || '').trim())
    .find((graphId: string) => graphId && graphId !== rootProjectionId.value);
  if (linked) return linked;
  const childGraph = (Array.isArray(projection?.child_executions)
    ? projection.child_executions
    : [])
    .map((child: any) => String(child?.execution_id || '').trim())
    .find((graphId: string) => graphId && graphId !== rootProjectionId.value);
  if (childGraph) return childGraph;
  return [...activityEvents.value]
    .reverse()
    .filter((event) => event.parent_execution_id === rootProjectionId.value)
    .map((event) => String(event.graph_id || '').trim())
    .find((graphId) => graphId && graphId !== rootProjectionId.value) || '';
});
const displayedExecutionGraphId = computed(() => (
  activeTeamExecutionGraphId.value || rootProjectionId.value
));
const activeProjection = computed(() => displayedExecutionGraphId.value
  ? projections.projectionFor(displayedExecutionGraphId.value)
  : null);
const activeProjectionEntry = computed(() => displayedExecutionGraphId.value
  ? projections.entries[displayedExecutionGraphId.value]
  : null);
const executionGraph = computed(() => activeProjection.value?.graph || null);
const canonicalExecutionTurns = computed(() => {
  const projectedTurns = chat.active?.turnProjection?.turns || [];
  if (projectedTurns.length) {
    return projectedTurns.map((projected) => ({
      turnId: projected.turn_id,
      projected,
    }));
  }
  const transcript = chat.active?.turns || [];
  const canonical = [];
  for (let index = 0; index < transcript.length; index += 1) {
    const userTurn = transcript[index];
    if (userTurn.role !== 'user') continue;
    let turnId = String(userTurn.turn_id || '');
    for (let cursor = index + 1; !turnId && cursor < transcript.length; cursor += 1) {
      if (transcript[cursor].role === 'user') break;
      turnId = String(transcript[cursor].turn_id || '');
    }
    canonical.push({
      turnId: turnId || `legacy-user:${userTurn.id}`,
      projected: null,
    });
  }
  return canonical;
});
const executionTurnGroups = computed(() => {
  const entries = chat.active?.executionIndex?.executions || [];
  const canonicalTurns = canonicalExecutionTurns.value;
  const visibleTurns = canonicalTurns.slice(-executionHistoryLimit.value).reverse();
  return visibleTurns.map(({ turnId, projected }, index) => {
    const entry = entries.find((candidate) => candidate.turn_id === turnId);
    const fallbackTimestamp = Number(
      projected?.completed_at_ms
      || projected?.started_at_ms
      || projected?.submitted_at_ms
      || 0,
    );
    return {
      entry: entry || {
        execution_id: '',
        graph_id: null,
        turn_id: turnId,
        status: projected?.status || 'unknown',
        updated_at_ms: fallbackTimestamp,
      },
      turnId,
      label: t('chat.execution.turnNumber', {
        number: Math.max(1, canonicalTurns.length - index),
      }),
      events: activityEvents.value.filter((event) => (
        event.turn_id === turnId
        || (!!entry?.execution_id && event.execution_id === entry.execution_id)
        || (!!entry?.execution_id && event.parent_execution_id === entry.execution_id)
      )),
    };
  });
});
const hasMoreExecutionTurns = computed(() => (
  canonicalExecutionTurns.value.length > executionHistoryLimit.value
));
const projectionContractError = computed(() => {
  const message = activeProjectionEntry.value?.lastError || '';
  return message.startsWith('unsupported execution projection')
    || message.startsWith('unsupported strategy projection')
    ? message
    : '';
});
const liveExecution = computed(() => activeProjection.value?.live || chat.active?.live || null);
const liveMetrics = computed(() => liveExecution.value?.metrics || null);
function decodedPayload(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}
const executionUsage = computed(() => {
  const metricInput = Number(liveMetrics.value?.input_tokens || 0);
  const metricOutput = Number(liveMetrics.value?.output_tokens || 0);
  if (metricInput || metricOutput) return { input: metricInput, output: metricOutput };
  return (chat.active?.turns || []).reduce((total, turn) => {
    const usage = turn.token_usage || {};
    const input = Number(usage.input_tokens || usage.prompt_tokens || 0);
    const output = Number(usage.output_tokens || usage.completion_tokens || 0);
    return {
      input: total.input + (Number.isFinite(input) ? input : 0),
      output: total.output + (Number.isFinite(output) ? output : 0),
    };
  }, { input: 0, output: 0 });
});
const activityToolCount = computed(() => activityEvents.value.filter((event) => event.kind === 'tool').length);
const selectedActivity = computed(() => store.selectedActivity as ActivityEvent | null);
const selectedActivityInput = computed(() => {
  const event = selectedActivity.value;
  return decodedPayload(event?.input
    ?? event?.raw?.input
    ?? (event?.raw?.tool_use as Record<string, unknown> | undefined)?.input
    ?? event?.raw?.arguments
    ?? null);
});
const selectedActivityOutput = computed(() => {
  const event = selectedActivity.value;
  return decodedPayload(event?.output
    ?? event?.raw?.output
    ?? (event?.raw?.tool_result as Record<string, unknown> | undefined)?.output
    ?? event?.raw?.result
    ?? null);
});
const selectedActivityDuration = computed(() => {
  const value = Number(selectedActivity.value?.duration_ms ?? selectedActivity.value?.raw?.duration_ms);
  if (!Number.isFinite(value) || value < 0) return '—';
  return value < 1_000
    ? `${Math.round(value)} ms`
    : `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, '')} s`;
});
const liveContextLabel = computed(() => {
  const usage = liveExecution.value?.context_usage;
  if (!usage?.window_tokens) return '—';
  return `${Number(usage.input_tokens || 0).toLocaleString()} / ${Number(usage.window_tokens).toLocaleString()}`;
});

function runtimeInputId(item: any) {
  return String(item?.input_id || item?.id || '');
}

function runtimeInputDetail(item: any) {
  const decision = item?.decision ? displayStatus(item.decision) : displayStatus('unknown');
  const checkpoint = item?.checkpoint ? ` · ${item.checkpoint}` : '';
  return `${decision}${checkpoint}`;
}

async function cancelRuntimeInput(item: any) {
  await store.cancelSessionInput(runtimeInputId(item));
}

async function queueRuntimeInput(item: any) {
  await store.reclassifySessionInput(runtimeInputId(item), 'enqueue_next_step');
}

async function uploadFiles(files: FileList | null) {
  if (!files?.length) return;
  await store.uploadWorkspaceFiles(files);
  if (fileInput.value) fileInput.value.value = '';
}

async function dropUpload(event: DragEvent) {
  event.preventDefault();
  await uploadFiles(event.dataTransfer?.files || null);
}

function applyCompanionWidth(width: number) {
  const next = Math.max(320, Math.min(720, width));
  document.documentElement.style.setProperty('--companion-width', `${next}px`);
  localStorage.setItem('cowd-webui-companion-width', String(next));
}

function startResize(event: MouseEvent) {
  resizing.value = true;
  event.preventDefault();
}

function dragResize(event: MouseEvent) {
  if (!resizing.value) return;
  applyCompanionWidth(window.innerWidth - event.clientX);
}

function stopResize() {
  resizing.value = false;
}

function openPreview() {
  if (!store.selectedFile) return;
  previewOpen.value = true;
  previewMode.value = 'render';
  imageZoom.value = 1;
}

function closePreview() {
  previewOpen.value = false;
}

function openActivityDetail(item: Record<string, unknown>) {
  store.selectedActivity = item;
  activityDetailOpen.value = true;
}

function closeActivityDetail() {
  activityDetailOpen.value = false;
}

function openExecutionTurn(graphId: string | null | undefined) {
  const normalized = String(graphId || '').trim();
  if (normalized) store.openChatExecutionGraph(normalized);
}

function formatTokenQuantity(value: number) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return Math.round(value).toString();
}

async function stepPreview(delta: number) {
  if (!previewableFiles.value.length) return;
  const current = selectedFileIndex.value >= 0 ? selectedFileIndex.value : 0;
  const nextIndex = Math.max(0, Math.min(previewableFiles.value.length - 1, current + delta));
  const next = previewableFiles.value[nextIndex];
  if (next) {
    await store.openFile(next.path);
    openPreview();
  }
}

watch(() => store.selectedFile, (path) => {
  if (path) openPreview();
});

useEscapeKey(() => closePreview(), () => previewOpen.value);
useEscapeKey(() => closeActivityDetail(), () => activityDetailOpen.value);

onMounted(() => {
  const savedWidth = Number(localStorage.getItem('cowd-webui-companion-width') || 0);
  if (savedWidth) applyCompanionWidth(savedWidth);
  window.addEventListener('mousemove', dragResize);
  window.addEventListener('mouseup', stopResize);
});

onBeforeUnmount(() => {
  projections.release('chat:companion-root-execution');
  projections.release('chat:companion-team-execution');
  window.removeEventListener('mousemove', dragResize);
  window.removeEventListener('mouseup', stopResize);
});

watch(rootProjectionId, (executionId) => {
  projections.release('chat:companion-root-execution');
  if (!executionId || !store.activeSessionId) return;
  projections.acquire(
    executionId,
    'chat:companion-root-execution',
    'full',
    'bounded',
    store.activeSessionId,
  );
}, { immediate: true });

watch(activeTeamExecutionGraphId, (graphId) => {
  projections.release('chat:companion-team-execution');
  if (!graphId || !store.activeSessionId) return;
  projections.acquire(
    graphId,
    'chat:companion-team-execution',
    'full',
    'bounded',
    store.activeSessionId,
  );
}, { immediate: true });
</script>

<template>
  <aside class="companion-panel" :aria-label="t('component.companion.panel.aria-label.98b3d09f27')">
    <button class="companion-resizer" type="button" :aria-label="t('workspace.preview.resize')" @mousedown="startResize"></button>
    <div class="companion-tabs" role="tablist">
      <button :class="{ active: store.companionTab === 'activity' }" type="button" @click="store.openCompanion('activity')">
        <Workflow :size="15" />
        <span>{{ t('component.companion.panel.text.49c2a0044c') }}</span>
      </button>
      <button :class="{ active: store.companionTab === 'thinking' }" type="button" @click="store.openCompanion('thinking')">
        <Brain :size="15" />
        <span>{{ t('component.companion.panel.text.c7e3500e72') }}</span>
      </button>
      <button :class="{ active: store.companionTab === 'workspace' }" type="button" @click="store.openCompanion('workspace')">
        <Folder :size="15" />
        <span>{{ t('component.companion.panel.text.594060d245') }}</span>
      </button>
      <button :class="{ active: store.companionTab === 'evidence' }" type="button" @click="store.openCompanion('evidence')">
        <CircleDot :size="15" />
        <span>{{ t('component.companion.panel.text.46cb32e1a3') }}</span>
      </button>
      <button :class="{ active: store.companionTab === 'inspector' }" type="button" @click="store.openCompanion('inspector')">
        <Info :size="15" />
        <span>{{ t('component.companion.panel.text.85df2a90f7') }}</span>
      </button>
    </div>

    <section v-if="store.companionTab === 'activity'" class="companion-body">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.97ab0e4ebb') }}</h2>
        <span>{{ formatCount('events', activityEvents.length) }}</span>
      </div>
      <section v-if="chat.active?.executionGraphId || chat.active?.executionId" class="companion-execution-graph">
        <header>
          <span>
            <Workflow :size="14" />
            {{ activeTeamExecutionGraphId ? t('chat.execution.teamGraph') : t('chat.execution.graph') }}
          </span>
          <small>{{ displayStatus(displayedExecutionGraphId ? projections.stateFor(displayedExecutionGraphId) : 'materializing') }}</small>
        </header>
        <ExecutionGraphCanvas
          :graph="executionGraph"
          :selected-node-id="String(selectedExecutionNode?.node_id || selectedExecutionNode?.id || '')"
          :connection-state="displayedExecutionGraphId ? projections.stateFor(displayedExecutionGraphId) : 'materializing'"
          :loading="!executionGraph"
          :activity-events="activityEvents"
          compact
          @select="selectedExecutionNode = $event"
          @expand="store.openChatExecutionGraph()"
        />
      </section>
      <div class="execution-stream-summary">
        <span><Wrench :size="13" />{{ t('chat.execution.tools') }} <strong>{{ activityToolCount }}</strong></span>
        <span>{{ t('chat.execution.input') }} <strong>{{ formatTokenQuantity(executionUsage.input) }}</strong></span>
        <span>{{ t('chat.execution.output') }} <strong>{{ formatTokenQuantity(executionUsage.output) }}</strong></span>
      </div>
      <p v-if="projectionContractError" class="companion-contract-alert" role="alert">
        {{ t('strategy.state.contractMismatch') }} · {{ projectionContractError }}
      </p>
      <div v-if="executionTurnGroups.length" class="execution-turn-groups">
        <section v-for="group in executionTurnGroups" :key="group.turnId" class="execution-turn-group">
          <header>
            <button
              type="button"
              :disabled="!group.entry.graph_id"
              @click="openExecutionTurn(group.entry.graph_id)"
            >
              <Workflow :size="13" />
              <strong>{{ group.label }}</strong>
              <small>{{ displayStatus(group.entry.status) }}</small>
            </button>
            <time v-if="group.entry.updated_at_ms">{{ new Date(group.entry.updated_at_ms).toLocaleString() }}</time>
          </header>
          <TimelineList
            v-if="group.events.length"
            :items="group.events"
            :filterable="false"
            :selected-id="String(store.selectedActivity?.id || '')"
            @select="openActivityDetail"
          />
          <p v-else class="empty-note">{{ t('chat.execution.turnNoEvents') }}</p>
        </section>
        <button
          v-if="hasMoreExecutionTurns"
          class="ghost-action execution-history-more"
          type="button"
          @click="executionHistoryLimit += 50"
        >
          {{ t('chat.execution.loadMoreTurns') }}
        </button>
      </div>
      <TimelineList
        v-else
        class="companion-timeline"
        :items="activityEvents"
        :filterable="false"
        live
        :selected-id="String(store.selectedActivity?.id || '')"
        @select="openActivityDetail"
      />
    </section>

    <section v-else-if="store.companionTab === 'thinking'" class="companion-body">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.b8012c4678') }}</h2>
        <span>{{ formatCount('events', thinkingEvents.length) }}</span>
      </div>
      <div class="activity-list">
        <article v-for="event in thinkingEvents" :key="event.id" class="activity-item" data-kind="think">
          <div>
            <strong>{{ event.title }}</strong>
            <p>{{ event.detail || t('component.companion.panel.inline.1f965eaa31') }}</p>
          </div>
          <span>{{ displayStatus(event.status || 'unknown') }}</span>
        </article>
        <div v-if="!thinkingEvents.length" class="empty-state">
          <strong>{{ t('component.companion.panel.text.7817ce5674') }}</strong>
          <p>{{ t('component.companion.panel.text.cc3a224e6f') }}</p>
        </div>
      </div>
    </section>

    <section v-else-if="store.companionTab === 'workspace'" class="companion-body workspace-tab">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.594060d245') }}</h2>
        <span>{{ formatCount('items', store.workspaceFiles.length) }}</span>
      </div>
      <div class="workspace-root" :title="store.workspaceRoot">{{ store.workspaceRoot || t('component.companion.panel.inline.76270efe65') }}</div>
      <div class="upload-drop" @dragover.prevent @drop="dropUpload">
        <Upload :size="16" />
        <span>{{ store.uploadBusy ? t('component.companion.panel.inline.acde0a17ab') : t('component.companion.panel.inline.d2f9c4ceab') }}</span>
        <button type="button" @click="fileInput?.click()">{{ t('component.companion.panel.text.5231b7a1c8') }}</button>
        <input ref="fileInput" type="file" multiple @change="uploadFiles(($event.target as HTMLInputElement).files)" />
      </div>
      <div v-if="store.attachments.length" class="attachment-list">
        <div class="panel-title compact">
          <h2>{{ t('component.companion.panel.text.7a057b8ff5') }}</h2>
          <span>{{ store.attachments.length }}</span>
        </div>
        <article v-for="attachment in store.attachments" :key="attachment.ref_id" class="attachment-row">
          <Link2 :size="14" />
          <span>{{ attachment.label || attachment.path }}</span>
          <small>{{ attachment.kind }} · {{ attachment.detected_mime || displayStatus(attachment.status || 'unknown') }}</small>
          <button class="icon-action" type="button" @click="store.removeAttachment(attachment.ref_id)"><X :size="13" /></button>
        </article>
      </div>
      <label class="workspace-search">
        <Search :size="14" />
        <input v-model="store.workspaceFilter" type="search" :placeholder="t('component.companion.panel.placeholder.070c810b3f')" />
      </label>
      <div v-if="store.recentWorkspaceFiles.length" class="workspace-recent">
        <div class="panel-title compact">
          <h2>{{ t('workspace.preview.recent') }}</h2>
          <span>{{ store.recentWorkspaceFiles.length }}</span>
        </div>
        <button v-for="file in store.recentWorkspaceFiles" :key="file.path" type="button" @click="store.openFile(file.path)">
          <span>{{ file.name }}</span>
          <small>{{ file.path }}</small>
        </button>
      </div>
      <WorkspaceTree />
      <div class="preview-summary" v-if="store.selectedFile">
        <div class="preview-head">
          <strong>{{ store.selectedFile }}</strong>
          <div>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.preview')" @click="openPreview"><Eye :size="14" /></button>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.openExternal')" @click="store.openWorkspacePathExternally(store.selectedFile)"><ExternalLink :size="14" /></button>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.download')" @click="store.downloadWorkspacePath(store.selectedFile, 'file')"><Download :size="14" /></button>
            <button class="icon-action" type="button" @click="store.attachWorkspaceFile(store.selectedFile)"><Link2 :size="14" /></button>
            <button class="icon-action" type="button" :disabled="!store.editorDirty || !canEdit" @click="store.resetFile"><RotateCcw :size="14" /></button>
            <button class="icon-action" type="button" :disabled="!store.editorDirty || !canEdit" @click="store.saveFile"><Save :size="14" /></button>
          </div>
        </div>
        <p v-if="store.fileError" class="file-error">{{ store.fileError }}</p>
        <p v-if="!canEdit" class="readonly-note"><Eye :size="14" />{{ t('component.companion.panel.text.be83b668ee') }}</p>
        <span class="dirty-state" :class="{ dirty: store.editorDirty }">{{ store.editorDirty ? t('component.companion.panel.inline.cc6b6c33d6') : t('component.companion.panel.inline.86b4b292f0') }}</span>
      </div>
      <div v-if="workspaceMetaEntries.length" class="workspace-meta-panel">
        <div class="panel-title compact">
          <h2>{{ t('workspace.preview.meta.title') }}</h2>
          <span>{{ workspaceMetaEntries.length }}</span>
        </div>
        <dl class="detail-list">
          <template v-for="item in workspaceMetaEntries" :key="item.key">
            <dt>{{ item.key }}</dt>
            <dd>{{ item.value }}</dd>
          </template>
        </dl>
      </div>
    </section>

    <section v-else-if="store.companionTab === 'evidence'" class="companion-body evidence-tab">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.0a3b6fabd8') }}</h2>
        <span>{{ formatCount('tools', Number(liveMetrics?.tool_calls || 0)) }}</span>
      </div>
      <dl class="detail-list evidence-summary">
        <dt>{{ t('component.companion.panel.text.f37df354d9') }}</dt>
        <dd>{{ displayStatus(liveExecution?.status || 'unknown') }}</dd>
        <dt>{{ t('component.companion.panel.text.97f11d23ce') }}</dt>
        <dd>{{ chat.active?.executionId || store.activeSessionId || '-' }}</dd>
        <dt>{{ t('component.companion.panel.text.2c11686ce6') }}</dt>
        <dd>{{ liveContextLabel }}</dd>
        <dt>{{ t('component.companion.panel.text.06f670e7b4') }}</dt>
        <dd>{{ Number(liveMetrics?.memory_recalls || 0) }} recall / {{ Number(liveMetrics?.memory_evidence || 0) }} evidence</dd>
      </dl>
      <div class="stage-list">
        <article v-for="stage in store.runStageSummary" :key="stage.id" class="stage-row" :data-status="stage.status">
          <strong>{{ stage.label }}</strong>
          <span>{{ displayStatus(stage.status) }}</span>
          <small>{{ stage.count }}</small>
        </article>
      </div>

      <div class="panel-title compact">
        <h2>{{ t('chat.input.panel.title') }}</h2>
        <span>{{ formatCount('items', runtimeInputItems.length) }}</span>
      </div>
      <dl class="detail-list evidence-summary">
        <dt>{{ t('chat.input.panel.activeTurn') }}</dt>
        <dd>{{ store.sessionInputProjection?.active_turn_id || store.turnInbox?.turn_id || '-' }}</dd>
        <dt>{{ t('chat.input.panel.pending') }}</dt>
        <dd>{{ store.sessionInputProjection?.pending_count ?? store.turnInbox?.pending_count ?? 0 }}</dd>
        <dt>{{ t('chat.input.panel.queuedNext') }}</dt>
        <dd>{{ store.sessionInputProjection?.queued_next_count ?? 0 }}</dd>
        <dt>{{ t('chat.input.panel.consumed') }}</dt>
        <dd>{{ store.sessionInputProjection?.consumed_count ?? store.turnInbox?.consumed_count ?? 0 }}</dd>
      </dl>
      <div class="evidence-list">
        <article v-for="item in runtimeInputItems" :key="runtimeInputId(item)" class="evidence-item runtime-input-item">
          <strong>{{ item.content_preview || runtimeInputId(item) }}</strong>
          <p>{{ runtimeInputDetail(item) }}</p>
          <div class="inline-actions">
            <button class="ghost-action" type="button" @click="queueRuntimeInput(item)">{{ t('chat.input.action.queue') }}</button>
            <button class="danger-action" type="button" @click="cancelRuntimeInput(item)">{{ t('chat.input.action.cancel') }}</button>
          </div>
        </article>
        <div v-if="!runtimeInputItems.length" class="empty-state">
          <strong>{{ t('chat.input.panel.emptyTitle') }}</strong>
          <p>{{ t('chat.input.panel.emptyBody') }}</p>
        </div>
      </div>

      <div class="panel-title compact">
        <h2>{{ t('component.companion.panel.text.de0a30c1bf') }}</h2>
        <span>{{ formatCount('items', contextItems.length) }}</span>
      </div>
      <div class="evidence-list">
        <article v-for="item in contextItems" :key="String(item.id || item.ref || item.path || JSON.stringify(item).slice(0, 40))" class="evidence-item">
          <strong>{{ item.title || item.kind || item.source || item.ref || t('component.companion.panel.inline.1d4e255098') }}</strong>
          <p>{{ item.summary || item.text || item.path || item.content || JSON.stringify(item).slice(0, 180) }}</p>
        </article>
        <div v-if="!contextItems.length" class="empty-state">
          <strong>{{ t('component.companion.panel.text.356bff2e1a') }}</strong>
          <p>{{ t('component.companion.panel.text.b409fb7404') }}</p>
        </div>
      </div>

      <div class="panel-title compact">
        <h2>{{ t('component.companion.panel.text.75c2e8fc26') }}</h2>
        <span>{{ formatCount('stages', realityStages.length) }}</span>
      </div>
      <div class="evidence-list">
        <article v-for="stage in realityStages" :key="String(stage.id || stage.kind || stage.ref || JSON.stringify(stage).slice(0, 40))" class="evidence-item">
          <strong>{{ stage.kind || stage.stage || displayStatus(stage.status || 'unknown') }}</strong>
          <p>{{ stage.summary || stage.detail || stage.message || JSON.stringify(stage).slice(0, 180) }}</p>
        </article>
      </div>

      <div class="panel-title compact">
        <h2>{{ t('component.companion.panel.text.727690de87') }}</h2>
        <span>{{ store.currentRunFiles.length }}</span>
      </div>
      <div class="evidence-list">
        <article v-for="file in store.currentRunFiles" :key="file.path" class="evidence-item">
          <strong>{{ file.path }}</strong>
          <p>{{ file.kind }} · {{ displayStatus(file.status) }} · {{ file.ref }}</p>
        </article>
      </div>

      <div class="panel-title compact">
        <h2>{{ t('component.companion.panel.text.1fb9bd1ff9') }}</h2>
        <span>{{ timelineEvents.length }}</span>
      </div>
      <div class="activity-list">
        <article v-for="event in timelineEvents" :key="event.id" class="activity-item" :data-kind="['error', 'failed', 'denied', 'timed_out'].includes(event.status.toLowerCase()) ? 'error' : event.domain">
          <div>
            <strong>{{ event.title }}</strong>
            <p>{{ event.detail }}</p>
            <small v-if="event.correlation">{{ event.correlation }}</small>
          </div>
          <span>{{ displayStatus(event.status) }}</span>
          <RawPayload :title="t('component.workbench.evidence.object.detail.title.payload')" :data="event.raw" />
        </article>
      </div>
    </section>

    <section v-else class="companion-body">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.85df2a90f7') }}</h2>
        <span>{{ inspectorEvents.length }} errors</span>
      </div>
      <dl class="detail-list">
        <dt>{{ t('component.companion.panel.text.594060d245') }}</dt>
        <dd>{{ store.workspaceRoot || t('component.companion.panel.inline.2c58a61ee9') }}</dd>
        <dt>{{ t('component.companion.panel.text.5fab3c518f') }}</dt>
        <dd>{{ store.selectedFile || '-' }}</dd>
        <dt>{{ t('component.companion.panel.text.bd29ce8763') }}</dt>
        <dd>{{ store.fileError || '-' }}</dd>
        <dt>{{ t('component.companion.panel.text.2c11686ce6') }}</dt>
        <dd>{{ liveContextLabel }}</dd>
        <dt>{{ t('component.companion.panel.text.68f0885972') }}</dt>
        <dd>{{ store.selectedActivity?.title || '-' }}</dd>
      </dl>
      <div class="activity-list">
        <article v-for="event in inspectorEvents" :key="event.id" class="activity-item" data-kind="error">
          <div>
            <strong>{{ event.title }}</strong>
            <p>{{ event.detail || t('component.companion.panel.inline.f3fd2cb8bf') }}</p>
          </div>
          <span>{{ displayStatus(event.status || 'error') }}</span>
        </article>
      </div>
    </section>

    <div v-if="previewOpen" class="modal-scrim workspace-preview-scrim" @click.self="closePreview">
      <section class="workspace-preview-modal" tabindex="-1">
        <header>
          <div>
            <strong>{{ store.selectedFile }}</strong>
            <span>{{ previewKind }}</span>
          </div>
          <div class="preview-modal-actions">
            <button class="icon-action" type="button" :disabled="selectedFileIndex <= 0" :aria-label="t('workspace.preview.previous')" @click="stepPreview(-1)"><ChevronLeft :size="16" /></button>
            <button class="icon-action" type="button" :disabled="selectedFileIndex < 0 || selectedFileIndex >= previewableFiles.length - 1" :aria-label="t('workspace.preview.next')" @click="stepPreview(1)"><ChevronRight :size="16" /></button>
            <button v-if="previewKind === 'image'" class="icon-action" type="button" :aria-label="t('workspace.preview.zoomOut')" @click="imageZoom = Math.max(0.4, imageZoom - 0.2)"><ZoomOut :size="16" /></button>
            <button v-if="previewKind === 'image'" class="icon-action" type="button" :aria-label="t('workspace.preview.zoomIn')" @click="imageZoom = Math.min(3, imageZoom + 0.2)"><ZoomIn :size="16" /></button>
            <button v-if="canEdit" class="icon-action" type="button" :aria-label="t('workspace.preview.toggleSource')" @click="previewMode = previewMode === 'render' ? 'source' : 'render'"><Code2 :size="16" /></button>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.openExternal')" @click="store.openWorkspacePathExternally(store.selectedFile)"><ExternalLink :size="16" /></button>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.download')" @click="store.downloadWorkspacePath(store.selectedFile, 'file')"><Download :size="16" /></button>
            <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="closePreview"><X :size="16" /></button>
          </div>
        </header>
        <div class="workspace-preview-content">
          <div v-if="store.fileError" class="unsupported-preview">
            <strong>{{ t('workspace.preview.blocked') }}</strong>
            <p>{{ store.fileError }}</p>
            <button class="ghost-action" type="button" @click="store.downloadWorkspacePath(store.selectedFile, 'file')">
              <Download :size="14" />{{ t('workspace.preview.action.download') }}
            </button>
          </div>
          <div v-else-if="previewKind === 'image'" class="image-preview modal-image">
            <img :src="rawFileUrl" alt="" :style="{ transform: `scale(${imageZoom})` }" />
          </div>
          <iframe v-else-if="previewKind === 'web' && previewMode === 'render'" class="browser-preview" :srcdoc="store.editorContent" sandbox="allow-same-origin"></iframe>
          <iframe v-else-if="previewKind === 'pdf'" class="browser-preview" :src="rawFileUrl"></iframe>
          <audio v-else-if="previewKind === 'audio'" class="media-preview" :src="rawFileUrl" controls></audio>
          <video v-else-if="previewKind === 'video'" class="media-preview video" :src="rawFileUrl" controls></video>
          <div v-else-if="previewKind === 'markdown' && previewMode === 'render'" class="render-preview">
            <MarkdownBlock :content="store.editorContent" />
          </div>
          <textarea v-else-if="canEdit" v-model="store.editorContent" class="structured-preview" spellcheck="false" />
          <div v-else class="unsupported-preview">
            <strong>{{ t('workspace.preview.unsupported.title') }}</strong>
            <p>{{ t('workspace.preview.unsupported.body') }}</p>
            <button class="ghost-action" type="button" @click="store.downloadWorkspacePath(store.selectedFile, 'file')">
              <Download :size="14" />{{ t('workspace.preview.action.download') }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-if="activityDetailOpen && selectedActivity" class="modal-scrim activity-detail-scrim" @click.self="closeActivityDetail">
      <section class="activity-detail-modal" tabindex="-1">
        <header>
          <div>
            <strong>{{ selectedActivity.title }}</strong>
            <span><Clock3 :size="13" />{{ selectedActivityDuration }}</span>
          </div>
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="closeActivityDetail"><X :size="16" /></button>
        </header>
        <div class="activity-detail-content">
          <p v-if="selectedActivity.detail" class="activity-detail-summary">{{ selectedActivity.detail }}</p>
          <RawPayload
            :title="t('chat.activity.detail.input')"
            :data="selectedActivityInput"
            :max-chars="6000"
            default-open
          />
          <RawPayload
            :title="t('chat.activity.detail.output')"
            :data="selectedActivityOutput"
            :max-chars="6000"
            default-open
          />
          <RawPayload
            :title="t('chat.activity.detail.event')"
            :data="selectedActivity.raw || selectedActivity"
            :max-chars="6000"
            default-open
          />
        </div>
      </section>
    </div>
  </aside>
</template>
