<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Panel, VueFlow } from '@vue-flow/core';
import {
  ArrowDown,
  ArrowRight,
  Download,
  ExternalLink,
  Filter,
  List,
  Maximize2,
  Minimize2,
  Scan,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-vue-next';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import type { GraphDirection, GraphEdgeView, GraphNodeView, GraphViewModel } from '../../types/graph';
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';
import DataTable from '../workbench/DataTable.vue';
import StatusPill from '../workbench/StatusPill.vue';
import EvidenceInspector from '../evidence/EvidenceInspector.vue';
import { runGraphLayout } from './graphLayout';
import { graphDiagnostics, graphExportPayload, graphLayoutSignature } from './graphRuntime';

const props = withDefaults(defineProps<{
  model: GraphViewModel;
  selectedNodeId?: string;
  connectionState?: string;
  loading?: boolean;
  searchQuery?: string;
  statusQuery?: string;
  activeNodeId?: string;
  compact?: boolean;
  embeddedInspector?: boolean;
  delegateFullscreen?: boolean;
  fullscreen?: boolean;
}>(), {
  selectedNodeId: '',
  connectionState: 'ready',
  loading: false,
  searchQuery: '',
  statusQuery: 'all',
  activeNodeId: '',
  compact: false,
  embeddedInspector: true,
  delegateFullscreen: false,
  fullscreen: false,
});

const emit = defineEmits<{
  selectNode: [node: GraphNodeView];
  selectEdge: [edge: GraphEdgeView];
  viewStateChange: [state: { filter: string; status: string }];
  toggleFullscreen: [];
}>();

const root = ref<HTMLElement | null>(null);
const flow = ref<any>(null);
const search = ref(props.searchQuery);
const statusFilter = ref(props.statusQuery);
const direction = ref<GraphDirection>('RIGHT');
const listMode = ref(false);
const compactSearchOpen = ref(false);
const inspectorOpen = ref(false);
const internalSelectedNodeId = ref('');
const laidOutNodes = ref<any[]>([]);
let layoutEpoch = 0;
const graphNodeLimit = 220;
const layoutCache = new Map<string, Array<{ id: string; x: number; y: number }>>();
let lastLayoutIdentity = '';
let fitFrame = 0;
let fitTimer = 0;
let layoutTimer = 0;
let resizeObserver: ResizeObserver | null = null;
let lastObservedSize = '';

const nodeDescriptionKeys: Record<string, string> = {
  'agent': 'graph.nodeType.agent',
  'agent-task': 'graph.nodeType.agentTask',
  'approval': 'graph.nodeType.approval',
  'checkpoint': 'graph.nodeType.checkpoint',
  'child-execution': 'graph.nodeType.childExecution',
  'command': 'graph.nodeType.command',
  'context-source': 'graph.nodeType.contextSource',
  'decision': 'graph.nodeType.decision',
  'entity': 'graph.nodeType.entity',
  'evidence': 'graph.nodeType.evidence',
  'execution': 'graph.nodeType.execution',
  'fact-stage': 'graph.nodeType.factStage',
  'inline-model': 'graph.nodeType.model',
  'knowledge': 'graph.nodeType.knowledge',
  'metric': 'graph.nodeType.metric',
  'mission': 'graph.nodeType.mission',
  'mutation': 'graph.nodeType.mutation',
  'recovery': 'graph.nodeType.recovery',
  'relation': 'graph.nodeType.relation',
  'session': 'graph.nodeType.session',
  'stage': 'graph.nodeType.stage',
  'subgraph': 'graph.nodeType.childExecution',
  'synthesize': 'graph.nodeType.synthesize',
  'task': 'graph.nodeType.task',
  'team': 'graph.nodeType.team',
  'team-role': 'graph.nodeType.teamRole',
  'tool-batch': 'graph.nodeType.toolBatch',
  'tool-call': 'graph.nodeType.toolCall',
  'tool-operation': 'graph.nodeType.toolOperation',
  'verify': 'graph.nodeType.verify',
};

function nodeDescription(node: GraphNodeView) {
  const normalized = String(node.type || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s.]+/g, '-');
  const key = nodeDescriptionKeys[normalized];
  if (key) return t(key);
  const group = String(node.group || '').trim().toLowerCase();
  const groupKey = nodeDescriptionKeys[group];
  return groupKey ? t(groupKey) : t('graph.nodeType.generic');
}

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
const topologySignature = computed(() => [
  showList.value ? 'list' : 'graph',
  graphLayoutSignature(props.model.id, direction.value, canvasNodes.value, canvasEdges.value),
].join('|'));
const nextDirection = computed<GraphDirection>(() => direction.value === 'RIGHT' ? 'DOWN' : 'RIGHT');
const nextDirectionLabel = computed(() => (
  nextDirection.value === 'DOWN' ? t('graph.direction.down') : t('graph.direction.right')
));
const diagnostics = computed(() => graphDiagnostics(props.model.nodes, props.model.edges));
const diagnosticCount = computed(() => diagnostics.value.duplicateNodeIds.length + diagnostics.value.duplicateEdgeIds.length + diagnostics.value.danglingEdgeIds.length);
const summaryId = computed(() => `graph-summary-${String(props.model.id || 'default').replace(/[^a-z0-9_-]/gi, '-')}`);
const selectedNode = computed(() => props.model.nodes.find((node) => node.id === (props.selectedNodeId || internalSelectedNodeId.value)) || null);
const selectedEvidenceRefs = computed(() => selectedNode.value?.evidenceRefs || []);
const listRows = computed(() => visibleNodes.value.map((node) => ({
  id: node.id,
  type: node.badges?.[0] || node.type,
  status: displayStatus(node.status),
  group: node.group || '-',
  evidence: node.evidenceRefs?.length || 0,
  summary: node.summary || node.label,
})));
const flowNodes = computed(() => {
  const currentById = new Map(canvasNodes.value.map((node) => [node.id, node]));
  return laidOutNodes.value.flatMap((layoutNode) => {
    const node = currentById.get(layoutNode.id);
    if (!node) return [];
    return [{
      ...layoutNode,
      data: {
        label: node.label,
        description: nodeDescription(node),
        task: node.description,
        summary: node.summary,
        outputSummary: node.outputSummary,
        metrics: node.metrics || [],
        node,
        status: node.status,
      },
      class: `graph-node graph-node-${node.type} status-${node.status}${(props.selectedNodeId || internalSelectedNodeId.value) === node.id ? ' selected' : ''}${props.activeNodeId === node.id ? ' active-runtime-node' : ''}`,
    }];
  });
});
const laidOutNodeIds = computed(() => new Set(flowNodes.value.map((node) => node.id)));
const flowEdges = computed(() => canvasEdges.value
  .filter((edge) => laidOutNodeIds.value.has(edge.source) && laidOutNodeIds.value.has(edge.target))
  .map((edge) => ({
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
  const graph = cached ? null : await runGraphLayout({
      id: props.model.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction.value,
        'elk.spacing.nodeNode': '42',
        'elk.layered.spacing.nodeNodeBetweenLayers': '82',
        ...(props.model.id.startsWith('semantic-lineage:') ? {
          'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
          'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
        } : {}),
      },
      children: canvasNodes.value.map((node) => ({
        id: node.id,
        width: node.raw?.semantic_view ? 228 : 196,
        height: node.raw?.semantic_view ? 118 : 76,
      })),
      edges: canvasEdges.value.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
    });
  if (epoch !== layoutEpoch) return;
  const currentNodes = [...canvasNodes.value];
  const positions = cached || (graph?.children || []).map((position) => ({ id: position.id, x: position.x || 0, y: position.y || 0 }));
  if (!cached) {
    layoutCache.set(signature, positions);
    if (layoutCache.size > 24) layoutCache.delete(layoutCache.keys().next().value as string);
  }
  const positionById = new Map(positions.map((position) => [String(position.id), position]));
  const previousViewport = flow.value?.getViewport?.();
  laidOutNodes.value = currentNodes.map((node, index) => {
    const position = positionById.get(node.id) || (
      direction.value === 'DOWN'
        ? { x: (index % 6) * 238, y: Math.floor(index / 6) * 158 }
        : { x: Math.floor(index / 6) * 278, y: (index % 6) * 118 }
    );
    return {
      id: node.id,
      position: { x: position.x || 0, y: position.y || 0 },
      data: {
        label: node.label,
        description: nodeDescription(node),
        task: node.description,
        summary: node.summary,
        outputSummary: node.outputSummary,
        metrics: node.metrics || [],
        node,
        status: node.status,
      },
      class: `graph-node graph-node-${node.type} status-${node.status}${(props.selectedNodeId || internalSelectedNodeId.value) === node.id ? ' selected' : ''}${props.activeNodeId === node.id ? ' active-runtime-node' : ''}`,
      draggable: false,
      connectable: false,
    };
  });
  await nextTick();
  const layoutIdentity = `${props.model.id}:${direction.value}`;
  if (lastLayoutIdentity === layoutIdentity && previousViewport) flow.value?.setViewport?.(previousViewport, { duration: 0 });
  else scheduleFit();
  lastLayoutIdentity = layoutIdentity;
}

function scheduleLayout() {
  window.clearTimeout(layoutTimer);
  layoutTimer = window.setTimeout(layout, 80);
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

function emitViewState() {
  emit('viewStateChange', { filter: search.value, status: statusFilter.value });
}

function toggleDirection() {
  direction.value = nextDirection.value;
}

function selectNode(event: any) {
  const node = event?.node?.data?.node as GraphNodeView | undefined;
  if (node) {
    internalSelectedNodeId.value = node.id;
    inspectorOpen.value = props.embeddedInspector;
    emit('selectNode', node);
  }
}

function selectEdge(event: any) {
  const edge = event?.edge?.data?.edge as GraphEdgeView | undefined;
  if (edge) emit('selectEdge', edge);
}

async function paneReady(instance: any) {
  flow.value = instance;
  await nextTick();
  scheduleFit(instance);
}

function scheduleFit(instance = flow.value) {
  if (!instance || showList.value || !laidOutNodes.value.length) return;
  const fit = () => instance.fitView?.({
    padding: props.compact ? 0.08 : 0.2,
    duration: 0,
  });
  if (typeof requestAnimationFrame !== 'function') {
    fit();
    return;
  }
  cancelAnimationFrame(fitFrame);
  window.clearTimeout(fitTimer);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = requestAnimationFrame(() => {
      fit();
      // Side panels and modal graphs can finish sizing after VueFlow initializes.
      // Refit once after that layout settles; subsequent user zoom remains untouched.
      fitTimer = window.setTimeout(fit, 120);
    });
  });
}

function selectListRow(row: Record<string, unknown>) {
  const node = props.model.nodes.find((item) => item.id === row.id);
  if (node) {
    internalSelectedNodeId.value = node.id;
    inspectorOpen.value = props.embeddedInspector;
    emit('selectNode', node);
  }
}

async function toggleFullscreen() {
  if (props.delegateFullscreen) {
    emit('toggleFullscreen');
    return;
  }
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
    inspectorOpen.value = props.embeddedInspector;
    emit('selectNode', next);
  }
}

watch(
  topologySignature,
  scheduleLayout,
  { immediate: true },
);
watch(() => props.searchQuery, (value) => { if (value !== search.value) search.value = value; });
watch(() => props.statusQuery, (value) => { if (value !== statusFilter.value) statusFilter.value = value || 'all'; });

onMounted(() => {
  if (!root.value || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(([entry]) => {
    const width = Math.round(entry?.contentRect.width || 0);
    const height = Math.round(entry?.contentRect.height || 0);
    if (width < 1 || height < 1) return;
    const size = `${width}:${height}`;
    if (size === lastObservedSize) return;
    lastObservedSize = size;
    scheduleFit();
  });
  resizeObserver.observe(root.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.clearTimeout(layoutTimer);
  cancelAnimationFrame(fitFrame);
  window.clearTimeout(fitTimer);
});
</script>

<template>
  <section ref="root" class="graph-surface" :data-density="compact ? 'compact' : 'full'" role="region" tabindex="0" :aria-describedby="summaryId" @keydown="onKeydown">
    <header class="graph-surface-header" :data-density="compact ? 'compact' : 'full'">
      <div class="graph-title">
        <h3>{{ model.title || t('graph.title.default') }}</h3>
        <small :id="summaryId">{{ t('graph.summary', { nodes: visibleNodes.length, edges: visibleEdges.length }) }}</small>
        <small v-if="!compact && model.truncated" class="graph-truncated">{{ t('graph.state.truncated') }}</small>
        <small v-if="!compact && diagnosticCount" class="graph-diagnostic">{{ t('graph.state.diagnostics', { count: diagnosticCount, dangling: diagnostics.danglingEdgeIds.length }) }}</small>
        <small v-if="!compact && model.work" class="graph-work-summary">
          {{ t('graph.work.summary', {
            width: model.work.width,
            depth: model.work.depth,
            expected: model.work.expectedSpeedupBasisPoints == null ? '-' : `${(model.work.expectedSpeedupBasisPoints / 10000).toFixed(2)}x`,
            actual: model.work.actualSpeedupBasisPoints == null ? '-' : `${(model.work.actualSpeedupBasisPoints / 10000).toFixed(2)}x`,
            tokens: model.work.inputTokens + model.work.outputTokens + model.work.cachedTokens,
          }) }}
        </small>
      </div>
      <div class="graph-header-actions">
        <RouterLink
          v-if="selectedNode?.href"
          class="graph-icon-action"
          :to="selectedNode.href"
          :title="t('graph.action.openLinked')"
          :aria-label="t('graph.action.openLinked')"
        >
          <ExternalLink :size="15" />
        </RouterLink>
        <StatusPill :status="connectionState || model.status || 'ready'" />
        <div class="graph-toolbar" :data-density="compact ? 'compact' : 'full'">
          <button
            class="graph-icon-action"
            type="button"
            :class="{ active: compactSearchOpen || Boolean(search) }"
            :title="t('graph.action.search')"
            :aria-label="t('graph.action.search')"
            :aria-expanded="compactSearchOpen"
            @click="compactSearchOpen = !compactSearchOpen"
          >
            <Search :size="15" />
          </button>
          <label
            class="graph-icon-select"
            :class="{ active: statusFilter !== 'all' }"
            :title="t('graph.action.filterStatus')"
          >
            <Filter :size="15" />
            <select v-model="statusFilter" :aria-label="t('graph.action.filterStatus')" @change="emitViewState">
              <option value="all">{{ t('graph.filter.all') }}</option>
              <option v-for="status in statuses" :key="status" :value="status">{{ displayStatus(status) }}</option>
            </select>
          </label>
          <button
            class="graph-icon-action"
            type="button"
            :title="nextDirectionLabel"
            :aria-label="nextDirectionLabel"
            @click="toggleDirection"
          >
            <ArrowDown v-if="nextDirection === 'DOWN'" :size="15" />
            <ArrowRight v-else :size="15" />
          </button>
          <button class="graph-icon-action" type="button" :title="t('graph.action.list')" :aria-label="t('graph.action.list')" :aria-pressed="listMode" @click="listMode = !listMode">
            <List :size="15" />
          </button>
          <button class="graph-icon-action" type="button" :title="t('graph.action.export')" :aria-label="t('graph.action.export')" @click="exportGraph">
            <Download :size="15" />
          </button>
          <button class="graph-icon-action" type="button" :title="t('graph.action.fullscreen')" :aria-label="t('graph.action.fullscreen')" @click="toggleFullscreen">
            <Minimize2 v-if="fullscreen" :size="15" />
            <Maximize2 v-else :size="15" />
          </button>
        </div>
      </div>
    </header>
    <div class="graph-search-slot">
      <label v-if="compactSearchOpen" class="graph-search-row search-field">
        <Search :size="14" />
        <input v-model="search" :placeholder="t('graph.action.search')" @input="emitViewState" />
      </label>
    </div>
    <p class="sr-only" aria-live="polite">{{ t('graph.a11y.summary', { nodes: visibleNodes.length, edges: visibleEdges.length, status: connectionState || model.status || 'ready' }) }}</p>
    <p v-if="graphIsAggregated" class="empty-note">{{ t('graph.state.aggregated', { limit: graphNodeLimit, total: visibleNodes.length }) }}</p>
    <p v-if="loading" class="empty-note">{{ t('graph.state.loading') }}</p>
    <p v-else-if="!visibleNodes.length" class="empty-note">{{ t('graph.state.empty') }}</p>
    <DataTable v-else-if="showList" :rows="listRows" :columns="['id', 'type', 'status', 'group', 'evidence', 'summary']" row-key="id" searchable copyable @row-click="selectListRow" />
    <VueFlow
      v-else
      class="graph-flow"
      :nodes="flowNodes"
      :edges="flowEdges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :nodes-focusable="true"
      :edges-focusable="true"
      :min-zoom="compact ? 0.04 : 0.18"
      @pane-ready="paneReady"
      @nodes-initialized="scheduleFit()"
      @node-click="selectNode"
      @edge-click="selectEdge"
    >
      <template #node-default="{ data }">
        <div class="graph-node-content" :class="{ 'semantic-node-content': data.node.raw?.semantic_view }">
          <div class="graph-node-heading">
            <strong>{{ data.label }}</strong>
            <span class="graph-node-status">{{ displayStatus(data.status) }}</span>
          </div>
          <small v-if="data.node.raw?.semantic_view && data.task" class="graph-node-task">{{ data.task }}</small>
          <small v-else>{{ data.description }}</small>
          <small v-if="data.node.raw?.semantic_view && data.outputSummary" class="graph-node-output">
            {{ t('execution.outputPrefix') }}{{ data.outputSummary }}
          </small>
          <div v-if="data.node.raw?.semantic_view && data.metrics?.length" class="graph-node-metrics">
            <span v-for="metric in data.metrics" :key="metric">{{ metric }}</span>
          </div>
        </div>
      </template>
      <Panel position="top-right" class="execution-graph-controls">
        <button type="button" :title="t('runtime.execution.canvas.zoomIn')" :aria-label="t('runtime.execution.canvas.zoomIn')" @click="flow?.zoomIn()"><ZoomIn :size="15" /></button>
        <button type="button" :title="t('runtime.execution.canvas.zoomOut')" :aria-label="t('runtime.execution.canvas.zoomOut')" @click="flow?.zoomOut()"><ZoomOut :size="15" /></button>
        <button type="button" :title="t('runtime.execution.canvas.fit')" :aria-label="t('runtime.execution.canvas.fit')" @click="flow?.fitView({ padding: 0.2 })"><Scan :size="15" /></button>
      </Panel>
      <Panel v-if="!compact" position="bottom-right" class="graph-minimap" :aria-label="t('graph.minimap.label')">
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
      v-if="embeddedInspector && selectedNode && inspectorOpen"
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
