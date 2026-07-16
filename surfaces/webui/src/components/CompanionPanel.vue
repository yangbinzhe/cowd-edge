<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Brain, ChevronLeft, ChevronRight, CircleDot, Code2, Download, ExternalLink, Eye, Folder, Info, Link2, RotateCcw, Save, Search, Upload, Workflow, X, ZoomIn, ZoomOut } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import MarkdownBlock from './MarkdownBlock.vue';
import { useEscapeKey } from '../composables/useEscapeKey';
import { displayStatus } from '../i18n/domain/status';
import WorkspaceTree from './workspace/WorkspaceTree.vue';
import { isWorkspaceEditablePreview, workspacePreviewKind } from '../utils/workspacePreview';

const store = useAppStore();
const chat = useChatSessionsStore();
const projections = useProjectionRegistryStore();
const fileInput = ref<HTMLInputElement | null>(null);
const previewOpen = ref(false);
const previewMode = ref<'render' | 'source'>('render');
const imageZoom = ref(1);
const resizing = ref(false);

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
const thinkingEvents = computed(() => store.activity.filter((event) => event.kind === 'think'));
const inspectorEvents = computed(() => store.activity.filter((event) => event.kind === 'error' || event.status === 'error'));
const contextItems = computed(() => {
  const envelope = store.currentContextEnvelope || {};
  return [
    ...(Array.isArray(envelope.items) ? envelope.items : []),
    ...(Array.isArray(envelope.context_items) ? envelope.context_items : []),
    ...(Array.isArray(envelope.evidence) ? envelope.evidence : []),
  ].slice(0, 12);
});
const realityStages = computed(() => (Array.isArray(store.currentRealityFlow?.stages) ? store.currentRealityFlow.stages : []).slice(0, 12));
const timelineEvents = computed(() => (Array.isArray(store.currentTimeline?.events) ? store.currentTimeline.events : []).slice(0, 14));
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
const activeProjection = computed(() => chat.active?.executionId ? projections.projectionFor(chat.active.executionId) : null);
const liveExecution = computed(() => activeProjection.value?.live || chat.active?.live || null);
const liveMetrics = computed(() => liveExecution.value?.metrics || null);
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

onMounted(() => {
  const savedWidth = Number(localStorage.getItem('cowd-webui-companion-width') || 0);
  if (savedWidth) applyCompanionWidth(savedWidth);
  window.addEventListener('mousemove', dragResize);
  window.addEventListener('mouseup', stopResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', dragResize);
  window.removeEventListener('mouseup', stopResize);
});
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
        <span>{{ formatCount('events', store.activity.length) }}</span>
      </div>
      <div class="activity-list">
        <article v-for="event in store.activity" :key="event.id" class="activity-item" :data-kind="event.kind" @click="store.selectedActivity = event">
          <div>
            <strong>{{ event.title }}</strong>
            <p>{{ event.detail || t('component.companion.panel.inline.f3fd2cb8bf') }}</p>
          </div>
          <span>{{ displayStatus(event.status || 'unknown') }}</span>
        </article>
      </div>
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
        <article v-for="event in timelineEvents" :key="String(event.sequence || event.id || JSON.stringify(event).slice(0, 40))" class="activity-item" :data-kind="String(event.kind || event.type || 'runtime').toLowerCase().includes('error') ? 'error' : 'runtime'">
          <div>
            <strong>{{ event.kind || event.type || event.event_type || t('component.companion.panel.inline.edbaf9232e') }}</strong>
            <p>{{ event.summary || event.detail || (event.status ? displayStatus(event.status) : JSON.stringify(event).slice(0, 180)) }}</p>
          </div>
          <span>{{ event.status ? displayStatus(event.status) : (event.sequence || t('component.companion.panel.inline.77e447be0d')) }}</span>
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
  </aside>
</template>
