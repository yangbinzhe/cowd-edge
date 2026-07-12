<script setup lang="ts">
import { computed, ref } from 'vue';
import { Panel, VueFlow } from '@vue-flow/core';
import { t } from '../../i18n';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';

const props = defineProps<{
  graph: Record<string, any> | null;
  selectedNodeId?: string;
}>();

const emit = defineEmits<{ select: [node: Record<string, any>] }>();
const flow = ref<any>(null);

function statusOf(node: Record<string, any>) {
  return String(node.status || 'planned');
}

const graphNodes = computed(() => {
  const nodes = Array.isArray(props.graph?.nodes) ? props.graph.nodes : [];
  const edges = Array.isArray(props.graph?.edges) ? props.graph.edges : [];
  const incoming = new Map<string, number>();
  const depth = new Map<string, number>();
  nodes.forEach((node: any) => incoming.set(String(node.node_id), 0));
  edges.forEach((edge: any) => incoming.set(String(edge.to), (incoming.get(String(edge.to)) || 0) + 1));
  const queue = nodes.filter((node: any) => (incoming.get(String(node.node_id)) || 0) === 0);
  queue.forEach((node: any) => depth.set(String(node.node_id), 0));
  while (queue.length) {
    const node = queue.shift();
    const id = String(node.node_id);
    for (const edge of edges.filter((item: any) => String(item.from) === id)) {
      const target = String(edge.to);
      depth.set(target, Math.max(depth.get(target) || 0, (depth.get(id) || 0) + 1));
      incoming.set(target, (incoming.get(target) || 1) - 1);
      if ((incoming.get(target) || 0) === 0) {
        const next = nodes.find((item: any) => String(item.node_id) === target);
        if (next) queue.push(next);
      }
    }
  }
  const lanes = new Map<number, number>();
  return nodes.map((node: any) => {
    const id = String(node.node_id);
    const column = depth.get(id) || 0;
    const row = lanes.get(column) || 0;
    lanes.set(column, row + 1);
    return {
      id,
      type: 'default',
      position: { x: column * 250, y: row * 128 },
      data: {
        label: node.executor_kind || node.kind || id,
        node,
        status: statusOf(node),
      },
      class: `execution-graph-node status-${statusOf(node)}${props.selectedNodeId === id ? ' selected' : ''}`,
    };
  });
});

const graphEdges = computed(() => (Array.isArray(props.graph?.edges) ? props.graph.edges : []).map((edge: any) => ({
  id: `${edge.from}:${edge.to}:${edge.kind}`,
  source: String(edge.from),
  target: String(edge.to),
  label: String(edge.kind || '').replace(/_/g, ' '),
  animated: false,
  type: 'smoothstep',
})));
const hasGraph = computed(() => graphNodes.value.length > 0);

function selectNode(event: any) {
  const node = event?.node?.data?.node;
  if (node) emit('select', node);
}

function onCanvasKeydown(event: KeyboardEvent) {
  if (!flow.value) return;
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    flow.value.zoomIn();
  } else if (event.key === '-') {
    event.preventDefault();
    flow.value.zoomOut();
  } else if (event.key === '0') {
    event.preventDefault();
    void flow.value.fitView();
  }
}
</script>

<template>
  <section class="execution-graph-canvas" :data-empty="!hasGraph" tabindex="0" @keydown="onCanvasKeydown">
    <p v-if="!hasGraph" class="empty-note">{{ t('runtime.execution.canvas.empty') }}</p>
    <VueFlow
      v-else
      :nodes="graphNodes"
      :edges="graphEdges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :nodes-focusable="true"
      :edges-focusable="true"
      fit-view-on-init
      @pane-ready="flow = $event"
      @node-click="selectNode"
    >
      <Panel position="top-right" class="execution-graph-controls">
        <button type="button" :aria-label="t('runtime.execution.canvas.zoomIn')" @click="flow?.zoomIn()">+</button>
        <button type="button" :aria-label="t('runtime.execution.canvas.zoomOut')" @click="flow?.zoomOut()">−</button>
        <button type="button" :aria-label="t('runtime.execution.canvas.fit')" @click="flow?.fitView()">⤢</button>
      </Panel>
    </VueFlow>
  </section>
</template>
