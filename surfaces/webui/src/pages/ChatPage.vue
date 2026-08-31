<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Bot,
  ArrowDown,
  Boxes,
  Brain,
  Check,
  CircleAlert,
  CircleDot,
  Clock,
  Coins,
  Copy,
  Eye,
  FileCheck2,
  Folder,
  Gauge,
  GitBranch,
  History,
  LoaderCircle,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  Square,
  Workflow,
  Wrench,
  X,
} from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import {
  api,
  type SessionExecutionPolicyPreset,
} from '../api/client';
import MarkdownBlock from '../components/MarkdownBlock.vue';
import { copyTextToClipboard } from '../utils/clipboard';
import ExecutionActivityTree from '../components/chat/ExecutionActivityTree.vue';
import ReasoningGroup from '../components/chat/ReasoningGroup.vue';
import ExecutionGraphCanvas from '../components/mission/ExecutionGraphCanvas.vue';
import { useEscapeKey } from '../composables/useEscapeKey';
import { displayStatus } from '../i18n/domain/status';
import { blockedRecoveryForTurn } from '../utils/blockedRecovery';
import type {
  ActivityEvent,
  CancellationReceipt,
  ChatTurn,
  SessionRoutingFocusProjection,
  SessionExecutionPolicyResponse,
  TaskAggregateProjection,
} from '../types';
import { policyAxisValue } from '../adapters/approvalPresentation';
import { causalActivityTimeline } from '../utils/causalTimeline';
import { mergeActivityEvent } from '../utils/turnSettlement';
import { releaseProjection } from '../release';
import {
  combineExecutionLineage,
  entryGraphId,
  executionProjectionLinks,
  executionTopologyCounts,
  selectTurnExecutionEntry,
} from '../utils/executionLineage';
import {
  canonicalActivityEvents,
  canonicalActivityRelations,
  type ActivityView,
} from '../adapters/executionActivity';
import {
  reasoningPresentation,
  type ReasoningPresentation,
} from '../adapters/reasoningPresentation';

const GlobalMissionGraphDialog = defineAsyncComponent(
  () => import('../components/mission/GlobalMissionGraphDialog.vue'),
);
const store = useAppStore();
const chat = useChatSessionsStore();
const projections = useProjectionRegistryStore();
onMounted(() => {
  // Model metadata backs the always-visible model/context controls. Heavy
  // execution evidence remains owned by the closed-by-default companion.
  store.loadChatCapabilities().catch(() => undefined);
});
const globalMissionGraphOpen = ref(false);
const executionPolicyOpen = ref(false);
const executionPolicyBusy = ref(false);
const executionPolicyError = ref('');
const executionPolicy = ref<SessionExecutionPolicyResponse | null>(null);
const draftExecutionPolicyPreset = ref<SessionExecutionPolicyPreset>('supervised');
const executionPolicyPresets: SessionExecutionPolicyPreset[] = [
  'cautious',
  'supervised',
  'stewarded',
  'autonomous',
  'yolo',
];
const routingDialogOpen = ref(false);
const routingBusy = ref(false);
const routingError = ref('');
const routingFocus = ref<SessionRoutingFocusProjection>({ revision: 0 });
const currentTask = ref<TaskAggregateProjection | null>(null);
const missionOptions = ref<Array<{ mission_id: string; objective: string }>>([]);
const selectedMissionFocus = ref('');
const release = computed(() => releaseProjection(store.health));
const releaseTitle = computed(() => t('release.versions', {
  edge: release.value.edge,
  gateway: release.value.gateway,
}));
const transcript = ref<HTMLElement | null>(null);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const commandSearchInput = ref<HTMLInputElement | null>(null);
const transcriptPinnedToTail = ref(true);
const historyLoadInFlight = ref(false);
const pendingTailSessionId = ref('');
const copiedAnswerId = ref('');
let copiedAnswerResetTimer: ReturnType<typeof setTimeout> | null = null;
const copiedUserMessageId = ref('');
let copiedUserMessageResetTimer: ReturnType<typeof setTimeout> | null = null;
const unboundDraft = ref('');
const draft = computed({
  get: () => store.activeSessionId ? (chat.active?.draft || '') : unboundDraft.value,
  set: (value: string) => {
    if (store.activeSessionId) chat.setDraft(store.activeSessionId, value);
    else unboundDraft.value = value;
  },
});
const commandQuery = ref('');
const currentExecutionProjectionId = computed(() => (
  chat.active?.executionGraphId || chat.active?.executionId || ''
));
const currentProjection = computed(() => currentExecutionProjectionId.value
  ? projections.projectionFor(currentExecutionProjectionId.value)
  : null);
const requestedExecutionGraphId = computed(() => (
  store.chatExecutionGraphId || chat.active?.executionGraphId || chat.active?.executionId || ''
));
const requestedProjection = computed(() => requestedExecutionGraphId.value
  ? projections.projectionFor(requestedExecutionGraphId.value)
  : null);
const linkedExecutionProjectionIds = computed(() => executionProjectionLinks(requestedProjection.value));
const lineageProjections = computed(() => [requestedProjection.value]);
const canonicalNarrativeActivities = computed(() => (
  canonicalActivityEvents(lineageProjections.value, 'narrative')
));
const activeProjection = computed(() => requestedProjection.value);
const projectionTaskId = computed(() => String(activeProjection.value?.task_id || '').trim());
const currentTaskId = computed(() => String(
  projectionTaskId.value
  || routingFocus.value.task?.task_id
  || '',
).trim());
const currentMissionId = computed(() => String(
  currentTask.value?.mission_id
  || routingFocus.value.mission?.mission_id
  || '',
).trim());
const executionGraph = computed(() => combineExecutionLineage(
  requestedExecutionGraphId.value,
  lineageProjections.value,
));
const executionTopology = computed(() => executionTopologyCounts(executionGraph.value));
const executionConnectionState = computed(() => {
  const states = [requestedExecutionGraphId.value]
    .filter(Boolean)
    .map((executionId) => projections.stateFor(executionId));
  if (states.some((state) => state === 'error')) return 'error';
  if (states.some((state) => ['materializing', 'connecting', 'reconnecting'].includes(state))) return 'materializing';
  if (states.some((state) => state === 'live')) return 'live';
  if (states.length && states.every((state) => state === 'terminal')) return 'terminal';
  return states[0] || 'idle';
});
const executionGraphLoading = computed(() => (
  !executionGraph.value
  && ['idle', 'materializing', 'connecting', 'reconnecting'].includes(executionConnectionState.value)
));
const selectedExecutionEntry = computed(() => (
  (chat.active?.executionIndex?.executions || []).find((entry) => (
    entry.graph_id === requestedExecutionGraphId.value
    || entry.execution_id === requestedExecutionGraphId.value
  )) || null
));
const executionActivityEvents = computed(() => {
  if (canonicalNarrativeActivities.value.length) {
    return canonicalNarrativeActivities.value.slice(-500);
  }
  const rows = new Map<string, ActivityEvent>();
  const lineageIds = new Set([
    requestedExecutionGraphId.value,
    ...linkedExecutionProjectionIds.value,
  ].filter(Boolean));
  for (const event of [...store.activity, ...(chat.active?.activity || [])]) {
    const entry = selectedExecutionEntry.value;
    const belongsToExecutionLineage = !entry
      || event.execution_id === entry.execution_id
      || event.parent_execution_id === entry.execution_id
      || lineageIds.has(String(event.execution_id || ''))
      || lineageIds.has(String(event.graph_id || ''));
    if (
      entry
      && event.turn_id
      && entry.turn_id
      && event.turn_id !== entry.turn_id
      && !belongsToExecutionLineage
    ) continue;
    const previous = rows.get(event.id);
    rows.set(event.id, mergeActivityEvent(previous, event));
  }
  return [...rows.values()].slice(-160);
});
const live = computed(() => {
  const local = chat.active?.live || null;
  if (chat.active?.submitting || chat.active?.pending) {
    return local || currentProjection.value?.live || null;
  }
  return currentProjection.value?.live || local;
});
const providerModelRows = computed(() => {
  const providers = store.providers as any;
  const control = store.controlPlane as any;
  const settings = store.settings as any;
  return [
    ...(Array.isArray(providers?.models) ? providers.models : []),
    ...(Array.isArray(providers?.catalog?.models) ? providers.catalog.models : []),
    ...(Array.isArray(control?.components?.provider?.catalog?.models) ? control.components.provider.catalog.models : []),
    ...(Array.isArray(settings?.models) ? settings.models : []),
  ];
});
const effectiveModel = computed(() => String(live.value?.context_usage?.model || '').trim());
const modelLabel = computed(() => effectiveModel.value || store.selectedModel || '—');
const selectedModelMetadata = computed(() => {
  const target = modelLabel.value.toLowerCase();
  return providerModelRows.value.find((model: any) => (
    [model?.id, model?.name, model?.display_name, model?.model]
      .some((value) => String(value || '').toLowerCase() === target)
  )) || null;
});
const latestInputTokens = computed(() => {
  const turns = [...(chat.active?.turns || [])].reverse();
  for (const turn of turns) {
    const usage = turn.token_usage || {};
    const value = Number(usage.input_tokens || usage.prompt_tokens || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
});
const contextWindowTokens = computed(() => {
  const liveWindow = Number(live.value?.context_usage?.window_tokens || 0);
  if (Number.isFinite(liveWindow) && liveWindow > 0) return liveWindow;
  const model = selectedModelMetadata.value;
  const configured = Number(
    model?.context_window_tokens
    || model?.context_window
    || model?.contextWindow
    || model?.max_context_tokens
    || model?.max_context
    || model?.context_length
    || 0,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 0;
});
const contextInputTokens = computed(() => {
  const liveInput = Number(live.value?.context_usage?.input_tokens || 0);
  return Number.isFinite(liveInput) && liveInput > 0 ? liveInput : latestInputTokens.value;
});
const contextUsage = computed(() => {
  const raw = live.value?.context_usage?.usage_percent_bp;
  if (raw !== null && raw !== undefined && raw !== '') {
    const value = Number(raw);
    if (Number.isFinite(value)) return value / 100;
  }
  return contextWindowTokens.value
    ? Math.min(100, contextInputTokens.value / contextWindowTokens.value * 100)
    : null;
});
function formatTokenQuantity(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '—';
  const format = (divisor: number, suffix: string) => {
    const scaled = number / divisor;
    const digits = scaled >= 100 || Number.isInteger(scaled) ? 0 : 1;
    return `${scaled.toFixed(digits).replace(/\.0$/, '')}${suffix}`;
  };
  if (number >= 1_000_000) return format(1_000_000, 'M');
  if (number >= 1_000) return format(1_000, 'K');
  return Math.round(number).toString();
}
const contextLabel = computed(() => {
  return contextWindowTokens.value
    ? `${formatTokenQuantity(contextInputTokens.value)} / ${formatTokenQuantity(contextWindowTokens.value)}`
    : '—';
});
const contextTitle = computed(() => {
  return contextWindowTokens.value
    ? `${contextInputTokens.value.toLocaleString()} / ${contextWindowTokens.value.toLocaleString()}`
    : '—';
});
const executionStatus = computed(() => String(live.value?.status || (chat.active?.pending ? 'queued' : 'idle')));
const executionDetail = computed(() => String(
  chat.active?.lastError
  || chat.active?.degradedReason
  || live.value?.status_detail
  || '',
).trim());
const executionStatusTone = computed(() => (
  chat.active?.lastError || chat.active?.degradedReason
    ? 'error'
    : executionStatus.value
));
const loadedSessionUsage = computed(() => {
  return (chat.active?.turns || []).reduce((total, turn) => {
    const usage = turn.token_usage || {};
    return {
      input: total.input + usageNumber(usage, ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens']),
      output: total.output + usageNumber(usage, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens']),
    };
  }, { input: 0, output: 0 });
});
const chatRuntimeMetrics = computed(() => {
  const metrics = live.value?.metrics;
  const session = store.sessions.find((item) => item.id === store.activeSessionId);
  const turns = chat.active?.turns || [];
  const activities = [
    ...canonicalNarrativeActivities.value,
    ...turns.flatMap((_, index) => buildTurnExecutionActivities(turns, index)),
    ...(chat.active?.activity || []),
    ...store.activity,
  ];
  const toolEvents = new Set(
    activities
      .filter((event) => event.kind === 'tool')
      .map((event) => event.id),
  );
  const memoryEvents = new Set(
    activities
      .filter((event) => (
        /\b(memory|recall)\b/i.test([
          event.kind,
          event.title,
          event.detail,
          event.domain,
          event.event_kind,
        ].filter(Boolean).join(' '))
      ))
      .map((event) => event.id),
  );
  const input = Math.max(
    Number(metrics?.input_tokens || 0),
    Number(session?.input_tokens || 0),
    loadedSessionUsage.value.input,
  );
  const output = Math.max(
    Number(metrics?.output_tokens || 0),
    Number(session?.output_tokens || 0),
    loadedSessionUsage.value.output,
  );
  return {
    tools: Math.max(Number(metrics?.tool_calls || 0), toolEvents.size),
    memory: Math.max(Number(metrics?.memory_recalls || 0), memoryEvents.size),
    totalTokens: input + output,
  };
});
const chatEvidenceCount = computed(() => new Set(
  [
    ...canonicalNarrativeActivities.value,
    ...(chat.active?.activity || []),
  ]
    .flatMap((activity: any) => [
      ...(Array.isArray(activity?.evidence_refs) ? activity.evidence_refs : []),
      ...(Array.isArray(activity?.refs) ? activity.refs : []),
    ])
    .map((reference: unknown) => String(reference || '').trim())
    .filter(Boolean),
).size);
const showRequestedModel = computed(() => (
  !!store.selectedModel && effectiveModel.value !== store.selectedModel
));
const turnRunning = computed(() => !chat.active?.cancelRequested && (
  !!chat.active?.pending
  || ['queued', 'preparing_context', 'calling_model', 'thinking', 'calling_tool', 'waiting_approval', 'finalizing']
    .includes(executionStatus.value)
));
const submissionBusy = computed(() => store.sessionCreating || !!chat.active?.submitting);
type ExecutionPolicyDisplayPreset = SessionExecutionPolicyPreset | 'custom' | 'unavailable';
const activeExecutionPolicyPreset = computed<ExecutionPolicyDisplayPreset>(() => {
  const response = executionPolicy.value;
  if (!response) return 'unavailable';
  if (response.__state && response.__state !== 'ready' && response.__state !== 'stale') {
    return 'unavailable';
  }
  if (response.state?.pending_transition) {
    return response.state.effective.autonomy_profile as SessionExecutionPolicyPreset;
  }
  if (response.matched_preset === null) return 'custom';
  return response.matched_preset || 'unavailable';
});
const effectiveExecutionPolicy = computed(() => {
  const response = executionPolicy.value;
  if (!response) return null;
  if (response.__state && response.__state !== 'ready' && response.__state !== 'stale') return null;
  return response.state?.effective || null;
});
const desiredExecutionPolicy = computed(() => executionPolicy.value?.state?.desired || null);
const policyTransition = computed(() => (
  executionPolicy.value?.state?.pending_transition
  || executionPolicy.value?.transition
  || null
));
const policyTransitionActive = computed(() => !!executionPolicy.value?.state?.pending_transition);
const policyTransitionPhaseKeys: Record<string, string> = {
  requested: 'chat.executionPolicy.phase.requested',
  persisted: 'chat.executionPolicy.phase.persisted',
  freezing: 'chat.executionPolicy.phase.freezing',
  draining: 'chat.executionPolicy.phase.draining',
  rebinding: 'chat.executionPolicy.phase.rebinding',
  stable: 'chat.executionPolicy.phase.stable',
  failed: 'chat.executionPolicy.phase.failed',
  cancelled: 'chat.executionPolicy.phase.cancelled',
};
function policyTransitionPhaseLabel(phase: string | undefined) {
  return t(policyTransitionPhaseKeys[phase || 'stable'] || 'chat.executionPolicy.phase.stable');
}
function policyTransitionTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : '—';
}
const displayExecutionPolicyPreset = computed<ExecutionPolicyDisplayPreset>(() => (
  store.activeSessionId
    ? activeExecutionPolicyPreset.value
    : draftExecutionPolicyPreset.value
));
const canUpdateExecutionPolicy = computed(() => (
  !!store.activeSessionId
  && chat.active?.attachmentRole === 'writer'
  && chat.active?.writable === true
));
const canChooseExecutionPolicy = computed(() => (
  true
));
const attachmentLabel = computed(() => {
  if (chat.active?.attachmentRole === 'writer') return t('page.chat.attachment.writer');
  if (chat.active?.attachmentRole === 'reader') return t('page.chat.attachment.reader');
  return t('page.chat.attachment.detached');
});
const filteredCommands = computed(() => {
  const query = commandQuery.value.trim().toLowerCase().replace(/^\//, '');
  if (!query) return store.commands;
  return store.commands.filter((command: any) => `${command.name || ''} ${command.description || ''} ${command.detail || ''}`.toLowerCase().includes(query));
});

useEscapeKey(() => store.closeModal(), () => !!store.activeModal);
useEscapeKey(() => store.closeChatExecutionGraph(), () => store.chatExecutionGraphExpanded);
useEscapeKey(() => { executionPolicyOpen.value = false; }, () => executionPolicyOpen.value);

function executionPolicyLabel(preset: ExecutionPolicyDisplayPreset) {
  if (preset === 'cautious') return t('chat.executionPolicy.preset.cautious');
  if (preset === 'supervised') return t('chat.executionPolicy.preset.supervised');
  if (preset === 'autonomous') return t('chat.executionPolicy.preset.autonomous');
  if (preset === 'yolo') return t('chat.executionPolicy.preset.yolo');
  if (preset === 'stewarded') return t('chat.executionPolicy.preset.stewarded');
  if (preset === 'custom') return t('chat.executionPolicy.preset.custom');
  return t('chat.executionPolicy.preset.unavailable');
}

function executionPolicyDetail(preset: SessionExecutionPolicyPreset) {
  if (preset === 'cautious') return t('chat.executionPolicy.detail.cautious');
  if (preset === 'supervised') return t('chat.executionPolicy.detail.supervised');
  if (preset === 'autonomous') return t('chat.executionPolicy.detail.autonomous');
  if (preset === 'yolo') return t('chat.executionPolicy.detail.yolo');
  return t('chat.executionPolicy.detail.stewarded');
}

async function loadSessionExecutionPolicy(sessionId = store.activeSessionId) {
  if (!sessionId) {
    executionPolicy.value = null;
    return;
  }
  const requestedSession = sessionId;
  try {
    const next = await api.sessionExecutionPolicy(requestedSession);
    if (store.activeSessionId === requestedSession) {
      executionPolicy.value = next;
      executionPolicyError.value = next.__state && next.__state !== 'ready'
        ? String(next.__error || t('chat.executionPolicy.unavailable'))
        : '';
    }
  } catch (error) {
    if (store.activeSessionId === requestedSession) {
      executionPolicyError.value = error instanceof Error ? error.message : String(error);
    }
  }
}

async function updateExecutionPolicy(preset: SessionExecutionPolicyPreset) {
  const sessionId = store.activeSessionId;
  const revision = Number(executionPolicy.value?.policy?.revision || 0);
  if (!sessionId) {
    // P0: before a session exists, the selection becomes the creation-time
    // policy for the next session instead of mutating an active one.
    draftExecutionPolicyPreset.value = preset;
    store.setPendingSessionExecutionPolicy(preset);
    executionPolicyError.value = '';
    executionPolicyOpen.value = false;
    return;
  }
  if (!revision || executionPolicyBusy.value) return;
  executionPolicyBusy.value = true;
  executionPolicyError.value = '';
  try {
    const mutation = canUpdateExecutionPolicy.value
      ? {
        attached: true as const,
        value: await api.updateSessionExecutionPolicy(sessionId, preset, revision),
      }
      : await chat.withWriterMutation(
        sessionId,
        () => api.updateSessionExecutionPolicy(sessionId, preset, revision),
      );
    if (!mutation.attached) {
      executionPolicyError.value = t('chat.executionPolicy.writerRequired');
      return;
    }
    executionPolicy.value = mutation.value;
  } catch (error) {
    executionPolicyError.value = error instanceof Error ? error.message : String(error);
    await loadSessionExecutionPolicy(sessionId);
  } finally {
    executionPolicyBusy.value = false;
  }
}

watch(() => store.activeSessionId, async (sessionId, previousSessionId) => {
  if (sessionId !== previousSessionId) store.closeChatExecutionGraph();
  executionPolicy.value = null;
  executionPolicyError.value = '';
  executionPolicyOpen.value = false;
  if (sessionId) loadSessionExecutionPolicy(sessionId).catch(() => undefined);
  if (
    sessionId
    && !previousSessionId
    && unboundDraft.value
    && !chat.states[sessionId]?.draft
  ) {
    chat.setDraft(sessionId, unboundDraft.value);
    unboundDraft.value = '';
  }
  if (previousSessionId && transcript.value) {
    chat.setScrollTop(previousSessionId, transcript.value.scrollTop);
  }
  pendingTailSessionId.value = sessionId;
  transcriptPinnedToTail.value = true;
  await nextTick();
  if (
    sessionId
    && transcript.value
    && !chat.states[sessionId]?.historyLoading
  ) {
    scrollTranscriptToLatest();
    chat.states[sessionId].scrollInitialized = true;
    pendingTailSessionId.value = '';
  }
}, { immediate: true });

watch(
  [() => store.activeSessionId, projectionTaskId],
  async ([sessionId, taskId]) => {
    routingFocus.value = { revision: 0 };
    currentTask.value = null;
    routingError.value = '';
    if (!sessionId) return;
    try {
      const [taskFocus, missionFocus] = await Promise.all([
        api.taskFocus(sessionId),
        api.missionFocus(sessionId),
      ]);
      routingFocus.value = {
        revision: Math.max(Number(taskFocus.revision || 0), Number(missionFocus.revision || 0)),
        task: taskFocus.task_focus || null,
        mission: missionFocus.mission_focus || null,
      };
      const resolvedTaskId = taskId || routingFocus.value.task?.task_id || '';
      if (resolvedTaskId) currentTask.value = (await api.taskDetail(resolvedTaskId)).task;
    } catch (error) {
      routingError.value = error instanceof Error ? error.message : String(error);
    }
  },
  { immediate: true },
);

watch(
  () => [
    store.activeSessionId,
    chat.active?.historyLoading,
    chat.active?.historyWindowEndOffset,
  ] as const,
  async ([sessionId, loading]) => {
    if (!sessionId || loading || pendingTailSessionId.value !== sessionId) return;
    await nextTick();
    scrollTranscriptToLatest();
    const state = chat.states[sessionId];
    if (state) state.scrollInitialized = true;
    pendingTailSessionId.value = '';
  },
);

watch(
  () => {
    const turns = chat.active?.turns || [];
    const last = turns.at(-1);
    return [
      store.activeSessionId,
      turns.length,
      last?.content.length || 0,
      last?.activity?.length || 0,
      chat.active?.lastEventAtMs || 0,
      chat.active?.pending || false,
    ] as const;
  },
  async () => {
    if (!transcriptPinnedToTail.value || historyLoadInFlight.value) return;
    await nextTick();
    scrollTranscriptToLatest();
  },
);

const executionGraphConsumer = 'chat:expanded-execution-graph';
const activeExecutionSummaryConsumer = 'chat:active-execution-summary';
watch(
  [
    currentExecutionProjectionId,
    () => store.activeSessionId,
    () => Boolean(chat.active?.pending),
  ],
  ([executionId, sessionId, pending]) => {
    projections.release(activeExecutionSummaryConsumer);
    if (!executionId || !sessionId) return;
    projections.acquire(
      executionId,
      activeExecutionSummaryConsumer,
      'summary',
      pending ? 'bounded' : 'passive',
      sessionId,
    );
  },
  { immediate: true },
);
watch(
  [() => store.chatExecutionGraphExpanded, requestedExecutionGraphId],
  ([expanded, rootGraphId]) => {
    projections.release(executionGraphConsumer);
    if (!expanded) return;
    if (!rootGraphId) return;
    projections.acquire(
      rootGraphId,
      executionGraphConsumer,
      'full',
      'bounded',
      store.activeSessionId,
    );
  },
  { immediate: true },
);
watch(
  [() => store.activeSessionId, () => chat.active?.pending, () => chat.active?.streamTurnId],
  ([sessionId]) => {
    // Real-time status: whenever the active turn settles or changes identity,
    // refresh the durable input projection so queued->accepted->consumed
    // transitions are visible without a full page reload.
    if (sessionId && !chat.active?.pending) {
      void store.refreshSessionInputs(sessionId);
    }
  },
);
onBeforeUnmount(() => {
  projections.release(activeExecutionSummaryConsumer);
  projections.release(executionGraphConsumer);
  if (copiedAnswerResetTimer) clearTimeout(copiedAnswerResetTimer);
  if (copiedUserMessageResetTimer) clearTimeout(copiedUserMessageResetTimer);
});

function scrollTranscriptToLatest() {
  const element = transcript.value;
  if (!element) return;
  element.scrollTop = element.scrollHeight;
  transcriptPinnedToTail.value = true;
  if (store.activeSessionId) chat.setScrollTop(store.activeSessionId, element.scrollTop);
}

async function loadOlderHistory() {
  const sessionId = store.activeSessionId;
  const element = transcript.value;
  if (!sessionId || !element || historyLoadInFlight.value || !chat.active?.historyHasOlder) return;
  historyLoadInFlight.value = true;
  transcriptPinnedToTail.value = false;
  const previousHeight = element.scrollHeight;
  const previousTop = element.scrollTop;
  try {
    await chat.loadOlder(sessionId);
    await nextTick();
    if (store.activeSessionId !== sessionId || !transcript.value) return;
    transcript.value.scrollTop = previousTop + (transcript.value.scrollHeight - previousHeight);
    chat.setScrollTop(sessionId, transcript.value.scrollTop);
  } finally {
    historyLoadInFlight.value = false;
  }
}

async function loadLatestHistory() {
  const sessionId = store.activeSessionId;
  if (!sessionId) return;
  if (chat.active?.historyHasNewer) await chat.loadLatest(sessionId);
  await nextTick();
  scrollTranscriptToLatest();
}

function rememberScroll() {
  const element = transcript.value;
  const sessionId = store.activeSessionId;
  if (!sessionId || !element || historyLoadInFlight.value) return;
  const distanceFromTail = element.scrollHeight - element.scrollTop - element.clientHeight;
  transcriptPinnedToTail.value = distanceFromTail <= 120;
  chat.setScrollTop(sessionId, element.scrollTop);
  if (element.scrollTop <= 80 && chat.active?.historyHasOlder) {
    void loadOlderHistory();
  }
}

function openChatCompanion(tab: 'activity' | 'workspace' | 'inspector') {
  store.openCompanion(tab);
}

function toggleCurrentExecutionGraph() {
  if (store.chatExecutionGraphExpanded) {
    store.closeChatExecutionGraph();
    return;
  }
  store.openChatExecutionGraph(chat.active?.executionGraphId || chat.active?.executionId || '');
}

function openGlobalMissionGraph() {
  globalMissionGraphOpen.value = true;
}

async function openRoutingDialog() {
  routingDialogOpen.value = true;
  routingError.value = '';
  try {
    // M-04: first-panel routing uses the bounded summary contract; the full
    // typed snapshot is only requested when the summary lacks the mission list.
    const control = await api.missionControlSummary();
    const missions = (control.summary?.projection?.missions as any[]) || [];
    missionOptions.value = (missions.length ? missions : []).map((mission) => ({
      mission_id: mission.mission_id,
      objective: mission.objective,
    }));
    if (!missions.length) {
      const full = await api.missionControl();
      missionOptions.value = (full.snapshot?.projection?.missions || []).map((mission) => ({
        mission_id: mission.mission_id,
        objective: mission.objective,
      }));
    }
    selectedMissionFocus.value = routingFocus.value.mission?.mission_id
      || currentTask.value?.mission_id
      || missionOptions.value[0]?.mission_id
      || '';
  } catch (error) {
    routingError.value = error instanceof Error ? error.message : String(error);
  }
}

async function refreshRoutingFocus() {
  const sessionId = store.activeSessionId;
  if (!sessionId) return;
  const [taskFocus, missionFocus] = await Promise.all([
    api.taskFocus(sessionId),
    api.missionFocus(sessionId),
  ]);
  routingFocus.value = {
    revision: Math.max(Number(taskFocus.revision || 0), Number(missionFocus.revision || 0)),
    task: taskFocus.task_focus || null,
    mission: missionFocus.mission_focus || null,
  };
}

async function focusCurrentTask() {
  const sessionId = store.activeSessionId;
  const taskId = currentTaskId.value;
  if (!sessionId || !taskId) return;
  routingBusy.value = true;
  routingError.value = '';
  try {
    await api.setTaskFocus(sessionId, taskId, routingFocus.value.revision);
    await refreshRoutingFocus();
  } catch (error) {
    routingError.value = error instanceof Error ? error.message : String(error);
  } finally {
    routingBusy.value = false;
  }
}

async function clearTaskFocus() {
  const sessionId = store.activeSessionId;
  if (!sessionId || !routingFocus.value.task) return;
  routingBusy.value = true;
  routingError.value = '';
  try {
    await api.clearTaskFocus(sessionId, routingFocus.value.revision);
    await refreshRoutingFocus();
  } catch (error) {
    routingError.value = error instanceof Error ? error.message : String(error);
  } finally {
    routingBusy.value = false;
  }
}

async function applyMissionFocus() {
  const sessionId = store.activeSessionId;
  if (!sessionId || !selectedMissionFocus.value) return;
  routingBusy.value = true;
  routingError.value = '';
  try {
    await api.setMissionFocus(sessionId, selectedMissionFocus.value, routingFocus.value.revision);
    await refreshRoutingFocus();
    routingDialogOpen.value = false;
  } catch (error) {
    routingError.value = error instanceof Error ? error.message : String(error);
  } finally {
    routingBusy.value = false;
  }
}

async function clearMissionFocus() {
  const sessionId = store.activeSessionId;
  if (!sessionId || !routingFocus.value.mission) return;
  routingBusy.value = true;
  routingError.value = '';
  try {
    await api.clearMissionFocus(sessionId, routingFocus.value.revision);
    await refreshRoutingFocus();
    routingDialogOpen.value = false;
  } catch (error) {
    routingError.value = error instanceof Error ? error.message : String(error);
  } finally {
    routingBusy.value = false;
  }
}

function commandName(command: any) {
  const name = String(command?.name || command || '').trim();
  return name.startsWith('/') ? name : `/${name}`;
}

function commandDescription(command: any) {
  return command.description || command.detail || command.args || t('chat.commands.noDescription');
}

async function openCommandPalette() {
  commandQuery.value = '';
  store.openModal('commands');
  await nextTick();
  commandSearchInput.value?.focus();
}

async function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key === '/' && !draft.value.trim()) {
    event.preventDefault();
    await openCommandPalette();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    await submit();
  }
}

async function handleComposerInput() {
  if (draft.value.trim() !== '/') return;
  draft.value = '';
  await openCommandPalette();
}

async function submit() {
  const text = draft.value.trim();
  if (!text || submissionBusy.value) return;
  const supplementing = turnRunning.value;
  if (text === '/model') {
    store.openModal('model');
    draft.value = '';
    return;
  }
  if (text === '/workspace') {
    store.openModal('workspace');
    draft.value = '';
    return;
  }
  if (text === '/status') {
    openChatCompanion('activity');
    draft.value = '';
    return;
  }
  try {
    transcriptPinnedToTail.value = true;
    // An already selected Session is an actionable boundary even while the
    // rest of shell boot or its live stream is still hydrating. The Session
    // store projects `queued` immediately and performs its own readiness,
    // writer-attachment and recovery checks without blocking the composer on
    // unrelated global startup work.
    if (!store.activeSessionId) {
      await store.boot();
      if (!store.activeSessionId) {
        await store.createSession();
      }
    }
    const sessionId = store.activeSessionId;
    if (!sessionId) return;
    if (/^\/permissions(?:\s|$)/i.test(text)) {
      const mode = text.split(/\s+/)[1] || '';
      const result: any = await store.executeSessionCommand('/permissions', {
        session_id: sessionId,
        input: text,
        mode,
      });
      if (result?.ok === false) {
        throw new Error(String(result?.data?.error || result?.error || 'permission command rejected'));
      }
      chat.setDraft(sessionId, '');
      unboundDraft.value = '';
      return;
    }
    chat.setDraft(sessionId, '');
    unboundDraft.value = '';
    const input = store.composeChatInput(text);
    let accepted = false;
    accepted = await chat.send(sessionId, text, input);
    applyLatestInputProjection();
    if (accepted && store.activeSessionId === sessionId) {
      await store.ensureSessionTitleFromFirstMessage(sessionId, text);
      store.clearSubmittedResourceAttachments(input.resourceIds);
      if (supplementing) await store.refreshSessionInputs(sessionId);
    }
  } finally {
    await nextTick();
    if (transcriptPinnedToTail.value) scrollTranscriptToLatest();
  }
}

async function stop() {
  if (store.activeSessionId) await chat.stop(store.activeSessionId);
}

const CANCELLATION_STATUS_KEYS: Record<CancellationReceipt['status'], string> = {
  requested: 'chat.cancellation.status.requested',
  cancelled: 'chat.cancellation.status.cancelled',
  already_terminal: 'chat.cancellation.status.already_terminal',
};

function cancellationLabel(status: CancellationReceipt['status']) {
  return t(CANCELLATION_STATUS_KEYS[status]);
}

function cancellationTime(value: number) {
  return value > 0 ? new Date(value).toLocaleTimeString() : '';
}

function numberFrom(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function usageNumber(usage: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = numberFrom(usage[key]);
    if (direct) return direct;
  }
  return 0;
}

function exchangeStartIndex(turns: ChatTurn[], answerIndex: number) {
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    if (turns[index].role === 'user') return index + 1;
  }
  return 0;
}

function isFinalAssistantAnswer(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  if (turn?.role !== 'assistant' || !turn.content.trim()) return false;
  for (let cursor = index + 1; cursor < turns.length; cursor += 1) {
    if (turns[cursor].role === 'user') break;
    if (turns[cursor].role === 'assistant' && turns[cursor].content.trim()) return false;
  }
  return true;
}

function visibleTranscriptTurn(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  return turn.role === 'user'
    || turn.role === 'system'
    || isExecutionTranscriptTurn(turns, index);
}

function failedUserExecutionEntry(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  if (turn?.role !== 'user') return null;
  for (let cursor = index + 1; cursor < turns.length; cursor += 1) {
    const candidate = turns[cursor];
    if (candidate.role === 'user') break;
    if (
      candidate.role === 'assistant'
      && (!turn.turn_id || !candidate.turn_id || candidate.turn_id === turn.turn_id)
    ) return null;
  }
  const entry = selectTurnExecutionEntry(
    chat.active?.executionIndex?.executions || [],
    String(turn.turn_id || ''),
    String(turn.execution_id || ''),
  );
  return entry && (entry.status === 'error' || entry.status === 'cancelled')
    ? entry
    : null;
}

function openFailedUserExecution(turns: ChatTurn[], index: number) {
  const entry = failedUserExecutionEntry(turns, index);
  const graphId = String(entry?.graph_id || '').trim();
  if (graphId) store.openChatExecutionGraph(graphId);
}

async function retryBlockedTurn(turns: ChatTurn[], index: number) {
  const sessionId = String(store.activeSessionId || '');
  if (!sessionId) return;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = turns[cursor];
    if (candidate.role === 'user' && candidate.content.trim()) {
      const text = candidate.content;
      const input = store.composeChatInput(text);
      await chat.send(sessionId, text, input);
      applyLatestInputProjection();
      return;
    }
  }
}

function isActiveStreamingTurn(turn: ChatTurn) {
  return turn.role === 'assistant'
    && turn.id === chat.active?.streamTurnId
    && turnRunning.value;
}

function isTerminalExecutionAnchor(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  if (turn?.role !== 'assistant' || isActiveStreamingTurn(turn)) return false;
  if (
    !(turn.activity || []).length
    && !turn.execution_id
    && turn.status !== 'error'
  ) return false;
  for (let cursor = index + 1; cursor < turns.length; cursor += 1) {
    if (turns[cursor].role === 'user') break;
    if (turns[cursor].role === 'assistant') return false;
  }
  return true;
}

function isExecutionTranscriptTurn(turns: ChatTurn[], index: number) {
  return isFinalAssistantAnswer(turns, index)
    || isActiveStreamingTurn(turns[index])
    || isTerminalExecutionAnchor(turns, index);
}

function assistantProgressThought(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  const fenced = text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  const candidate = fenced?.[1]?.trim() || text;
  if (
    (candidate.startsWith('{') && candidate.endsWith('}'))
    || (candidate.startsWith('[') && candidate.endsWith(']'))
  ) {
    try {
      const structured = JSON.parse(candidate);
      if (structured && typeof structured === 'object') return '';
    } catch {
      // A prose message containing braces remains a useful public progress note.
    }
  }
  return text;
}

function exchangeActivityEvents(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  if (!isExecutionTranscriptTurn(turns, index)) return [];
  const activities = new Map<string, ActivityEvent>();
  const start = exchangeStartIndex(turns, index);
  for (let cursor = start; cursor <= index; cursor += 1) {
    const exchangeTurn = turns[cursor];
    for (const event of exchangeTurn.activity || []) {
      const identity = activityEventIdentity(event);
      activities.set(identity, mergeActivityEvent(activities.get(identity), event));
    }
    if (
      exchangeTurn.role === 'assistant'
      && cursor !== index
      && exchangeTurn.content.trim()
      && !(exchangeTurn.activity || []).some((event) => (
        event.kind === 'think' || event.kind === 'reasoning'
      ))
    ) {
      const detail = assistantProgressThought(exchangeTurn.content);
      if (!detail) continue;
      const event: ActivityEvent = {
        id: `assistant-progress:${exchangeTurn.id}`,
        kind: 'think',
        title: t('chat.activity.thinking'),
        detail,
        status: exchangeTurn.status || 'complete',
        sequence: exchangeTurn.sequence,
        turn_id: exchangeTurn.turn_id,
        execution_id: exchangeTurn.execution_id,
      };
      activities.set(event.id, event);
    }
  }
  return causalActivityTimeline([...activities.values()], 500);
}

function activityEventIdentity(event: ActivityEvent) {
  if (event.tool_call_id) return `tool:${event.tool_call_id}`;
  return String(event.activity_id || event.id);
}

function exchangeProjectionLineage(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  if (!isExecutionTranscriptTurn(turns, index)) return [];
  const entry = exchangeExecutionEntry(turns, index);
  const rootId = String(
    entry?.graph_id
    || entry?.execution_id
    || (isActiveStreamingTurn(turn) ? currentExecutionProjectionId.value : '')
    || '',
  ).trim();
  if (!rootId) return [];
  const root = projections.projectionFor(rootId);
  return [
    root,
    ...executionProjectionLinks(root).map((executionId) => projections.projectionFor(executionId)),
  ];
}

function buildTurnExecutionActivities(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  if (!isExecutionTranscriptTurn(turns, index)) return [];
  const entry = exchangeExecutionEntry(turns, index);
  const turnId = String(
    entry?.turn_id
    || turn.turn_id
    || (isActiveStreamingTurn(turn) ? chat.active?.executionTurnId : '')
    || '',
  ).trim();
  const executionId = String(
    entry?.execution_id
    || turn.execution_id
    || (isActiveStreamingTurn(turn) ? chat.active?.executionId : '')
    || '',
  ).trim();
  const lineage = exchangeProjectionLineage(turns, index);
  const lineageExecutionIds = new Set(
    lineage
      .flatMap((projection) => [
        String(projection?.execution_id || '').trim(),
        ...executionProjectionLinks(projection),
      ])
      .filter(Boolean),
  );
  const canonical = canonicalActivityEvents(lineage, 'narrative').filter((activity) => (
    (!turnId || !activity.turn_id || activity.turn_id === turnId)
    && (
      !executionId
      || !activity.execution_id
      || lineageExecutionIds.has(activity.execution_id)
      || activity.execution_id === executionId
      || activity.parent_execution_id === executionId
    )
  ));
  return canonical;
}

function turnRootExecutionId(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  const entry = exchangeExecutionEntry(turns, index);
  return String(
    entry?.graph_id
    || entry?.execution_id
    || turn?.execution_id
    || (isActiveStreamingTurn(turn) ? chat.active?.executionId : '')
    || '',
  ).trim();
}

function buildTurnExecutionRelations(
  turns: ChatTurn[],
  index: number,
  activities: ActivityView[],
) {
  const ids = new Set(activities.map((activity) => activity.id));
  return canonicalActivityRelations(exchangeProjectionLineage(turns, index)).filter((relation) => (
    ids.has(relation.from_activity_id) && ids.has(relation.to_activity_id)
  ));
}

const turnExecutionPresentations = computed(() => {
  const turns = chat.active?.turns || [];
  const presentations = new Map<string, {
    activities: ActivityView[];
    relations: ReturnType<typeof canonicalActivityRelations>;
    reasoning: ReasoningPresentation;
  }>();
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (!isExecutionTranscriptTurn(turns, index)) continue;
    const activities = buildTurnExecutionActivities(turns, index);
    presentations.set(turn.id, {
      activities,
      relations: buildTurnExecutionRelations(turns, index, activities),
      reasoning: reasoningPresentation(
        exchangeActivityEvents(turns, index),
        activities,
        turnRootExecutionId(turns, index),
      ),
    });
  }
  return presentations;
});

function turnExecutionActivities(turns: ChatTurn[], index: number) {
  return turnExecutionPresentations.value.get(turns[index]?.id)?.activities || [];
}

function turnExecutionRelations(turns: ChatTurn[], index: number) {
  return turnExecutionPresentations.value.get(turns[index]?.id)?.relations || [];
}

function turnGlobalReasoning(turns: ChatTurn[], index: number) {
  return turnExecutionPresentations.value.get(turns[index]?.id)?.reasoning.global || null;
}

function turnAgentReasoning(turns: ChatTurn[], index: number) {
  return turnExecutionPresentations.value.get(turns[index]?.id)?.reasoning.byOwner || {};
}

function openCanonicalActivity(activity: ActivityView) {
  store.selectedActivity = activity;
  openChatCompanion('activity');
}

function compactActivityValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (
      depth === 0
      && ((normalized.startsWith('{') && normalized.endsWith('}'))
        || (normalized.startsWith('[') && normalized.endsWith(']')))
    ) {
      try {
        return compactActivityValue(JSON.parse(normalized), depth);
      } catch {
        // Invalid JSON remains useful as ordinary tool input text.
      }
    }
    return normalized;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (depth > 0) return t('chat.timeline.itemCount', { count: value.length });
    return value.slice(0, 3)
      .map((item) => compactActivityValue(item, depth + 1))
      .filter(Boolean)
      .join(' · ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const preferred = ['command', 'path', 'query', 'q', 'url', 'pattern', 'file', 'target'];
    for (const key of preferred) {
      const entry = entries.find(([name]) => name === key);
      const compact = entry ? compactActivityValue(entry[1], depth + 1) : '';
      if (compact) return compact;
    }
    return entries.slice(0, 3)
      .map(([key, item]) => {
        const compact = compactActivityValue(item, depth + 1);
        return compact ? `${key}=${compact}` : '';
      })
      .filter(Boolean)
      .join(' · ');
  }
  return String(value);
}

function truncateActivityText(value: string, limit = 240) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

function liveNow(turn: ChatTurn) {
  if (!isActiveStreamingTurn(turn)) return null;
  const streamState = chat.active?.streamState || 'offline';
  if (['reconnecting', 'degraded'].includes(streamState)) {
    return {
      key: `stream:${streamState}`,
      title: t(streamState === 'degraded'
        ? 'chat.liveNow.recovering'
        : 'chat.liveNow.reconnecting'),
      detail: chat.active?.degradedReason || '',
    };
  }
  const events = exchangeActivityEvents(
    chat.active?.turns || [],
    (chat.active?.turns || []).indexOf(turn),
  );
  const activeTool = [...events].reverse().find((event) => (
    event.kind === 'tool'
    && ['queued', 'pending', 'started', 'running'].includes(String(event.status || '').toLowerCase())
  ));
  if (activeTool) {
    return {
      key: `tool:${activeTool.id}:${activeTool.status || 'running'}`,
      title: t('chat.liveNow.tool', { tool: activeTool.title }),
      detail: truncateActivityText(compactActivityValue(activeTool.input)),
    };
  }
  const activeAgent = [...events].reverse().find((event) => (
    event.kind === 'agent'
    && ['queued', 'pending', 'started', 'running'].includes(String(event.status || '').toLowerCase())
  ));
  if (activeAgent) {
    return {
      key: `agent:${activeAgent.id}:${activeAgent.phase || activeAgent.status || 'running'}`,
      title: t('chat.liveNow.agent', { agent: activeAgent.title }),
      detail: truncateActivityText(String(activeAgent.detail || '').replace(/\s+/g, ' ').trim()),
    };
  }
  const activeThought = [...events].reverse().find((event) => (
    (event.kind === 'think' || event.kind === 'reasoning')
    && ['queued', 'pending', 'started', 'running'].includes(String(event.status || '').toLowerCase())
  ));
  if (activeThought) {
    return {
      key: `think:${activeThought.id}`,
      title: t('chat.liveNow.thinking'),
      detail: truncateActivityText(String(activeThought.detail || '').replace(/\s+/g, ' ').trim()),
    };
  }
  const status = executionStatus.value;
  const labels: Record<string, string> = {
    queued: 'chat.liveNow.queued',
    accepted_pending_materialization: 'chat.liveNow.queued',
    preparing_context: 'chat.liveNow.preparingContext',
    calling_model: 'chat.liveNow.callingModel',
    thinking: 'chat.liveNow.thinking',
    calling_tool: 'chat.liveNow.callingTool',
    waiting_approval: 'chat.liveNow.waitingApproval',
    finalizing: 'chat.liveNow.finalizing',
  };
  const title = t(labels[status] || 'chat.liveNow.running');
  return {
    key: `status:${status}:${title}`,
    title,
    detail: '',
  };
}

const currentLiveNow = computed(() => {
  const turn = (chat.active?.turns || []).find((candidate) => (
    candidate.id === chat.active?.streamTurnId
  ));
  return turn ? liveNow(turn) : null;
});

function exchangeUsageParts(turns: ChatTurn[], answerIndex: number) {
  if (!isFinalAssistantAnswer(turns, answerIndex)) return [];
  const start = exchangeStartIndex(turns, answerIndex);
  let input = 0;
  let output = 0;
  for (let index = start; index <= answerIndex; index += 1) {
    const usage = turns[index]?.token_usage;
    if (!usage || typeof usage !== 'object') continue;
    input += usageNumber(usage, ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens']);
    output += usageNumber(usage, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens']);
  }
  return [
    { key: 'input', label: t('chat.turnUsage.input'), value: input },
    { key: 'output', label: t('chat.turnUsage.output'), value: output },
  ].filter((item) => item.value > 0);
}

function exchangeExecutionEntry(turns: ChatTurn[], answerIndex: number) {
  const active = isActiveStreamingTurn(turns[answerIndex]);
  if (!isExecutionTranscriptTurn(turns, answerIndex)) return null;
  const start = exchangeStartIndex(turns, answerIndex);
  const exchange = turns.slice(start, answerIndex + 1);
  const executionId = [...exchange]
    .reverse()
    .map((turn) => String(turn.execution_id || '').trim())
    .find(Boolean)
    || (active ? String(chat.active?.executionId || '').trim() : '');
  const turnId = [...exchange]
    .reverse()
    .map((turn) => String(turn.turn_id || '').trim())
    .find(Boolean)
    || (active ? String(chat.active?.executionTurnId || '').trim() : '');
  const entries = chat.active?.executionIndex?.executions || [];
  const canonical = selectTurnExecutionEntry(entries, turnId, executionId);
  if (canonical) {
    // Durable discovery entries may not carry graph_id (older runtime
    // projections); the execution id is the stable ingress graph identity,
    // so fall back to it instead of hiding the execution-graph action.
    const resolvedGraphId = entryGraphId(canonical);
    return resolvedGraphId ? { ...canonical, graph_id: resolvedGraphId } : canonical;
  }
  if (!executionId) return null;
  return {
    execution_id: executionId,
    graph_id: active
      ? String(chat.active?.executionGraphId || executionId)
      : executionId,
    turn_id: turnId || null,
    status: active
      ? 'thinking' as const
      : turns[answerIndex]?.status === 'error'
        ? 'error' as const
        : 'complete' as const,
    updated_at_ms: Number(turns[answerIndex]?.created_at_ms || 0),
  };
}

function openAnswerExecutionGraph(turns: ChatTurn[], answerIndex: number) {
  const entry = exchangeExecutionEntry(turns, answerIndex);
  const graphId = String(entry?.graph_id || '').trim();
  if (graphId) store.openChatExecutionGraph(graphId);
}

async function copyAnswer(turn: ChatTurn) {
  const content = turn.content.trim();
  if (!content) return;
  await copyTextToClipboard(content);
  copiedAnswerId.value = turn.id;
  if (copiedAnswerResetTimer) clearTimeout(copiedAnswerResetTimer);
  copiedAnswerResetTimer = setTimeout(() => {
    if (copiedAnswerId.value === turn.id) copiedAnswerId.value = '';
  }, 1_500);
}

async function copyUserMessage(turn: ChatTurn) {
  const content = turn.content.trim();
  if (!content) return;
  await copyTextToClipboard(content);
  copiedUserMessageId.value = turn.id;
  if (copiedUserMessageResetTimer) clearTimeout(copiedUserMessageResetTimer);
  copiedUserMessageResetTimer = setTimeout(() => {
    if (copiedUserMessageId.value === turn.id) copiedUserMessageId.value = '';
  }, 1_500);
}

async function branchCurrentAnswer() {
  const sessionId = String(store.activeSessionId || '');
  if (!sessionId || store.branchSessionBusy || turnRunning.value) return;
  await store.branchSession(sessionId);
}

function inputRecordForTurn(turn: ChatTurn) {
  const rows = [
    ...(Array.isArray(store.turnInbox?.items) ? store.turnInbox.items : []),
    ...(Array.isArray(store.sessionInputProjection?.inputs) ? store.sessionInputProjection.inputs : []),
  ];
  const inputId = String(turn.input_id || '').trim();
  if (inputId) {
    const byInput = rows.find((item: any) => (
      String(item?.input_id || item?.id || '').trim() === inputId
    ));
    if (byInput) return byInput;
  }
  const turnId = String(turn.id || '').trim();
  return rows.find((item: any) => String(item?.input_id || item?.id || '').trim() === turnId)
    || null;
}

function applyLatestInputProjection() {
  // C-03: the send receipt is the authoritative durable projection; write it
  // to the app store immediately so badge state never waits for a later poll.
  if (chat.lastInputProjection) store.sessionInputProjection = chat.lastInputProjection;
  if (chat.lastTurnInbox) store.turnInbox = chat.lastTurnInbox;
}

function userTurnAcceptedBadge(turn: ChatTurn) {
  if (turn.role !== 'user') return null;
  const record = inputRecordForTurn(turn);
  if (!record) return null;
  const status = String(record.status || '').toLowerCase();
  const applicationState = String(record.application_receipt?.state || '').toLowerCase();
  const applied = applicationState === 'applied' || Boolean(record.application_receipt?.action);
  if (status === 'consumed') {
    return { key: 'consumed', label: t('chat.input.badge.consumed') };
  }
  if (status === 'attached_to_turn' || applied) {
    return { key: 'accepted', label: t('chat.input.badge.applied') };
  }
  if (status === 'interrupt_requested') {
    return { key: 'waiting', label: t('chat.input.badge.waiting') };
  }
  if (['dispatched_subtask', 'dispatched_session', 'new_session_created'].includes(status)) {
    return { key: 'dispatched', label: t('chat.input.badge.dispatched') };
  }
  if (status === 'control_resolved') {
    return { key: 'accepted', label: t('chat.input.badge.applied') };
  }
  if (['cancelled', 'failed', 'rejected_duplicate', 'rejected_policy'].includes(status)) {
    return { key: 'error', label: t('chat.input.badge.error') };
  }
  if (status === 'superseded') {
    return { key: 'superseded', label: t('chat.input.badge.superseded') };
  }
  if (applicationState === 'prepared' || applicationState === 'materializing'
    || ['received', 'persisted', 'classified', 'queued_next', 'queued', 'pending', 'accepted'].includes(status)) {
    return { key: 'queued', label: t('chat.input.badge.queued') };
  }
  return null;
}

async function chooseCommand(command: any) {
  const name = commandName(command);
  draft.value = `${name} `;
  commandQuery.value = '';
  store.closeModal();
  await nextTick();
  composerInput.value?.focus();
}

function chooseFirstCommand() {
  const first = filteredCommands.value[0];
  if (first) chooseCommand(first);
}
</script>

<template>
  <section class="chat-page">
    <header class="page-header chat-topbar">
      <div class="chat-title-block">
        <div class="chat-title-line">
          <h1>{{ t('page.chat.page.text.177c6b9656') }}</h1>
          <span
            class="chat-release"
            :data-version-mismatch="release.mismatch"
            :title="releaseTitle"
          >
            {{ release.label }}
          </span>
          <span v-if="release.mismatch" class="chat-release-warning">{{ t('release.mismatch') }}</span>
        </div>
        <div class="chat-session-facts">
          <button
            type="button"
            class="chat-fact observer mission-observer-entry"
            :data-role="chat.active?.attachmentRole"
            :title="t('chat.execution.openGlobalMission')"
            :aria-label="t('chat.execution.openGlobalMission')"
            @click="openGlobalMissionGraph"
          >
            <Eye :size="13" />
            <strong>{{ attachmentLabel }}</strong>
          </button>
          <button
            v-if="chat.active"
            type="button"
            class="chat-execution-status"
            :data-status="executionStatusTone"
            :title="executionDetail"
            :aria-expanded="store.chatExecutionGraphExpanded"
            aria-live="polite"
            @click="toggleCurrentExecutionGraph"
          >
            <CircleDot :size="13" />
            <strong>{{ displayStatus(executionStatus) }}</strong>
          </button>
          <button
            type="button"
            class="session-evidence-head"
            :title="`${chatEvidenceCount} evidence refs`"
            @click="openChatCompanion('activity')"
          >
            <FileCheck2 :size="13" />
            <strong>{{ chatEvidenceCount }}</strong>
            <span>{{ t('page.chat.page.text.848af509ba') }}</span>
          </button>
          <span v-if="currentTaskId" class="chat-routing-control" :title="currentTask?.objective || currentTaskId">
            <button
              type="button"
              class="chat-fact routing-chip"
              :data-locked="Boolean(routingFocus.task)"
              :disabled="routingBusy"
              @click="focusCurrentTask"
            >
              <Check v-if="routingFocus.task?.task_id === currentTaskId" :size="13" />
              <Boxes v-else :size="13" />
              <strong>{{ currentTask?.objective || currentTaskId }}</strong>
            </button>
            <button
              v-if="routingFocus.task"
              type="button"
              class="icon-action routing-clear"
              :disabled="routingBusy"
              :title="t('chat.routing.clear')"
              :aria-label="t('chat.routing.clear')"
              @click="clearTaskFocus"
            ><X :size="12" /></button>
          </span>
          <button
            v-if="store.activeSessionId"
            type="button"
            class="chat-fact routing-chip"
            :data-locked="Boolean(routingFocus.mission)"
            :title="currentMissionId || t('chat.routing.missionFocus')"
            @click="openRoutingDialog"
          >
            <Workflow :size="13" />
            <strong>{{ currentMissionId || t('chat.routing.mission') }}</strong>
          </button>
        </div>
      </div>
    </header>

    <div class="chat-transcript-stage">
      <div
        v-if="store.chatExecutionGraphExpanded && chat.active"
        class="chat-execution-modal-scrim"
        @click.self="store.closeChatExecutionGraph()"
      >
        <section
          class="chat-execution-overlay"
          role="dialog"
          aria-modal="true"
          :aria-label="t('chat.execution.graph')"
        >
          <header>
            <div>
              <Workflow :size="15" />
              <strong>{{ executionTopology.teams ? t('chat.execution.teamGraph') : t('chat.execution.graph') }}</strong>
              <span v-if="selectedExecutionEntry?.turn_id">{{ t('chat.execution.turn', { turn: selectedExecutionEntry.turn_id }) }}</span>
              <span>{{ displayStatus(String(activeProjection?.live?.status || executionGraph?.status || executionStatus)) }}</span>
              <span v-if="executionTopology.teams">{{ t('execution.teamCount', { count: executionTopology.teams }) }}</span>
              <span v-if="executionTopology.agents">{{ t('execution.agentCount', { count: executionTopology.agents }) }}</span>
              <span v-if="executionTopology.tools">{{ t('execution.toolCalls', { count: executionTopology.tools }) }}</span>
            </div>
            <button
              class="icon-action"
              type="button"
              :aria-label="t('common.close')"
              :title="t('common.close')"
              @click="store.closeChatExecutionGraph()"
            >
              <X :size="16" />
            </button>
          </header>
          <div v-if="executionGraphLoading" class="execution-graph-loading" role="status">
            <LoaderCircle :size="20" />
            <div>
              <strong>{{ t('status.loading') }}</strong>
              <span>{{ t('chat.execution.loadingDetail') }}</span>
            </div>
          </div>
          <ExecutionGraphCanvas
            v-else
            :graph="executionGraph"
            :connection-state="executionConnectionState"
            :activity-events="executionActivityEvents"
            :loading="executionGraphLoading"
          />
        </section>
      </div>
      <div
        ref="transcript"
        class="transcript"
        :aria-label="t('page.chat.page.aria-label.e683294716')"
        :aria-busy="chat.active?.historyLoading ? 'true' : 'false'"
        @scroll.passive="rememberScroll"
      >
        <div
          v-if="chat.active?.historyHasOlder || chat.active?.historyHasNewer"
          class="history-controls"
        >
          <button
            v-if="chat.active?.historyHasOlder"
            type="button"
            :disabled="chat.active?.historyLoading"
            :title="t('page.chat.history.older')"
            @click="loadOlderHistory"
          >
            <LoaderCircle v-if="chat.active?.historyLoading" :size="13" />
            <History v-else :size="13" />
            <span>{{ chat.active?.historyLoading ? t('status.loading') : t('page.chat.history.older') }}</span>
          </button>
          <span v-if="chat.active">
            {{ chat.active.historyOldestOffset + 1 }}–{{ chat.active.historyWindowEndOffset }}
            / {{ chat.active.historyTotal }}
          </span>
          <button
            v-if="chat.active?.historyHasNewer"
            type="button"
            :title="t('page.chat.history.latest')"
            @click="loadLatestHistory"
          >
            <ArrowDown :size="13" />
            <span>{{ t('page.chat.history.latest') }}</span>
          </button>
        </div>
        <div
          v-if="chat.active?.historyLoading && !(chat.active?.turns || []).length"
          class="session-transcript-loading"
          role="status"
        >
          <LoaderCircle :size="20" />
          <strong>{{ t('status.loading') }}</strong>
          <span>{{ t('page.chat.history.loadingDetail') }}</span>
        </div>
        <template v-for="(turn, index) in chat.active?.turns || []" :key="turn.id">
          <article
            v-if="visibleTranscriptTurn(chat.active?.turns || [], index)"
            class="turn"
            :data-role="turn.role"
          >
            <MarkdownBlock
              v-if="turn.role === 'user' || turn.role === 'system'"
              :content="turn.content"
            />
            <div v-if="turn.role === 'user' || turn.role === 'system'" class="message-actions">
              <span
                v-if="userTurnAcceptedBadge(turn)"
                class="turn-input-badge"
                :title="userTurnAcceptedBadge(turn)!.label"
                :aria-label="userTurnAcceptedBadge(turn)!.label"
              >
                <LoaderCircle v-if="userTurnAcceptedBadge(turn)!.key === 'queued'" :size="13" />
                <Check v-else-if="userTurnAcceptedBadge(turn)!.key === 'accepted' || userTurnAcceptedBadge(turn)!.key === 'consumed'" :size="13" />
                <Clock v-else-if="userTurnAcceptedBadge(turn)!.key === 'waiting'" :size="13" />
                <Workflow v-else-if="userTurnAcceptedBadge(turn)!.key === 'dispatched'" :size="13" />
                <CircleAlert v-else :size="13" />
              </span>
              <button
                class="message-copy-link"
                type="button"
                :title="copiedUserMessageId === turn.id ? t('common.copied') : t('chat.message.copy')"
                :aria-label="copiedUserMessageId === turn.id ? t('common.copied') : t('chat.message.copy')"
                @click="copyUserMessage(turn)"
              >
                <Check v-if="copiedUserMessageId === turn.id" :size="13" />
                <Copy v-else :size="13" />
              </button>
            </div>
            <p
              v-if="turn.role === 'user' && turn.submission_error"
              class="turn-submission-error"
              role="alert"
            >
              <CircleAlert :size="13" />
              <span>{{ turn.submission_error }}</span>
            </p>
            <div
              v-if="failedUserExecutionEntry(chat.active?.turns || [], index)"
              class="turn-execution-failure"
              role="status"
            >
              <CircleAlert :size="13" />
              <span>{{ t('chat.execution.failedWithoutAnswer') }}</span>
              <button
                v-if="failedUserExecutionEntry(chat.active?.turns || [], index)?.graph_id"
                type="button"
                :title="t('chat.execution.openTurnGraph')"
                :aria-label="t('chat.execution.openTurnGraph')"
                @click="openFailedUserExecution(chat.active?.turns || [], index)"
              >
                <Workflow :size="13" />
              </button>
            </div>
            <div
              v-if="blockedRecoveryForTurn(turn)"
              class="turn-blocked-recovery"
              role="alert"
            >
              <CircleAlert :size="14" />
              <div>
                <strong>{{ t('chat.execution.blockedTitle') }}</strong>
                <p>{{ blockedRecoveryForTurn(turn)?.reason }}</p>
                <ul
                  v-if="blockedRecoveryForTurn(turn)?.recoveryHints?.length"
                  class="turn-blocked-hints"
                >
                  <li
                    v-for="hint in blockedRecoveryForTurn(turn)?.recoveryHints"
                    :key="hint"
                  >
                    {{ hint }}
                  </li>
                </ul>
                <button
                  type="button"
                  :disabled="turnRunning"
                  @click="retryBlockedTurn(chat.active?.turns || [], index)"
                >
                  {{ t('chat.execution.blockedRetry') }}
                </button>
              </div>
            </div>
            <section
              v-if="turn.role !== 'user' && turn.role !== 'system'"
              class="conversation-execution"
            >
              <div
                v-if="isActiveStreamingTurn(turn) && currentLiveNow"
                class="conversation-live-now"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <LoaderCircle :size="14" />
                <Transition name="live-now" mode="out-in">
                  <div :key="currentLiveNow.key">
                    <strong>{{ currentLiveNow.title }}</strong>
                    <span v-if="currentLiveNow.detail">{{ currentLiveNow.detail }}</span>
                  </div>
                </Transition>
              </div>
              <ReasoningGroup
                v-if="turnGlobalReasoning(chat.active?.turns || [], index)"
                :group="turnGlobalReasoning(chat.active?.turns || [], index)!"
                variant="global"
              />
              <ExecutionActivityTree
                v-if="turnExecutionActivities(chat.active?.turns || [], index).length"
                :activities="turnExecutionActivities(chat.active?.turns || [], index)"
                :relations="turnExecutionRelations(chat.active?.turns || [], index)"
                :reasoning-groups="turnAgentReasoning(chat.active?.turns || [], index)"
                @select="openCanonicalActivity"
              />
              <div v-if="isFinalAssistantAnswer(chat.active?.turns || [], index)" class="conversation-answer">
                <span class="conversation-answer-node" :title="t('chat.timeline.finalAnswer')"><Bot :size="14" /></span>
                <div class="conversation-answer-content">
                  <MarkdownBlock
                    :content="turn.content"
                    :streaming="turn.id === chat.active?.streamTurnId && turnRunning"
                  />
                  <footer class="answer-usage">
                    <span v-for="item in exchangeUsageParts(chat.active?.turns || [], index)" :key="item.key">
                      {{ item.label }} <strong>{{ formatTokenQuantity(item.value) }}</strong>
                    </span>
                    <span class="answer-actions">
                      <button
                        class="answer-branch-link"
                        type="button"
                        :disabled="turnRunning || store.branchSessionBusy"
                        :title="store.branchSessionBusy ? t('chat.answer.branching') : t('chat.answer.branch')"
                        :aria-label="store.branchSessionBusy ? t('chat.answer.branching') : t('chat.answer.branch')"
                        :aria-busy="store.branchSessionBusy ? 'true' : 'false'"
                        @click="branchCurrentAnswer"
                      >
                        <GitBranch :size="13" />
                      </button>
                      <button
                        v-if="exchangeExecutionEntry(chat.active?.turns || [], index)?.graph_id"
                        class="answer-execution-link"
                        type="button"
                        :title="t('chat.execution.openTurnGraph')"
                        :aria-label="t('chat.execution.openTurnGraph')"
                        @click="openAnswerExecutionGraph(chat.active?.turns || [], index)"
                      >
                        <Workflow :size="13" />
                      </button>
                      <button
                        class="answer-copy-link"
                        type="button"
                        :title="copiedAnswerId === turn.id ? t('common.copied') : t('chat.answer.copy')"
                        :aria-label="copiedAnswerId === turn.id ? t('common.copied') : t('chat.answer.copy')"
                        @click="copyAnswer(turn)"
                      >
                        <Check v-if="copiedAnswerId === turn.id" :size="13" />
                        <Copy v-else :size="13" />
                      </button>
                    </span>
                  </footer>
                </div>
              </div>
            </section>
          </article>
        </template>
        <ol
          v-if="chat.active?.cancellations.length"
          class="cancellation-timeline"
          :aria-label="t('chat.cancellation.timeline')"
        >
          <li
            v-for="receipt in chat.active.cancellations"
            :key="receipt.cancellation_id"
            :data-status="receipt.status"
          >
            <Clock :size="13" />
            <span>{{ cancellationLabel(receipt.status) }}</span>
            <time :datetime="new Date(receipt.effective_at_ms || receipt.requested_at_ms).toISOString()">
              {{ cancellationTime(receipt.effective_at_ms || receipt.requested_at_ms) }}
            </time>
          </li>
        </ol>
      </div>
      <button
        v-if="!transcriptPinnedToTail"
        class="jump-to-latest"
        type="button"
        :title="t('page.chat.history.latest')"
        :aria-label="t('page.chat.history.latest')"
        @click="loadLatestHistory"
      >
        <ArrowDown :size="15" />
      </button>
    </div>

    <footer class="composer">
      <div class="composer-input-shell">
        <textarea
          ref="composerInput"
          v-model="draft"
          :placeholder="t('page.chat.page.placeholder.3e0e768fa8')"
          @input="handleComposerInput"
          @keydown="handleComposerKeydown"
        />
        <div class="composer-input-actions">
          <button
            class="icon-action composer-icon-action"
            type="button"
            :aria-label="t('chat.input.addFile')"
            :title="t('chat.input.addFile')"
            @click="openChatCompanion('workspace')"
          >
            <Paperclip :size="16" />
          </button>
          <button
            v-if="turnRunning && draft.trim()"
            class="primary-action composer-icon-action"
            type="button"
            :aria-label="t('chat.input.supplement')"
            :title="t('chat.input.supplement')"
            :disabled="submissionBusy"
            @click="submit"
          >
            <Send :size="16" />
          </button>
          <button
            v-if="turnRunning"
            class="icon-action composer-icon-action composer-stop-action"
            type="button"
            :aria-label="t('page.chat.page.text.2090c0732a')"
            :title="t('page.chat.page.text.2090c0732a')"
            @click="stop"
          >
            <Square :size="15" />
          </button>
          <button
            v-else
            class="primary-action composer-icon-action"
            type="button"
            :aria-label="t('page.chat.page.text.aeee9b2149')"
            :title="t('page.chat.page.text.aeee9b2149')"
            :disabled="!draft.trim() || submissionBusy"
            @click="submit"
          >
            <Send :size="16" />
          </button>
        </div>
      </div>
      <div class="composer-runtime-summary" aria-live="polite">
        <button
          type="button"
          class="composer-runtime-chip model"
          :title="showRequestedModel ? `requested ${store.selectedModel} · effective ${effectiveModel || 'unknown'}` : modelLabel"
          @click="store.openModal('model')"
        >
          <Bot :size="13" />
          <strong>{{ modelLabel }}</strong>
        </button>
        <span class="composer-runtime-chip context" :title="contextTitle">
          <span class="context-ring compact" :style="{ '--context-progress': `${contextUsage ?? 0}%` }"><i>{{ contextUsage === null ? '—' : Math.round(contextUsage) + '%' }}</i></span>
          <Gauge :size="13" />
          <strong>{{ contextLabel }}</strong>
        </span>
        <button
          type="button"
          class="composer-runtime-chip execution-policy"
          :data-preset="displayExecutionPolicyPreset"
          :title="t('chat.executionPolicy.open')"
          @click="executionPolicyOpen = true"
        >
          <ShieldCheck :size="13" />
          <span>{{ t('chat.executionPolicy.label') }}</span>
          <strong>{{ executionPolicyLabel(displayExecutionPolicyPreset) }}</strong>
        </button>
        <button
          type="button"
          class="composer-runtime-chip"
          :title="t('page.chat.cleanCounters.tools')"
          @click="openChatCompanion('activity')"
        >
          <Wrench :size="13" />
          <span>{{ t('page.chat.cleanCounters.tools') }}</span>
          <strong>{{ chatRuntimeMetrics.tools }}</strong>
        </button>
        <button
          type="button"
          class="composer-runtime-chip"
          :title="t('chat.execution.memoryCalls')"
          @click="openChatCompanion('activity')"
        >
          <Brain :size="13" />
          <span>{{ t('chat.execution.memoryCalls') }}</span>
          <strong>{{ chatRuntimeMetrics.memory }}</strong>
        </button>
        <span class="composer-runtime-chip" :title="t('chat.execution.totalTokens')">
          <Coins :size="13" />
          <span>{{ t('chat.execution.totalTokens') }}</span>
          <strong>{{ formatTokenQuantity(chatRuntimeMetrics.totalTokens) }}</strong>
        </span>
        <button type="button" class="composer-runtime-chip workspace" :title="store.workspaceDir || t('page.chat.page.inline.59c92a9169')" @click="store.openModal('workspace')">
          <Folder :size="13" />
          <strong>{{ store.workspaceDir || t('page.chat.page.inline.59c92a9169') }}</strong>
        </button>
        <button v-if="store.attachments.length" type="button" class="composer-runtime-chip attachments" @click="openChatCompanion('workspace')">
          <Paperclip :size="13" />
          <strong>{{ formatCount('sources', store.attachments.length) }}</strong>
        </button>
      </div>
    </footer>

    <div v-if="store.activeModal" class="modal-scrim" @click.self="store.closeModal">
      <section v-if="store.activeModal === 'model'" class="command-modal">
        <header>
          <h2>{{ t('page.chat.page.text.371e4b7b8d') }}</h2>
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="store.closeModal"><X :size="16" /></button>
        </header>
        <div class="modal-columns">
          <div>
            <h3>{{ t('page.chat.page.text.3cd6d283c3') }}</h3>
            <p v-if="!store.availableModels.length" class="modal-note">{{ t('page.chat.page.text.1c06661208') }}</p>
            <button v-for="model in store.availableModels" :key="model" class="choice-row" :class="{ active: store.selectedModel === model }" type="button" @click="store.chooseModel(model)">
              {{ model }}
            </button>
          </div>
          <div>
            <h3>{{ t('page.chat.page.text.45db77b17b') }}</h3>
            <p v-if="!store.availableProfiles.length" class="modal-note">{{ t('page.chat.page.text.b2658db093') }}</p>
            <button v-for="profile in store.availableProfiles" :key="profile" class="choice-row" :class="{ active: store.selectedProfile === profile }" type="button" @click="store.chooseProfile(profile)">
              {{ profile }}
            </button>
          </div>
        </div>
        <p v-if="store.commandError" class="file-error">{{ store.commandError }}</p>
      </section>

      <section v-else-if="store.activeModal === 'workspace'" class="command-modal">
        <header>
          <h2>{{ t('page.chat.page.text.46144acb47') }}</h2>
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="store.closeModal"><X :size="16" /></button>
        </header>
        <button class="choice-row active" type="button" @click="openChatCompanion('workspace'); store.closeModal()">
          <Folder :size="15" />
          {{ store.workspaceRoot || t('page.chat.page.inline.cc6aef43a0') }}
        </button>
        <p class="modal-note">{{ t('page.chat.page.text.92b37b0298') }}</p>
      </section>

      <section v-else class="command-modal">
        <header>
          <h2>{{ t('page.chat.page.text.01bed7d85c') }}</h2>
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="store.closeModal"><X :size="16" /></button>
        </header>
        <label class="search-field command-search">
          <Search :size="15" />
          <input
            ref="commandSearchInput"
            v-model="commandQuery"
            type="search"
            :placeholder="t('chat.commands.search')"
            @keydown.enter.prevent="chooseFirstCommand"
          />
        </label>
        <p v-if="!store.commands.length" class="modal-note">{{ t('page.chat.page.text.0a237ff19e') }}</p>
        <button v-for="command in filteredCommands" :key="command.name" class="command-row" type="button" @click="chooseCommand(command)">
          <Boxes :size="15" />
          <span><strong>{{ commandName(command) }}</strong><small>{{ commandDescription(command) }}</small></span>
        </button>
      </section>
    </div>
    <div v-if="executionPolicyOpen" class="modal-scrim" @click.self="executionPolicyOpen = false">
      <section class="command-modal execution-policy-modal" role="dialog" aria-modal="true" :aria-label="t('chat.executionPolicy.title')">
        <header>
          <div>
            <h2>{{ t('chat.executionPolicy.title') }}</h2>
            <p>{{ t('chat.executionPolicy.help') }}</p>
          </div>
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="executionPolicyOpen = false"><X :size="16" /></button>
        </header>
        <div class="execution-policy-summary">
          <span>{{ t('chat.executionPolicy.autonomy') }} <strong>{{ effectiveExecutionPolicy?.autonomy_profile || '—' }}</strong></span>
          <span>{{ t('chat.executionPolicy.permission') }} <strong>{{ effectiveExecutionPolicy?.permission_mode || '—' }}</strong></span>
          <span>{{ t('chat.executionPolicy.approval') }} <strong>{{ effectiveExecutionPolicy?.approval_profile || '—' }}</strong></span>
          <span>{{ t('chat.executionPolicy.sandbox') }} <strong>{{ policyAxisValue(effectiveExecutionPolicy, 'sandbox_posture') || '—' }}</strong></span>
          <span>{{ t('chat.executionPolicy.interruption') }} <strong>{{ effectiveExecutionPolicy?.interruption_policy || '—' }}</strong></span>
          <span>{{ t('chat.executionPolicy.revision') }} <strong>{{ effectiveExecutionPolicy?.revision || '—' }}</strong></span>
          <span>{{ t('chat.executionPolicy.origin') }} <strong>{{ effectiveExecutionPolicy?.origin || '—' }}</strong></span>
        </div>
        <section v-if="policyTransition" class="execution-policy-transition" :data-active="policyTransitionActive">
          <strong>{{ policyTransitionActive ? t('chat.executionPolicy.transitioning') : t('chat.executionPolicy.transitionStable') }}</strong>
          <div class="execution-policy-summary">
            <span>{{ t('chat.executionPolicy.phaseLabel') }} <strong>{{ policyTransitionPhaseLabel(policyTransition.phase) }}</strong></span>
            <span>{{ t('chat.executionPolicy.effectivePolicy') }} <strong>{{ effectiveExecutionPolicy?.autonomy_profile || '—' }}@{{ effectiveExecutionPolicy?.revision || '—' }}</strong></span>
            <span>{{ t('chat.executionPolicy.desiredPolicy') }} <strong>{{ desiredExecutionPolicy?.autonomy_profile || '—' }}@{{ desiredExecutionPolicy?.revision || '—' }}</strong></span>
            <span>{{ t('chat.executionPolicy.oldAttempts') }} <strong>{{ policyTransition.old_revision_active_attempts }}</strong></span>
            <span>{{ t('chat.executionPolicy.requestedAt') }} <strong>{{ policyTransitionTime(policyTransition.requested_at_ms) }}</strong></span>
            <span>{{ t('chat.executionPolicy.effectiveAt') }} <strong>{{ policyTransitionTime(policyTransition.effective_at_ms) }}</strong></span>
          </div>
          <p v-if="policyTransition.blocker" class="modal-note">{{ t('chat.executionPolicy.blocker', { blocker: policyTransition.blocker }) }}</p>
        </section>
        <p class="modal-note">{{ t('chat.executionPolicy.guardrail') }}</p>
        <div class="execution-policy-options">
          <button
            v-for="preset in executionPolicyPresets"
            :key="preset"
            type="button"
            :data-preset="preset"
            :class="{ active: displayExecutionPolicyPreset === preset }"
            :disabled="executionPolicyBusy || !canChooseExecutionPolicy"
            @click="updateExecutionPolicy(preset)"
          >
            <span><ShieldCheck :size="15" /><strong>{{ executionPolicyLabel(preset) }}</strong></span>
            <small>{{ executionPolicyDetail(preset) }}</small>
          </button>
        </div>
        <p v-if="!store.activeSessionId" class="modal-note">{{ t('chat.executionPolicy.appliesToNewSession') }}</p>
        <p v-if="policyTransitionActive" class="modal-note">{{ t('chat.executionPolicy.nextTurn') }}</p>
        <p v-if="executionPolicyError" class="file-error" role="alert">{{ executionPolicyError }}</p>
      </section>
    </div>
    <div v-if="routingDialogOpen" class="modal-scrim" @click.self="routingDialogOpen = false">
      <section class="command-modal routing-dialog">
        <header>
          <div>
            <h2>{{ t('chat.routing.missionFocus') }}</h2>
            <p>{{ t('chat.routing.missionHelp') }}</p>
          </div>
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="routingDialogOpen = false"><X :size="16" /></button>
        </header>
        <label class="field-line">
          <span>{{ t('chat.routing.mission') }}</span>
          <select v-model="selectedMissionFocus">
            <option v-for="mission in missionOptions" :key="mission.mission_id" :value="mission.mission_id">
              {{ mission.objective || mission.mission_id }}
            </option>
          </select>
        </label>
        <p v-if="routingError" class="file-error">{{ routingError }}</p>
        <div class="button-row">
          <button class="primary-action" type="button" :disabled="routingBusy || !selectedMissionFocus" @click="applyMissionFocus">
            <Check :size="15" /> {{ t('chat.routing.apply') }}
          </button>
          <button v-if="routingFocus.mission" class="ghost-action" type="button" :disabled="routingBusy" @click="clearMissionFocus">
            <X :size="15" /> {{ t('chat.routing.clear') }}
          </button>
        </div>
      </section>
    </div>
    <GlobalMissionGraphDialog
      v-if="globalMissionGraphOpen"
      @close="globalMissionGraphOpen = false"
    />
  </section>
</template>

<style scoped>
.cancellation-timeline {
  display: grid;
  gap: 4px;
  margin: 8px 0 14px;
  padding: 0;
  color: var(--text-muted);
  list-style: none;
}

.cancellation-timeline li {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--surface-2);
  font-size: 12px;
}

.cancellation-timeline time {
  margin-left: auto;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
</style>
