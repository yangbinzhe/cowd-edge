<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Brain, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleDashed, Clipboard, Clock3, Code2, Coins, Download, Edit3, ExternalLink, FileCheck2, FileText, Folder, Info, Link2, LoaderCircle, MemoryStick, RotateCcw, Save, Search, ShieldCheck, Upload, Workflow, Wrench, X, ZoomIn, ZoomOut } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import MarkdownBlock from './MarkdownBlock.vue';
import RawPayload from './workbench/RawPayload.vue';
import { useEscapeKey } from '../composables/useEscapeKey';
import { displayStatus } from '../i18n/domain/status';
import WorkspaceTree from './workspace/WorkspaceTree.vue';
import TimelineList from './workbench/TimelineList.vue';
import StructuredValue from './workbench/StructuredValue.vue';
import EvidenceInspector from './evidence/EvidenceInspector.vue';
import ExecutionGraphCanvas from './mission/ExecutionGraphCanvas.vue';
import { isWorkspaceEditablePreview, workspacePreviewKind } from '../utils/workspacePreview';
import type { ActivityEvent } from '../types';
import { activityIdentityKey, causalActivityTimeline } from '../utils/causalTimeline';
import {
  combineExecutionLineage,
  executionProjectionLinks,
  selectTurnExecutionEntry,
} from '../utils/executionLineage';
import {
  businessGraphActivities,
  canonicalActivityEvents,
  presentActivityDetail,
} from '../adapters/executionActivity';

const BUSINESS_TIMELINE_KINDS = new Set([
  'execution',
  'goal',
  'team',
  'agent',
  'tool_batch',
  'tool',
  'approval',
  'verify',
  'artifact',
  'outcome',
  'replan',
]);

const store = useAppStore();
const chat = useChatSessionsStore();
const projections = useProjectionRegistryStore();
const fileInput = ref<HTMLInputElement | null>(null);
const previewOpen = ref(false);
const activityDetailOpen = ref(false);
const activityEvidenceOpen = ref(false);
const activityEvidenceOverride = ref<string[]>([]);
const activityDetailLoading = ref(false);
let activityDetailRequest = 0;
const activityEvidenceDetails = ref<HTMLDetailsElement | null>(null);
const selectedExecutionNode = ref<Record<string, any> | null>(null);
const previewMode = ref<'render' | 'source'>('render');
const previewEditing = ref(false);
const imageZoom = ref(1);
const resizing = ref(false);
const executionHistoryLimit = ref(50);
const collapsedTurnIds = ref(new Set<string>());
const activityMode = ref<'business' | 'technical'>('business');

const previewKind = computed(() => store.selectedFile ? workspacePreviewKind(store.selectedFile) : 'binary');
const rawFileUrl = computed(() => store.rawWorkspaceFileUrl(store.selectedFile));
const canEdit = computed(() => !!store.selectedFile && isWorkspaceEditablePreview(store.selectedFile));
const previewableFiles = computed(() => store.filteredWorkspaceFiles.filter((file) => file.kind === 'file'));
const selectedFileIndex = computed(() => previewableFiles.value.findIndex((file) => file.path === store.selectedFile));
const workspaceMetaEntries = computed(() => {
  const meta = store.workspaceMeta || {};
  return Object.entries(meta).slice(0, 8).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
});
const contextItems = computed(() => {
  const envelope = store.currentContextEnvelope || {};
  return (Array.isArray(envelope.selected) ? envelope.selected : []).slice(0, 100);
});
const realityStages = computed(() => (Array.isArray(store.currentRealityFlow?.stages) ? store.currentRealityFlow.stages : []).slice(0, 12));
const runtimeInputItems = computed(() => {
  const seen = new Set<string>();
  const rows = [
    ...(Array.isArray(store.turnInbox?.items) ? store.turnInbox.items : []),
    ...(Array.isArray(store.sessionInputProjection?.inputs) ? store.sessionInputProjection.inputs : []),
  ];
  return rows.filter((item: any) => {
    const id = String(item?.input_id || item?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
});
const rootProjectionId = computed(() => (
  chat.active?.executionGraphId
  || chat.active?.executionId
  || chat.active?.executionIndex?.latest_graph_id
  || chat.active?.executionIndex?.latest_execution_id
  || ''
));
const rootProjection = computed(() => rootProjectionId.value
  ? projections.projectionFor(rootProjectionId.value)
  : null);
const linkedProjectionIds = computed(() => executionProjectionLinks(rootProjection.value));
const lineageProjections = computed(() => {
  const ids = new Set<string>([
    rootProjectionId.value,
    ...linkedProjectionIds.value,
    ...(chat.active?.executionIndex?.executions || []).flatMap((entry) => [
      String(entry.graph_id || '').trim(),
      String(entry.execution_id || '').trim(),
    ]),
  ].filter(Boolean));
  return [...ids].map((executionId) => projections.projectionFor(executionId));
});
const activityEvents = computed(() => {
  const canonical = canonicalActivityEvents(lineageProjections.value, 'audit');
  const sessionActivity = chat.active?.activity || [];
  const rows = new Map<string, ActivityEvent>();
  for (const item of [...store.activity, ...sessionActivity]) {
    const event = item as ActivityEvent;
    const identity = activityIdentityKey(event);
    const previous = rows.get(identity);
    rows.set(identity, previous ? {
      ...previous,
      ...event,
      detail: event.detail || previous.detail,
      status: event.status || previous.status,
      duration_ms: event.duration_ms ?? previous.duration_ms,
      input: event.input ?? previous.input,
      output: event.output ?? previous.output,
      raw: { ...(previous.raw || {}), ...(event.raw || {}) },
    } : event);
  }
  // The current typed execution projection is fresher than the durable
  // transcript, but it only covers one execution lineage. Merge it into the
  // Session-wide transcript activity instead of replacing earlier turns.
  for (const event of canonical) {
    const identity = activityIdentityKey(event);
    const previous = rows.get(identity);
    rows.set(identity, previous ? {
      ...previous,
      ...event,
      detail: event.detail || previous.detail,
      status: event.status || previous.status,
      duration_ms: event.duration_ms ?? previous.duration_ms,
      input: previous.input ?? event.input,
      output: previous.output ?? event.output,
      raw: { ...(previous.raw || {}), ...(event.raw || {}) },
    } : event);
  }
  return causalActivityTimeline([...rows.values()], 2_000);
});
const businessActivityEvents = computed(() => {
  return causalActivityTimeline(
    businessGraphActivities(canonicalActivityEvents(lineageProjections.value, 'narrative'))
      .filter((activity) => BUSINESS_TIMELINE_KINDS.has(activity.kind)),
    2_000,
  );
});
const visibleActivityEvents = computed(() => (
  activityMode.value === 'technical' ? activityEvents.value : businessActivityEvents.value
));
const inspectorEvents = computed(() => activityEvents.value.filter((event) => event.kind === 'error' || event.status === 'error'));
const activeProjection = computed(() => rootProjection.value);
const activeProjectionEntry = computed(() => rootProjectionId.value
  ? projections.entries[rootProjectionId.value]
  : null);
const executionGraph = computed(() => combineExecutionLineage(
  rootProjectionId.value,
  lineageProjections.value,
));
const executionConnectionState = computed(() => {
  const states = [rootProjectionId.value]
    .filter(Boolean)
    .map((executionId) => projections.stateFor(executionId));
  if (states.some((state) => state === 'error')) return 'error';
  if (states.some((state) => ['materializing', 'connecting', 'reconnecting'].includes(state))) return 'materializing';
  if (states.some((state) => state === 'live')) return 'live';
  if (states.length && states.every((state) => state === 'terminal')) return 'terminal';
  return states[0] || 'materializing';
});
const canonicalExecutionTurns = computed(() => {
  const rows = new Map<string, {
    turnId: string;
    userTurns: any[];
    order: number;
    timestamp: number;
  }>();
  let order = 0;
  const indexedExecutions = [...(chat.active?.executionIndex?.executions || [])]
    .sort((left, right) => (
      Number(left.started_at_ms || left.updated_at_ms || 0)
      - Number(right.started_at_ms || right.updated_at_ms || 0)
    ));
  for (const execution of indexedExecutions) {
    const turnId = String(execution.turn_id || '').trim();
    if (!turnId) continue;
    if (rows.has(turnId)) continue;
    rows.set(turnId, {
      turnId,
      userTurns: [],
      order: order += 1,
      timestamp: Number(execution.started_at_ms || execution.updated_at_ms || 0),
    });
  }
  const transcript = chat.active?.turns || [];
  for (let index = 0; index < transcript.length; index += 1) {
    const userTurn = transcript[index];
    if (userTurn.role !== 'user') continue;
    let turnId = String(userTurn.turn_id || '');
    for (let cursor = index + 1; !turnId && cursor < transcript.length; cursor += 1) {
      if (transcript[cursor].role === 'user') break;
      turnId = String(transcript[cursor].turn_id || '');
    }
    turnId = turnId || `message:${userTurn.id}`;
    const existing = rows.get(turnId);
    if (existing) {
      existing.userTurns.push(userTurn);
      existing.timestamp ||= Number(userTurn.created_at_ms || 0);
    } else {
      rows.set(turnId, {
        turnId,
        userTurns: [userTurn],
        order: order += 1,
        timestamp: Number(userTurn.created_at_ms || 0),
      });
    }
  }
  return [...rows.values()].sort((left, right) => (
    left.order - right.order || left.timestamp - right.timestamp
  ));
});
const executionTurnGroups = computed(() => {
  const entries = chat.active?.executionIndex?.executions || [];
  const canonicalTurns = canonicalExecutionTurns.value;
  const visibleTurns = canonicalTurns.slice(-executionHistoryLimit.value).reverse();
  return visibleTurns.map(({ turnId, userTurns, order, timestamp }) => {
    const indexedEntry = selectTurnExecutionEntry(entries, turnId);
    const isActiveTurn = turnId === chat.active?.executionTurnId;
    const entry = indexedEntry || (isActiveTurn ? {
      execution_id: chat.active?.executionId || '',
      graph_id: chat.active?.executionGraphId || null,
      turn_id: turnId,
      status: chat.active?.live?.status || (chat.active?.pending ? 'running' : 'unknown'),
      updated_at_ms: chat.active?.lastEventAtMs || Date.now(),
    } : null);
    const events = visibleActivityEvents.value.filter((event) => (
      event.turn_id === turnId
      || (!!entry?.execution_id && event.execution_id === entry.execution_id)
      || (!!entry?.execution_id && event.parent_execution_id === entry.execution_id)
    ));
    const evidenceRefs = Array.from(new Set([
      ...events.flatMap(activityEvidenceRefs),
    ]));
    const runtimeInput = runtimeInputItems.value.find((item: any) => (
      String(item?.turn_id || item?.active_turn_id || item?.input_id || item?.id || '') === turnId
    ));
    const transcriptInput = userTurns[0];
    const userPreview = String(
      runtimeInput?.content_preview
      || transcriptInput?.content
      || '',
    ).trim();
    return {
      entry: entry || {
        execution_id: '',
        graph_id: null,
        turn_id: turnId,
        status: transcriptInput?.status || 'unknown',
        updated_at_ms: timestamp,
      },
      turnId,
      runtimeInput,
      userPreview,
      label: t('chat.execution.turnNumber', {
        number: Math.max(1, order),
      }),
      status: String(
        (isActiveTurn && chat.active?.pending ? chat.active?.live?.status : '')
        || entry?.status
        || transcriptInput?.status
        || 'unknown',
      ),
      events,
      evidenceRefs,
      evidenceCount: evidenceRefs.length,
    };
  });
});
const hasMoreExecutionTurns = computed(() => (
  canonicalExecutionTurns.value.length > executionHistoryLimit.value
));
const projectionContractError = computed(() => {
  const message = activeProjectionEntry.value?.lastError || '';
  return message.startsWith('unsupported execution projection')
    || message.startsWith('unsupported strategy projection')
    ? message
    : '';
});
const liveExecution = computed(() => activeProjection.value?.live || chat.active?.live || null);
const liveMetrics = computed(() => liveExecution.value?.metrics || null);
function decodedPayload(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}
const executionUsage = computed(() => {
  const metricInput = Number(liveMetrics.value?.input_tokens || 0);
  const metricOutput = Number(liveMetrics.value?.output_tokens || 0);
  if (metricInput || metricOutput) return { input: metricInput, output: metricOutput };
  return (chat.active?.turns || []).reduce((total, turn) => {
    const usage = turn.token_usage || {};
    const input = Number(usage.input_tokens || usage.prompt_tokens || 0);
    const output = Number(usage.output_tokens || usage.completion_tokens || 0);
    return {
      input: total.input + (Number.isFinite(input) ? input : 0),
      output: total.output + (Number.isFinite(output) ? output : 0),
    };
  }, { input: 0, output: 0 });
});
const activityToolCount = computed(() => Math.max(
  Number(liveMetrics.value?.tool_calls || 0),
  activityEvents.value.filter((event) => event.kind === 'tool').length,
));
const activityApprovalCount = computed(() => Math.max(
  Number(liveMetrics.value?.approvals || 0),
  activityEvents.value.filter((event) => event.kind === 'approval').length,
));
const activityEvidenceCount = computed(() => Array.from(new Set([
  ...activityEvents.value.flatMap(activityEvidenceRefs),
])).length);
const activityMemoryEvidenceCount = computed(() =>
  Number(liveMetrics.value?.memory_evidence || 0),
);
const activityContextCount = computed(() => Math.max(
  Number(liveMetrics.value?.context_items || 0),
  contextItems.value.length,
));
const activityRealityStageCount = computed(() => Math.max(
  Number(store.currentRealityFlow?.stage_count || 0),
  realityStages.value.length,
));
const activityFileCount = computed(() => Math.max(
  Number(liveMetrics.value?.files_touched || 0),
  store.currentRunFiles.length,
));
const historyIndex = computed(() => chat.active?.historyIndex || null);
const historyCoverage = computed(() => {
  const index = historyIndex.value;
  if (!index) return '—';
  const indexed = Number(index.indexed_through_sequence ?? -1) + 1;
  const total = Number(index.total_messages || 0);
  if (!total) return index.index_complete ? '100%' : '0%';
  return `${Math.min(100, Math.round((Math.max(0, indexed) / total) * 100))}%`;
});
const historyRecoveryLabel = computed(() => {
  switch (historyIndex.value?.recovery_state) {
    case 'ready':
      return t('chat.history.index.ready');
    case 'manifest_rebuilt':
      return t('chat.history.index.manifest_rebuilt');
    case 'index_pending':
      return t('chat.history.index.index_pending');
    case 'checkpoint_missing':
      return t('chat.history.index.checkpoint_missing');
    case 'checkpoint_malformed':
      return t('chat.history.index.checkpoint_malformed');
    default:
      return t('chat.history.index.loading');
  }
});
const executionLatency = computed(() => liveExecution.value?.latency || null);
const selectedActivity = computed(() => store.selectedActivity as ActivityEvent | null);
const selectedActivityEvidenceRefs = computed(() => {
  if (activityEvidenceOverride.value.length) return activityEvidenceOverride.value;
  const event = selectedActivity.value;
  if (!event) return [];
  return Array.from(new Set(activityEvidenceRefs(event))).slice(0, 100);
});
const selectedActivityInput = computed(() => {
  const event = selectedActivity.value;
  return decodedPayload(event?.input
    ?? event?.raw?.input
    ?? (event?.raw?.tool_use as Record<string, unknown> | undefined)?.input
    ?? event?.raw?.arguments
    ?? null);
});
const selectedActivityOutput = computed(() => {
  const event = selectedActivity.value;
  return decodedPayload(event?.output
    ?? event?.raw?.output
    ?? (event?.raw?.tool_result as Record<string, unknown> | undefined)?.output
    ?? event?.raw?.result
    ?? null);
});
const selectedActivityDuration = computed(() => {
  const value = Number(selectedActivity.value?.duration_ms ?? selectedActivity.value?.raw?.duration_ms);
  if (!Number.isFinite(value) || value < 0) return '—';
  return value < 1_000
    ? `${Math.round(value)} ms`
    : `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, '')} s`;
});
const liveContextLabel = computed(() => {
  const usage = liveExecution.value?.context_usage;
  if (!usage?.window_tokens) return '—';
  return `${Number(usage.input_tokens || 0).toLocaleString()} / ${Number(usage.window_tokens).toLocaleString()}`;
});

function runtimeInputId(item: any) {
  return String(item?.input_id || item?.id || '');
}

function activityEvidenceRefs(event: any) {
  const raw = event?.raw || {};
  const direct = [
    ...(Array.isArray(event?.evidence_refs) ? event.evidence_refs : []),
    ...(Array.isArray(raw?.evidence_refs) ? raw.evidence_refs : []),
    raw?.full_output_ref,
    raw?.output_ref,
  ];
  const typed = [
    ...(Array.isArray(event?.refs) ? event.refs : []),
    ...(Array.isArray(raw?.refs) ? raw.refs : []),
  ].flatMap((reference: any) => {
    if (typeof reference === 'string') {
      return /^(?:evidence|tool|memory|matrix|audit):\/\//.test(reference) ? [reference] : [];
    }
    const kind = String(reference?.type || reference?.kind || '').toLowerCase();
    if (!kind.includes('evidence') && !['tool_output', 'memory', 'matrix', 'audit'].includes(kind)) return [];
    return [reference?.ref || reference?.id].filter(Boolean);
  });
  return [...direct, ...typed]
    .map((reference) => String(reference || '').trim())
    .filter(Boolean);
}

function runtimeInputPending(item: any) {
  return ['pending', 'accepted', 'queued', 'queued_next_step'].includes(
    String(item?.status || item?.state || '').toLowerCase(),
  );
}

function runtimeInputOwnership(item: any) {
  const decision = String(item?.decision || '').toLowerCase();
  switch (decision) {
    case 'start_new_turn':
      return t('chat.input.ownership.start_new_turn');
    case 'supplement_current_turn':
      return t('chat.input.ownership.supplement_current_turn');
    case 'interrupt_and_replan':
      return t('chat.input.ownership.interrupt_and_replan');
    case 'enqueue_next_step':
      return t('chat.input.ownership.enqueue_next_step');
    case 'spawn_subtask':
      return t('chat.input.ownership.spawn_subtask');
    case 'route_cross_session':
      return t('chat.input.ownership.route_cross_session');
    case 'create_new_session':
      return t('chat.input.ownership.create_new_session');
    case 'control_or_approval':
      return t('chat.input.ownership.control_or_approval');
    default:
      return t('chat.input.ownership.unknown');
  }
}

async function cancelRuntimeInput(item: any) {
  await store.cancelSessionInput(runtimeInputId(item));
}

async function queueRuntimeInput(item: any) {
  await store.reclassifySessionInput(runtimeInputId(item), 'enqueue_next_step');
}

async function uploadFiles(files: FileList | null) {
  if (!files?.length) return;
  await store.uploadWorkspaceFiles(files);
  if (fileInput.value) fileInput.value.value = '';
}

async function dropUpload(event: DragEvent) {
  event.preventDefault();
  await uploadFiles(event.dataTransfer?.files || null);
}

function applyCompanionWidth(width: number) {
  const next = Math.max(320, Math.min(720, width));
  document.documentElement.style.setProperty('--companion-width', `${next}px`);
  localStorage.setItem('cowd-webui-companion-width', String(next));
}

function startResize(event: MouseEvent) {
  resizing.value = true;
  event.preventDefault();
}

function dragResize(event: MouseEvent) {
  if (!resizing.value) return;
  applyCompanionWidth(window.innerWidth - event.clientX);
}

function stopResize() {
  resizing.value = false;
}

function openPreview() {
  if (!store.selectedFile) return;
  previewOpen.value = true;
  previewMode.value = 'render';
  previewEditing.value = false;
  imageZoom.value = 1;
}

async function copyPreviewLink() {
  if (!store.selectedFile) return;
  const link = new URL(rawFileUrl.value, window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(link);
  } catch (error) {
    store.fileError = error instanceof Error ? error.message : String(error);
  }
}

function togglePreviewEditing() {
  previewEditing.value = !previewEditing.value;
  previewMode.value = previewEditing.value ? 'source' : 'render';
}

async function savePreviewFile() {
  await store.saveFile();
  if (!store.fileError) previewEditing.value = false;
}

function closePreview() {
  previewOpen.value = false;
}

async function openActivityDetail(item: Record<string, unknown>) {
  store.selectedActivity = item;
  activityEvidenceOverride.value = [];
  activityEvidenceOpen.value = false;
  activityDetailOpen.value = true;
  const activityId = String(item.activity_id || item.id || '').trim();
  const executionId = String(item.execution_id || '').trim();
  if (!activityId || !executionId || !item.detail_capability) return;
  const request = activityDetailRequest += 1;
  activityDetailLoading.value = true;
  try {
    const detail = await api.executionActivity(
      executionId,
      activityId,
      String(item.session_id || chat.active?.id || ''),
    );
    if (request !== activityDetailRequest) return;
    activityEvidenceOverride.value = Array.from(new Set([
      ...(detail.activity?.evidence_refs || []),
      ...(detail.activity?.artifact_refs || []),
    ])).slice(0, 100);
    store.selectedActivity = presentActivityDetail(detail, item);
  } catch (error) {
    if (request !== activityDetailRequest) return;
    store.selectedActivity = {
      ...item,
      raw: {
        ...(typeof item.raw === 'object' && item.raw ? item.raw : {}),
        detail_error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    if (request === activityDetailRequest) activityDetailLoading.value = false;
  }
}

function openGraphNodeDetail(node: Record<string, unknown>) {
  selectedExecutionNode.value = node;
  const activityId = String(node.canonical_activity_id || node.node_id || '').trim();
  const activity = activityEvents.value.find((candidate) => candidate.id === activityId);
  void openActivityDetail(activity || node);
}

function openTurnEvidenceDetail(group: any) {
  activityEvidenceOverride.value = Array.from(new Set(group.evidenceRefs || [])).slice(0, 100);
  store.selectedActivity = {
    id: `turn-input:${group.turnId}`,
    kind: 'input',
    title: group.userPreview || group.label,
    detail: group.label,
    input: {
      message: group.userPreview,
      ownership: group.runtimeInput ? runtimeInputOwnership(group.runtimeInput) : null,
    },
    output: {
      status: group.status,
      event_count: group.events.length,
      evidence_count: group.evidenceCount,
      execution_id: group.entry?.execution_id || null,
      graph_id: group.entry?.graph_id || null,
    },
    turn_id: group.turnId,
    timestamp: Number(group.entry?.updated_at_ms || 0),
    raw: {
      turn_id: group.turnId,
      execution_id: group.entry?.execution_id || null,
      evidence_refs: activityEvidenceOverride.value,
      events: group.events,
    },
  };
  activityEvidenceOpen.value = false;
  activityDetailOpen.value = true;
}

function toggleTurn(turnId: string) {
  const next = new Set(collapsedTurnIds.value);
  if (next.has(turnId)) next.delete(turnId);
  else next.add(turnId);
  collapsedTurnIds.value = next;
}

function turnCollapsed(turnId: string) {
  return collapsedTurnIds.value.has(turnId);
}

function turnStatusIcon(status: string) {
  const normalized = status.toLowerCase();
  if (['complete', 'completed', 'succeeded', 'resolved'].includes(normalized)) return CheckCircle2;
  if (['error', 'failed', 'blocked'].includes(normalized)) return CircleAlert;
  if (['running', 'thinking', 'calling_model', 'calling_tool', 'preparing_context', 'finalizing'].includes(normalized)) return LoaderCircle;
  return CircleDashed;
}

function turnStatus(status: string) {
  return String(status || 'unknown').toLowerCase();
}

function closeActivityDetail() {
  activityDetailRequest += 1;
  activityDetailLoading.value = false;
  activityDetailOpen.value = false;
  activityEvidenceOpen.value = false;
  activityEvidenceOverride.value = [];
}

function closeActivityEvidence() {
  activityEvidenceOpen.value = false;
  if (activityEvidenceDetails.value) activityEvidenceDetails.value.open = false;
}

function openExecutionTurn(graphId: string | null | undefined) {
  const normalized = String(graphId || '').trim();
  if (normalized) store.openChatExecutionGraph(normalized);
}

function formatTokenQuantity(value: number) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return Math.round(value).toString();
}

async function stepPreview(delta: number) {
  if (!previewableFiles.value.length) return;
  const current = selectedFileIndex.value >= 0 ? selectedFileIndex.value : 0;
  const nextIndex = Math.max(0, Math.min(previewableFiles.value.length - 1, current + delta));
  const next = previewableFiles.value[nextIndex];
  if (next) {
    await store.openFile(next.path);
    openPreview();
  }
}

watch(() => store.selectedFile, (path) => {
  if (path) openPreview();
});
watch(
  () => String(store.selectedActivity?.id || ''),
  (activityId) => {
    if (
      !activityId
      || activityDetailOpen.value
      || store.companionTab !== 'activity'
      || !store.selectedActivity?.detail_capability
    ) return;
    void openActivityDetail(store.selectedActivity as Record<string, unknown>);
  },
  { immediate: true },
);

useEscapeKey(() => closePreview(), () => previewOpen.value);
useEscapeKey(() => closeActivityDetail(), () => activityDetailOpen.value);

onMounted(() => {
  const savedWidth = Number(localStorage.getItem('cowd-webui-companion-width') || 0);
  if (savedWidth) applyCompanionWidth(savedWidth);
  window.addEventListener('mousemove', dragResize);
  window.addEventListener('mouseup', stopResize);
});

onBeforeUnmount(() => {
  projections.release('chat:companion-root-execution');
  window.removeEventListener('mousemove', dragResize);
  window.removeEventListener('mouseup', stopResize);
});

watch(
  [rootProjectionId, () => store.companionTab, activityMode],
  ([executionId, tab, mode]) => {
  projections.release('chat:companion-root-execution');
  if (tab !== 'activity' || !executionId || !store.activeSessionId) return;
  projections.acquire(
    executionId,
    'chat:companion-root-execution',
    mode === 'technical' ? 'full' : 'summary',
    'bounded',
    store.activeSessionId,
  );
  },
  { immediate: true },
);

</script>

<template>
  <aside class="companion-panel" :aria-label="t('component.companion.panel.aria-label.98b3d09f27')">
    <button class="companion-resizer" type="button" :aria-label="t('workspace.preview.resize')" @mousedown="startResize"></button>
    <div class="companion-tabs" role="tablist">
      <button :class="{ active: store.companionTab === 'activity' }" type="button" @click="store.openCompanion('activity')">
        <Workflow :size="15" />
        <span>{{ t('component.companion.panel.text.49c2a0044c') }}</span>
      </button>
      <button :class="{ active: store.companionTab === 'workspace' }" type="button" @click="store.openCompanion('workspace')">
        <Folder :size="15" />
        <span>{{ t('component.companion.panel.text.594060d245') }}</span>
      </button>
      <button :class="{ active: store.companionTab === 'inspector' }" type="button" @click="store.openCompanion('inspector')">
        <Info :size="15" />
        <span>{{ t('component.companion.panel.text.85df2a90f7') }}</span>
      </button>
    </div>

    <section v-if="store.companionTab === 'activity'" class="companion-body">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.97ab0e4ebb') }}</h2>
        <div class="segmented activity-mode-switch" role="group" :aria-label="t('chat.execution.activityMode')">
          <button type="button" :class="{ active: activityMode === 'business' }" @click="activityMode = 'business'">
            {{ t('chat.execution.businessMode') }}
          </button>
          <button type="button" :class="{ active: activityMode === 'technical' }" @click="activityMode = 'technical'">
            {{ t('chat.execution.technicalMode') }}
          </button>
        </div>
        <span>{{ formatCount('events', visibleActivityEvents.length) }}</span>
      </div>
      <section v-if="chat.active?.executionGraphId || chat.active?.executionId" class="companion-execution-graph">
        <header>
          <span>
            <Workflow :size="14" />
            {{ linkedProjectionIds.length ? t('chat.execution.teamGraph') : t('chat.execution.graph') }}
          </span>
          <small>{{ displayStatus(executionConnectionState) }}</small>
        </header>
        <ExecutionGraphCanvas
          :graph="executionGraph"
          :selected-node-id="String(selectedExecutionNode?.node_id || selectedExecutionNode?.id || '')"
          :connection-state="executionConnectionState"
          :loading="!executionGraph"
          :activity-events="businessActivityEvents"
          compact
          @select="openGraphNodeDetail"
          @expand="store.openChatExecutionGraph(rootProjectionId)"
        />
      </section>
      <div class="execution-stream-summary activity-metric-grid">
        <span><Wrench :size="13" />{{ t('chat.execution.tools') }} <strong>{{ activityToolCount }}</strong></span>
        <span><Brain :size="13" />{{ t('chat.execution.memoryCalls') }} <strong>{{ Number(liveMetrics?.memory_recalls || 0) }}</strong></span>
        <span><FileCheck2 :size="13" />{{ t('page.chat.cleanCounters.memoryEvidence') }} <strong>{{ activityMemoryEvidenceCount }}</strong></span>
        <span><MemoryStick :size="13" />{{ t('component.companion.panel.text.de0a30c1bf') }} <strong>{{ activityContextCount }}</strong></span>
        <span><Workflow :size="13" />{{ t('component.companion.panel.text.75c2e8fc26') }} <strong>{{ activityRealityStageCount }}</strong></span>
        <span><FileText :size="13" />{{ t('component.companion.panel.text.727690de87') }} <strong>{{ activityFileCount }}</strong></span>
        <span><ShieldCheck :size="13" />{{ t('execution.kind.approval') }} <strong>{{ activityApprovalCount }}</strong></span>
        <span><Coins :size="13" />{{ t('chat.execution.totalTokens') }} <strong>{{ formatTokenQuantity(executionUsage.input + executionUsage.output) }}</strong></span>
        <span :title="historyRecoveryLabel"><Clock3 :size="13" />{{ t('chat.history.index.coverage') }} <strong>{{ historyCoverage }}</strong></span>
        <span :title="historyRecoveryLabel"><RotateCcw :size="13" />{{ t('chat.history.index.generation') }} <strong>{{ historyIndex?.projection_generation ?? '—' }}</strong></span>
        <span><Clock3 :size="13" />{{ t('chat.execution.harnessLatency') }} <strong>{{ executionLatency ? `${executionLatency.harness_elapsed_ms} ms` : '—' }}</strong></span>
        <span><Clock3 :size="13" />{{ t('chat.execution.providerLatency') }} <strong>{{ executionLatency ? `${executionLatency.provider_wall_ms} ms` : '—' }}</strong></span>
      </div>
      <p v-if="projectionContractError" class="companion-contract-alert" role="alert">
        {{ t('strategy.state.contractMismatch') }} · {{ projectionContractError }}
      </p>
      <div v-if="executionTurnGroups.length" class="execution-turn-groups">
        <section v-for="group in executionTurnGroups" :key="group.turnId" class="execution-turn-group">
          <header class="execution-turn-head">
            <button
              class="turn-collapse-action"
              type="button"
              :aria-label="turnCollapsed(group.turnId) ? t('common.expand') : t('common.collapse')"
              :aria-expanded="!turnCollapsed(group.turnId)"
              @click="toggleTurn(group.turnId)"
            >
              <ChevronRight v-if="turnCollapsed(group.turnId)" :size="13" />
              <ChevronDown v-else :size="13" />
            </button>
            <button
              class="turn-title-action"
              type="button"
              :title="group.userPreview"
              @click="openTurnEvidenceDetail(group)"
            >
              <component :is="turnStatusIcon(group.status)" :size="13" :class="{ spinning: ['running', 'thinking', 'calling_model', 'calling_tool', 'preparing_context', 'finalizing'].includes(turnStatus(group.status)) }" />
              <strong>{{ group.label }}</strong>
              <span v-if="group.userPreview">· {{ group.userPreview }}</span>
              <small :data-status="turnStatus(group.status)">{{ displayStatus(group.status) }}</small>
              <small v-if="group.evidenceCount" class="turn-evidence-count"><FileCheck2 :size="11" />{{ group.evidenceCount }}</small>
            </button>
            <div class="turn-head-actions">
              <template v-if="group.runtimeInput && runtimeInputPending(group.runtimeInput)">
                <button class="icon-action" type="button" :aria-label="t('chat.input.action.queue')" @click="queueRuntimeInput(group.runtimeInput)">
                  <ChevronRight :size="14" />
                </button>
                <button class="icon-action danger" type="button" :aria-label="t('chat.input.action.cancel')" @click="cancelRuntimeInput(group.runtimeInput)">
                  <X :size="14" />
                </button>
              </template>
              <time v-if="group.entry?.updated_at_ms">{{ new Date(group.entry.updated_at_ms).toLocaleTimeString() }}</time>
              <button
                class="icon-action"
                type="button"
                :disabled="!group.entry?.graph_id"
                :aria-label="t('chat.execution.graph')"
                :title="t('chat.execution.graph')"
                @click="openExecutionTurn(group.entry?.graph_id)"
              >
                <Workflow :size="13" />
              </button>
            </div>
          </header>
          <div v-show="!turnCollapsed(group.turnId)" class="execution-turn-content">
            <p
              v-if="group.runtimeInput?.status === 'failed'"
              class="companion-contract-alert"
              role="alert"
            >
              {{ group.runtimeInput.failure_class || displayStatus(group.runtimeInput.status) }}
              <template v-if="group.runtimeInput.last_error"> · {{ group.runtimeInput.last_error }}</template>
            </p>
            <TimelineList
              v-if="group.events.length"
              :items="group.events"
              :filterable="false"
              causal
              :selected-id="String(store.selectedActivity?.id || '')"
              @select="openActivityDetail"
            />
            <p v-else class="empty-note">{{ t('chat.execution.turnNoEvents') }}</p>
          </div>
        </section>
        <button
          v-if="hasMoreExecutionTurns"
          class="ghost-action execution-history-more"
          type="button"
          @click="executionHistoryLimit += 50"
        >
          {{ t('chat.execution.loadMoreTurns') }}
        </button>
      </div>
      <TimelineList
        v-else
        class="companion-timeline"
        :items="visibleActivityEvents"
        :filterable="false"
        live
        causal
        :selected-id="String(store.selectedActivity?.id || '')"
        @select="openActivityDetail"
      />
    </section>

    <section v-else-if="store.companionTab === 'workspace'" class="companion-body workspace-tab">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.594060d245') }}</h2>
        <span>{{ formatCount('items', store.workspaceFiles.length) }}</span>
      </div>
      <div class="workspace-root" :title="store.workspaceRoot">{{ store.workspaceRoot || t('component.companion.panel.inline.76270efe65') }}</div>
      <div class="upload-drop" @dragover.prevent @drop="dropUpload">
        <Upload :size="16" />
        <span>{{ store.uploadBusy ? t('component.companion.panel.inline.acde0a17ab') : t('component.companion.panel.inline.d2f9c4ceab') }}</span>
        <button type="button" @click="fileInput?.click()">{{ t('component.companion.panel.text.5231b7a1c8') }}</button>
        <input ref="fileInput" type="file" multiple @change="uploadFiles(($event.target as HTMLInputElement).files)" />
      </div>
      <div v-if="store.attachments.length" class="attachment-list">
        <div class="panel-title compact">
          <h2>{{ t('component.companion.panel.text.7a057b8ff5') }}</h2>
          <span>{{ store.attachments.length }}</span>
        </div>
        <article v-for="attachment in store.attachments" :key="attachment.ref_id" class="attachment-row">
          <Link2 :size="14" />
          <span>{{ attachment.label || attachment.path }}</span>
          <small>{{ attachment.kind }} · {{ attachment.detected_mime || displayStatus(attachment.status || 'unknown') }}</small>
          <button class="icon-action" type="button" @click="store.removeAttachment(attachment.ref_id)"><X :size="13" /></button>
        </article>
      </div>
      <label class="workspace-search">
        <Search :size="14" />
        <input v-model="store.workspaceFilter" type="search" :placeholder="t('component.companion.panel.placeholder.070c810b3f')" />
      </label>
      <WorkspaceTree />
      <div v-if="workspaceMetaEntries.length" class="workspace-meta-panel">
        <div class="panel-title compact">
          <h2>{{ t('workspace.preview.meta.title') }}</h2>
          <span>{{ workspaceMetaEntries.length }}</span>
        </div>
        <dl class="detail-list">
          <template v-for="item in workspaceMetaEntries" :key="item.key">
            <dt>{{ item.key }}</dt>
            <dd>{{ item.value }}</dd>
          </template>
        </dl>
      </div>
    </section>

    <section v-else class="companion-body">
      <div class="panel-title">
        <h2>{{ t('component.companion.panel.text.85df2a90f7') }}</h2>
        <span>{{ inspectorEvents.length }} errors</span>
      </div>
      <dl class="detail-list">
        <dt>{{ t('component.companion.panel.text.594060d245') }}</dt>
        <dd>{{ store.workspaceRoot || t('component.companion.panel.inline.2c58a61ee9') }}</dd>
        <dt>{{ t('component.companion.panel.text.5fab3c518f') }}</dt>
        <dd>{{ store.selectedFile || '-' }}</dd>
        <dt>{{ t('component.companion.panel.text.bd29ce8763') }}</dt>
        <dd>{{ store.fileError || '-' }}</dd>
        <dt>{{ t('component.companion.panel.text.2c11686ce6') }}</dt>
        <dd>{{ liveContextLabel }}</dd>
        <dt>{{ t('component.companion.panel.text.68f0885972') }}</dt>
        <dd>{{ store.selectedActivity?.title || '-' }}</dd>
      </dl>
      <div class="activity-list">
        <article v-for="event in inspectorEvents" :key="event.id" class="activity-item" data-kind="error">
          <div>
            <strong>{{ event.title }}</strong>
            <p>{{ event.detail || t('component.companion.panel.inline.f3fd2cb8bf') }}</p>
          </div>
          <span>{{ displayStatus(event.status || 'error') }}</span>
        </article>
      </div>
    </section>

    <div v-if="previewOpen" class="modal-scrim workspace-preview-scrim" @click.self="closePreview">
      <section class="workspace-preview-modal" tabindex="-1">
        <header>
          <div>
            <strong>{{ store.selectedFile }}</strong>
            <span>{{ previewKind }}</span>
          </div>
          <div class="preview-modal-actions">
            <button class="icon-action" type="button" :disabled="selectedFileIndex <= 0" :aria-label="t('workspace.preview.previous')" @click="stepPreview(-1)"><ChevronLeft :size="16" /></button>
            <button class="icon-action" type="button" :disabled="selectedFileIndex < 0 || selectedFileIndex >= previewableFiles.length - 1" :aria-label="t('workspace.preview.next')" @click="stepPreview(1)"><ChevronRight :size="16" /></button>
            <button v-if="previewKind === 'image'" class="icon-action" type="button" :aria-label="t('workspace.preview.zoomOut')" @click="imageZoom = Math.max(0.4, imageZoom - 0.2)"><ZoomOut :size="16" /></button>
            <button v-if="previewKind === 'image'" class="icon-action" type="button" :aria-label="t('workspace.preview.zoomIn')" @click="imageZoom = Math.min(3, imageZoom + 0.2)"><ZoomIn :size="16" /></button>
            <button v-if="canEdit" class="icon-action" type="button" :aria-label="t('workspace.preview.toggleSource')" @click="previewMode = previewMode === 'render' ? 'source' : 'render'"><Code2 :size="16" /></button>
            <button v-if="canEdit" class="icon-action" type="button" :aria-pressed="previewEditing" :aria-label="t('workspace.preview.action.edit')" @click="togglePreviewEditing"><Edit3 :size="16" /></button>
            <button v-if="previewEditing" class="icon-action" type="button" :disabled="!store.editorDirty" :aria-label="t('workspace.preview.action.reset')" @click="store.resetFile"><RotateCcw :size="16" /></button>
            <button v-if="previewEditing" class="icon-action" type="button" :disabled="!store.editorDirty" :aria-label="t('workspace.preview.action.save')" @click="savePreviewFile"><Save :size="16" /></button>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.copyLink')" @click="copyPreviewLink"><Clipboard :size="16" /></button>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.openExternal')" @click="store.openWorkspacePathExternally(store.selectedFile)"><ExternalLink :size="16" /></button>
            <button class="icon-action" type="button" :aria-label="t('workspace.preview.action.download')" @click="store.downloadWorkspacePath(store.selectedFile, 'file')"><Download :size="16" /></button>
            <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="closePreview"><X :size="16" /></button>
          </div>
        </header>
        <div class="workspace-preview-content">
          <div v-if="store.fileError" class="unsupported-preview">
            <strong>{{ t('workspace.preview.blocked') }}</strong>
            <p>{{ store.fileError }}</p>
            <button class="ghost-action" type="button" @click="store.downloadWorkspacePath(store.selectedFile, 'file')">
              <Download :size="14" />{{ t('workspace.preview.action.download') }}
            </button>
          </div>
          <div v-else-if="previewKind === 'image'" class="image-preview modal-image">
            <img :src="rawFileUrl" alt="" :style="{ transform: `scale(${imageZoom})` }" />
          </div>
          <iframe v-else-if="previewKind === 'web' && previewMode === 'render'" class="browser-preview" :srcdoc="store.editorContent" sandbox="allow-same-origin"></iframe>
          <iframe v-else-if="previewKind === 'pdf'" class="browser-preview" :src="rawFileUrl"></iframe>
          <audio v-else-if="previewKind === 'audio'" class="media-preview" :src="rawFileUrl" controls></audio>
          <video v-else-if="previewKind === 'video'" class="media-preview video" :src="rawFileUrl" controls></video>
          <div v-else-if="previewKind === 'markdown' && previewMode === 'render'" class="render-preview">
            <MarkdownBlock :content="store.editorContent" />
          </div>
          <textarea v-else-if="canEdit" v-model="store.editorContent" class="structured-preview" :readonly="!previewEditing" spellcheck="false" />
          <div v-else class="unsupported-preview">
            <strong>{{ t('workspace.preview.unsupported.title') }}</strong>
            <p>{{ t('workspace.preview.unsupported.body') }}</p>
            <button class="ghost-action" type="button" @click="store.downloadWorkspacePath(store.selectedFile, 'file')">
              <Download :size="14" />{{ t('workspace.preview.action.download') }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-if="activityDetailOpen && selectedActivity" class="modal-scrim activity-detail-scrim" @click.self="closeActivityDetail">
      <section class="activity-detail-modal" tabindex="-1">
        <header>
          <div>
            <strong>{{ selectedActivity.title }}</strong>
            <span><Clock3 :size="13" />{{ selectedActivityDuration }}</span>
          </div>
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="closeActivityDetail"><X :size="16" /></button>
        </header>
        <div class="activity-detail-content">
          <div v-if="activityDetailLoading" class="inline-loading" role="status">
            <LoaderCircle class="spin" :size="15" />
            <span>{{ t('common.loading') }}</span>
          </div>
          <p v-if="selectedActivity.detail" class="activity-detail-summary">{{ selectedActivity.detail }}</p>
          <section v-if="selectedActivityInput !== null && selectedActivityInput !== undefined" class="activity-structured-section">
            <header><strong>{{ t('chat.activity.detail.input') }}</strong></header>
            <StructuredValue :value="selectedActivityInput" />
          </section>
          <section v-if="selectedActivityOutput !== null && selectedActivityOutput !== undefined" class="activity-structured-section">
            <header><strong>{{ t('chat.activity.detail.output') }}</strong></header>
            <StructuredValue :value="selectedActivityOutput" />
          </section>
          <RawPayload
            :title="t('chat.activity.detail.event')"
            :data="selectedActivity.raw || selectedActivity"
            :max-chars="6000"
          />
          <details
            v-if="selectedActivityEvidenceRefs.length"
            ref="activityEvidenceDetails"
            class="activity-evidence-drilldown"
            @toggle="activityEvidenceOpen = ($event.currentTarget as HTMLDetailsElement).open"
          >
            <summary>
              <FileCheck2 :size="14" />
              {{ t('page.chat.page.text.848af509ba') }}
              <strong>{{ selectedActivityEvidenceRefs.length }}</strong>
            </summary>
            <EvidenceInspector
              v-if="activityEvidenceOpen"
              :refs="selectedActivityEvidenceRefs"
              :session-id="chat.activeSessionId || store.activeSessionId"
              :subject="selectedActivity.raw || selectedActivity"
              @close="closeActivityEvidence"
            />
          </details>
        </div>
      </section>
    </div>
  </aside>
</template>
