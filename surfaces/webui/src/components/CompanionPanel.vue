<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, ref } from 'vue';
import { Brain, ChevronUp, CircleDot, Eye, FilePenLine, FilePlus2, FileText, Folder, FolderPlus, Info, Link2, RotateCcw, Save, Search, Trash2, Upload, Workflow, X } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import MarkdownBlock from './MarkdownBlock.vue';

const store = useAppStore();
const newFolderName = ref('');
const renamePath = ref('');
const renameTarget = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

const breadcrumbs = computed(() => {
  const parts = store.workspaceDir.split('/').filter(Boolean);
  return [{ label: 'root', path: '' }, ...parts.map((part, index) => ({
    label: part,
    path: parts.slice(0, index + 1).join('/'),
  }))];
});

const parentDir = computed(() => {
  const parts = store.workspaceDir.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
});

const selectedExt = computed(() => store.selectedFile.split('.').pop()?.toLowerCase() || '');
const isMarkdown = computed(() => ['md', 'markdown'].includes(selectedExt.value));
const isImage = computed(() => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(selectedExt.value));
const isStructured = computed(() => ['json', 'yaml', 'yml', 'toml'].includes(selectedExt.value));
const rawFileUrl = computed(() => `/api/file/raw?path=${encodeURIComponent(store.selectedFile)}`);
const canEdit = computed(() => !!store.selectedFile && !isImage.value);
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

function openFile(path: string, kind: string) {
  if (kind === 'dir') store.loadWorkspace(path);
  else store.openFile(path);
}

async function createFolder() {
  const name = newFolderName.value.trim();
  if (!name) return;
  await store.createWorkspaceDir(name);
  newFolderName.value = '';
}

async function uploadFiles(files: FileList | null) {
  if (!files?.length) return;
  for (const file of Array.from(files)) {
    await store.uploadResource(file);
  }
  if (fileInput.value) fileInput.value.value = '';
}

async function dropUpload(event: DragEvent) {
  event.preventDefault();
  await uploadFiles(event.dataTransfer?.files || null);
}

function startRename(path: string) {
  renamePath.value = path;
  renameTarget.value = path;
}

async function commitRename() {
  if (!renamePath.value || !renameTarget.value.trim()) return;
  await store.renameWorkspacePath(renamePath.value, renameTarget.value.trim());
  renamePath.value = '';
  renameTarget.value = '';
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
          <span>{{ event.status || t('component.companion.panel.inline.77e447be0d') }}</span>
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
          <span>{{ event.status || t('component.companion.panel.inline.77e447be0d') }}</span>
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
      <div class="workspace-create">
        <label>
          <FolderPlus :size="14" />
          <input v-model="newFolderName" type="text" :placeholder="t('component.companion.panel.placeholder.08fa8937cf')" @keydown.enter.prevent="createFolder" />
        </label>
        <button class="icon-action" type="button" :disabled="!newFolderName.trim()" @click="createFolder"><FilePlus2 :size="14" /></button>
      </div>
      <div v-if="store.attachments.length" class="attachment-list">
        <div class="panel-title compact">
          <h2>{{ t('component.companion.panel.text.7a057b8ff5') }}</h2>
          <span>{{ store.attachments.length }}</span>
        </div>
        <article v-for="attachment in store.attachments" :key="attachment.ref_id" class="attachment-row">
          <Link2 :size="14" />
          <span>{{ attachment.label || attachment.path }}</span>
          <small>{{ attachment.kind }} · {{ attachment.detected_mime || attachment.status || t('component.companion.panel.inline.1bb23d605f') }}</small>
          <button class="icon-action" type="button" @click="store.removeAttachment(attachment.ref_id)"><X :size="13" /></button>
        </article>
      </div>
      <nav class="breadcrumbs" :aria-label="t('component.companion.panel.aria-label.4ee55d3234')">
        <button v-for="crumb in breadcrumbs" :key="crumb.path || 'root'" type="button" @click="store.loadWorkspace(crumb.path)">
          {{ crumb.label }}
        </button>
      </nav>
      <button class="ghost-action" type="button" @click="store.loadWorkspace(parentDir)">
        <ChevronUp :size="15" />
        {{ t('component.companion.panel.text.parentFolder') }}
      </button>
      <label class="workspace-search">
        <Search :size="14" />
        <input v-model="store.workspaceFilter" type="search" :placeholder="t('component.companion.panel.placeholder.070c810b3f')" />
      </label>
      <div class="file-list">
        <article
          v-for="file in store.filteredWorkspaceFiles"
          :key="file.path"
          class="file-row"
        >
          <button type="button" @click="openFile(file.path, file.kind)">
            <Folder v-if="file.kind === 'dir'" :size="16" />
            <FileText v-else :size="16" />
            <span>{{ file.name }}</span>
          </button>
          <small>{{ file.kind }}</small>
          <button class="icon-action" type="button" :aria-label="t('component.companion.panel.aria.renameFile', { name: file.name })" @click="startRename(file.path)"><FilePenLine :size="13" /></button>
          <button class="icon-action" type="button" :aria-label="t('component.companion.panel.aria.deleteFile', { name: file.name })" @click="store.deleteWorkspacePath(file.path)"><Trash2 :size="13" /></button>
          <div v-if="renamePath === file.path" class="rename-row">
            <input v-model="renameTarget" type="text" @keydown.enter.prevent="commitRename" />
            <button class="ghost-action" type="button" @click="commitRename">{{ t('component.companion.panel.text.feb4f37c13') }}</button>
            <button class="ghost-action" type="button" @click="renamePath = ''">{{ t('component.companion.panel.text.8881905a84') }}</button>
          </div>
        </article>
      </div>
      <div class="preview-pane" v-if="store.selectedFile">
        <div class="preview-head">
          <strong>{{ store.selectedFile }}</strong>
          <div>
            <button class="icon-action" type="button" @click="store.attachWorkspaceFile(store.selectedFile)"><Link2 :size="14" /></button>
            <button class="icon-action" type="button" :disabled="!store.editorDirty || !canEdit" @click="store.resetFile"><RotateCcw :size="14" /></button>
            <button class="icon-action" type="button" :disabled="!store.editorDirty || !canEdit" @click="store.saveFile"><Save :size="14" /></button>
          </div>
        </div>
        <div v-if="isImage" class="image-preview">
          <img :src="rawFileUrl" alt="" />
        </div>
        <div v-else-if="isMarkdown" class="render-preview">
          <MarkdownBlock :content="store.editorContent" />
        </div>
        <textarea v-else-if="isStructured" v-model="store.editorContent" class="structured-preview" spellcheck="false" />
        <textarea v-else v-model="store.editorContent" spellcheck="false" />
        <p v-if="store.fileError" class="file-error">{{ store.fileError }}</p>
        <p v-if="!canEdit" class="readonly-note"><Eye :size="14" />{{ t('component.companion.panel.text.be83b668ee') }}</p>
        <span class="dirty-state" :class="{ dirty: store.editorDirty }">{{ store.editorDirty ? t('component.companion.panel.inline.cc6b6c33d6') : t('component.companion.panel.inline.86b4b292f0') }}</span>
      </div>
    </section>

    <section v-else-if="store.companionTab === 'evidence'" class="companion-body evidence-tab">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.0a3b6fabd8') }}</h2>
        <span>{{ formatCount('tools', store.toolCallCount) }}</span>
      </div>
      <dl class="detail-list evidence-summary">
        <dt>{{ t('component.companion.panel.text.f37df354d9') }}</dt>
        <dd>{{ store.currentRun?.status || t('component.companion.panel.inline.4a44588598') }}</dd>
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
          <span>{{ stage.status }}</span>
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
          <strong>{{ stage.kind || stage.stage || stage.status || t('component.companion.panel.inline.33236162c2') }}</strong>
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
          <p>{{ file.kind }} · {{ file.status }} · {{ file.ref }}</p>
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
            <p>{{ event.summary || event.detail || event.status || JSON.stringify(event).slice(0, 180) }}</p>
          </div>
          <span>{{ event.status || event.sequence || t('component.companion.panel.inline.77e447be0d') }}</span>
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
          <span>{{ event.status || t('component.companion.panel.inline.0bafd75e47') }}</span>
        </article>
      </div>
    </section>
  </aside>
</template>
