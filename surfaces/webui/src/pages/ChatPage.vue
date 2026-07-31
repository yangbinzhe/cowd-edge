<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  Bot,
  ArrowDown,
  Boxes,
  Brain,
  Check,
  CircleDot,
  CircleX,
  Coins,
  Copy,
  Eye,
  FileCheck2,
  Folder,
  Gauge,
  History,
  LoaderCircle,
  Paperclip,
  Search,
  Send,
  Square,
  Workflow,
  Wrench,
  X,
} from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import MarkdownBlock from '../components/MarkdownBlock.vue';
import ExecutionGraphCanvas from '../components/mission/ExecutionGraphCanvas.vue';
import { useEscapeKey } from '../composables/useEscapeKey';
import { displayStatus } from '../i18n/domain/status';
import type { ActivityEvent, ChatTurn } from '../types';
import { causalActivityTimeline } from '../utils/causalTimeline';
import { mergeActivityEvent } from '../utils/turnSettlement';

const store = useAppStore();
const chat = useChatSessionsStore();
const projections = useProjectionRegistryStore();
const transcript = ref<HTMLElement | null>(null);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const commandSearchInput = ref<HTMLInputElement | null>(null);
const transcriptPinnedToTail = ref(true);
const historyLoadInFlight = ref(false);
const pendingTailSessionId = ref('');
const copiedAnswerId = ref('');
let copiedAnswerResetTimer: ReturnType<typeof setTimeout> | null = null;
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
const teamExecutionGraphId = computed(() => {
  const projection = requestedProjection.value as any;
  const strategyGraphId = String(projection?.strategy?.team_execution_id || '').trim();
  if (strategyGraphId && strategyGraphId !== requestedExecutionGraphId.value) return strategyGraphId;
  const linked = (Array.isArray(projection?.teams) ? projection.teams : [])
    .map((team: any) => String(team?.detail?.graph_id || '').trim())
    .find((graphId: string) => graphId && graphId !== requestedExecutionGraphId.value);
  if (linked) return linked;
  const childGraph = (Array.isArray(projection?.child_executions)
    ? projection.child_executions
    : [])
    .map((child: any) => String(child?.execution_id || '').trim())
    .find((graphId: string) => graphId && graphId !== requestedExecutionGraphId.value);
  if (childGraph) return childGraph;
  return [...(chat.active?.activity || [])]
    .reverse()
    .filter((event) => event.parent_execution_id === requestedExecutionGraphId.value)
    .map((event) => String(event.graph_id || '').trim())
    .find((graphId) => graphId && graphId !== requestedExecutionGraphId.value) || '';
});
const displayedExecutionGraphId = computed(() => (
  teamExecutionGraphId.value || requestedExecutionGraphId.value
));
const activeProjection = computed(() => displayedExecutionGraphId.value
  ? projections.projectionFor(displayedExecutionGraphId.value)
  : null);
const executionGraph = computed(() => activeProjection.value?.graph || null);
const executionConnectionState = computed(() => displayedExecutionGraphId.value
  ? projections.stateFor(displayedExecutionGraphId.value)
  : 'idle');
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
  const rows = new Map<string, ActivityEvent>();
  for (const event of [...store.activity, ...(chat.active?.activity || [])]) {
    const entry = selectedExecutionEntry.value;
    if (entry && event.turn_id && entry.turn_id && event.turn_id !== entry.turn_id) continue;
    const previous = rows.get(event.id);
    rows.set(event.id, mergeActivityEvent(previous, event));
  }
  return [...rows.values()].slice(-160);
});
const live = computed(() => currentProjection.value?.live || chat.active?.live || null);
const providerModelRows = computed(() => {
  const providers = store.providers as any;
  const control = store.controlPlane as any;
  const settings = store.settings as any;
  return [
    ...(Array.isArray(providers?.models) ? providers.models : []),
    ...(Array.isArray(providers?.catalog?.models) ? providers.catalog.models : []),
    ...(Array.isArray(control?.provider?.catalog?.models) ? control.provider.catalog.models : []),
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
  const activities = [...(chat.active?.activity || []), ...store.activity];
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
  (chat.active?.turnProjection?.turns || [])
    .flatMap((turn: any) => Array.isArray(turn?.evidence_refs) ? turn.evidence_refs : [])
    .map((reference: unknown) => String(reference || '').trim())
    .filter(Boolean),
).size);
const showRequestedModel = computed(() => (
  !!store.selectedModel && effectiveModel.value !== store.selectedModel
));
const isPanorama = computed(() => store.chatDisplayMode === 'panorama');
const turnRunning = computed(() => !!chat.active?.pending || ['queued', 'preparing_context', 'calling_model', 'thinking', 'calling_tool', 'waiting_approval', 'finalizing'].includes(executionStatus.value));
const submissionBusy = computed(() => !!chat.active?.submitting);
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
watch(() => store.activeSessionId, async (sessionId, previousSessionId) => {
  if (sessionId !== previousSessionId) store.closeChatExecutionGraph();
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
watch(
  [() => store.chatExecutionGraphExpanded, requestedExecutionGraphId, teamExecutionGraphId],
  ([expanded, rootGraphId, teamGraphId]) => {
    projections.release(executionGraphConsumer);
    if (!expanded) return;
    const graphId = teamGraphId || rootGraphId;
    if (!graphId) return;
    projections.acquire(
      graphId,
      executionGraphConsumer,
      'full',
      'bounded',
      store.activeSessionId,
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  projections.release(executionGraphConsumer);
  if (copiedAnswerResetTimer) clearTimeout(copiedAnswerResetTimer);
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
  store.setChatDisplayMode('panorama');
  store.openCompanion(tab);
}

function toggleCurrentExecutionGraph() {
  if (store.chatExecutionGraphExpanded) {
    store.closeChatExecutionGraph();
    return;
  }
  store.openChatExecutionGraph(chat.active?.executionGraphId || chat.active?.executionId || '');
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
    await store.boot();
    if (!store.activeSessionId) await store.createSession();
    const sessionId = store.activeSessionId;
    if (!sessionId) return;
    if (/^\/permissions(?:\s|$)/i.test(text)) {
      const mode = text.split(/\s+/)[1] || '';
      const result: any = await store.executeCommand('/permissions', {
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
    chat.setDraft(sessionId, text);
    unboundDraft.value = '';
    const input = store.composeChatInput(text);
    const accepted = await chat.send(sessionId, text, input);
    if (accepted && store.activeSessionId === sessionId) {
      await store.ensureSessionTitleFromFirstMessage(sessionId, text);
      chat.setDraft(sessionId, '');
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
    || isFinalAssistantAnswer(turns, index)
    || isActiveStreamingTurn(turn)
    || (turn.role === 'assistant' && !!turn.content.trim())
    || causalTurnTimelineActivities(turns, index).length > 0;
}

function isActiveStreamingTurn(turn: ChatTurn) {
  return turn.role === 'assistant'
    && turn.id === chat.active?.streamTurnId
    && turnRunning.value;
}

function causalTurnTimelineActivities(turns: ChatTurn[], index: number) {
  const turn = turns[index];
  const finalAnswer = isFinalAssistantAnswer(turns, index);
  const priorActivityIds = new Set<string>();
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (turns[cursor].role === 'user') break;
    for (const event of turns[cursor].activity || []) priorActivityIds.add(event.id);
  }
  const activities = (turn.activity || [])
    .filter((event) => ['tool', 'think', 'approval', 'error'].includes(event.kind))
    .filter((event) => turn.role !== 'tool' || !priorActivityIds.has(event.id))
    .map((event) => {
      if (event.kind !== 'tool' || event.status !== 'started') return event;
      for (let cursor = index + 1; cursor < turns.length; cursor += 1) {
        if (turns[cursor].role === 'user') break;
        const settled = (turns[cursor].activity || []).find((candidate) => candidate.id === event.id);
        if (!settled) continue;
        return {
          ...event,
          ...settled,
          input: event.input ?? settled.input,
          output: settled.output ?? event.output,
          raw: {
            ...(event.raw || {}),
            ...(settled.raw || {}),
          },
        };
      }
      return event;
    });
  if (turn.role === 'assistant' && !finalAnswer && turn.content.trim()) {
    activities.push({
      id: `assistant-progress:${turn.id}`,
      kind: 'think',
      title: t('chat.activity.thinking'),
      detail: turn.content.trim(),
      status: turn.status || 'complete',
      sequence: turn.sequence,
    });
  }
  return causalActivityTimeline(activities, 500);
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
  const events = causalTurnTimelineActivities(chat.active?.turns || [], (chat.active?.turns || []).indexOf(turn));
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
  const activeThought = [...events].reverse().find((event) => (
    event.kind === 'think'
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
  if (!isFinalAssistantAnswer(turns, answerIndex)) return null;
  const start = exchangeStartIndex(turns, answerIndex);
  const exchange = turns.slice(start, answerIndex + 1);
  const executionId = [...exchange]
    .reverse()
    .map((turn) => String(turn.execution_id || '').trim())
    .find(Boolean);
  const turnId = [...exchange]
    .reverse()
    .map((turn) => String(turn.turn_id || '').trim())
    .find(Boolean);
  const entries = chat.active?.executionIndex?.executions || [];
  const canonical = entries.find((entry) => (
    (executionId && entry.execution_id === executionId)
    || (turnId && entry.turn_id === turnId)
  ));
  if (canonical) return canonical;
  if (!executionId) return null;
  return {
    execution_id: executionId,
    graph_id: executionId,
    turn_id: turnId || null,
    status: 'complete' as const,
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
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand?.('copy');
    textarea.remove();
  }
  copiedAnswerId.value = turn.id;
  if (copiedAnswerResetTimer) clearTimeout(copiedAnswerResetTimer);
  copiedAnswerResetTimer = setTimeout(() => {
    if (copiedAnswerId.value === turn.id) copiedAnswerId.value = '';
  }, 1_500);
}

function activityFailed(event: ActivityEvent) {
  return event.kind === 'error'
    || ['error', 'failed', 'denied', 'timed_out'].includes(String(event.status || '').toLowerCase());
}

function activityDuration(event: ActivityEvent) {
  const value = Number(event.duration_ms ?? event.raw?.duration_ms);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, '')} s`;
}

function activityIcon(event: ActivityEvent) {
  if (activityFailed(event)) return CircleX;
  if (event.kind === 'think') return Brain;
  if (event.kind === 'runtime') return Workflow;
  if (event.kind === 'context') return Gauge;
  if (event.kind === 'approval') return CircleDot;
  return Wrench;
}

function activityDetail(event: ActivityEvent) {
  if (event.kind !== 'tool') return String(event.detail || '').trim();
  const input = truncateActivityText(compactActivityValue(event.input), 160);
  const output = truncateActivityText(compactActivityValue(event.output), 220);
  if (output && input) return `${input} → ${output}`;
  return output || input || String(event.detail || '').trim();
}

function activityLane(event: ActivityEvent) {
  if (event.kind !== 'tool' && event.kind !== 'error') return '';
  const agent = String(event.agent_id || '').trim();
  const agentLabel = agent
    ? t('chat.timeline.agentLane', { agent: truncateActivityText(agent, 32) })
    : '';
  const wave = Number(event.wave || 0) + 1;
  const lane = Number(event.lane || 0) + 1;
  const laneCount = Number(event.lane_count || 0);
  const executionLane = laneCount > 1
    ? t('chat.timeline.parallelLane', { wave, lane, count: laneCount })
    : wave > 1
      ? t('chat.timeline.dependencyWave', { wave })
      : '';
  return [agentLabel, executionLane].filter(Boolean).join(' · ');
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
        <h1>{{ t('page.chat.page.text.177c6b9656') }}</h1>
        <div class="chat-session-facts">
          <span class="chat-fact observer" :data-role="chat.active?.attachmentRole">
            <Eye :size="13" />
            <strong>{{ attachmentLabel }}</strong>
          </span>
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
        </div>
      </div>
    </header>

    <div class="chat-transcript-stage">
      <section
        v-if="store.chatExecutionGraphExpanded && chat.active"
        class="chat-execution-overlay"
        role="dialog"
        :aria-label="t('chat.execution.graph')"
      >
        <header>
          <div>
            <Workflow :size="15" />
            <strong>{{ teamExecutionGraphId ? t('chat.execution.teamGraph') : t('chat.execution.graph') }}</strong>
            <span v-if="selectedExecutionEntry?.turn_id">{{ t('chat.execution.turn', { turn: selectedExecutionEntry.turn_id }) }}</span>
            <span>{{ displayStatus(String(activeProjection?.live?.status || executionGraph?.status || executionStatus)) }}</span>
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
            <section v-else class="conversation-execution">
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
              <ol
                v-if="isPanorama && causalTurnTimelineActivities(chat.active?.turns || [], index).length"
                class="conversation-timeline"
              >
                <li
                  v-for="event in causalTurnTimelineActivities(chat.active?.turns || [], index)"
                  :key="event.id"
                  :data-kind="event.kind"
                  :data-status="activityFailed(event) ? 'error' : event.status || 'complete'"
                >
                  <span class="conversation-timeline-node" :title="activityFailed(event) ? displayStatus(event.status || 'error') : event.title">
                    <component :is="activityIcon(event)" :size="13" />
                  </span>
                  <div>
                    <strong>{{ event.title }}</strong>
                    <p v-if="activityDetail(event)">{{ activityDetail(event) }}</p>
                    <small v-if="activityLane(event)" class="conversation-timeline-lane">{{ activityLane(event) }}</small>
                  </div>
                  <time v-if="activityDuration(event)">{{ activityDuration(event) }}</time>
                </li>
              </ol>
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
  </section>
</template>
