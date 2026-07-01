<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Copy, Download, ExternalLink, FilePlus2, FileText, FolderOpen, FolderPlus, Info, Link2, Pencil, Trash2, X } from 'lucide-vue-next';
import { t } from '../../i18n';
import type { WorkspaceContextTarget } from '../../utils/workspaceTree';

const props = defineProps<{
  target: WorkspaceContextTarget | null;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  action: [action: string, target: WorkspaceContextTarget];
}>();

const confirmingDelete = ref(false);

const style = computed(() => ({
  left: `${Math.max(8, props.x)}px`,
  top: `${Math.max(8, props.y)}px`,
}));

watch(() => props.target, () => {
  confirmingDelete.value = false;
});

function run(action: string) {
  if (!props.target) return;
  emit('action', action, props.target);
  if (action !== 'delete-pending') emit('close');
}

function deleteAction() {
  if (!confirmingDelete.value) {
    confirmingDelete.value = true;
    return;
  }
  run('delete');
}
</script>

<template>
  <div
    v-if="target"
    class="workspace-context-menu"
    :style="style"
    role="menu"
    tabindex="-1"
    @click.stop
    @keydown.escape.prevent="emit('close')"
  >
    <button v-if="target.kind !== 'blank'" type="button" role="menuitem" @click="run('open')">
      <FolderOpen v-if="target.kind === 'dir'" :size="14" />
      <FileText v-else :size="14" />
      {{ t('workspace.tree.action.open') }}
    </button>
    <button v-if="target.kind !== 'file'" type="button" role="menuitem" @click="run('new-file')">
      <FilePlus2 :size="14" />
      {{ t('workspace.tree.action.newFile') }}
    </button>
    <button v-if="target.kind !== 'file'" type="button" role="menuitem" @click="run('new-folder')">
      <FolderPlus :size="14" />
      {{ t('workspace.tree.action.newFolder') }}
    </button>
    <button v-if="target.kind !== 'blank'" type="button" role="menuitem" @click="run('rename')">
      <Pencil :size="14" />
      {{ t('workspace.tree.action.rename') }}
    </button>
    <button v-if="target.kind === 'file'" type="button" role="menuitem" @click="run('attach')">
      <Link2 :size="14" />
      {{ t('workspace.tree.action.attach') }}
    </button>
    <button v-if="target.kind === 'file'" type="button" role="menuitem" @click="run('open-external')">
      <ExternalLink :size="14" />
      {{ t('workspace.tree.action.openExternal') }}
    </button>
    <button v-if="target.kind !== 'blank'" type="button" role="menuitem" @click="run('download')">
      <Download :size="14" />
      {{ t('workspace.tree.action.download') }}
    </button>
    <button v-if="target.kind !== 'blank'" type="button" role="menuitem" @click="run('copy-path')">
      <Copy :size="14" />
      {{ t('workspace.tree.action.copyPath') }}
    </button>
    <button v-if="target.kind !== 'blank'" type="button" role="menuitem" @click="run('meta')">
      <Info :size="14" />
      {{ t('workspace.tree.action.meta') }}
    </button>
    <button
      v-if="target.kind !== 'blank'"
      class="danger"
      type="button"
      role="menuitem"
      @click="deleteAction"
    >
      <Trash2 :size="14" />
      {{ confirmingDelete ? t('workspace.tree.action.confirmDelete') : t('workspace.tree.action.delete') }}
    </button>
    <button type="button" role="menuitem" @click="emit('close')">
      <X :size="14" />
      {{ t('workspace.tree.action.close') }}
    </button>
  </div>
</template>
