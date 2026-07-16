<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Panel, VueFlow } from '@vue-flow/core';
import { Expand, List, Search } from 'lucide-vue-next';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import type { GraphDirection, GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';
import { t } from '../../i18n';
import DataTable from '../workbench/DataTable.vue';
import StatusPill from '../workbench/StatusPill.vue';
import EvidenceInspector from '../evidence/EvidenceInspector.vue';

const props = withDefaults(defineProps<{
  model: GraphViewModel;
  selectedNodeId?: string;
  connectionState?: string;
  loading?: boolean;
}>(), { selectedNodeId: '', connectionState: 'ready', loading: false });

const emit = defineEmits<{
  selectNode: [node: GraphNodeView];
  selectEdge: [edge: GraphEdgeView];
}>();

const elk = new ELK();
const root = ref<HTMLElement | null>(null);
const flow = ref<any>(null);
const search = ref('');
const statusFilter = ref('all');
const direction = ref<GraphDirection>('RIGHT');
const listMode = ref(false);
const inspectorOpen = ref(false);
const laidOutNodes = ref<any[]>([]);
let layoutEpoch = 0;

const statuses = computed(() => Array.from(new Set(props.model.nodes.map((node) => node.status))).filter(Boolean));
const visibleNodes = computed(() => {
  const query = search.value.trim().toLowerCase();
  return props.model.nodes.filter((node) => {
    const statusMatch = statusFilter.value === 'all' || node.status === statusFilter.value;
    const textMatch = !query || `${node.id} ${node.label} ${node.type} ${node.summary || ''}`.toLowerCase().includes(query);
    return statusMatch && textMatch;
  });
});
const visibleNodeIds = computed(() => new Set(visibleNodes.value.map((node) => node.id)));
const visibleEdges = computed(() => props.model.edges.filter((edge) => visibleNodeIds.value.has(edge.source) && visibleNodeIds.value.has(edge.target)));
const selectedNode = computed(() => props.model.nodes.find((node) => node.id === props.selectedNodeId) || null);
const selectedEvidenceRefs = computed(() => selectedNode.value?.evidenceRefs || []);
const listRows = computed(() => visibleNodes.value.map((node) => ({
  id: node.id,
  type: node.type,
  status: node.status,
  group: node.group || '-',
  evidence: node.evidenceRefs?.length || 0,
  summary: node.summary || node.label,
})));
const flowEdges = computed(() => visibleEdges.value.map((edge) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  label: edge.label,
  type: 'smoothstep',
  class: `graph-edge graph-edge-${edge.type}`,
  data: { edge },
})));

async function layout() {
  const epoch = ++layoutEpoch;
  if (!visibleNodes.value.length) {
    laidOutNodes.value = [];
    return;
  }
  const graph = await elk.layout({
    id: props.model.id,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction.value,
      'elk.spacing.nodeNode': '42',
      'elk.layered.spacing.nodeNodeBetweenLayers': '82',
    },
    children: visibleNodes.value.map((node) => ({ id: node.id, width: 196, height: 76 })),
    edges: visibleEdges.value.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });
  if (epoch !== layoutEpoch) return;
  const byId = new Map(visibleNodes.value.map((node) => [node.id, node]));
  laidOutNodes.value = (graph.children || []).map((position) => {
    const node = byId.get(position.id)!;
    return {
      id: node.id,
      position: { x: position.x || 0, y: position.y || 0 },
      data: { label: node.label, node, status: node.status },
      class: `graph-node graph-node-${node.type} status-${node.status}${props.selectedNodeId === node.id ? ' selected' : ''}`,
      draggable: false,
      connectable: false,
    };
  });
  await nextTick();
  flow.value?.fitView?.({ padding: 0.2 });
}

function selectNode(event: any) {
  const node = event?.node?.data?.node as GraphNodeView | undefined;
  if (node) {
    inspectorOpen.value = true;
    emit('selectNode', node);
  }
}

function selectEdge(event: any) {
  const edge = event?.edge?.data?.edge as GraphEdgeView | undefined;
  if (edge) emit('selectEdge', edge);
}

function selectListRow(row: Record<string, unknown>) {
  const node = props.model.nodes.find((item) => item.id === row.id);
  if (node) {
    inspectorOpen.value = true;
    emit('selectNode', node);
  }
}

async function toggleFullscreen() {
  if (!root.value) return;
  if (document.fullscreenElement) await document.exitFullscreen();
  else await root.value.requestFullscreen();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === '+' || event.key === '=') flow.value?.zoomIn?.();
  if (event.key === '-') flow.value?.zoomOut?.();
  if (event.key === '0') flow.value?.fitView?.({ padding: 0.2 });
}

watch([visibleNodes, visibleEdges, direction, () => props.model.revision], layout, { immediate: true, deep: true });
</script>

<template>
  <section ref="root" class="graph-surface" tabindex="0" @keydown="onKeydown">
    <header class="graph-surface-header">
      <div>
        <h3>{{ model.title || t('graph.title.default') }}</h3>
        <small>{{ t('graph.summary', { nodes: visibleNodes.length, edges: visibleEdges.length }) }}</small>
      </div>
      <StatusPill :status="connectionState || model.status || 'ready'" />
    </header>
    <div class="graph-toolbar">
      <label class="search-field"><Search :size="14" /><input v-model="search" :placeholder="t('graph.action.search')" /></label>
      <select v-model="statusFilter" :aria-label="t('graph.action.filterStatus')">
        <option value="all">{{ t('graph.filter.all') }}</option>
        <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
      </select>
      <select v-model="direction" :aria-label="t('graph.action.direction')">
        <option value="RIGHT">{{ t('graph.direction.right') }}</option>
        <option value="DOWN">{{ t('graph.direction.down') }}</option>
      </select>
      <button class="ghost-action" type="button" :aria-pressed="listMode" @click="listMode = !listMode"><List :size="14" />{{ t('graph.action.list') }}</button>
      <button class="ghost-action" type="button" @click="toggleFullscreen"><Expand :size="14" />{{ t('graph.action.fullscreen') }}</button>
    </div>
    <p v-if="loading" class="empty-note">{{ t('graph.state.loading') }}</p>
    <p v-else-if="!visibleNodes.length" class="empty-note">{{ t('graph.state.empty') }}</p>
    <DataTable v-else-if="listMode" :rows="listRows" :columns="['id', 'type', 'status', 'group', 'evidence', 'summary']" row-key="id" searchable copyable @row-click="selectListRow" />
    <VueFlow
      v-else
      class="graph-flow"
      :nodes="laidOutNodes"
      :edges="flowEdges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :nodes-focusable="true"
      :edges-focusable="true"
      fit-view-on-init
      @pane-ready="flow = $event"
      @node-click="selectNode"
      @edge-click="selectEdge"
    >
      <Panel position="top-right" class="execution-graph-controls">
        <button type="button" :aria-label="t('runtime.execution.canvas.zoomIn')" @click="flow?.zoomIn()">+</button>
        <button type="button" :aria-label="t('runtime.execution.canvas.zoomOut')" @click="flow?.zoomOut()">−</button>
        <button type="button" :aria-label="t('runtime.execution.canvas.fit')" @click="flow?.fitView({ padding: 0.2 })">⤢</button>
      </Panel>
    </VueFlow>
    <EvidenceInspector
      v-if="selectedNode && inspectorOpen"
      :title="selectedNode.label"
      :refs="selectedEvidenceRefs"
      :subject="selectedNode.raw || selectedNode"
      @close="inspectorOpen = false"
    />
  </section>
</template>
