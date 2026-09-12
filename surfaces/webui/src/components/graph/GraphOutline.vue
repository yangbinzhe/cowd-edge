<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ArrowDown, ArrowRight } from 'lucide-vue-next';
import type { GraphNodeView } from '../../types/graph';
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';
const props = defineProps<{
  nodes: GraphNodeView[];
  parents: Map<string, string>;
  children: Map<string, string[]>;
  depths: Map<string, number>;
  collapsed: Set<string>;
  selectedId: string;
  filtering: boolean;
}>();
const emit = defineEmits<{ select: [node: GraphNodeView]; toggle: [id: string] }>();
const viewport = ref<HTMLElement | null>(null);
const offset = ref(0);
const focusedId = ref('');
const rowHeight = 48;
const windowSize = 30;
const start = computed(() => Math.max(0, Math.min(Math.floor(offset.value / rowHeight) - 4, props.nodes.length - windowSize)));
const rows = computed(() => props.nodes.slice(start.value, start.value + windowSize));
const siblingPosition = computed(() => {
  const result = new Map<string, { index: number; size: number }>();
  const roots = props.nodes.filter(node => !props.parents.has(node.id)).map(node => node.id);
  for (const siblings of [roots, ...props.children.values()]) {
    siblings.forEach((id, index) => result.set(id, { index: index + 1, size: siblings.length }));
  }
  return result;
});
const tabStop = computed(() => rows.value.some(node => node.id === focusedId.value) ? focusedId.value : rows.value[0]?.id);
const indexById = computed(() => new Map(props.nodes.map((node, index) => [node.id, index])));
async function focusIndex(index: number) {
  const node = props.nodes[Math.max(0, Math.min(index, props.nodes.length - 1))];
  if (!node) return;
  focusedId.value = node.id;
  const top = (indexById.value.get(node.id) || 0) * rowHeight;
  if (viewport.value) {
    const height = viewport.value.clientHeight || 480;
    if (top < viewport.value.scrollTop || top + rowHeight > viewport.value.scrollTop + height) {
      viewport.value.scrollTop = top;
      offset.value = top;
    }
  }
  await nextTick();
  viewport.value?.querySelector<HTMLElement>(`[data-row-index="${indexById.value.get(node.id)}"]`)?.focus();
}
function keydown(event: KeyboardEvent, node: GraphNodeView) {
  const index = indexById.value.get(node.id) || 0;
  if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowDown') void focusIndex(index + 1);
  else if (event.key === 'ArrowUp') void focusIndex(index - 1);
  else if (event.key === 'Home') void focusIndex(0);
  else if (event.key === 'End') void focusIndex(props.nodes.length - 1);
  else if (event.key === 'Enter' || event.key === ' ') emit('select', node);
  else if (event.key === 'ArrowRight') {
    if (props.collapsed.has(node.id) && !props.filtering) emit('toggle', node.id);
    else if (props.children.has(node.id)) void focusIndex(index + 1);
  } else if (props.children.has(node.id) && !props.collapsed.has(node.id) && !props.filtering) emit('toggle', node.id);
  else {
    const parent = props.parents.get(node.id);
    if (parent && indexById.value.has(parent)) void focusIndex(indexById.value.get(parent)!);
  }
}
watch(() => props.nodes, () => {
  if (!indexById.value.has(focusedId.value)) focusedId.value = props.nodes[0]?.id || '';
  const max = Math.max(0, (props.nodes.length - 1) * rowHeight);
  offset.value = Math.min(offset.value, max);
  if (viewport.value) viewport.value.scrollTop = offset.value;
}, { immediate: true });
</script>

<template>
  <div ref="viewport" class="graph-outline" role="tree" :aria-label="t('graph.action.list')"
    @scroll="offset = ($event.target as HTMLElement).scrollTop" @keydown.stop>
    <div role="none" :style="{ height: `${nodes.length * rowHeight}px`, position: 'relative' }">
      <div v-for="(node, index) in rows" :key="node.id" role="treeitem" class="graph-outline-row"
        :data-row-index="start + index" :aria-level="(depths.get(node.id) || 0) + 1"
        :aria-selected="selectedId === node.id"
        :aria-posinset="siblingPosition.get(node.id)?.index" :aria-setsize="siblingPosition.get(node.id)?.size"
        :aria-expanded="children.has(node.id) ? filtering || !collapsed.has(node.id) : undefined"
        :tabindex="tabStop === node.id ? 0 : -1"
        :style="{ top: `${(start + index) * rowHeight}px`, paddingInlineStart: `${8 + Math.min(depths.get(node.id) || 0, 12) * 16}px` }"
        @focus="focusedId = node.id" @keydown="keydown($event, node)" @click="emit('select', node)">
        <button v-if="children.has(node.id)" type="button" tabindex="-1" :disabled="filtering"
          :aria-label="t(collapsed.has(node.id) ? 'graph.action.expandBranch' : 'graph.action.collapseBranch', { label: node.label })"
          @click.stop="emit('toggle', node.id)">
          <ArrowRight v-if="collapsed.has(node.id) && !filtering" :size="14" /><ArrowDown v-else :size="14" />
        </button>
        <span v-else class="graph-outline-leaf" aria-hidden="true" />
        <span class="graph-outline-label" :title="`${node.label}\n${node.summary || node.id}`">{{ node.label }}<small>{{ node.summary || node.id }}</small></span>
        <span class="graph-outline-status">{{ displayStatus(node.status) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-outline { height: min(60vh, 720px); min-height: 240px; overflow: auto; position: relative; }
.graph-outline-row { position: absolute; inset-inline: 0; height: 48px; display: flex; gap: 8px; align-items: center; padding-inline-end: 12px; cursor: pointer; box-sizing: border-box; }
.graph-outline-row[aria-selected="true"] { background: var(--surface-hover, rgba(128, 128, 128, .12)); }
.graph-outline-row:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
.graph-outline-row button { background: transparent; color: inherit; border: 0; padding: 4px; flex: 0 0 24px; }
.graph-outline-leaf { flex: 0 0 24px; }
.graph-outline-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.graph-outline-label small { display: block; opacity: .75; overflow: hidden; text-overflow: ellipsis; }
.graph-outline-status { flex: 0 0 auto; font-size: 12px; }
</style>
