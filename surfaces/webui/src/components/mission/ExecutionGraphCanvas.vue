<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ActivityEvent } from '../../types';
import { adaptExecutionGraph } from '../../adapters/graph/execution';
import { activeExecutionNode } from '../../utils/executionNode';
import {
  applyExecutionActivityState,
  expandExecutionToolBatches,
} from '../../utils/executionToolGraph';
import GraphSurface from '../graph/GraphSurface.vue';
import ExecutionNodeDetail from './ExecutionNodeDetail.vue';

const props = withDefaults(defineProps<{
  graph: Record<string, any> | null;
  selectedNodeId?: string;
  connectionState?: string;
  activityEvents?: ActivityEvent[];
  compact?: boolean;
  loading?: boolean;
}>(), {
  selectedNodeId: '',
  connectionState: 'ready',
  activityEvents: () => [],
  compact: false,
  loading: false,
});

const emit = defineEmits<{
  select: [node: Record<string, any>];
  expand: [];
}>();
const root = ref<HTMLElement | null>(null);
const projectedGraph = computed(() => expandExecutionToolBatches(
  applyExecutionActivityState(props.graph, props.activityEvents),
  props.activityEvents,
));
const model = computed(() => adaptExecutionGraph(projectedGraph.value));
const selectedNode = ref<Record<string, any> | null>(null);
const detailOpen = ref(false);
const fullscreen = ref(false);

const activeNode = computed(() => {
  const nodes = Array.isArray(projectedGraph.value?.nodes) ? projectedGraph.value!.nodes : [];
  return activeExecutionNode(nodes);
});
const activeNodeId = computed(() => String(activeNode.value?.node_id || activeNode.value?.id || ''));
const resolvedSelectedNodeId = computed(() => String(
  selectedNode.value?.node_id
  || selectedNode.value?.id
  || props.selectedNodeId
  || '',
));
const selectedDetailNode = computed(() => {
  if (selectedNode.value) return selectedNode.value;
  const selectedId = resolvedSelectedNodeId.value;
  return (Array.isArray(projectedGraph.value?.nodes) ? projectedGraph.value!.nodes : [])
    .find((node: any) => String(node.node_id || node.id || '') === selectedId)
    || null;
});

function selectNode(node: Record<string, any>) {
  const nodeId = String(node?.node_id || node?.id || '');
  const selectedId = String(selectedNode.value?.node_id || selectedNode.value?.id || '');
  if (detailOpen.value && nodeId && nodeId === selectedId) {
    detailOpen.value = false;
    return;
  }
  selectedNode.value = node;
  detailOpen.value = true;
  emit('select', node);
}

function closeDetail() {
  detailOpen.value = false;
}

async function toggleFullscreen() {
  if (props.compact) {
    emit('expand');
    return;
  }
  if (!root.value) return;
  if (document.fullscreenElement === root.value) await document.exitFullscreen();
  else await root.value.requestFullscreen();
}

function syncFullscreenState() {
  fullscreen.value = document.fullscreenElement === root.value;
}

onMounted(() => document.addEventListener('fullscreenchange', syncFullscreenState));
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', syncFullscreenState));

watch(() => projectedGraph.value?.graph_id, () => {
  selectedNode.value = null;
  detailOpen.value = false;
});
</script>

<template>
  <section ref="root" class="execution-graph-canvas" :data-density="compact ? 'compact' : 'full'">
    <GraphSurface
      class="execution-graph-surface"
      :model="model"
      :selected-node-id="resolvedSelectedNodeId"
      :active-node-id="activeNodeId"
      :connection-state="connectionState"
      :compact="compact"
      :loading="loading"
      :embedded-inspector="false"
      :fullscreen="fullscreen"
      delegate-fullscreen
      @select-node="selectNode($event.raw || $event)"
      @toggle-fullscreen="toggleFullscreen"
    />
    <ExecutionNodeDetail
      v-if="!loading && projectedGraph && detailOpen && selectedDetailNode"
      :node="selectedDetailNode"
      :objective="String(projectedGraph?.objective || '')"
      :activity-events="activityEvents"
      @close="closeDetail"
    />
  </section>
</template>
