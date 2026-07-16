<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Panel, VueFlow } from '@vue-flow/core';
import { Download, Expand, List, Search } from 'lucide-vue-next';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import type { GraphDirection, GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';
import { t } from '../../i18n';
import DataTable from '../workbench/DataTable.vue';
import StatusPill from '../workbench/StatusPill.vue';
import EvidenceInspector from '../evidence/EvidenceInspector.vue';
import { graphDiagnostics, graphExportPayload, graphLayoutSignature } from './graphRuntime';

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
const internalSelectedNodeId = ref('');
const laidOutNodes = ref<any[]>([]);
let layoutEpoch = 0;
const graphNodeLimit = 220;
const layoutCache = new Map<string, Array<{ id: string; x: number; y: number }>>();
let lastLayoutIdentity = '';

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
const graphIsAggregated = computed(() => visibleNodes.value.length > graphNodeLimit);
const canvasNodes = computed(() => graphIsAggregated.value ? [] : visibleNodes.value);
const canvasNodeIds = computed(() => new Set(canvasNodes.value.map((node) => node.id)));
const canvasEdges = computed(() => visibleEdges.value.filter((edge) => canvasNodeIds.value.has(edge.source) && canvasNodeIds.value.has(edge.target)));
const showList = computed(() => listMode.value || graphIsAggregated.value);
const diagnostics = computed(() => graphDiagnostics(props.model.nodes, props.model.edges));
const diagnosticCount = computed(() => diagnostics.value.duplicateNodeIds.length + diagnostics.value.duplicateEdgeIds.length + diagnostics.value.danglingEdgeIds.length);
const summaryId = computed(() => `graph-summary-${String(props.model.id || 'default').replace(/[^a-z0-9_-]/gi, '-')}`);
const selectedNode = computed(() => props.model.nodes.find((node) => node.id === (props.selectedNodeId || internalSelectedNodeId.value)) || null);
const selectedEvidenceRefs = computed(() => selectedNode.value?.evidenceRefs || []);
const listRows = computed(() => visibleNodes.value.map((node) => ({
  id: node.id,
  type: node.type,
  status: node.status,
  group: node.group || '-',
  evidence: node.evidenceRefs?.length || 0,
  summary: node.summary || node.label,
})));
const flowEdges = computed(() => canvasEdges.value.map((edge) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  label: edge.label,
  type: 'smoothstep',
  class: `graph-edge graph-edge-${edge.type}`,
  data: { edge },
})));
const minimapBounds = computed(() => {
  if (!laidOutNodes.value.length) return null;
  const xs = laidOutNodes.value.map((node) => Number(node.position.x || 0));
  const ys = laidOutNodes.value.map((node) => Number(node.position.y || 0));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - minX + 196);
  const height = Math.max(1, Math.max(...ys) - minY + 76);
  return { minX, minY, width, height };
});
const minimapNodes = computed(() => {
  const bounds = minimapBounds.value;
  if (!bounds) return [];
  return laidOutNodes.value.map((node) => ({
    id: node.id,
    x: 4 + ((Number(node.position.x || 0) - bounds.minX) / bounds.width) * 152,
    y: 4 + ((Number(node.position.y || 0) - bounds.minY) / bounds.height) * 92,
    width: Math.max(3, (196 / bounds.width) * 152),
    height: Math.max(3, (76 / bounds.height) * 92),
    selected: node.id === (props.selectedNodeId || internalSelectedNodeId.value),
  }));
});

async function layout() {
  const epoch = ++layoutEpoch;
  if (!canvasNodes.value.length || showList.value) {
    laidOutNodes.value = [];
    return;
  }
  const signature = graphLayoutSignature(props.model.id, direction.value, canvasNodes.value, canvasEdges.value);
  const cached = layoutCache.get(signature);
  const graph = cached ? null : await elk.layout({
      id: props.model.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction.value,
        'elk.spacing.nodeNode': '42',
        'elk.layered.spacing.nodeNodeBetweenLayers': '82',
      },
      children: canvasNodes.value.map((node) => ({ id: node.id, width: 196, height: 76 })),
      edges: canvasEdges.value.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
    });
  if (epoch !== layoutEpoch) return;
  const byId = new Map(canvasNodes.value.map((node) => [node.id, node]));
  const positions = cached || (graph?.children || []).map((position) => ({ id: position.id, x: position.x || 0, y: position.y || 0 }));
  if (!cached) {
    layoutCache.set(signature, positions);
    if (layoutCache.size > 24) layoutCache.delete(layoutCache.keys().next().value as string);
  }
  const previousViewport = flow.value?.getViewport?.();
  laidOutNodes.value = positions.map((position) => {
    const node = byId.get(position.id)!;
    return {
      id: node.id,
      position: { x: position.x || 0, y: position.y || 0 },
      data: { label: node.label, node, status: node.status },
      class: `graph-node graph-node-${node.type} status-${node.status}${(props.selectedNodeId || internalSelectedNodeId.value) === node.id ? ' selected' : ''}`,
      draggable: false,
      connectable: false,
    };
  });
  await nextTick();
  const layoutIdentity = `${props.model.id}:${direction.value}`;
  if (lastLayoutIdentity === layoutIdentity && previousViewport) flow.value?.setViewport?.(previousViewport, { duration: 0 });
  else flow.value?.fitView?.({ padding: 0.2 });
  lastLayoutIdentity = layoutIdentity;
}

function exportGraph() {
  const payload = graphExportPayload(props.model, visibleNodes.value, visibleEdges.value, direction.value, diagnostics.value);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const filename = String(props.model.id || 'runtime-graph').replace(/[^a-z0-9._-]/gi, '-');
  anchor.href = url;
  anchor.download = `${filename}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function selectNode(event: any) {
  const node = event?.node?.data?.node as GraphNodeView | undefined;
  if (node) {
    internalSelectedNodeId.value = node.id;
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
    internalSelectedNodeId.value = node.id;
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
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
  if (event.key === '+' || event.key === '=') flow.value?.zoomIn?.();
  if (event.key === '-') flow.value?.zoomOut?.();
  if (event.key === '0') flow.value?.fitView?.({ padding: 0.2 });
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    const nodes = visibleNodes.value;
    if (!nodes.length) return;
    const current = nodes.findIndex((node) => node.id === (props.selectedNodeId || internalSelectedNodeId.value));
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = nodes[(current + delta + nodes.length) % nodes.length]!;
    internalSelectedNodeId.value = next.id;
    inspectorOpen.value = true;
    emit('selectNode', next);
  }
}

watch([canvasNodes, canvasEdges, direction, showList, () => props.model.revision], layout, { immediate: true, deep: true });
</script>

<template>
  <section ref="root" class="graph-surface" role="region" tabindex="0" :aria-describedby="summaryId" @keydown="onKeydown">
    <header class="graph-surface-header">
      <div>
        <h3>{{ model.title || t('graph.title.default') }}</h3>
        <small :id="summaryId">{{ t('graph.summary', { nodes: visibleNodes.length, edges: visibleEdges.length }) }}</small>
        <small v-if="model.truncated" class="graph-truncated">{{ t('graph.state.truncated') }}</small>
        <small v-if="diagnosticCount" class="graph-diagnostic">{{ t('graph.state.diagnostics', { count: diagnosticCount, dangling: diagnostics.danglingEdgeIds.length }) }}</small>
      </div>
      <StatusPill :status="connectionState || model.status || 'ready'" />
    </header>
    <p class="sr-only" aria-live="polite">{{ t('graph.a11y.summary', { nodes: visibleNodes.length, edges: visibleEdges.length, status: connectionState || model.status || 'ready' }) }}</p>
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
      <button class="ghost-action" type="button" @click="exportGraph"><Download :size="14" />{{ t('graph.action.export') }}</button>
      <button class="ghost-action" type="button" @click="toggleFullscreen"><Expand :size="14" />{{ t('graph.action.fullscreen') }}</button>
    </div>
    <p v-if="graphIsAggregated" class="empty-note">{{ t('graph.state.aggregated', { limit: graphNodeLimit, total: visibleNodes.length }) }}</p>
    <p v-if="loading" class="empty-note">{{ t('graph.state.loading') }}</p>
    <p v-else-if="!visibleNodes.length" class="empty-note">{{ t('graph.state.empty') }}</p>
    <DataTable v-else-if="showList" :rows="listRows" :columns="['id', 'type', 'status', 'group', 'evidence', 'summary']" row-key="id" searchable copyable @row-click="selectListRow" />
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
      @pane-ready="flow = $event"
      @node-click="selectNode"
      @edge-click="selectEdge"
    >
      <Panel position="top-right" class="execution-graph-controls">
        <button type="button" :aria-label="t('runtime.execution.canvas.zoomIn')" @click="flow?.zoomIn()">+</button>
        <button type="button" :aria-label="t('runtime.execution.canvas.zoomOut')" @click="flow?.zoomOut()">−</button>
        <button type="button" :aria-label="t('runtime.execution.canvas.fit')" @click="flow?.fitView({ padding: 0.2 })">⤢</button>
      </Panel>
      <Panel position="bottom-right" class="graph-minimap" :aria-label="t('graph.minimap.label')">
        <svg viewBox="0 0 160 100" role="img">
          <rect class="graph-minimap-frame" x="0.5" y="0.5" width="159" height="99" rx="5" />
          <rect
            v-for="node in minimapNodes"
            :key="node.id"
            :class="['graph-minimap-node', { selected: node.selected }]"
            :x="node.x"
            :y="node.y"
            :width="node.width"
            :height="node.height"
            rx="1"
          />
        </svg>
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

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .graph-surface :deep(.vue-flow__edge-path), .graph-surface :deep(.vue-flow__node) { transition: none !important; animation: none !important; }
}
</style>
