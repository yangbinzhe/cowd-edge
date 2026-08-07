import { defineStore } from 'pinia';
import { computed, onScopeDispose, reactive, ref } from 'vue';
import {
  api,
  invalidateSessionAuthorization,
} from '../api/client';
import type {
  ActivityEvent,
  ChatTurn,
  ExecutionLiveState,
  SessionExecutionIndexProjection,
  SessionHistoryIndexProjection,
} from '../types';
import { mergeActivityEvent, normalizeTurnActivity } from '../utils/turnSettlement';
import {
  activityIdentityKey,
  appendReasoningSummary,
  causalActivityTimeline,
} from '../utils/causalTimeline';
import { t } from '../i18n';
import { useProjectionRegistryStore } from './projectionRegistry';
import { openSessionLiveSource } from './liveTransport';
import type { SessionLiveSource } from './liveTransport';

type SurfaceExecutionStatus = ExecutionLiveState['status'] | 'accepted_pending_materialization' | 'running' | 'terminal';
type LiveExecutionState = Omit<ExecutionLiveState, 'status'>
  & { status: SurfaceExecutionStatus }
  & Partial<Omit<ExecutionLiveState, 'status'>>;

export type SessionChatState = {
  sessionId: string;
  turns: ChatTurn[];
  activity: ActivityEvent[];
  executionId: string;
  executionGraphId: string;
  executionTurnId: string;
  executionGeneration: number;
  streamGeneration: number;
  runtimeCommitCursor: number;
  reconnectBlocked: boolean;
  latestIngressSequence: number;
  streamTurnId: string;
  terminalId: string;
  live: LiveExecutionState | null;
  executionIndex: SessionExecutionIndexProjection | null;
  historyIndex: SessionHistoryIndexProjection | null;
  streamState: 'connected' | 'connecting' | 'reconnecting' | 'degraded' | 'offline';
  loadEpoch: number;
  submissionEpoch: number;
  attachmentEpoch: number;
  pending: boolean;
  submitting: boolean;
  lastError: string;
  unread: number;
  lastEventAtMs: number;
  lastProgressAtMs: number;
  degradedReason: string;
  resyncCount: number;
  attachmentRole: 'writer' | 'reader' | 'detached';
  writable: boolean;
  draft: string;
  scrollTop: number;
  historyTotal: number;
  historyNextSequence: number;
  historyOldestOffset: number;
  historyWindowEndOffset: number;
  historyHasOlder: boolean;
  historyHasNewer: boolean;
  historyLoading: boolean;
  historyIndexLoading: boolean;
  historyIndexLoaded: boolean;
  scrollInitialized: boolean;
  executionIndexLoading: boolean;
  executionIndexLoaded: boolean;
  detailsLoading: boolean;
  detailsLoaded: boolean;
};

const SESSION_DRAFT_KEY_PREFIX = 'cowd.webui.sessionDraft.v1:';

function sessionDraftStorageKey(sessionId: string) {
  return `${SESSION_DRAFT_KEY_PREFIX}${encodeURIComponent(sessionId)}`;
}

function readSessionDraft(sessionId: string) {
  try {
    return globalThis.localStorage?.getItem(sessionDraftStorageKey(sessionId)) || '';
  } catch {
    return '';
  }
}

function writeSessionDraft(sessionId: string, value: string) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (value) storage.setItem(sessionDraftStorageKey(sessionId), value);
    else storage.removeItem(sessionDraftStorageKey(sessionId));
  } catch {
    // Browser privacy and quota policies must not block chat input.
  }
}
const HISTORY_PAGE_SIZE = 50;
const HISTORY_WINDOW_CAP = 1_000;
const SESSION_ACTIVITY_CAP = 2_000;
const TURN_ACTIVITY_CAP = 500;
const LIVE_RECOVERY_INTERVAL_MS = 1_500;
const LIVE_RECOVERY_SILENCE_MS = 2_000;
const LIVE_SOURCE_READY_TIMEOUT_MS = import.meta.env.MODE === 'test' ? 0 : 5_000;
const LIVE_SOURCE_READY_POLL_MS = 25;
const DURABLE_MESSAGE_ROLES = new Set(['user', 'assistant', 'system', 'tool']);
const SESSION_SCOPED_STREAM_EVENTS = new Set([
  'Connected',
  'SessionAuthorizationRevoked',
  'session_stream_resync',
  'RuntimeStreamLagged',
  'UserMessageCommitted',
  'ExecutionGraphSummary',
  'TextDelta',
  'ModelStepStarted',
  'ModelStepCompleted',
  'ItemStarted',
  'ItemCompleted',
  'ReasoningSummaryDelta',
  'ToolStart',
  'ToolProgress',
  'ToolComplete',
  'ToolExecuted',
  'ExecutionPhase',
  'ProviderAttempt',
  'ContextEnvelope',
  'RuntimePolicyDecision',
  'SessionInputReceived',
  'SessionInputProjection',
  'TurnInboxUpdated',
  'TurnInputCheckpointConsumed',
  'ApprovalRequested',
  'ApprovalResolved',
  'TurnError',
  'TerminalCommitted',
]);

function textFromBlocks(blocks: any[]) {
  return (blocks || [])
    .filter((block) => block?.type === 'text')
    .map((block) => block?.text || block?.content || '')
    .join('');
}

function toolResultBlock(blocks: any[]) {
  return (blocks || []).find((block) => block?.type === 'tool_result') || null;
}

function compactToolOutput(value: unknown) {
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['summary', 'message', 'error', 'status', 'result', 'decision']) {
      if (typeof object[key] === 'string' && object[key].trim()) {
        return object[key].trim().slice(0, 260);
      }
    }
    return `${Object.keys(object).length} fields`;
  }
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const completed = text.match(
    /^Tool `[^`]+` completed\.(?: Evidence: \S+\.)?(?: JSON object with (\d+) keys[^.]*\.)?/,
  );
  if (completed) {
    return completed[1]
      ? t('chat.activity.toolCompletedFields', { count: completed[1] })
      : t('chat.activity.toolCompleted');
  }
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return `${parsed.length} items`;
      for (const key of ['summary', 'message', 'error', 'status', 'result']) {
        if (typeof parsed?.[key] === 'string' && parsed[key].trim()) {
          return parsed[key].trim().slice(0, 260);
        }
      }
      return `${Object.keys(parsed || {}).length} fields`;
    } catch {
      // Fall through to the bounded textual summary.
    }
  }
  const marker = text.search(/\s[\[{]\s*["']/);
  const summary = marker > 0 ? text.slice(0, marker) : text;
  return summary.length > 260 ? `${summary.slice(0, 257)}...` : summary;
}

const STRUCTURED_ASSISTANT_KEYS = new Set([
  'analysis',
  'conclusion',
  'details',
  'evidence',
  'evidence_summary',
  'findings',
  'grounding',
  'memory_contents',
  'next_steps',
  'objective',
  'recommendations',
  'risks',
  'source_title',
  'source_url',
  'status',
  'summary',
  'unresolved',
  'version',
]);

function assistantFieldLabel(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function structuredAssistantValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        const rendered = structuredAssistantValue(item, depth + 1);
        return typeof item === 'object' && item !== null
          ? `${index + 1}. ${rendered.replace(/\n/g, '\n   ')}`
          : `- ${rendered}`;
      })
      .join('\n');
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => {
      const label = assistantFieldLabel(key);
      if (item !== null && typeof item === 'object') {
        const heading = '#'.repeat(Math.min(4, depth + 2));
        return `${heading} ${label}\n\n${structuredAssistantValue(item, depth + 1)}`;
      }
      return `- **${label}:** ${structuredAssistantValue(item, depth + 1)}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function unwrapAssistantEnvelope(value: string) {
  const text = String(value || '').trim();
  const fenced = text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  const candidate = fenced?.[1]?.trim() || text;
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return value;
  try {
    const parsed = JSON.parse(candidate);
    const entries = Object.entries(parsed || {});
    for (const key of ['answer', 'response', 'message', 'content', 'text', 'final', 'output']) {
      if (
        typeof parsed?.[key] === 'string'
        && parsed[key].trim()
        && entries.length === 1
      ) {
        return parsed[key];
      }
    }
    const choice = parsed?.choices?.[0]?.message?.content;
    if (typeof choice === 'string' && choice.trim()) return choice;
    const hasReadableValue = entries.some(([, item]) => (
      (typeof item === 'string' && item.trim())
      || (Array.isArray(item) && item.length > 0)
      || (item !== null && typeof item === 'object' && Object.keys(item).length > 0)
    ));
    if (
      entries.some(([key]) => STRUCTURED_ASSISTANT_KEYS.has(key))
      || (entries.length >= 2 && hasReadableValue)
    ) {
      return structuredAssistantValue(parsed);
    }
  } catch {
    // Ordinary prose and code blocks that are not complete JSON reports stay verbatim.
  }
  return value;
}

function durableActivity(message: any): ActivityEvent[] {
  const sequence = Number(message?.sequence);
  const executionId = blockMetadata(message?.blocks, 'cowd_execution_id');
  const turnId = blockMetadata(message?.blocks, 'cowd_turn_id');
  return (message?.blocks || []).flatMap((block: any, index: number) => {
    if (block?.type === 'thinking' || block?.type === 'reasoning_summary') {
      return [normalizeTurnActivity({
        id: String(block.id || `${message.id}:thinking:${index}`),
        kind: 'think',
        title: t('chat.activity.thinking'),
        detail: block.text || block.thinking || block.content || '',
        status: 'complete',
        sequence: Number.isFinite(sequence) ? `${sequence}.${index}` : index,
        execution_id: executionId,
        turn_id: turnId,
        raw: { thinking: block },
      })];
    }
    if (block?.type === 'tool_use') {
      const name = String(block.name || 'tool');
      return [normalizeTurnActivity({
        id: String(block.cowd_tool_instance_id || block.id || `${message.id}:tool:${index}`),
        kind: 'tool',
        title: name,
        detail: block.input ? compactToolOutput(JSON.stringify(block.input)) : '',
        status: 'started',
        sequence: Number.isFinite(sequence) ? `${sequence}.${index}` : index,
        execution_id: executionId,
        turn_id: turnId,
        tool_call_id: String(block.id || ''),
        input: block.input,
        raw: { tool_use: block, input: block.input },
      })];
    }
    if (block?.type === 'tool_result') {
      const name = String(block.tool_name || 'tool');
      return [normalizeTurnActivity({
        id: String(block.cowd_tool_instance_id || block.tool_use_id || `${message.id}:result:${index}`),
        kind: block.is_error ? 'error' : 'tool',
        title: name,
        detail: compactToolOutput(block.output),
        status: block.is_error ? 'error' : 'complete',
        sequence: Number.isFinite(sequence) ? `${sequence}.${index}` : index,
        execution_id: executionId,
        turn_id: turnId,
        tool_call_id: String(block.tool_use_id || ''),
        output: block.output,
        raw: { tool_result: block, output: block.output },
      })];
    }
    return [];
  });
}

function sortTurnsCausally(turns: ChatTurn[]) {
  const ingressAnchors = new Map<string, number>();
  turns.forEach((message) => {
    if (message.role !== 'user') return;
    const turnId = blockMetadata(message.blocks, 'cowd_turn_id');
    const ingressId = blockMetadata(message.blocks, 'cowd_turn_ingress_message_id');
    if (turnId && ingressId === message.id && Number.isFinite(Number(message.sequence))) {
      ingressAnchors.set(turnId, Number(message.sequence));
    }
  });
  return [...turns].sort((left, right) => {
    const leftTurn = blockMetadata(left.blocks, 'cowd_turn_id');
    const rightTurn = blockMetadata(right.blocks, 'cowd_turn_id');
    const leftPhysical = Number.isFinite(Number(left.sequence)) ? Number(left.sequence) : Number.MAX_SAFE_INTEGER;
    const rightPhysical = Number.isFinite(Number(right.sequence)) ? Number(right.sequence) : Number.MAX_SAFE_INTEGER;
    const leftAnchor = ingressAnchors.get(leftTurn) ?? leftPhysical;
    const rightAnchor = ingressAnchors.get(rightTurn) ?? rightPhysical;
    if (leftAnchor !== rightAnchor) return leftAnchor - rightAnchor;
    if ((left.role === 'user') !== (right.role === 'user')) return left.role === 'user' ? -1 : 1;
    return leftPhysical - rightPhysical;
  });
}

function sessionEnvelopeIdentityIssue(
  value: any,
  sessionId: string,
  label: string,
) {
  const received = typeof value?.session_id === 'string' ? value.session_id : '';
  if (received !== sessionId) {
    return `${label} session identity mismatch: expected ${sessionId}, received ${received || 'missing'}`;
  }
  return '';
}

function messagesIdentityIssue(page: any, sessionId: string, label: string) {
  const envelopeIssue = sessionEnvelopeIdentityIssue(page, sessionId, label);
  if (envelopeIssue) return envelopeIssue;
  if (!Array.isArray(page?.messages)) return `${label} messages payload is not an array`;
  const seen = new Set<string>();
  for (const message of page.messages) {
    const messageIssue = sessionEnvelopeIdentityIssue(message, sessionId, `${label} message`);
    if (messageIssue) return messageIssue;
    const id = String(message?.id || message?.message_id || '').trim();
    if (!id) return `${label} message is missing its canonical identity`;
    if (seen.has(id)) return `${label} contains duplicate message identity ${id}`;
    seen.add(id);
    if (!DURABLE_MESSAGE_ROLES.has(String(message?.role || ''))) {
      return `${label} message ${id} has an unsupported role`;
    }
  }
  return '';
}

function normalizeTurns(messages: any[]): ChatTurn[] {
  const normalized = (messages || []).filter((message: any) => !(
    message?.role === 'assistant'
    && String(message?.id || message?.message_id || '').includes(':transcript:')
  )).map((message: any) => {
    const role = message.role as ChatTurn['role'];
    const result = role === 'tool' ? toolResultBlock(message.blocks) : null;
    const blockText = textFromBlocks(message.blocks);
    const rawContent = typeof message.content === 'string' ? message.content : blockText;
    const toolOutput = result ? String(result.output || '') : '';
    const activity = durableActivity(message);
    return {
      id: String(message.id || message.message_id),
      role,
      content: role === 'assistant'
        ? unwrapAssistantEnvelope(rawContent)
        : role === 'tool'
          ? compactToolOutput(toolOutput)
          : rawContent,
      status: result?.is_error ? 'error' : 'complete',
      sequence: message.sequence,
      blocks: message.blocks,
      activity,
      tool_use_id: result?.tool_use_id,
      tool_name: result?.tool_name,
      tool_output: toolOutput,
      tool_error: !!result?.is_error,
      token_usage: message.token_usage ?? message.usage,
      execution_id: blockMetadata(message.blocks, 'cowd_execution_id'),
      turn_id: blockMetadata(message.blocks, 'cowd_turn_id'),
      ingress_message_id: blockMetadata(message.blocks, 'cowd_turn_ingress_message_id'),
    } as ChatTurn;
  });
  return sortTurnsCausally(normalized);
}

function blockMetadata(blocks: any[], key: string) {
  for (const block of blocks || []) {
    const value = block?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function mergeActivityTimeline(existing: ActivityEvent[], incoming: ActivityEvent[]) {
  const rows = [...existing];
  for (const event of incoming) {
    const identity = activityIdentityKey(event);
    const index = rows.findIndex((candidate) => (
      activityIdentityKey(candidate) === identity
      || (
        !!event.tool_call_id
        && candidate.tool_call_id === event.tool_call_id
      )
    ));
    if (index >= 0) rows.splice(index, 1, mergeActivityEvent(rows[index], event));
    else rows.push(event);
  }
  return causalActivityTimeline(rows, TURN_ACTIVITY_CAP);
}

function streamIdentityKey(sessionId: string, state: SessionChatState, payload: any) {
  const executionId = String(payload.execution_id || '');
  const turnId = String(payload.turn_id || '');
  const partId = String(payload.part_id || '');
  if (!executionId || !turnId || !partId) return '';
  if (executionId !== state.executionId) return '';
  if (state.executionTurnId && turnId !== state.executionTurnId) return '';
  return `${sessionId}\u0000${executionId}\u0000${turnId}\u0000${partId}`;
}

function readIssue(value: any, label: string) {
  const state = String(value?.__state || 'ready');
  if (state === 'ready') return '';
  const status = Number(value?.__http_status);
  const statusPrefix = Number.isFinite(status) && status > 0 ? `HTTP ${status} ` : '';
  return `${label}: ${statusPrefix}${String(value?.__error || state)}`;
}

function mergeTurns(current: ChatTurn[], incoming: ChatTurn[]) {
  const merged = new Map<string, ChatTurn>();
  for (const turn of [...current, ...incoming]) merged.set(turn.id, turn);
  return sortTurnsCausally([...merged.values()]);
}

function hasDurableAssistantForExecution(
  state: SessionChatState,
  executionId: string,
  turnId = '',
) {
  return state.turns.some((turn) => (
    turn.id !== state.streamTurnId
    && turn.role === 'assistant'
    && !!turn.content.trim()
    && (
      (!!executionId && turn.execution_id === executionId)
      || (!!turnId && turn.turn_id === turnId)
    )
  ));
}

function uniqueSubmissionKey(sessionId: string) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `webui:${sessionId}:${suffix}`;
}

function hasActivePrimaryTurn(state: SessionChatState) {
  return state.pending || [
    'queued',
    'preparing_context',
    'calling_model',
    'thinking',
    'calling_tool',
    'waiting_approval',
    'finalizing',
    'running',
    'accepted_pending_materialization',
  ].includes(String(state.live?.status || ''));
}

function reconcileOptimisticUserTurn(
  state: SessionChatState,
  canonical: {
    messageId: string;
    content: string;
    sequence?: number;
    executionId?: string;
    turnId?: string;
  },
) {
  if (!canonical.messageId) return;
  const existing = state.turns.find((turn) => turn.id === canonical.messageId);
  const optimistic = [...state.turns]
    .reverse()
    .find((turn) => (
      turn.role === 'user'
      && turn.id.startsWith('local:')
      && turn.content === canonical.content
    ));
  if (existing) {
    if (optimistic) {
      state.turns = state.turns.filter((turn) => turn !== optimistic);
    }
    return;
  }
  if (optimistic) {
    optimistic.id = canonical.messageId;
    optimistic.status = 'complete';
    optimistic.submission_error = undefined;
    optimistic.sequence = canonical.sequence;
    optimistic.execution_id = canonical.executionId;
    optimistic.turn_id = canonical.turnId;
    optimistic.ingress_message_id = canonical.messageId;
    return;
  }
  state.turns.push({
    id: canonical.messageId,
    role: 'user',
    content: canonical.content,
    status: 'complete',
    sequence: canonical.sequence,
    execution_id: canonical.executionId,
    turn_id: canonical.turnId,
    ingress_message_id: canonical.messageId,
  });
}

export const useChatSessionsStore = defineStore('chatSessions', () => {
  const states = reactive<Record<string, SessionChatState>>({});
  const sourceLeases = new Map<string, SessionLiveSource>();
  const deltaBuffers = new Map<string, string>();
  const flushFrames = new Map<string, number>();
  const streamByteEnds = new Map<string, number>();
  const openFlights = new Map<string, Promise<void>>();
  const attachmentFlights = new Map<string, Promise<unknown>>();
  const canonicalResyncFlights = new Map<string, Promise<void>>();
  const executionIndexFlights = new Map<string, Promise<void>>();
  const transcriptSyncFlights = new Map<string, Promise<void>>();
  const progressRecoveryTimers = new Map<string, ReturnType<typeof setInterval>>();
  const progressRecoveryFlights = new Map<string, Promise<void>>();
  const presenceHeartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const projections = useProjectionRegistryStore();
  const activeSessionId = ref('');
  const active = computed(() => activeSessionId.value ? stateFor(activeSessionId.value) : null);
  const activeSourceCount = ref(0);

  function stateFor(sessionId: string) {
    if (!states[sessionId]) {
      states[sessionId] = {
        sessionId, turns: [], activity: [], executionId: '', executionGraphId: '', executionTurnId: '', executionGeneration: 0,
        streamGeneration: 0, runtimeCommitCursor: 0, reconnectBlocked: false,
        latestIngressSequence: -1, streamTurnId: '', terminalId: '', live: null, executionIndex: null, historyIndex: null, streamState: 'offline',
        loadEpoch: 0, submissionEpoch: 0, attachmentEpoch: 0,
        pending: false, submitting: false, lastError: '', unread: 0,
        lastEventAtMs: 0, lastProgressAtMs: 0, degradedReason: '', resyncCount: 0,
        attachmentRole: 'detached', writable: false,
        draft: readSessionDraft(sessionId), scrollTop: 0, historyTotal: 0, historyNextSequence: 0, historyOldestOffset: 0,
        historyWindowEndOffset: 0, historyHasOlder: false, historyHasNewer: false,
        scrollInitialized: false,
        executionIndexLoading: false, executionIndexLoaded: false,
        historyLoading: false, historyIndexLoading: false, historyIndexLoaded: false,
        detailsLoading: false, detailsLoaded: false,
      };
    }
    return states[sessionId];
  }

  function clearPresenceHeartbeat(sessionId: string) {
    const timer = presenceHeartbeatTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    presenceHeartbeatTimers.delete(sessionId);
  }

  function schedulePresenceHeartbeat(sessionId: string, attachment: any) {
    const ttlMs = Number(attachment?.presence_ttl_ms);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
    clearPresenceHeartbeat(sessionId);
    const delayMs = Math.max(100, Math.floor(ttlMs / 3));
    const timer = setTimeout(() => {
      presenceHeartbeatTimers.delete(sessionId);
      const reaffirm = serializeAttachment(sessionId, async () => {
        const state = states[sessionId];
        if (!state || state.reconnectBlocked || state.attachmentRole === 'detached') return null;
        const response: any = await api.attachSession(sessionId, state.attachmentRole);
        if (response?.ok === false) {
          throw new Error(String(response.error || 'session presence heartbeat rejected'));
        }
        return response;
      });
      void reaffirm
        .then((response) => {
          if (response) schedulePresenceHeartbeat(sessionId, response);
        })
        .catch(() => {
          const state = states[sessionId];
          if (state && !state.reconnectBlocked && state.attachmentRole !== 'detached') {
            schedulePresenceHeartbeat(sessionId, { presence_ttl_ms: ttlMs });
          }
        });
    }, delayMs);
    presenceHeartbeatTimers.set(sessionId, timer);
  }

  function scheduleFlush(sessionId: string) {
    if (flushFrames.has(sessionId)) return;
    let flushedSynchronously = false;
    const frame = requestAnimationFrame(() => {
      flushedSynchronously = true;
      flush(sessionId);
    });
    if (!flushedSynchronously) flushFrames.set(sessionId, frame);
  }

  function flush(sessionId: string) {
    flushFrames.delete(sessionId);
    const delta = deltaBuffers.get(sessionId);
    if (!delta) return;
    const state = stateFor(sessionId);
    const turn = state.turns.find((item) => item.id === state.streamTurnId);
    const batch = delta.slice(0, 12_000);
    const remaining = delta.slice(batch.length);
    if (remaining) {
      deltaBuffers.set(sessionId, remaining);
      scheduleFlush(sessionId);
    } else {
      deltaBuffers.delete(sessionId);
    }
    if (turn) turn.content += batch;
  }

  function drainPendingDelta(sessionId: string) {
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    const delta = deltaBuffers.get(sessionId);
    deltaBuffers.delete(sessionId);
    if (!delta) return;
    const state = stateFor(sessionId);
    const turn = state.turns.find((item) => item.id === state.streamTurnId);
    if (turn) turn.content += delta;
  }

  function queueDelta(sessionId: string, content: string) {
    deltaBuffers.set(sessionId, `${deltaBuffers.get(sessionId) || ''}${content}`);
    scheduleFlush(sessionId);
  }

  function clearStreamByteEnds(sessionId: string) {
    const prefix = `${sessionId}\u0000`;
    for (const key of streamByteEnds.keys()) {
      if (key.startsWith(prefix)) streamByteEnds.delete(key);
    }
  }

  function acceptCanonicalDelta(
    sessionId: string,
    state: SessionChatState,
    payload: any,
  ): { delta: string; error: string } {
    const streamKey = streamIdentityKey(sessionId, state, payload);
    if (!streamKey) {
      return { delta: '', error: 'assistant stream identity does not match the active execution/turn/part' };
    }
    const text = String(payload.text || payload.content || '');
    const start = Number(payload.start_bytes);
    const end = Number(payload.end_bytes);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      return { delta: '', error: 'assistant stream has an invalid or missing canonical byte range' };
    }
    const encoded = new TextEncoder().encode(text);
    if (end - start !== encoded.byteLength) {
      return { delta: '', error: 'assistant stream byte range does not match its UTF-8 payload' };
    }
    const consumed = streamByteEnds.get(streamKey) || 0;
    if (start > consumed) {
      return { delta: '', error: 'assistant stream byte range gap' };
    }
    if (end <= consumed) return { delta: '', error: '' };
    const overlap = Math.max(0, consumed - start);
    streamByteEnds.set(streamKey, end);
    return { delta: new TextDecoder().decode(encoded.slice(overlap)), error: '' };
  }

  function serializeAttachment<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = attachmentFlights.get(sessionId) || Promise.resolve();
    const flight = previous.catch(() => undefined).then(operation);
    attachmentFlights.set(sessionId, flight);
    return flight.finally(() => {
      if (attachmentFlights.get(sessionId) === flight) attachmentFlights.delete(sessionId);
    });
  }

  function recordProgress(sessionId: string) {
    const state = stateFor(sessionId);
    const now = Date.now();
    state.lastEventAtMs = now;
    state.lastProgressAtMs = now;
    if (activeSessionId.value !== sessionId) state.unread += 1;
  }

  function matchesActiveExecution(state: SessionChatState, payload: any) {
    return !!state.executionId
      && typeof payload?.execution_id === 'string'
      && payload.execution_id === state.executionId;
  }

  function belongsToActiveExecution(state: SessionChatState, payload: any) {
    if (!state.executionId) return false;
    return payload?.execution_id === state.executionId
      || payload?.parent_execution_id === state.executionId;
  }

  function belongsToActiveTurn(state: SessionChatState, payload: any) {
    if (!state.executionId) return true;
    if (belongsToActiveExecution(state, payload)) return true;
    const payloadTurnId = String(payload?.turn_id || '').trim();
    const activeTurnId = state.executionTurnId.trim();
    return !!payloadTurnId && !!activeTurnId && payloadTurnId === activeTurnId;
  }

  function ensureStreamTurn(state: SessionChatState) {
    if (!state.streamTurnId) return;
    if (!state.turns.some((turn) => turn.id === state.streamTurnId)) {
      state.turns.push({
        id: state.streamTurnId,
        role: 'assistant',
        content: '',
        status: 'streaming',
        execution_id: state.executionId,
        turn_id: state.executionTurnId,
      });
    }
  }

  function upsertSessionActivity(sessionId: string, event: ActivityEvent) {
    const state = stateFor(sessionId);
    const normalized = normalizeTurnActivity(event);
    const identity = activityIdentityKey(normalized);
    const index = state.activity.findIndex((item) => activityIdentityKey(item) === identity);
    if (index >= 0) {
      state.activity.splice(index, 1, mergeActivityEvent(state.activity[index], normalized));
    }
    else state.activity.push(normalized);
    state.activity = causalActivityTimeline(state.activity, SESSION_ACTIVITY_CAP);
    ensureStreamTurn(state);
    const turn = state.turns.find((item) => item.id === state.streamTurnId);
    if (turn) {
      const activity = [...(turn.activity || [])];
      const turnIndex = activity.findIndex((item) => activityIdentityKey(item) === identity);
      if (turnIndex >= 0) {
        activity.splice(turnIndex, 1, mergeActivityEvent(activity[turnIndex], normalized));
      }
      else activity.push(normalized);
      turn.activity = causalActivityTimeline(activity, TURN_ACTIVITY_CAP);
    }
  }

  function projectLiveActivity(sessionId: string, payload: any) {
    const state = stateFor(sessionId);
    const type = String(payload.type || '');
    const payloadExecutionId = String(payload.execution_id || '');
    if (
      payloadExecutionId
      && state.executionId
      && !belongsToActiveTurn(state, payload)
      && type !== 'UserMessageCommitted'
    ) {
      return;
    }
    const executionId = String(payloadExecutionId || state.executionId || 'pending');
    const nestedExecution = !!state.executionId && executionId !== state.executionId;
    const modelStepId = String(payload.model_step_id || '');
    const itemId = String(payload.item_id || '');
    const segmentId = String(payload.segment_id || '');
    const toolId = String(payload.tool_call_id || payload.tool_instance_id || payload.id || '');
    const causalItemKey = segmentId || itemId || modelStepId;
    const scopedActivityId = (activityId: string) => (
      nestedExecution ? `${executionId}:${activityId}` : activityId
    );
    const base = {
      at: Date.now(),
      sequence: payload.causal_sequence ?? payload.runtime_commit_cursor,
      session_id: String(payload.session_id || sessionId),
      execution_id: String(payload.execution_id || ''),
      parent_execution_id: String(payload.parent_execution_id || ''),
      graph_id: String(payload.graph_id || ''),
      node_id: String(payload.node_id || ''),
      team_id: String(payload.team_id || ''),
      agent_id: String(payload.agent_id || ''),
      turn_id: String(payload.turn_id || ''),
      model_step_id: modelStepId,
      item_id: itemId,
      segment_id: segmentId,
      tool_call_id: toolId,
      causal_sequence: Number(payload.causal_sequence),
      delta_sequence: Number(payload.delta_sequence),
      causal_parent_ids: Array.isArray(payload.causal_parent_ids)
        ? payload.causal_parent_ids.map(String)
        : [],
      commit_cursor: Number(payload.runtime_commit_cursor),
      event_kind: type,
      raw: payload,
    };
    if (type === 'SessionInputReceived') {
      const receipt = payload.receipt || {};
      const inputId = String(receipt.input_id || payload.input_id || '');
      upsertSessionActivity(sessionId, {
        ...base,
        id: `session-input:${inputId || executionId}`,
        kind: 'runtime',
        title: t('chat.input.received'),
        detail: compactToolOutput(receipt.reason || receipt.decision || receipt.status),
        status: String(receipt.status || 'pending'),
        turn_id: String(receipt.active_turn_id || payload.turn_id || state.executionTurnId || ''),
        input: receipt,
        refs: Array.isArray(receipt.evidence_refs) ? receipt.evidence_refs.map(String) : [],
      });
      return;
    }
    if (type === 'SessionInputProjection') {
      const projection = payload.projection || {};
      upsertSessionActivity(sessionId, {
        ...base,
        id: `session-input-projection:${executionId}`,
        kind: 'runtime',
        title: t('chat.input.projection'),
        detail: `${Number(projection.pending_count || 0)} pending · ${Number(projection.consumed_count || 0)} consumed`,
        status: Number(projection.pending_count || 0) > 0 ? 'running' : 'complete',
        turn_id: String(projection.active_turn_id || payload.turn_id || state.executionTurnId || ''),
        input: projection.inputs,
        output: {
          total: projection.total,
          pending_count: projection.pending_count,
          queued_next_count: projection.queued_next_count,
          consumed_count: projection.consumed_count,
          last_decision: projection.last_decision,
        },
      });
      return;
    }
    if (type === 'TurnInboxUpdated') {
      const inbox = payload.inbox || {};
      upsertSessionActivity(sessionId, {
        ...base,
        id: `turn-inbox:${String(inbox.turn_id || state.executionTurnId || executionId)}`,
        kind: 'runtime',
        title: t('chat.input.inbox'),
        detail: `${Number(inbox.pending_count || 0)} pending · ${Number(inbox.consumed_count || 0)} consumed`,
        status: Number(inbox.pending_count || 0) > 0 ? 'running' : 'complete',
        turn_id: String(inbox.turn_id || payload.turn_id || state.executionTurnId || ''),
        input: inbox.items,
        output: {
          pending_count: inbox.pending_count,
          consumed_count: inbox.consumed_count,
          admitted_cursor: inbox.admitted_cursor,
          consumed_cursor: inbox.consumed_cursor,
        },
      });
      return;
    }
    if (type === 'TurnInputCheckpointConsumed') {
      const consumed = Array.isArray(payload.consumed) ? payload.consumed : [];
      for (const item of consumed) {
        const inputId = String(item?.input_id || '');
        upsertSessionActivity(sessionId, {
          ...base,
          id: `session-input:${inputId || executionId}`,
          kind: 'runtime',
          title: t('chat.input.consumed'),
          detail: compactToolOutput(item?.content_preview || payload.checkpoint),
          status: 'complete',
          turn_id: String(payload.turn_id || state.executionTurnId || ''),
          input: item,
          output: { checkpoint: payload.checkpoint, consumed: true },
        });
      }
      return;
    }
    if (type === 'AgentLifecycle') {
      const runId = String(payload.run_id || executionId || payload.agent_id || 'agent');
      const phase = String(payload.phase || payload.status || 'running');
      const role = String(payload.role || '').trim();
      const agentId = String(payload.agent_id || base.agent_id || runId);
      upsertSessionActivity(sessionId, {
        ...base,
        id: `agent:${runId}:${phase}`,
        kind: 'agent',
        title: role || agentId || t('chat.activity.agent'),
        detail: compactToolOutput(payload.summary),
        status: String(payload.status || phase),
        phase,
        role,
        agent_id: agentId,
        output: ['completed', 'failed', 'cancelled', 'blocked'].includes(phase)
          ? payload.summary
          : undefined,
      });
      return;
    }
    if (type === 'ToolStart' || type === 'ToolProgress' || type === 'ToolComplete') {
      const failed = type === 'ToolComplete' && Number(payload.exit_code || 0) !== 0;
      const activityId = toolId || causalItemKey || `tool:${executionId}:${payload.name || 'unknown'}`;
      upsertSessionActivity(sessionId, {
        ...base,
        id: scopedActivityId(activityId),
        kind: failed ? 'error' : 'tool',
        title: String(payload.name || 'tool'),
        detail: compactToolOutput(payload.preview || payload.progress || payload.summary),
        status: failed ? 'error' : type === 'ToolComplete' ? 'complete' : 'running',
        input: type === 'ToolStart' ? payload.input : undefined,
        output: type === 'ToolComplete' ? (payload.output ?? payload.summary) : undefined,
      });
      return;
    }
    if (type === 'ModelStepStarted' || type === 'ModelStepCompleted') {
      upsertSessionActivity(sessionId, {
        ...base,
        id: modelStepId || `model-step:${executionId}`,
        kind: 'runtime',
        title: t('chat.activity.executionPhase'),
        detail: '',
        status: type === 'ModelStepCompleted' ? String(payload.status || 'complete') : 'running',
      });
      return;
    }
    if (type === 'ItemStarted' || type === 'ItemCompleted') {
      const kind = String(payload.kind || '');
      if (kind === 'public_reasoning') {
        if (!causalItemKey) return;
        upsertSessionActivity(sessionId, {
          ...base,
          id: causalItemKey,
          kind: 'think',
          title: t('chat.activity.thinking'),
          detail: '',
          status: type === 'ItemCompleted' ? 'complete' : 'running',
        });
      } else if (kind === 'tool_call' && type === 'ItemCompleted' && toolId) {
        let input: unknown = payload.tool_input;
        if (typeof input === 'string') {
          try {
            input = JSON.parse(input);
          } catch {
            // Plain-text tool inputs remain displayable without inventing structure.
          }
        }
        upsertSessionActivity(sessionId, {
          ...base,
          id: scopedActivityId(toolId),
          kind: 'tool',
          title: String(payload.tool_name || 'tool'),
          detail: '',
          status: 'queued',
          input,
        });
      }
      return;
    }
    if (type === 'ToolExecuted') {
      const state = stateFor(sessionId);
      const matching = [...state.activity]
        .reverse()
        .find((event) => (
          (event.kind === 'tool' || event.kind === 'error')
          && event.title === String(payload.name || 'tool')
          && event.execution_id === String(payload.execution_id || '')
          && event.duration_ms === undefined
        ));
      upsertSessionActivity(sessionId, {
        ...base,
        id: matching?.id || scopedActivityId(`tool-executed:${executionId}:${payload.name || toolId}`),
        kind: 'tool',
        title: String(payload.name || 'tool'),
        detail: matching?.detail || '',
        status: 'complete',
        duration_ms: Number.isFinite(Number(payload.duration_ms))
          ? Number(payload.duration_ms)
          : undefined,
      });
      return;
    }
    if (type === 'ReasoningSummaryDelta') {
      if (!causalItemKey) return;
      const id = causalItemKey;
      const previous = stateFor(sessionId).activity.find((event) => event.id === id);
      const delta = String(payload.summary || '');
      const incomingDeltaSequence = Number(payload.delta_sequence);
      if (
        previous
        && Number.isFinite(Number(previous.delta_sequence))
        && incomingDeltaSequence <= Number(previous.delta_sequence)
      ) return;
      upsertSessionActivity(sessionId, {
        ...base,
        id,
        kind: 'think',
        title: t('chat.activity.thinking'),
        detail: appendReasoningSummary(previous?.detail || '', delta),
        status: 'running',
      });
      return;
    }
    if (type === 'ExecutionPhase') {
      upsertSessionActivity(sessionId, {
        ...base,
        id: `phase:${executionId}:${String(payload.status || 'running')}`,
        kind: 'runtime',
        title: t('chat.activity.executionPhase'),
        detail: compactToolOutput(payload.detail),
        status: String(payload.status || 'running'),
      });
      return;
    }
    if (type === 'ProviderAttempt') {
      upsertSessionActivity(sessionId, {
        ...base,
        id: `provider:${executionId}:${payload.model || 'model'}`,
        kind: 'context',
        title: String(payload.model || 'Provider'),
        detail: payload.context_window_tokens
          ? `${Number(payload.packed_input_tokens || 0).toLocaleString()} / ${Number(payload.context_window_tokens).toLocaleString()} tokens`
          : '',
        status: 'running',
      });
      return;
    }
    if (type === 'ContextEnvelope') {
      upsertSessionActivity(sessionId, {
        ...base,
        id: `context:${executionId}`,
        kind: 'context',
        title: t('chat.activity.contextPrepared'),
        detail: compactToolOutput(payload.envelope?.summary || payload.summary),
        status: 'complete',
      });
      return;
    }
    if (type === 'RuntimePolicyDecision') {
      upsertSessionActivity(sessionId, {
        ...base,
        id: `policy:${executionId}`,
        kind: 'runtime',
        title: t('chat.activity.runtimePolicy'),
        detail: compactToolOutput(payload.summary || payload.decision),
        status: String(payload.status || 'observed'),
      });
      return;
    }
    if (type === 'ApprovalRequested' || type === 'ApprovalResolved') {
      upsertSessionActivity(sessionId, {
        ...base,
        id: `approval:${String(payload.request_id || payload.approval_id || payload.id || executionId)}`,
        kind: 'approval',
        title: String(payload.action || t('chat.approval.title')),
        detail: compactToolOutput(payload.summary),
        status: type === 'ApprovalRequested' ? 'pending' : String(payload.status || 'resolved'),
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cowd:approval-changed', {
          detail: { sessionId, type },
        }));
      }
    }
  }

  function requestCanonicalResync(sessionId: string, reason: string) {
    const state = stateFor(sessionId);
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    deltaBuffers.delete(sessionId);
    state.resyncCount += 1;
    state.streamState = 'degraded';
    state.degradedReason = reason;
    state.lastError = reason;
    if (canonicalResyncFlights.has(sessionId)) return;
    let flight!: Promise<void>;
    flight = (async () => {
      // Recover from the cheapest canonical source first. A transient preview
      // gap should not immediately fan out into history, live and graph loads.
      try {
        if (await refreshLiveExecution(sessionId)) return;
      } catch {
        // Escalate to the next canonical layer.
      }
      try {
        if (await refreshProjection(sessionId)) return;
      } catch {
        // Durable history is the final recovery boundary.
      }
      await load(sessionId);
      const current = stateFor(sessionId);
      if (
        hasDurableAssistantForExecution(
          current,
          current.executionId,
          current.executionTurnId,
        )
      ) {
        current.streamState = 'connected';
        current.degradedReason = '';
        if (current.lastError === reason) current.lastError = '';
      }
    })().finally(() => {
      if (canonicalResyncFlights.get(sessionId) === flight) {
        canonicalResyncFlights.delete(sessionId);
      }
    });
    canonicalResyncFlights.set(sessionId, flight);
  }

  function isCurrentStream(sessionId: string, stream: SessionLiveSource, generation: number) {
    const state = states[sessionId];
    return !!state
      && !state.reconnectBlocked
      && state.streamGeneration === generation
      && sourceLeases.get(sessionId) === stream;
  }

  function closeSessionStream(sessionId: string, expected?: SessionLiveSource) {
    const current = sourceLeases.get(sessionId);
    if (expected && current !== expected) return;
    current?.close();
    sourceLeases.delete(sessionId);
    activeSourceCount.value = sourceLeases.size;
  }

  function clearSessionAuthorizationState(
    sessionId: string,
    stream: SessionLiveSource | undefined,
    reason: string,
  ) {
    const state = stateFor(sessionId);
    closeSessionStream(sessionId, stream);
    state.streamGeneration += 1;
    state.loadEpoch += 1;
    state.submissionEpoch += 1;
    state.attachmentEpoch += 1;
    state.reconnectBlocked = true;
    state.streamState = 'degraded';
    state.lastError = `session authorization revoked: ${reason}`;
    state.degradedReason = state.lastError;
    state.pending = false;
    state.submitting = false;
    state.writable = false;
    state.attachmentRole = 'detached';
    clearPresenceHeartbeat(sessionId);
    state.turns = [];
    state.activity = [];
    state.live = null;
    state.executionId = '';
    state.executionGraphId = '';
    state.executionTurnId = '';
    state.streamTurnId = '';
    state.terminalId = '';
    state.latestIngressSequence = -1;
    state.runtimeCommitCursor = 0;
    state.historyTotal = 0;
    state.historyNextSequence = 0;
    state.historyOldestOffset = 0;
    state.historyWindowEndOffset = 0;
    state.historyHasOlder = false;
    state.historyHasNewer = false;
    state.historyLoading = false;
    state.historyIndex = null;
    state.historyIndexLoading = false;
    state.historyIndexLoaded = false;
    state.scrollInitialized = false;
    state.executionIndexLoading = false;
    state.executionIndexLoaded = false;
    state.detailsLoading = false;
    state.detailsLoaded = false;
    projections.revokeSessionAuthorization(sessionId, reason);
    projections.release(`chat:${sessionId}`);
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    deltaBuffers.delete(sessionId);
    clearStreamByteEnds(sessionId);
    stopProgressRecovery(sessionId);
  }

  function failClosedSessionAuthorization(sessionId: string, stream: SessionLiveSource | undefined, reason: string) {
    invalidateSessionAuthorization(sessionId, reason);
    // CustomEvent delivery is synchronous in browsers. SSR and isolated store
    // tests have no window listener, so retain an explicit fail-closed path.
    if (!stateFor(sessionId).reconnectBlocked) {
      clearSessionAuthorizationState(sessionId, stream, reason);
    }
  }

  function failClosedAllSessionAuthorization(reason: string) {
    for (const state of Object.values(states)) {
      clearSessionAuthorizationState(state.sessionId, sourceLeases.get(state.sessionId), reason);
    }
  }

  function adoptExecution(
    sessionId: string,
    executionId: string,
    turnId = '',
    markPending = true,
    initialStatus?: SurfaceExecutionStatus,
  ) {
    const state = stateFor(sessionId);
    const next = executionId.trim();
    if (!next) return false;
    if (state.executionId === next) {
      if (turnId) state.executionTurnId = turnId;
      if (markPending) state.pending = true;
      if (state.pending) ensureStreamTurn(state);
      if (state.pending) ensureProgressRecovery(sessionId);
      return false;
    }
    projections.release(`chat:${sessionId}`);
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    deltaBuffers.delete(sessionId);
    clearStreamByteEnds(sessionId);
    const previousStreamTurn = state.streamTurnId
      ? state.turns.find((turn) => turn.id === state.streamTurnId)
      : undefined;
    if (state.streamTurnId) {
      state.turns = state.turns.filter((turn) => turn.id !== state.streamTurnId || !!turn.content);
    }
    state.executionId = next;
    state.executionGraphId = '';
    state.executionTurnId = turnId;
    state.executionGeneration += 1;
    state.terminalId = '';
    state.streamTurnId = `stream:${sessionId}:${next}`;
    state.pending = markPending;
    state.live = {
      status: initialStatus || (markPending ? 'queued' : 'complete'),
      status_detail: 'execution adopted from canonical session stream',
      last_progress_at_ms: Date.now(),
    };
    if (markPending) {
      ensureStreamTurn(state);
      const canonicalStreamTurn = state.turns.find((turn) => turn.id === state.streamTurnId);
      if (canonicalStreamTurn && previousStreamTurn?.activity?.length) {
        canonicalStreamTurn.activity = mergeActivityTimeline(
          canonicalStreamTurn.activity || [],
          previousStreamTurn.activity,
        );
      }
      if (canonicalStreamTurn && previousStreamTurn?.content) {
        canonicalStreamTurn.content = previousStreamTurn.content;
      }
    }
    if (markPending) ensureProgressRecovery(sessionId);
    return true;
  }

  function adoptExecutionGraph(sessionId: string, graphId: string, hydrateProjection = true) {
    const state = stateFor(sessionId);
    const next = graphId.trim();
    if (!next) return false;
    if (state.executionGraphId === next) {
      if (hydrateProjection) {
        projections.acquire(next, `chat:${sessionId}`, 'summary', 'bounded', sessionId);
        refreshProjection(sessionId).catch(() => undefined);
      }
      return false;
    }
    projections.release(`chat:${sessionId}`);
    state.executionGraphId = next;
    if (hydrateProjection) {
      projections.acquire(next, `chat:${sessionId}`, 'summary', 'bounded', sessionId);
      refreshProjection(sessionId).catch(() => undefined);
    }
    return true;
  }

  function executionProjectionId(state: SessionChatState) {
    return state.executionGraphId || state.executionId;
  }

  async function hydrateExecutionProjection(
    sessionId: string,
    scope: 'summary' | 'full' = 'summary',
  ) {
    const state = stateFor(sessionId);
    const projectionId = executionProjectionId(state);
    if (!projectionId) return false;
    projections.acquire(
      projectionId,
      `chat:${sessionId}`,
      scope,
      'bounded',
      sessionId,
    );
    return refreshProjection(sessionId, scope);
  }

  async function load(sessionId: string) {
    const state = stateFor(sessionId);
    const epoch = ++state.loadEpoch;
    executionIndexFlights.delete(sessionId);
    state.historyLoading = true;
    state.executionIndexLoading = false;
    state.executionIndexLoaded = false;
    state.detailsLoaded = false;
    state.historyIndexLoading = true;
    state.historyIndexLoaded = false;
    void api.sessionHistoryIndex(sessionId)
      .then((projection) => {
        if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
        const identityIssue = sessionEnvelopeIdentityIssue(projection, sessionId, 'history index');
        if (identityIssue) {
          state.lastError = identityIssue;
          state.degradedReason = identityIssue;
          return;
        }
        const issue = readIssue(projection, 'history index');
        if (issue) {
          state.lastError = issue;
          state.degradedReason = issue;
          return;
        }
        state.historyIndex = projection;
        state.historyIndexLoaded = true;
        state.historyTotal = Math.max(state.historyTotal, Number(projection.total_messages || 0));
        state.historyHasOlder = state.historyOldestOffset > 0
          || state.historyTotal > state.turns.length;
        state.runtimeCommitCursor = Math.max(
          state.runtimeCommitCursor,
          Number(projection.durable_cursor || 0),
        );
      })
      .catch((error) => {
        if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
        state.lastError = String((error as any)?.message || error || 'history index request failed');
        state.degradedReason = state.lastError;
      })
      .finally(() => {
        if (state.loadEpoch === epoch) state.historyIndexLoading = false;
      });
    let data: Awaited<ReturnType<typeof api.messages>>;
    try {
      data = await api.messages(sessionId, { limit: HISTORY_PAGE_SIZE, tail: true });
    } catch (error) {
      if (state.loadEpoch === epoch && !state.reconnectBlocked) {
        state.lastError = String((error as any)?.message || error || 'history request failed');
        state.degradedReason = state.lastError;
        state.streamState = 'degraded';
      }
      return;
    } finally {
      if (state.loadEpoch === epoch) state.historyLoading = false;
    }
    if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
    const identityIssue = messagesIdentityIssue(data, sessionId, 'history');
    if (identityIssue) {
      state.streamState = 'degraded';
      state.lastError = identityIssue;
      state.degradedReason = state.lastError;
      return;
    }
    const issue = readIssue(data, 'history');
    if (issue) {
      state.lastError = issue;
      state.degradedReason = state.lastError;
      if (!data.messages?.length && String(data.__state || '') !== 'stale') {
        state.streamState = 'degraded';
      }
    } else if (!state.pending) {
      state.lastError = '';
      state.degradedReason = '';
    }
    drainPendingDelta(sessionId);
    const streaming = state.turns.find((turn) => turn.id === state.streamTurnId && turn.content);
    const durableTurns = normalizeTurns(data.messages);
    const durableActivity = durableTurns.flatMap((turn) => turn.activity || []);
    const liveById = new Map(state.activity.map((event) => [activityIdentityKey(event), event]));
    durableActivity.forEach((event) => {
      const identity = activityIdentityKey(event);
      liveById.set(identity, mergeActivityEvent(liveById.get(identity), event));
    });
    state.activity = causalActivityTimeline([...liveById.values()], SESSION_ACTIVITY_CAP);
    const durableOwnsStreamingIdentity = !!streaming && durableTurns.some((turn) => (
      turn.role === 'assistant'
      && (
        (!!streaming.execution_id && turn.execution_id === streaming.execution_id)
        || (!!streaming.turn_id && turn.turn_id === streaming.turn_id)
        || (
          !state.pending
          && !!streaming.content.trim()
          && turn.content.trim() === streaming.content.trim()
        )
      )
    ));
    state.turns = durableTurns;
    const total = Math.max(0, Number(data.total || 0));
    const offset = Math.max(0, Number(data.offset ?? total - (data.messages || []).length));
    state.historyTotal = Math.max(
      total,
      Number(data.total || 0),
      Number(state.historyIndex?.total_messages || 0),
    );
    state.historyNextSequence = Math.max(
      Number(data.next_seq || 0),
      ...((data.messages || [])
        .map((message: any) => Number(message.sequence) + 1)
        .filter(Number.isFinite)),
    );
    state.historyOldestOffset = Number(data.offset ?? offset);
    state.historyWindowEndOffset = state.historyOldestOffset + (data.messages || []).length;
    state.historyHasOlder = state.historyOldestOffset > 0;
    state.historyHasNewer = state.historyWindowEndOffset < state.historyTotal;
    state.latestIngressSequence = Math.max(
      state.latestIngressSequence,
      ...(data.messages || [])
        .filter((message: any) => message?.role === 'user')
        .map((message: any) => Number(message.sequence))
        .filter(Number.isFinite),
    );
    if (streaming) {
      const streamingStillCurrent = (
        (!streaming.execution_id || streaming.execution_id === state.executionId)
        && (!streaming.turn_id || !state.executionTurnId || streaming.turn_id === state.executionTurnId)
      );
      // `adoptExecution` may have created a fresh empty placeholder after the
      // durable snapshot was installed. It is not proof that the live content
      // was materialized, so resolve the merge only by causal identity.
      state.turns = state.turns.filter((turn) => (
        turn.id !== state.streamTurnId || !!turn.content
      ));
      if (!durableOwnsStreamingIdentity && streamingStillCurrent) {
        state.turns.push({ ...streaming, id: state.streamTurnId });
      }
    }
    if (state.executionId) {
      if (state.pending && !durableOwnsStreamingIdentity) ensureStreamTurn(state);
      refreshLiveExecution(sessionId).catch(() => undefined);
    }
  }

  function refreshDetailState(state: SessionChatState) {
    state.detailsLoading = state.executionIndexLoading;
    state.detailsLoaded = state.executionIndexLoaded;
  }

  async function hydrateExecutionIndex(sessionId: string, includeProjection = false) {
    const state = stateFor(sessionId);
    const epoch = state.loadEpoch;
    const existing = executionIndexFlights.get(sessionId);
    if (existing) {
      await existing;
      if (includeProjection && state.loadEpoch === epoch) {
        await hydrateExecutionProjection(sessionId, 'full');
      }
      return;
    }
    if (state.executionIndexLoaded) {
      if (includeProjection) await hydrateExecutionProjection(sessionId, 'full');
      return;
    }

    state.executionIndexLoading = true;
    refreshDetailState(state);
    let flight!: Promise<void>;
    flight = api.sessionExecution(sessionId)
      .then(async (execution) => {
        if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
        const identityIssue = sessionEnvelopeIdentityIssue(execution, sessionId, 'execution');
        if (identityIssue) {
          state.streamState = 'degraded';
          state.lastError = identityIssue;
          state.degradedReason = state.lastError;
          return;
        }
        const issue = readIssue(execution, 'execution');
        if (issue) {
          state.lastError = issue;
          state.degradedReason = state.lastError;
          return;
        }

        state.executionIndex = execution;
        const recoveredExecutionId = String(execution.latest_execution_id || '');
        const recoveredGraphId = String(execution.latest_graph_id || '');
        const recoveredActive = (execution.active_execution_ids || []).includes(recoveredExecutionId);
        const recoveredStatus = String(execution.latest_status || '');
        const currentStillMaterializing = state.pending
          && !!state.executionId
          && state.executionId !== recoveredExecutionId;
        if (recoveredExecutionId && (!currentStillMaterializing || recoveredActive)) {
          adoptExecution(
            sessionId,
            recoveredExecutionId,
            String((execution as any).turn_id || state.executionTurnId || ''),
            recoveredActive || !['complete', 'error', 'cancelled'].includes(recoveredStatus),
            recoveredStatus as SurfaceExecutionStatus || undefined,
          );
        }
        if (recoveredGraphId) adoptExecutionGraph(sessionId, recoveredGraphId, includeProjection);
        if (includeProjection) await hydrateExecutionProjection(sessionId, 'full');
        if (state.executionId) refreshLiveExecution(sessionId).catch(() => undefined);
        state.executionIndexLoaded = true;
      })
      .finally(() => {
        if (state.loadEpoch === epoch) {
          state.executionIndexLoading = false;
          refreshDetailState(state);
        }
        if (executionIndexFlights.get(sessionId) === flight) executionIndexFlights.delete(sessionId);
      });
    executionIndexFlights.set(sessionId, flight);
    await flight;
  }

  async function hydrateRuntimeDetails(sessionId: string, includeProjection = false) {
    await hydrateExecutionIndex(sessionId, includeProjection);
  }

  async function loadOlder(sessionId: string) {
    const state = stateFor(sessionId);
    if (state.reconnectBlocked || state.historyLoading || !state.historyHasOlder) return;
    const epoch = state.loadEpoch;
    state.historyLoading = true;
    const nextOffset = Math.max(0, state.historyOldestOffset - HISTORY_PAGE_SIZE);
    try {
      const page = await api.messages(sessionId, {
        offset: nextOffset,
        limit: state.historyOldestOffset - nextOffset,
      });
      if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
      const issue = readIssue(page, 'older history')
        || messagesIdentityIssue(page, sessionId, 'older history');
      if (issue) {
        state.lastError = issue;
        state.degradedReason = issue;
        return;
      }
      const merged = mergeTurns(normalizeTurns(page.messages), state.turns);
      state.turns = merged.length > HISTORY_WINDOW_CAP
        ? merged.slice(0, HISTORY_WINDOW_CAP)
        : merged;
      state.historyTotal = Math.max(state.historyTotal, Number(page.total || 0));
      state.historyOldestOffset = nextOffset;
      state.historyWindowEndOffset = Math.min(state.historyTotal, nextOffset + state.turns.length);
      state.historyHasOlder = nextOffset > 0;
      state.historyHasNewer = state.historyWindowEndOffset < state.historyTotal;
    } catch (error) {
      if (state.loadEpoch === epoch && !state.reconnectBlocked) {
        state.lastError = String((error as any)?.message || error || 'older history request failed');
        state.degradedReason = state.lastError;
      }
    } finally {
      if (state.loadEpoch === epoch) state.historyLoading = false;
    }
  }

  async function loadLatest(sessionId: string) {
    await load(sessionId);
  }

  async function syncTranscriptTail(sessionId: string) {
    const state = stateFor(sessionId);
    const existing = transcriptSyncFlights.get(sessionId);
    if (existing) return existing;
    const epoch = state.loadEpoch;
    let flight!: Promise<void>;
    flight = (async () => {
      let nextSequence = Math.max(
        0,
        state.historyNextSequence,
        ...state.turns
          .map((turn) => Number(turn.sequence) + 1)
          .filter(Number.isFinite),
      );
      for (;;) {
        const page = await api.messages(sessionId, {
          fromSeq: nextSequence,
          limit: 500,
        });
        if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
        const issue = readIssue(page, 'transcript tail')
          || messagesIdentityIssue(page, sessionId, 'transcript tail');
        if (issue) {
          state.lastError = issue;
          state.degradedReason = issue;
          return;
        }

        const durableTurns = normalizeTurns(page.messages);
        const durableActivity = durableTurns.flatMap((turn) => turn.activity || []);
        state.activity = mergeActivityTimeline(state.activity, durableActivity);
        state.turns = mergeTurns(state.turns, durableTurns);

        const streamTurn = state.turns.find((turn) => turn.id === state.streamTurnId);
        if (streamTurn && durableTurns.some((turn) => (
          turn.role === 'assistant'
          && (
            (!!streamTurn.execution_id && turn.execution_id === streamTurn.execution_id)
            || (!!streamTurn.turn_id && turn.turn_id === streamTurn.turn_id)
            || (
              !state.pending
              && !!streamTurn.content.trim()
              && turn.content.trim() === streamTurn.content.trim()
            )
          )
        ))) {
          state.turns = state.turns.filter((turn) => turn.id !== state.streamTurnId);
        }
        if (state.turns.length > HISTORY_WINDOW_CAP) {
          state.turns = state.turns.slice(-HISTORY_WINDOW_CAP);
        }

        const responseNext = Number(page.next_seq);
        const observedNext = Math.max(
          nextSequence,
          ...page.messages
            .map((message: any) => Number(message.sequence) + 1)
            .filter(Number.isFinite),
        );
        const advancedNext = Number.isFinite(responseNext)
          ? Math.max(observedNext, responseNext)
          : observedNext;
        state.historyNextSequence = Math.max(state.historyNextSequence, advancedNext);
        state.historyTotal = Math.max(state.historyTotal, Number(page.total || 0));
        state.historyWindowEndOffset = state.historyTotal;
        state.historyOldestOffset = Math.max(0, state.historyTotal - state.turns.length);
        state.historyHasOlder = state.historyOldestOffset > 0;
        state.historyHasNewer = false;
        state.latestIngressSequence = Math.max(
          state.latestIngressSequence,
          ...page.messages
            .filter((message: any) => message?.role === 'user')
            .map((message: any) => Number(message.sequence))
            .filter(Number.isFinite),
        );

        if (!page.has_more) return;
        if (advancedNext <= nextSequence) {
          state.lastError = 'transcript tail cursor did not advance';
          state.degradedReason = state.lastError;
          return;
        }
        nextSequence = advancedNext;
      }
    })().finally(() => {
      if (transcriptSyncFlights.get(sessionId) === flight) {
        transcriptSyncFlights.delete(sessionId);
      }
    });
    transcriptSyncFlights.set(sessionId, flight);
    return flight;
  }

  async function applyRecoveredLive(
    sessionId: string,
    executionId: string,
    recoveredLive: LiveExecutionState,
  ): Promise<boolean> {
    const state = stateFor(sessionId);
    if (!state.executionId || executionId !== state.executionId) return false;
    let streamRecovered = state.streamState !== 'degraded';
    state.live = recoveredLive;
    const projectionStatus = String(recoveredLive.status || '');
    const terminalProjection = ['complete', 'error', 'cancelled'].includes(projectionStatus);
    const durableAssistantPresent = hasDurableAssistantForExecution(
      state,
      state.executionId,
      state.executionTurnId || String(recoveredLive.turn_id || ''),
    );
    const outputBytes = Number(recoveredLive.output_bytes);
    const outputParts = [...(recoveredLive.output_parts || [])]
      .sort((left, right) => Number(left.causal_sequence) - Number(right.causal_sequence));
    if (outputParts.length > 0) {
      const recoveredText: string[] = [];
      let recoveredBytes = 0;
      let valid = true;
      for (const part of outputParts) {
        const partId = String(part.part_id || '').trim();
        const partBytes = Number(part.bytes || 0);
        const previewStart = Number(part.preview_start_bytes || 0);
        const preview = typeof part.preview === 'string'
          ? part.preview
          : (partBytes === 0 && previewStart === 0 ? '' : null);
        const previewBytes = preview === null
          ? -1
          : new TextEncoder().encode(preview).byteLength;
        if (
          !partId
          || !Number.isFinite(partBytes)
          || partBytes < 0
          || !Number.isFinite(previewStart)
          || previewStart < 0
          || previewStart > partBytes
          || previewBytes !== partBytes - previewStart
        ) {
          valid = false;
          break;
        }
        const streamKey = streamIdentityKey(sessionId, state, {
          execution_id: state.executionId,
          turn_id: state.executionTurnId || recoveredLive.turn_id,
          part_id: partId,
        });
        if (streamKey) streamByteEnds.set(streamKey, partBytes);
        recoveredBytes += partBytes;
        recoveredText.push(previewStart > 0
          ? `[${previewStart} earlier output bytes omitted during recovery]\n${preview}`
          : preview || '');
      }
      if (valid && (!Number.isFinite(outputBytes) || outputBytes === recoveredBytes)) {
        if (terminalProjection && durableAssistantPresent) {
          state.turns = state.turns.filter((turn) => turn.id !== state.streamTurnId);
        } else {
          ensureStreamTurn(state);
          const turn = state.turns.find((item) => item.id === state.streamTurnId);
          if (turn) turn.content = recoveredText.join('');
        }
        streamRecovered = true;
      } else {
        state.streamState = 'degraded';
        state.degradedReason = 'canonical output parts do not cover their declared UTF-8 byte ranges';
        state.lastError = state.degradedReason;
        streamRecovered = false;
      }
    } else if (Number.isFinite(outputBytes) && outputBytes > 0) {
      state.streamState = 'degraded';
      state.degradedReason = 'canonical output projection is missing Runtime-owned output parts';
      state.lastError = state.degradedReason;
      streamRecovered = false;
    }
    if (streamRecovered) {
      state.degradedReason = '';
      if (
        state.lastError.includes('assistant stream')
        || state.lastError.includes('canonical output')
      ) {
        state.lastError = '';
      }
      if (state.streamState === 'degraded') state.streamState = 'connected';
    }
    if (terminalProjection) {
      const wasPending = state.pending;
      state.pending = false;
      stopProgressRecovery(sessionId);
      if (wasPending) await syncTranscriptTail(sessionId);
      await releaseWriter(sessionId);
    }
    return streamRecovered;
  }

  async function refreshLiveExecution(sessionId: string): Promise<boolean> {
    const state = stateFor(sessionId);
    if (!state.executionId) return false;
    const update = await api.sessionExecutionLive(sessionId);
    if (
      String(update?.execution_id || '') === state.executionId
      && update?.live
    ) {
      return applyRecoveredLive(
        sessionId,
        state.executionId,
        update.live as LiveExecutionState,
      );
    }
    return false;
  }

  async function refreshProjection(
    sessionId: string,
    scope: 'summary' | 'full' = 'summary',
  ): Promise<boolean> {
    const state = stateFor(sessionId);
    const projectionId = executionProjectionId(state);
    if (!projectionId) return false;
    const projection = await projections.load(projectionId, scope, sessionId);
    if (projection?.execution_id === projectionId) {
      if (projection.live && projection.execution_id === state.executionId) {
        return applyRecoveredLive(
          sessionId,
          state.executionId,
          projection.live as LiveExecutionState,
        );
      }
    } else {
      const entry = projections.entries[projectionId];
      if (entry?.reconnectBlocked) {
        state.live = null;
        state.lastError = entry.lastError || 'execution projection authorization was revoked';
        state.degradedReason = state.lastError;
      }
      if (entry?.connectionState === 'degraded') {
        state.degradedReason = entry.degradedReason || entry.lastError;
      }
    }
    return false;
  }

  function stopProgressRecovery(sessionId: string) {
    const timer = progressRecoveryTimers.get(sessionId);
    if (timer) clearInterval(timer);
    progressRecoveryTimers.delete(sessionId);
    progressRecoveryFlights.delete(sessionId);
  }

  function ensureProgressRecovery(sessionId: string) {
    if (progressRecoveryTimers.has(sessionId)) return;
    const timer = setInterval(() => {
      const state = states[sessionId];
      if (
        !state
        || !state.pending
        || ['complete', 'cancelled', 'error', 'terminal'].includes(String(state.live?.status || ''))
      ) {
        stopProgressRecovery(sessionId);
        return;
      }
      const lastProgress = Math.max(
        state.lastProgressAtMs,
        state.lastEventAtMs,
        Number(state.live?.last_progress_at_ms || 0),
      );
      if (Date.now() - lastProgress < LIVE_RECOVERY_SILENCE_MS) return;
      if (progressRecoveryFlights.has(sessionId)) return;
      let flight!: Promise<void>;
      flight = (async () => {
        let recovered = false;
        try {
          recovered = await refreshLiveExecution(sessionId);
        } catch {
          // The execution projection is the next authoritative recovery source.
        }
        if (!recovered && state.executionGraphId) {
          try {
            await refreshProjection(sessionId);
          } catch {
            // Keep the Session stream primary and retry only after another silence window.
          }
        }
      })().finally(() => {
        if (progressRecoveryFlights.get(sessionId) === flight) {
          progressRecoveryFlights.delete(sessionId);
        }
      });
      progressRecoveryFlights.set(sessionId, flight);
    }, LIVE_RECOVERY_INTERVAL_MS);
    progressRecoveryTimers.set(sessionId, timer);
  }

  function connect(sessionId: string) {
    if (sourceLeases.has(sessionId)) return;
    const state = stateFor(sessionId);
    if (state.reconnectBlocked) return;
    state.streamState = 'connecting';
    state.degradedReason = '';
    const stream = openSessionLiveSource(sessionId, state.runtimeCommitCursor);
    const generation = ++state.streamGeneration;
    sourceLeases.set(sessionId, stream);
    activeSourceCount.value = sourceLeases.size;
    stream.onopen = () => {
      if (!isCurrentStream(sessionId, stream, generation)) return;
      // A physical EventSource can be open before a newly added Session
      // selector has crossed its source baseline barrier. Only that Session's
      // Connected envelope proves early Runtime events can no longer be lost.
      state.streamState = 'connecting';
      state.degradedReason = '';
      state.lastEventAtMs = Date.now();
    };
    stream.onerror = () => {
      if (!isCurrentStream(sessionId, stream, generation)) return;
      state.streamState = 'reconnecting';
      state.degradedReason = 'physical live transport is reconnecting';
    };
    stream.onmessage = (event) => {
      if (!isCurrentStream(sessionId, stream, generation)) return;
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        requestCanonicalResync(sessionId, 'session stream emitted invalid JSON');
        return;
      }
      if (
        ['TextDelta', 'ReasoningSummaryDelta', 'ItemStarted', 'ItemCompleted', 'ToolStart', 'ToolProgress', 'ToolComplete']
          .includes(String(payload.type || ''))
        && (
          typeof payload.model_step_id !== 'string'
          || !payload.model_step_id
          || typeof payload.item_id !== 'string'
          || !payload.item_id
          || typeof payload.segment_id !== 'string'
          || !payload.segment_id
          || !Number.isFinite(Number(payload.causal_sequence))
          || !Number.isFinite(Number(payload.delta_sequence))
        )
      ) {
        requestCanonicalResync(
          sessionId,
          `${String(payload.type || 'causal event')} is missing its Runtime causal item identity`,
        );
        return;
      }
      const eventType = String(payload.type || '');
      const receivedSessionId = typeof payload.session_id === 'string'
        ? payload.session_id
        : '';
      if (
        (SESSION_SCOPED_STREAM_EVENTS.has(eventType) && receivedSessionId !== sessionId)
        || (receivedSessionId && receivedSessionId !== sessionId)
      ) {
        state.streamState = 'degraded';
        requestCanonicalResync(
          sessionId,
          `${eventType || 'session event'} session identity mismatch: expected ${sessionId}, received ${receivedSessionId || 'missing'}`,
        );
        return;
      }
      state.lastEventAtMs = Date.now();
      if (state.streamState === 'connecting' || state.streamState === 'reconnecting') {
        state.streamState = 'connected';
        state.degradedReason = '';
      }
      const eventCursor = Number(
        payload.runtime_commit_cursor
          ?? (event as MessageEvent).lastEventId
          ?? state.runtimeCommitCursor,
      );
      if (Number.isFinite(eventCursor) && eventCursor >= state.runtimeCommitCursor) {
        state.runtimeCommitCursor = eventCursor;
      }
      if (payload.type === 'Connected') {
        state.streamState = 'connected';
        state.degradedReason = '';
        return;
      }
      if (payload.type === 'SessionAuthorizationRevoked') {
        failClosedSessionAuthorization(
          sessionId,
          stream,
          String(payload.reason || 'Gateway revoked this observer'),
        );
        return;
      }
      if (payload.type === 'session_stream_resync' || payload.type === 'RuntimeStreamLagged') {
        requestCanonicalResync(
          sessionId,
          `${String(payload.type)}: ${String(payload.reason || 'canonical replay required')}`,
        );
        return;
      }
      if (
        [
          'UserMessageCommitted',
          'TextDelta',
          'ExecutionPhase',
          'ExecutionGraphSummary',
          'TurnError',
          'TerminalCommitted',
        ].includes(String(payload.type || ''))
        && (typeof payload.execution_id !== 'string' || !payload.execution_id)
      ) {
        requestCanonicalResync(
          sessionId,
          `${String(payload.type || 'session event')} is missing its canonical execution identity`,
        );
        return;
      }
      if (
        payload.type === 'TextDelta'
        && (
          typeof payload.part_id !== 'string'
          || payload.part_id !== payload.segment_id
        )
      ) {
        requestCanonicalResync(
          sessionId,
          'TextDelta projection part does not match its Runtime segment identity',
        );
        return;
      }
      if (
        ['ToolStart', 'ToolProgress', 'ToolComplete'].includes(String(payload.type || ''))
        && (typeof payload.tool_call_id !== 'string' || !payload.tool_call_id)
      ) {
        requestCanonicalResync(
          sessionId,
          `${String(payload.type)} is missing its Runtime tool call identity`,
        );
        return;
      }
      projectLiveActivity(sessionId, payload);
      if (
        payload.type !== 'Connected'
        && payload.type !== 'UserMessageCommitted'
        && belongsToActiveTurn(state, payload)
      ) {
        recordProgress(sessionId);
      }
      if (payload.type === 'UserMessageCommitted') {
        const sequence = Number(payload.sequence);
        const supplemental = payload.supplemental === true;
        const executionId = supplemental
          ? (state.executionId || String(payload.execution_id || ''))
          : String(payload.execution_id || '');
        const turnId = supplemental
          ? (state.executionTurnId || String(payload.turn_id || ''))
          : String(payload.turn_id || '');
        if (executionId && (!Number.isFinite(sequence) || sequence >= state.latestIngressSequence)) {
          if (Number.isFinite(sequence)) state.latestIngressSequence = sequence;
          if (!supplemental) {
            adoptExecution(sessionId, executionId, turnId, true);
          }
          const messageId = String(payload.message_id || '');
          reconcileOptimisticUserTurn(state, {
            messageId,
            content: String(payload.content || ''),
            sequence: Number.isFinite(sequence) ? sequence : undefined,
            executionId,
            turnId,
          });
          if (!supplemental) {
            state.live = {
              ...(state.live || {}),
              status: 'queued',
              status_detail: 'durable input committed; awaiting runtime progress',
              last_progress_at_ms: Date.now(),
            };
          }
          recordProgress(sessionId);
        }
      }
      if (payload.type === 'ExecutionGraphSummary') {
        const executionId = String(payload.execution_id || '');
        const graphId = String(payload.summary?.graph_id || '');
        if (graphId && (!state.executionId || state.executionId === executionId)) {
          adoptExecutionGraph(sessionId, graphId);
        }
      }
      if (payload.type === 'TextDelta' && matchesActiveExecution(state, payload)) {
        recordProgress(sessionId);
        const accepted = acceptCanonicalDelta(sessionId, state, payload);
        if (accepted.error) {
          requestCanonicalResync(
            sessionId,
            `${accepted.error}; restoring canonical projection`,
          );
        } else if (accepted.delta) {
          ensureStreamTurn(state);
          queueDelta(sessionId, accepted.delta);
        }
      }
      if (payload.type === 'ExecutionPhase' && matchesActiveExecution(state, payload)) {
        recordProgress(sessionId);
        state.live = {
          ...(state.live || {}),
          status: payload.status,
          status_detail: payload.detail,
          last_progress_at_ms: Date.now(),
        };
      }
      if (payload.type === 'ExecutionGraphSummary' && matchesActiveExecution(state, payload)) {
        recordProgress(sessionId);
        const status = String(payload.summary?.status || '');
        if (status) {
          state.live = {
            ...(state.live || {}),
            status: status as SurfaceExecutionStatus,
            status_detail: String(payload.summary?.status_detail || 'canonical graph registered'),
            last_progress_at_ms: Date.now(),
          };
        }
      }
      if (payload.type === 'TurnError' && matchesActiveExecution(state, payload)) {
        recordProgress(sessionId);
        state.pending = false;
        stopProgressRecovery(sessionId);
        state.lastError = String(payload.error || 'execution failed');
        state.live = {
          ...(state.live || {}),
          status: 'error',
          status_detail: state.lastError,
          error: state.lastError,
          last_progress_at_ms: Date.now(),
        };
        const turn = state.turns.find((item) => item.id === state.streamTurnId);
        if (turn) turn.status = 'error';
        refreshLiveExecution(sessionId).catch(() => undefined);
        refreshProjection(sessionId).catch(() => undefined);
        void releaseWriter(sessionId);
      }
      if (payload.type === 'TerminalCommitted') {
        const settlesCurrentTurn = !payload.replayed
          && matchesActiveExecution(state, payload)
          && (!state.terminalId || payload.terminal_id === state.terminalId);
        if (settlesCurrentTurn) {
          recordProgress(sessionId);
          state.pending = false;
          stopProgressRecovery(sessionId);
          // TerminalCommitted proves durable transcript materialization, not
          // lifecycle outcome. Only canonical ExecutionLive/TurnError may
          // classify the execution as complete, error, or cancelled.
          const turn = state.turns.find((item) => item.id === state.streamTurnId);
          if (turn && turn.status !== 'error') turn.status = 'complete';
        }
        // Replayed and unrelated terminals are durable transcript facts, not
        // lifecycle transitions for the currently selected execution.
        // The initial bounded history load already contains replayed terminal
        // materialization. Reloading for every replayed terminal multiplies
        // the history/evidence requests and can keep the transcript blank
        // until the whole replay finishes.
        if (!payload.replayed) syncTranscriptTail(sessionId).catch(() => undefined);
        if (settlesCurrentTurn) refreshLiveExecution(sessionId).catch(() => undefined);
        if (settlesCurrentTurn) refreshProjection(sessionId).catch(() => undefined);
        if (settlesCurrentTurn) void releaseWriter(sessionId);
      }
    };
  }

  async function waitForSessionLiveReady(
    sessionId: string,
    timeoutMs = LIVE_SOURCE_READY_TIMEOUT_MS,
  ) {
    const state = stateFor(sessionId);
    connect(sessionId);
    if (state.streamState === 'connected') return true;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (
      Date.now() < deadline
      && !state.reconnectBlocked
      && state.streamState !== 'degraded'
    ) {
      if (state.streamState === 'connected') return true;
      await new Promise((resolve) => setTimeout(resolve, LIVE_SOURCE_READY_POLL_MS));
    }
    return state.streamState === 'connected';
  }

  async function attachReader(sessionId: string) {
    return serializeAttachment(sessionId, async () => {
      const state = stateFor(sessionId);
      const epoch = state.attachmentEpoch;
      if (state.attachmentRole === 'reader' || state.attachmentRole === 'writer') return true;
      try {
        const result: any = await api.attachSession(sessionId, 'reader');
        if (result?.ok === false) throw new Error(String(result.error || 'reader attachment rejected'));
        if (state.attachmentEpoch !== epoch || state.reconnectBlocked) {
          try {
            await api.detachSession(sessionId);
          } catch {
            // Revocation is already fail-closed locally.
          }
          return false;
        }
        state.attachmentRole = 'reader';
        state.writable = false;
        schedulePresenceHeartbeat(sessionId, result);
        return true;
      } catch (error: any) {
        if (state.attachmentEpoch !== epoch || state.reconnectBlocked) return false;
        state.attachmentRole = 'detached';
        state.writable = false;
        state.degradedReason = String(error?.message || error || 'reader attachment unavailable');
        return false;
      }
    });
  }

  async function attachWriterLocked(
    sessionId: string,
    mode: 'collaborative' | 'exclusive' = 'collaborative',
    forceServerReaffirmation = false,
  ) {
    const state = stateFor(sessionId);
    const epoch = state.attachmentEpoch;
    const invalidated = () => state.attachmentEpoch !== epoch || state.reconnectBlocked;
    let writerAttached = false;
    const compensateRevokedAttachment = async () => {
      try {
        await api.releaseRuntimeLease(sessionId);
      } catch {
        // A lease may not have been acquired yet.
      }
      try {
        await api.detachSession(sessionId);
      } catch {
        // Server-side revocation may have detached the observer already.
      }
    };
    if (!forceServerReaffirmation && state.attachmentRole === 'writer' && state.writable) return true;
    try {
      // Presence attachment replacement is atomic for one observer. Promote
      // reader -> writer directly so there is no detached race window.
      const attached: any = await api.attachSession(sessionId, 'writer');
      if (attached?.ok === false) throw new Error(String(attached.error || 'writer attachment rejected'));
      writerAttached = true;
      if (invalidated()) {
        await compensateRevokedAttachment();
        return false;
      }
      const lease: any = await api.acquireRuntimeLease(sessionId, mode);
      if (lease?.ok === false) throw new Error(String(lease.error || 'writer lease rejected'));
      if (invalidated()) {
        await compensateRevokedAttachment();
        return false;
      }
      state.attachmentRole = 'writer';
      state.writable = true;
      state.degradedReason = '';
      schedulePresenceHeartbeat(sessionId, attached);
      return true;
    } catch (error: any) {
      if (writerAttached) {
        try {
          await api.releaseRuntimeLease(sessionId);
        } catch {
          // The lease may not have been acquired.
        }
      }
      if (invalidated()) return false;
      try {
        // Demotion is also an atomic role replacement. Keep a valid reader
        // attachment when writer admission or lease acquisition fails.
        const reader: any = await api.attachSession(sessionId, 'reader');
        if (reader?.ok === false) throw new Error(String(reader.error || 'reader fallback rejected'));
        if (invalidated()) {
          await compensateRevokedAttachment();
          return false;
        }
        state.attachmentRole = 'reader';
        schedulePresenceHeartbeat(sessionId, reader);
      } catch {
        try {
          await api.detachSession(sessionId);
        } catch {
          // The server may already have removed the attachment.
        }
        state.attachmentRole = 'detached';
      }
      state.writable = false;
      state.degradedReason = String(error?.message || error || 'writer attachment unavailable');
      return false;
    }
  }

  async function attachSurface(
    sessionId: string,
    mode: 'collaborative' | 'exclusive' = 'collaborative',
  ) {
    return serializeAttachment(sessionId, () => attachWriterLocked(sessionId, mode));
  }

  async function withWriterMutation<T>(
    sessionId: string,
    operation: () => Promise<T>,
    mode: 'collaborative' | 'exclusive' = 'collaborative',
  ): Promise<{ attached: true; value: T } | { attached: false }> {
    return serializeAttachment(sessionId, async () => {
      // A different document can replace the server-side presence role while
      // this document still has a locally cached writer state. Reaffirm the
      // server role at the mutation boundary before sending the request.
      if (!await attachWriterLocked(sessionId, mode, true)) return { attached: false };
      return { attached: true, value: await operation() };
    });
  }

  async function runSessionCommandMutation<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<{ attached: true; value: T } | { attached: false }> {
    const state = stateFor(sessionId);
    const retainedWriter = state.attachmentRole === 'writer' && state.writable;
    const retainedActiveTurn = hasActivePrimaryTurn(state);
    state.lastError = '';
    try {
      const mutation = await withWriterMutation(sessionId, operation);
      if (!mutation.attached) {
        state.lastError = state.degradedReason || 'this WebUI tab could not acquire the Session writer';
      }
      return mutation;
    } catch (error: any) {
      state.lastError = String(error?.message || error || 'Session command failed');
      throw error;
    } finally {
      // A command mutates Session state but does not start a turn. Do not let
      // an idle one-shot command retain the writer lease after it completes.
      if (
        !retainedWriter
        && !retainedActiveTurn
        && !hasActivePrimaryTurn(state)
        && state.attachmentRole === 'writer'
      ) {
        await releaseWriter(sessionId);
      }
    }
  }

  async function releaseWriter(sessionId: string) {
    return serializeAttachment(sessionId, async () => {
      const state = stateFor(sessionId);
      const epoch = state.attachmentEpoch;
      const invalidated = () => state.attachmentEpoch !== epoch || state.reconnectBlocked;
      if (state.attachmentRole !== 'writer') {
        state.writable = false;
        return true;
      }
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const released: any = await api.releaseRuntimeLease(sessionId);
          if (released?.ok === false) throw new Error(String(released.error || 'writer lease release rejected'));
          if (invalidated()) return false;
          // Keep the logical Surface attached while atomically demoting the
          // observer from writer to reader.
          const reader: any = await api.attachSession(sessionId, 'reader');
          if (reader?.ok === false) throw new Error(String(reader.error || 'reader reattach rejected'));
          if (invalidated()) {
            try {
              await api.detachSession(sessionId);
            } catch {
              // Revocation may already have detached this observer.
            }
            return false;
          }
          state.attachmentRole = 'reader';
          state.writable = false;
          state.degradedReason = '';
          schedulePresenceHeartbeat(sessionId, reader);
          return true;
        } catch (error) {
          if (invalidated()) return false;
          lastError = error;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
          }
        }
      }
      state.writable = false;
      state.degradedReason = String(
        (lastError as any)?.message || lastError || 'writer lease release failed after retries',
      );
      state.lastError = state.degradedReason;
      return false;
    });
  }

  async function open(sessionId: string) {
    if (!sessionId) return;
    activeSessionId.value = sessionId;
    const state = stateFor(sessionId);
    state.unread = 0;
    if (state.reconnectBlocked) return;
    connect(sessionId);
    const existing = openFlights.get(sessionId);
    if (existing) return existing;
    attachReader(sessionId).catch((error) => {
      if (!state.reconnectBlocked) {
        state.lastError = String((error as any)?.message || error || 'reader attachment failed');
      }
    });
    let flight!: Promise<void>;
    // Opening a Session is a durable-history operation. The live source is
    // already connecting in parallel, but it must not hold transcript paint
    // or historical turn hydration behind its readiness timeout. Mutations
    // perform their own live-readiness check in `send`.
    flight = load(sessionId)
      .finally(() => {
        if (openFlights.get(sessionId) === flight) openFlights.delete(sessionId);
      });
    openFlights.set(sessionId, flight);
    return flight;
  }

  async function send(
    sessionId: string,
    content: string,
    options: { transportContent?: string; resourceIds?: string[] } = {},
  ) {
    const state = stateFor(sessionId);
    if (state.submitting) {
      state.lastError = 'a session input is already being submitted';
      return false;
    }
    const supplementing = hasActivePrimaryTurn(state);
    state.submitting = true;
    activeSessionId.value = sessionId;
    connect(sessionId);
    const epoch = ++state.submissionEpoch;
    const idempotencyKey = uniqueSubmissionKey(sessionId);
    state.lastError = '';
    if (!supplementing) {
      state.live = {
        ...(state.live || {}),
        status: 'queued',
        status_detail: 'acquiring writer attachment',
        last_progress_at_ms: Date.now(),
      };
    }
    const localId = `local:${idempotencyKey}`;
    state.turns.push({ id: localId, role: 'user', content, status: 'streaming' });
    if (!supplementing) {
      state.pending = true;
      state.streamTurnId = `stream:${sessionId}:${idempotencyKey}`;
      clearStreamByteEnds(sessionId);
      ensureStreamTurn(state);
    }
    try {
      if (!await waitForSessionLiveReady(sessionId)) {
        state.degradedReason = 'live Session source was not ready before submission; canonical recovery remains active';
      }
      // Writer promotion and the mutation share one attachment lane. A
      // terminal-event demotion cannot interleave between admission and POST.
      const mutation = await withWriterMutation(sessionId, () => api.sendMessage(
        sessionId,
        options.transportContent || content,
        options.resourceIds || [],
        idempotencyKey,
      ));
      if (!mutation.attached) {
        throw new Error(state.degradedReason || 'this WebUI tab is attached read-only');
      }
      if (state.submissionEpoch !== epoch || state.reconnectBlocked) return false;
      if (!supplementing) {
        state.live = {
          ...(state.live || {}),
          status: 'queued',
          status_detail: 'submitting durable session input',
          last_progress_at_ms: Date.now(),
        };
      }
      const receipt: any = mutation.value;
      if (state.submissionEpoch !== epoch || state.reconnectBlocked) return false;
      const canonicalMessageId = String(receipt?.message?.message_id || '');
      const canonicalSequence = Number(receipt?.message?.sequence);
      reconcileOptimisticUserTurn(state, {
        messageId: canonicalMessageId,
        content,
        sequence: Number.isFinite(canonicalSequence) ? canonicalSequence : undefined,
        executionId: String(receipt?.execution?.graph_id || receipt?.execution_id || ''),
        turnId: String(receipt?.message?.turn_id || receipt?.execution?.turn_id || ''),
      });
      const localTurn = state.turns.find((turn) => turn.id === localId);
      if (localTurn) localTurn.status = 'complete';
      if (supplementing) {
        const inputReceipt = receipt?.input || {};
        upsertSessionActivity(sessionId, {
          id: String(inputReceipt.input_id || `session-input:${idempotencyKey}`),
          kind: 'runtime',
          title: t('chat.input.supplemented'),
          detail: String(inputReceipt.decision || receipt?.mode || 'accepted'),
          status: 'complete',
          raw: receipt,
        });
        recordProgress(sessionId);
        return true;
      }
      const executionId = String(receipt?.execution?.graph_id || receipt?.execution_id || '');
      adoptExecution(sessionId, executionId, String(receipt?.execution?.turn_id || ''), true);
      state.terminalId = String(receipt?.execution?.terminal_id || `turn-terminal:${idempotencyKey}`);
      state.live = {
        ...(state.live || {}),
        status: String(receipt?.execution?.status || 'accepted_pending_materialization') as SurfaceExecutionStatus,
        status_detail: String(receipt?.execution?.materialization?.state || 'accepted_pending_graph'),
        last_progress_at_ms: Date.now(),
      };
      return true;
    } catch (error: any) {
      if (state.submissionEpoch !== epoch || state.reconnectBlocked) return false;
      state.lastError = String(error?.message || error || 'send failed');
      const localTurn = state.turns.find((turn) => turn.id === localId);
      if (localTurn) {
        localTurn.status = 'error';
        localTurn.submission_error = state.lastError;
      }
      if (supplementing) {
        upsertSessionActivity(sessionId, {
          id: `session-input:${idempotencyKey}:error`,
          kind: 'error',
          title: t('chat.input.supplementFailed'),
          detail: state.lastError,
          status: 'error',
        });
        return false;
      }
      state.pending = false;
      stopProgressRecovery(sessionId);
      state.live = { ...(state.live || {}), status: 'error', status_detail: state.lastError, error: state.lastError };
      state.turns = state.turns.filter((turn) => turn.id !== state.streamTurnId);
      state.streamTurnId = '';
      void releaseWriter(sessionId);
      return false;
    } finally {
      if (state.submissionEpoch === epoch) {
        state.submitting = false;
      }
    }
  }

  async function stop(sessionId: string) {
    const state = stateFor(sessionId);
    const mutation = await withWriterMutation(
      sessionId,
      () => api.cancelSessionTurn(sessionId),
    );
    if (!mutation.attached) {
      state.lastError = state.degradedReason || 'this WebUI tab is attached read-only';
      return false;
    }
    const receipt: any = mutation.value;
    if (!receipt?.ok) {
      const status = Number(receipt?.status);
      const prefix = Number.isFinite(status) && status > 0 ? `HTTP ${status} ` : '';
      state.lastError = `cancel failed: ${prefix}${String(receipt?.error || 'Gateway rejected cancellation')}`;
      state.degradedReason = state.lastError;
      state.live = {
        ...(state.live || {}),
        status: state.live?.status || 'running',
        status_detail: state.lastError,
        last_progress_at_ms: Date.now(),
      };
      return false;
    }
    state.lastError = '';
    state.degradedReason = '';
    state.live = {
      ...(state.live || {}),
      status: state.live?.status || 'running',
      status_detail: 'cancel requested; waiting for canonical terminal state',
      last_progress_at_ms: Date.now(),
    };
    await refreshLiveExecution(sessionId);
    await refreshProjection(sessionId);
    return true;
  }

  async function detachSurface(sessionId: string) {
    return serializeAttachment(sessionId, async () => {
      const state = stateFor(sessionId);
      state.writable = false;
      if (state.attachmentRole === 'detached') return true;
      if (state.attachmentRole === 'writer') {
        let released = false;
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const result: any = await api.releaseRuntimeLease(sessionId);
            if (result?.ok === false) throw new Error(String(result.error || 'writer lease release rejected'));
            released = true;
            break;
          } catch (error) {
            lastError = error;
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
            }
          }
        }
        if (!released) {
          state.degradedReason = String(
            (lastError as any)?.message || lastError || 'writer lease release failed before detach',
          );
          state.lastError = state.degradedReason;
          return false;
        }
      }
      try {
        const detached: any = await api.detachSession(sessionId);
        if (detached?.ok === false) throw new Error(String(detached.error || 'session detach rejected'));
        state.attachmentRole = 'detached';
        clearPresenceHeartbeat(sessionId);
        return true;
      } catch (error: any) {
        state.degradedReason = String(error?.message || error || 'session detach failed');
        state.lastError = state.degradedReason;
        return false;
      }
    });
  }

  async function close(sessionId: string) {
    const state = stateFor(sessionId);
    state.streamGeneration += 1;
    closeSessionStream(sessionId);
    projections.release(`chat:${sessionId}`);
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    deltaBuffers.delete(sessionId);
    clearStreamByteEnds(sessionId);
    stopProgressRecovery(sessionId);
    state.streamState = 'offline';
    state.degradedReason = '';
    state.writable = false;
    if (state.attachmentRole !== 'detached') {
      await detachSurface(sessionId);
    }
  }

  function refreshAuthorization() {
    for (const state of Object.values(states)) {
      if (!state.reconnectBlocked) continue;
      state.reconnectBlocked = false;
      state.streamState = 'connecting';
      state.lastError = '';
      state.degradedReason = '';
      connect(state.sessionId);
      void Promise.all([attachReader(state.sessionId), load(state.sessionId)]);
    }
  }

  const authorizationInvalidated = (event: Event) => {
    const reason = String((event as CustomEvent)?.detail?.reason || 'Gateway authorization changed');
    failClosedAllSessionAuthorization(reason);
  };
  const sessionAuthorizationInvalidated = (event: Event) => {
    const detail = (event as CustomEvent)?.detail || {};
    const sessionId = String(detail.sessionId || '');
    if (!sessionId) return;
    clearSessionAuthorizationState(
      sessionId,
      sourceLeases.get(sessionId),
      String(detail.reason || 'Gateway revoked this session observer'),
    );
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('cowd:authorization-invalidated', authorizationInvalidated);
    window.addEventListener('cowd:session-authorization-invalidated', sessionAuthorizationInvalidated);
  }
  onScopeDispose(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('cowd:authorization-invalidated', authorizationInvalidated);
      window.removeEventListener('cowd:session-authorization-invalidated', sessionAuthorizationInvalidated);
    }
    for (const stream of sourceLeases.values()) stream.close();
    for (const frame of flushFrames.values()) cancelAnimationFrame(frame);
    for (const timer of progressRecoveryTimers.values()) clearInterval(timer);
    for (const timer of presenceHeartbeatTimers.values()) clearTimeout(timer);
    sourceLeases.clear();
    deltaBuffers.clear();
    flushFrames.clear();
    streamByteEnds.clear();
    openFlights.clear();
    attachmentFlights.clear();
    canonicalResyncFlights.clear();
    executionIndexFlights.clear();
    transcriptSyncFlights.clear();
    progressRecoveryTimers.clear();
    progressRecoveryFlights.clear();
    presenceHeartbeatTimers.clear();
    for (const sessionId of Object.keys(states)) delete states[sessionId];
    activeSourceCount.value = 0;
  });

  function setDraft(sessionId: string, value: string) {
    stateFor(sessionId).draft = value;
    writeSessionDraft(sessionId, value);
  }

  function setScrollTop(sessionId: string, value: number) {
    stateFor(sessionId).scrollTop = Math.max(0, Number(value) || 0);
  }

  return {
    states,
    activeSessionId,
    active,
    activeSourceCount,
    open,
    load,
    hydrateExecutionIndex,
    hydrateRuntimeDetails,
    loadOlder,
    loadLatest,
    syncTranscriptTail,
    send,
    stop,
    close,
    refreshProjection,
    attachSurface,
    runSessionCommandMutation,
    detachSurface,
    failClosedAllSessionAuthorization,
    refreshAuthorization,
    setDraft,
    setScrollTop,
  };
});
