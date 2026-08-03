<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ChevronRight, Download, Eye, FileText, Folder, FolderOpen, MoreHorizontal, Plus, Search } from 'lucide-vue-next';
import { t } from '../../i18n';
import { useAppStore } from '../../stores/app';
import {
  fileNameOf,
  flattenWorkspaceTree,
  joinWorkspacePath,
  parentPathOf,
  type WorkspaceContextTarget,
  type WorkspaceTreeNode,
} from '../../utils/workspaceTree';
import WorkspaceContextMenu from './WorkspaceContextMenu.vue';

const store = useAppStore();
const inlineInput = ref<HTMLInputElement | null>(null);
const inlineAction = ref<{
  kind: 'new-file' | 'new-folder' | 'rename';
  parent: string;
  path: string;
  value: string;
} | null>(null);
const contextTarget = ref<WorkspaceContextTarget | null>(null);
const contextX = ref(0);
const contextY = ref(0);
const dropTargetPath = ref('');

function formatFileSize(value: number | undefined) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes >= 102_400 ? 0 : 1).replace(/\.0$/, '')} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(bytes >= 104_857_600 ? 0 : 1).replace(/\.0$/, '')} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1).replace(/\.0$/, '')} GB`;
}

const treeRows = computed(() => {
  const rows = flattenWorkspaceTree(store.workspaceTreeRoot);
  const query = store.workspaceFilter.trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => `${row.name} ${row.path}`.toLowerCase().includes(query));
});

function targetFromNode(node: WorkspaceTreeNode): WorkspaceContextTarget {
  return {
    path: node.path,
    name: node.name,
    kind: node.kind,
  };
}

function openContext(event: MouseEvent, target: WorkspaceContextTarget) {
  contextTarget.value = target;
  contextX.value = event.clientX;
  contextY.value = event.clientY;
}

function openBlankContext(event: MouseEvent) {
  openContext(event, {
    path: store.workspaceDir || '',
    name: store.workspaceDir || 'root',
    kind: 'blank',
  });
}

async function activateNode(node: WorkspaceTreeNode) {
  await store.selectWorkspacePath(node.path, node.kind);
}

async function keyAction(event: KeyboardEvent, node: WorkspaceTreeNode) {
  if (event.key === 'Enter') {
    event.preventDefault();
    await activateNode(node);
  } else if (event.key === 'ArrowRight' && node.kind === 'dir' && !node.expanded) {
    event.preventDefault();
    await store.toggleWorkspaceTreeDir(node.path);
  } else if (event.key === 'ArrowLeft' && node.kind === 'dir' && node.expanded) {
    event.preventDefault();
    await store.toggleWorkspaceTreeDir(node.path);
  } else if (event.key === 'F10' && event.shiftKey) {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openContext({ clientX: rect.left + 24, clientY: rect.top + 24 } as MouseEvent, targetFromNode(node));
  }
}

async function beginInline(kind: 'new-file' | 'new-folder', parent: string) {
  inlineAction.value = { kind, parent, path: '', value: '' };
  await nextTick();
  inlineInput.value?.focus();
}

async function beginRename(target: WorkspaceContextTarget) {
  inlineAction.value = {
    kind: 'rename',
    parent: parentPathOf(target.path),
    path: target.path,
    value: fileNameOf(target.path),
  };
  await nextTick();
  inlineInput.value?.focus();
  inlineInput.value?.select();
}

function cancelInline() {
  inlineAction.value = null;
}

async function commitInline() {
  const action = inlineAction.value;
  const value = action?.value.trim();
  if (!action || !value) return;
  if (action.kind === 'new-file') {
    await store.createWorkspaceFile(joinWorkspacePath(action.parent, value));
  } else if (action.kind === 'new-folder') {
    await store.createWorkspaceDirAt(action.parent, value);
  } else {
    await store.renameWorkspacePath(action.path, joinWorkspacePath(action.parent, value));
  }
  inlineAction.value = null;
}

async function handleMenuAction(action: string, target: WorkspaceContextTarget) {
  const parent = target.kind === 'file' ? parentPathOf(target.path) : target.path || store.workspaceDir || '';
  if (action === 'open') {
    await store.selectWorkspacePath(target.path, target.kind === 'blank' ? 'dir' : target.kind);
  } else if (action === 'new-file') {
    await beginInline('new-file', parent);
  } else if (action === 'new-folder') {
    await beginInline('new-folder', parent);
  } else if (action === 'rename') {
    await beginRename(target);
  } else if (action === 'delete') {
    await store.deleteWorkspacePathConfirmed(target.path);
  } else if (action === 'copy-path') {
    try {
      await navigator.clipboard?.writeText(target.path);
    } catch {
      store.fileError = t('workspace.tree.error.copyPath');
    }
  } else if (action === 'attach') {
    await store.attachWorkspaceFile(target.path);
  } else if (action === 'meta') {
    await store.loadWorkspaceMeta(target.path);
  } else if (action === 'download') {
    store.downloadWorkspacePath(target.path, target.kind === 'dir' ? 'dir' : 'file');
  } else if (action === 'open-external') {
    await store.openWorkspacePathExternally(target.path);
  }
}

async function dropOnNode(event: DragEvent, node: WorkspaceTreeNode) {
  if (node.kind !== 'dir') return;
  event.preventDefault();
  dropTargetPath.value = '';
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  await store.uploadWorkspaceFiles(files, node.path);
  await store.loadWorkspaceTreeDir(node.path, true);
}
</script>

<template>
  <div class="workspace-tree-shell" @click="contextTarget = null">
    <div class="workspace-tree-toolbar">
      <button class="ghost-action" type="button" @click="beginInline('new-file', store.workspaceDir || '')">
        <FileText :size="14" />
        {{ t('workspace.tree.action.newFile') }}
      </button>
      <button class="ghost-action" type="button" @click="beginInline('new-folder', store.workspaceDir || '')">
        <Plus :size="14" />
        {{ t('workspace.tree.action.newFolder') }}
      </button>
    </div>
    <div
      class="workspace-tree"
      role="tree"
      :aria-label="t('workspace.tree.aria')"
      @contextmenu.self.prevent="openBlankContext"
    >
      <div v-if="inlineAction && inlineAction.kind !== 'rename'" class="workspace-inline-action">
        <Search :size="14" />
        <input
          ref="inlineInput"
          v-model="inlineAction.value"
          type="text"
          :placeholder="inlineAction.kind === 'new-file' ? t('workspace.tree.placeholder.file') : t('workspace.tree.placeholder.folder')"
          @keydown.enter.prevent="commitInline"
          @keydown.escape.prevent="cancelInline"
        />
        <button class="ghost-action" type="button" @click="commitInline">{{ t('workspace.tree.action.create') }}</button>
        <button class="ghost-action" type="button" @click="cancelInline">{{ t('workspace.tree.action.cancel') }}</button>
      </div>

      <article
        v-for="node in treeRows"
        :key="node.path || 'root'"
        class="workspace-tree-node"
        :class="{ selected: store.selectedFile === node.path || store.workspaceDir === node.path, loading: node.loading, 'drop-target': dropTargetPath === node.path }"
        :style="{ '--tree-depth': Math.min(node.depth, 8) }"
        role="treeitem"
        :aria-expanded="node.kind === 'dir' ? String(node.expanded) : undefined"
        tabindex="0"
        @keydown="keyAction($event, node)"
        @contextmenu.prevent="openContext($event, targetFromNode(node))"
        @dragenter.prevent="node.kind === 'dir' && (dropTargetPath = node.path)"
        @dragover.prevent="node.kind === 'dir' && (dropTargetPath = node.path)"
        @dragleave="dropTargetPath === node.path && (dropTargetPath = '')"
        @drop="dropOnNode($event, node)"
      >
        <button class="workspace-tree-main" type="button" @click="activateNode(node)">
          <ChevronRight v-if="node.kind === 'dir'" class="tree-chevron" :class="{ expanded: node.expanded }" :size="14" />
          <span v-else class="tree-chevron-placeholder" aria-hidden="true"></span>
          <FolderOpen v-if="node.kind === 'dir' && node.expanded" :size="15" />
          <Folder v-else-if="node.kind === 'dir'" :size="15" />
          <FileText v-else :size="15" />
          <span class="workspace-tree-name" :title="node.path || node.name">{{ node.name }}</span>
          <i v-if="store.selectedFile === node.path && store.editorDirty" class="workspace-tree-dirty" :title="t('workspace.tree.dirty')"></i>
        </button>
        <small>{{ node.kind === 'dir' ? (node.loaded ? node.children.length : t('workspace.tree.lazy')) : formatFileSize(node.size) }}</small>
        <div class="workspace-tree-actions">
          <button
            v-if="node.kind === 'file'"
            class="icon-action workspace-tree-preview"
            type="button"
            :aria-label="t('workspace.tree.action.previewTarget', { name: node.name })"
            @click.stop="store.openFile(node.path)"
          >
            <Eye :size="14" />
          </button>
          <button
            class="icon-action workspace-tree-download"
            type="button"
            :aria-label="t('workspace.tree.action.downloadTarget', { name: node.name })"
            @click.stop="store.downloadWorkspacePath(node.path, node.kind)"
          >
            <Download :size="14" />
          </button>
          <button class="icon-action workspace-tree-more" type="button" :aria-label="t('workspace.tree.action.more', { name: node.name })" @click.stop="openContext($event, targetFromNode(node))">
            <MoreHorizontal :size="14" />
          </button>
        </div>
        <div v-if="inlineAction?.kind === 'rename' && inlineAction.path === node.path" class="workspace-inline-action rename">
          <input
            ref="inlineInput"
            v-model="inlineAction.value"
            type="text"
            @keydown.enter.prevent="commitInline"
            @keydown.escape.prevent="cancelInline"
          />
          <button class="ghost-action" type="button" @click="commitInline">{{ t('workspace.tree.action.rename') }}</button>
          <button class="ghost-action" type="button" @click="cancelInline">{{ t('workspace.tree.action.cancel') }}</button>
        </div>
      </article>

      <div v-if="!treeRows.length" class="empty-state compact">
        <strong>{{ t('workspace.tree.empty.title') }}</strong>
        <p>{{ t('workspace.tree.empty.body') }}</p>
      </div>
    </div>
    <WorkspaceContextMenu
      :target="contextTarget"
      :x="contextX"
      :y="contextY"
      @close="contextTarget = null"
      @action="handleMenuAction"
    />
  </div>
</template>
