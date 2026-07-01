<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, ref } from 'vue';
import { Brain, CircleDot, Download, ExternalLink, Eye, Folder, Info, Link2, RotateCcw, Save, Search, Upload, Workflow, X } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import MarkdownBlock from './MarkdownBlock.vue';
import { displayStatus } from '../i18n/domain/status';
import WorkspaceTree from './workspace/WorkspaceTree.vue';
import { isWorkspaceEditablePreview, workspacePreviewKind } from '../utils/workspacePreview';

const store = useAppStore();
const fileInput = ref<HTMLInputElement | null>(null);

const previewKind = computed(() => store.selectedFile ? workspacePreviewKind(store.selectedFile) : 'binary');
const rawFileUrl = computed(() => store.rawWorkspaceFileUrl(store.selectedFile));
const canEdit = computed(() => !!store.selectedFile && isWorkspaceEditablePreview(store.selectedFile));
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

async function uploadFiles(files: FileList | null) {
  if (!files?.length) return;
  await store.uploadWorkspaceFiles(files);
  if (fileInput.value) fileInput.value.value = '';
}

async function dropUpload(event: DragEvent) {
  event.preventDefault();
  await uploadFiles(event.dataTransfer?.files || null);
}
</script>

<template>
  <aside class="companion-panel" :aria-label="t('component.companion.panel.aria-label.98b3d09f27')">
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
      <WorkspaceTree />
      <div class="preview-pane" v-if="store.selectedFile">
        <div class="preview-head">
          <strong>{{ store.selectedFile }}</strong>
          <div>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.openExternal')" @click="store.openWorkspacePathExternally(store.selectedFile)"><ExternalLink :size="14" /></button>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.download')" @click="store.downloadWorkspacePath(store.selectedFile, 'file')"><Download :size="14" /></button>
            <button class="icon-action" type="button" @click="store.attachWorkspaceFile(store.selectedFile)"><Link2 :size="14" /></button>
            <button class="icon-action" type="button" :disabled="!store.editorDirty || !canEdit" @click="store.resetFile"><RotateCcw :size="14" /></button>
            <button class="icon-action" type="button" :disabled="!store.editorDirty || !canEdit" @click="store.saveFile"><Save :size="14" /></button>
          </div>
        </div>
        <div v-if="previewKind === 'image'" class="image-preview">
          <img :src="rawFileUrl" alt="" />
        </div>
        <iframe v-else-if="previewKind === 'web'" class="browser-preview" :srcdoc="store.editorContent" sandbox="allow-same-origin"></iframe>
        <iframe v-else-if="previewKind === 'pdf'" class="browser-preview" :src="rawFileUrl"></iframe>
        <audio v-else-if="previewKind === 'audio'" class="media-preview" :src="rawFileUrl" controls></audio>
        <video v-else-if="previewKind === 'video'" class="media-preview video" :src="rawFileUrl" controls></video>
        <div v-else-if="previewKind === 'markdown'" class="render-preview">
          <MarkdownBlock :content="store.editorContent" />
        </div>
        <textarea v-else-if="previewKind === 'structured'" v-model="store.editorContent" class="structured-preview" spellcheck="false" />
        <textarea v-else-if="previewKind === 'text'" v-model="store.editorContent" spellcheck="false" />
        <div v-else class="unsupported-preview">
          <strong>{{ t('workspace.preview.unsupported.title') }}</strong>
          <p>{{ t('workspace.preview.unsupported.body') }}</p>
          <button class="ghost-action" type="button" @click="store.downloadWorkspacePath(store.selectedFile, 'file')">
            <Download :size="14" />{{ t('workspace.preview.action.download') }}
          </button>
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
        <span>{{ formatCount('tools', store.toolCallCount) }}</span>
      </div>
      <dl class="detail-list evidence-summary">
        <dt>{{ t('component.companion.panel.text.f37df354d9') }}</dt>
        <dd>{{ displayStatus(store.currentRun?.status || 'unknown') }}</dd>
        <dt>{{ t('component.companion.panel.text.97f11d23ce') }}</dt>
        <dd>{{ store.currentRun?.run_id || store.currentRun?.turn_id || store.activeSessionId || '-' }}</dd>
        <dt>{{ t('component.companion.panel.text.2c11686ce6') }}</dt>
        <dd>{{ store.currentRun?.context_envelope_id || store.currentContextEnvelope?.id || '-' }}</dd>
        <dt>{{ t('component.companion.panel.text.06f670e7b4') }}</dt>
        <dd>{{ store.memoryRecallCount }} recall / {{ store.memoryEvidenceCount }} evidence</dd>
      </dl>
      <div class="stage-list">
        <article v-for="stage in store.runStageSummary" :key="stage.id" class="stage-row" :data-status="stage.status">
          <strong>{{ stage.label }}</strong>
          <span>{{ displayStatus(stage.status) }}</span>
          <small>{{ stage.count }}</small>
        </article>
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
        <dd>{{ store.contextUsagePercent === null ? store.contextUsageSource : `${store.contextUsagePercent}%` }}</dd>
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
  </aside>
</template>
