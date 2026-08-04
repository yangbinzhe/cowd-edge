<script setup lang="ts">
import { computed } from 'vue';
import {
  activityTree,
  type ActivityView,
} from '../../adapters/executionActivity';
import type { ExecutionActivityRelation } from '../../types';
import ExecutionActivityNode from './ExecutionActivityNode.vue';

const props = defineProps<{
  activities: ActivityView[];
  relations: ExecutionActivityRelation[];
}>();
const emit = defineEmits<{
  select: [activity: ActivityView];
}>();

const roots = computed(() => activityTree(props.activities, props.relations));
</script>

<template>
  <ol v-if="roots.length" class="execution-activity-tree">
    <ExecutionActivityNode
      v-for="node in roots"
      :key="node.activity.id"
      :node="node"
      @select="emit('select', $event)"
    />
  </ol>
</template>

<style scoped>
.execution-activity-tree {
  width: min(100%, 1280px);
  min-width: 0;
  margin: 4px 0 8px;
  padding: 0;
}
</style>
