<script setup lang="ts">
import { computed } from 'vue';
import GraphSurface from '../graph/GraphSurface.vue';
import { adaptExecutionGraph } from '../../adapters/graph/execution';

const props = defineProps<{
  graph: Record<string, any> | null;
  selectedNodeId?: string;
}>();

const emit = defineEmits<{ select: [node: Record<string, any>] }>();
const model = computed(() => adaptExecutionGraph(props.graph));
</script>

<template>
  <GraphSurface
    class="execution-graph-canvas"
    :model="model"
    :selected-node-id="selectedNodeId"
    @select-node="emit('select', $event.raw || $event)"
  />
</template>
