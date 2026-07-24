import { defineStore } from 'pinia';
import { computed, onScopeDispose, reactive, ref } from 'vue';
import {
  api,
  invalidateAuthentication,
  invalidateSessionAuthorization,
} from '../api/client';
import type {
  ChatTurn,
  ExecutionLiveState,
  SessionEvidenceProjection,
} from '../types';
import { useProjectionRegistryStore } from './projectionRegistry';
import {
  acquireLongLivedConnection,
  releaseLongLivedConnection,
  updateLongLivedConnectionPriority,
} from '../utils/longLivedConnectionBudget';

type SurfaceExecutionStatus = ExecutionLiveState['status'] | 'accepted_pending_materialization' | 'running' | 'terminal';
type LiveExecutionState = Omit<ExecutionLiveState, 'status'>
  & { status: SurfaceExecutionStatus }
  & Partial<Omit<ExecutionLiveState, 'status'>>;

export type SessionChatState = {
  sessionId: string;
  turns: ChatTurn[];
  executionId: string;
  executionTurnId: string;
  executionGeneration: number;
  streamGeneration: number;
  runtimeCommitCursor: number;
  reconnectBlocked: boolean;
  latestIngressSequence: number;
  streamTurnId: string;
  terminalId: string;
  live: LiveExecutionState | null;
  evidence: SessionEvidenceProjection | null;
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
  historyOldestOffset: number;
  historyWindowEndOffset: number;
  historyHasOlder: boolean;
  historyHasNewer: boolean;
  historyLoading: boolean;
};

const states = reactive<Record<string, SessionChatState>>({});
const streams = new Map<string, EventSource>();
const deltaBuffers = new Map<string, string>();
const flushFrames = new Map<string, number>();
const streamByteEnds = new Map<string, number>();
const openFlights = new Map<string, Promise<void>>();
const attachmentFlights = new Map<string, Promise<unknown>>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reconnectAttempts = new Map<string, number>();
const streamOpenedAt = new Map<string, number>();
const canonicalResyncFlights = new Map<string, Promise<void>>();
// Keep the browser below the HTTP/1.1 per-origin socket ceiling. Each live
// chat can also own one execution projection stream, leaving capacity for
// ordinary fetches, cancellation and navigation.
export const MAX_ACTIVE_SESSION_STREAMS = 2;
const HISTORY_PAGE_SIZE = 100;
const HISTORY_WINDOW_CAP = 1_000;
const SESSION_RECONNECT_BASE_MS = 250;
const SESSION_RECONNECT_MAX_MS = 5_000;
const MAX_SESSION_RECONNECT_ATTEMPTS = 8;
const SESSION_STREAM_HEALTHY_MS = 10_000;
const SESSION_SCOPED_STREAM_EVENTS = new Set([
  'Connected',
  'SessionAuthorizationRevoked',
  'session_stream_resync',
  'RuntimeStreamLagged',
  'UserMessageCommitted',
  'ExecutionGraphSummary',
  'TextDelta',
  'ExecutionPhase',
  'TurnError',
  'TerminalCommitted',
]);

function scheduleFlush(sessionId: string) {
  if (flushFrames.has(sessionId)) return;
  let flushedSynchronously = false;
  const frame = requestAnimationFrame(() => {
    flushedSynchronously = true;
    flush(sessionId);
  });
  if (!flushedSynchronously) flushFrames.set(sessionId, frame);
}

function stateFor(sessionId: string) {
  if (!states[sessionId]) {
    states[sessionId] = {
      sessionId, turns: [], executionId: '', executionTurnId: '', executionGeneration: 0,
      streamGeneration: 0, runtimeCommitCursor: 0, reconnectBlocked: false,
      latestIngressSequence: -1, streamTurnId: '', terminalId: '', live: null, evidence: null, streamState: 'offline',
      loadEpoch: 0, submissionEpoch: 0, attachmentEpoch: 0,
      pending: false, submitting: false, lastError: '', unread: 0,
      lastEventAtMs: 0, lastProgressAtMs: 0, degradedReason: '', resyncCount: 0,
      attachmentRole: 'detached', writable: false,
      draft: '', scrollTop: 0, historyTotal: 0, historyOldestOffset: 0,
      historyWindowEndOffset: 0, historyHasOlder: false, historyHasNewer: false,
      historyLoading: false,
    };
  }
  return states[sessionId];
}

function textFromBlocks(blocks: any[]) {
  return (blocks || []).map((block) => block?.text || block?.content || block?.output || block?.thinking || '').join('');
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
    if (!['user', 'assistant', 'system'].includes(String(message?.role || ''))) {
      return `${label} message ${id} has an unsupported role`;
    }
  }
  return '';
}

function evidenceIdentityIssue(value: any, sessionId: string) {
  const envelopeIssue = sessionEnvelopeIdentityIssue(value, sessionId, 'evidence');
  if (envelopeIssue) return envelopeIssue;
  if (!Array.isArray(value?.turns)) return 'evidence turns payload is not an array';
  for (const turn of value.turns) {
    const turnIssue = sessionEnvelopeIdentityIssue(turn, sessionId, 'evidence turn');
    if (turnIssue) return turnIssue;
  }
  return '';
}

function normalizeTurns(messages: any[]): ChatTurn[] {
  const normalized = (messages || []).map((message: any) => ({
    raw: message,
    id: String(message.id || message.message_id),
    role: message.role,
    content: typeof message.content === 'string' ? message.content : textFromBlocks(message.blocks),
    status: 'complete',
    sequence: message.sequence,
    blocks: message.blocks,
    token_usage: message.token_usage ?? message.usage,
    execution_id: blockMetadata(message.blocks, 'cowd_execution_id'),
    turn_id: blockMetadata(message.blocks, 'cowd_turn_id'),
    ingress_message_id: blockMetadata(message.blocks, 'cowd_turn_ingress_message_id'),
  }));
  return sortTurnsCausally(
    normalized.map(({ raw: _raw, ...message }: any) => message as ChatTurn),
  );
}

function blockMetadata(blocks: any[], key: string) {
  for (const block of blocks || []) {
    const value = block?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
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

function streamIdentityKey(sessionId: string, state: SessionChatState, payload: any) {
  const executionId = String(payload.execution_id || '');
  const turnId = String(payload.turn_id || '');
  const partId = String(payload.part_id || '');
  if (!executionId || !turnId || !partId) return '';
  if (executionId !== state.executionId) return '';
  if (state.executionTurnId && turnId !== state.executionTurnId) return '';
  return `${sessionId}\u0000${executionId}\u0000${turnId}\u0000${partId}`;
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

function serializeAttachment<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = attachmentFlights.get(sessionId) || Promise.resolve();
  const flight = previous.catch(() => undefined).then(operation);
  attachmentFlights.set(sessionId, flight);
  return flight.finally(() => {
    if (attachmentFlights.get(sessionId) === flight) attachmentFlights.delete(sessionId);
  });
}

function uniqueSubmissionKey(sessionId: string) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `webui:${sessionId}:${suffix}`;
}

export const useChatSessionsStore = defineStore('chatSessions', () => {
  // The transport registry belongs to this Pinia store instance. A recreated
  // application shell (tests, HMR, sign-out bootstrap) must not inherit live
  // observers or per-session state from the disposed shell.
  for (const stream of streams.values()) stream.close();
  streams.clear();
  deltaBuffers.clear();
  flushFrames.clear();
  streamByteEnds.clear();
  openFlights.clear();
  attachmentFlights.clear();
  for (const timer of reconnectTimers.values()) clearTimeout(timer);
  reconnectTimers.clear();
  reconnectAttempts.clear();
  streamOpenedAt.clear();
  canonicalResyncFlights.clear();
  for (const sessionId of Object.keys(states)) delete states[sessionId];

  const projections = useProjectionRegistryStore();
  const activeSessionId = ref('');
  const active = computed(() => activeSessionId.value ? stateFor(activeSessionId.value) : null);
  const activeStreams = ref(streams.size);
  const activeStreamCount = computed(() => activeStreams.value);

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
    flight = Promise.all([
      load(sessionId),
      refreshProjection(sessionId),
    ]).then(() => undefined).finally(() => {
      if (canonicalResyncFlights.get(sessionId) === flight) {
        canonicalResyncFlights.delete(sessionId);
      }
    });
    canonicalResyncFlights.set(sessionId, flight);
  }

  function isCurrentStream(sessionId: string, stream: EventSource, generation: number) {
    const state = states[sessionId];
    return !!state
      && !state.reconnectBlocked
      && state.streamGeneration === generation
      && streams.get(sessionId) === stream;
  }

  function cancelSessionReconnect(sessionId: string, resetAttempts = true) {
    const timer = reconnectTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(sessionId);
    if (resetAttempts) reconnectAttempts.delete(sessionId);
  }

  function closeSessionStream(sessionId: string, expected?: EventSource) {
    const current = streams.get(sessionId);
    if (expected && current !== expected) return;
    current?.close();
    streams.delete(sessionId);
    releaseLongLivedConnection(`chat:${sessionId}`);
    streamOpenedAt.delete(sessionId);
    activeStreams.value = streams.size;
  }

  function scheduleSessionReconnect(sessionId: string) {
    const state = stateFor(sessionId);
    if (
      state.reconnectBlocked
      || streams.has(sessionId)
      || reconnectTimers.has(sessionId)
    ) return;
    const attempt = reconnectAttempts.get(sessionId) || 0;
    if (attempt >= MAX_SESSION_RECONNECT_ATTEMPTS) {
      state.streamState = 'degraded';
      state.degradedReason = 'session observer reconnect budget exhausted';
      promoteDeferredStreams();
      return;
    }
    const delay = Math.min(
      SESSION_RECONNECT_BASE_MS * (2 ** Math.min(attempt, 5)),
      SESSION_RECONNECT_MAX_MS,
    );
    reconnectAttempts.set(sessionId, attempt + 1);
    state.streamState = 'reconnecting';
    const timer = setTimeout(() => {
      reconnectTimers.delete(sessionId);
      if (!state.reconnectBlocked) connect(sessionId);
    }, delay);
    reconnectTimers.set(sessionId, timer);
  }

  async function revalidateAndScheduleReconnect(
    sessionId: string,
    generation: number,
  ) {
    const state = stateFor(sessionId);
    const [authorization, execution] = await Promise.all([
      api.authVerify(),
      api.sessionExecution(sessionId),
    ]);
    if (
      state.streamGeneration !== generation
      || state.reconnectBlocked
      || streams.has(sessionId)
    ) return;
    if (
      String((authorization as any)?.__state || '') === 'forbidden'
      || (
        (authorization as any)?.auth_required === true
        && (authorization as any)?.valid !== true
        && String((authorization as any)?.__state || '') === 'ready'
      )
    ) {
      invalidateAuthentication('Gateway rejected the session observer credential');
      if (!state.reconnectBlocked) {
        failClosedAllSessionAuthorization('Gateway rejected the session observer credential');
      }
      return;
    }
    if (String((execution as any)?.__state || '') === 'forbidden') {
      if (!state.reconnectBlocked) {
        failClosedSessionAuthorization(
          sessionId,
          undefined,
          String((execution as any)?.__error || 'Gateway rejected this session observer'),
        );
      }
      return;
    }
    const executionIssue = sessionEnvelopeIdentityIssue(
      execution,
      sessionId,
      'execution reconnect probe',
    );
    if (executionIssue) {
      failClosedSessionAuthorization(sessionId, undefined, executionIssue);
      return;
    }
    scheduleSessionReconnect(sessionId);
  }

  function clearSessionAuthorizationState(
    sessionId: string,
    stream: EventSource | undefined,
    reason: string,
  ) {
    const state = stateFor(sessionId);
    cancelSessionReconnect(sessionId);
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
    state.turns = [];
    state.evidence = null;
    state.live = null;
    state.executionId = '';
    state.executionTurnId = '';
    state.streamTurnId = '';
    state.terminalId = '';
    state.latestIngressSequence = -1;
    state.runtimeCommitCursor = 0;
    state.draft = '';
    state.historyTotal = 0;
    state.historyOldestOffset = 0;
    state.historyWindowEndOffset = 0;
    state.historyHasOlder = false;
    state.historyHasNewer = false;
    state.historyLoading = false;
    projections.revokeSessionAuthorization(sessionId, reason);
    projections.release(`chat:${sessionId}`);
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    deltaBuffers.delete(sessionId);
    clearStreamByteEnds(sessionId);
    promoteDeferredStreams();
  }

  function failClosedSessionAuthorization(sessionId: string, stream: EventSource | undefined, reason: string) {
    invalidateSessionAuthorization(sessionId, reason);
    // CustomEvent delivery is synchronous in browsers. SSR and isolated store
    // tests have no window listener, so retain an explicit fail-closed path.
    if (!stateFor(sessionId).reconnectBlocked) {
      clearSessionAuthorizationState(sessionId, stream, reason);
    }
  }

  function failClosedAllSessionAuthorization(reason: string) {
    for (const state of Object.values(states)) {
      clearSessionAuthorizationState(state.sessionId, streams.get(state.sessionId), reason);
    }
  }

  function adoptExecution(
    sessionId: string,
    executionId: string,
    turnId = '',
    markPending = true,
  ) {
    const state = stateFor(sessionId);
    const next = executionId.trim();
    if (!next) return false;
    if (state.executionId === next) {
      if (turnId) state.executionTurnId = turnId;
      if (markPending) state.pending = true;
      if (state.pending) ensureStreamTurn(state);
      return false;
    }
    projections.release(`chat:${sessionId}`);
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    deltaBuffers.delete(sessionId);
    clearStreamByteEnds(sessionId);
    if (state.streamTurnId) {
      state.turns = state.turns.filter((turn) => turn.id !== state.streamTurnId || !!turn.content);
    }
    state.executionId = next;
    state.executionTurnId = turnId;
    state.executionGeneration += 1;
    state.terminalId = '';
    state.streamTurnId = `stream:${sessionId}:${next}`;
    state.pending = markPending;
    state.live = {
      status: 'queued',
      status_detail: 'execution adopted from canonical session stream',
      last_progress_at_ms: Date.now(),
    };
    if (markPending) ensureStreamTurn(state);
    projections.acquire(next, `chat:${sessionId}`, 'full', 'bounded', sessionId);
    refreshProjection(sessionId).catch(() => undefined);
    return true;
  }

  async function load(sessionId: string) {
    const state = stateFor(sessionId);
    const epoch = ++state.loadEpoch;
    state.historyLoading = true;
    const probePromise = api.messages(sessionId, { offset: 0, limit: 1 });
    const evidencePromise = api.sessionEvidence(sessionId);
    const executionPromise = api.sessionExecution(sessionId);
    const probe = await probePromise;
    if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
    const probeIssue = readIssue(probe, 'history')
      || messagesIdentityIssue(probe, sessionId, 'history probe');
    if (probeIssue) {
      state.historyLoading = false;
      state.streamState = 'degraded';
      state.lastError = probeIssue;
      state.degradedReason = probeIssue;
      return;
    }
    const total = Math.max(0, Number(probe.total || 0));
    const offset = Math.max(0, total - HISTORY_PAGE_SIZE);
    const data = total <= 1 && offset === 0
      ? probe
      : await api.messages(sessionId, { offset, limit: HISTORY_PAGE_SIZE });
    const [evidence, execution] = await Promise.all([
      evidencePromise,
      executionPromise,
    ]);
    if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
    state.historyLoading = false;
    const identityIssues = [
      messagesIdentityIssue(data, sessionId, 'history'),
      evidenceIdentityIssue(evidence, sessionId),
      sessionEnvelopeIdentityIssue(execution, sessionId, 'execution'),
    ].filter(Boolean);
    if (identityIssues.length) {
      state.streamState = 'degraded';
      state.lastError = identityIssues.join(' · ');
      state.degradedReason = state.lastError;
      return;
    }
    const issues = [...new Set([
      probeIssue,
      readIssue(data, 'history'),
      readIssue(evidence, 'evidence'),
      readIssue(execution, 'execution'),
    ].filter(Boolean))];
    if (issues.length) {
      state.lastError = issues.join(' · ');
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
    const durableOwnsStreamingIdentity = !!streaming && durableTurns.some((turn) => (
      turn.role === 'assistant'
      && (
        (!!streaming.execution_id && turn.execution_id === streaming.execution_id)
        || (!!streaming.turn_id && turn.turn_id === streaming.turn_id)
      )
    ));
    state.turns = durableTurns;
    state.historyTotal = Math.max(total, Number(data.total || 0));
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
    state.evidence = evidence;
    const recoveredExecutionId = String(execution.latest_execution_id || '');
    const recoveredActive = (execution.active_execution_ids || []).includes(recoveredExecutionId);
    const currentStillMaterializing = state.pending
      && !!state.executionId
      && state.executionId !== recoveredExecutionId;
    if (recoveredExecutionId && (!currentStillMaterializing || recoveredActive)) {
      adoptExecution(
        sessionId,
        recoveredExecutionId,
        String((execution as any).turn_id || state.executionTurnId || ''),
        recoveredActive || !['complete', 'error', 'cancelled'].includes(String(execution.latest_status || '')),
      );
    }
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
      projections.acquire(
        state.executionId,
        `chat:${sessionId}`,
        'full',
        'bounded',
        sessionId,
      );
      refreshProjection(sessionId).catch(() => undefined);
    }
  }

  async function loadOlder(sessionId: string) {
    const state = stateFor(sessionId);
    if (state.reconnectBlocked || state.historyLoading || !state.historyHasOlder) return;
    const epoch = state.loadEpoch;
    state.historyLoading = true;
    const nextOffset = Math.max(0, state.historyOldestOffset - HISTORY_PAGE_SIZE);
    const page = await api.messages(sessionId, {
      offset: nextOffset,
      limit: state.historyOldestOffset - nextOffset,
    });
    if (state.loadEpoch !== epoch || state.reconnectBlocked) return;
    state.historyLoading = false;
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
  }

  async function loadLatest(sessionId: string) {
    await load(sessionId);
  }

  async function refreshProjection(sessionId: string) {
    const state = stateFor(sessionId);
    if (!state.executionId) return;
    const projection = await projections.load(state.executionId, 'full', sessionId);
    if (projection?.execution_id === state.executionId) {
      let streamRecovered = state.streamState !== 'degraded';
      if (projection.live) {
        state.live = projection.live;
        const outputBytes = Number(projection.live.output_bytes);
        const previewStart = Number(projection.live.output_preview_start_bytes || 0);
        const preview = projection.live.output_preview;
        if (
          Number.isFinite(outputBytes)
          && outputBytes >= 0
          && Number.isFinite(previewStart)
          && previewStart >= 0
          && previewStart <= outputBytes
        ) {
          const canonicalPreview = typeof preview === 'string'
            ? preview
            : (outputBytes === 0 && previewStart === 0 ? '' : null);
          const previewBytes = canonicalPreview === null
            ? -1
            : new TextEncoder().encode(canonicalPreview).byteLength;
          if (previewBytes === outputBytes - previewStart) {
            const streamKey = streamIdentityKey(sessionId, state, {
              execution_id: state.executionId,
              turn_id: state.executionTurnId || projection.live.turn_id,
              part_id: 'assistant_text',
            });
            if (streamKey) streamByteEnds.set(streamKey, outputBytes);
            ensureStreamTurn(state);
            const turn = state.turns.find((item) => item.id === state.streamTurnId);
            if (turn) {
              turn.content = previewStart > 0
                ? `[${previewStart} earlier output bytes omitted during recovery]\n${canonicalPreview}`
                : canonicalPreview || '';
            }
            streamRecovered = true;
          } else {
            state.streamState = 'degraded';
            state.degradedReason = 'canonical output preview does not cover its declared UTF-8 byte range';
            state.lastError = state.degradedReason;
            streamRecovered = false;
          }
        }
      }
      if (streamRecovered) {
        state.degradedReason = '';
        if (state.streamState === 'degraded') state.streamState = 'connected';
      }
      const status = String(projection.live?.status || state.live?.status || '');
      if (['complete', 'error', 'cancelled'].includes(status)) {
        const wasPending = state.pending;
        state.pending = false;
        refreshStreamPriorities();
        if (wasPending) await load(sessionId);
        await releaseWriter(sessionId);
      }
    } else {
      const entry = projections.entries[state.executionId];
      if (entry?.reconnectBlocked) {
        state.live = null;
        state.lastError = entry.lastError || 'execution projection authorization was revoked';
        state.degradedReason = state.lastError;
      }
      if (entry?.connectionState === 'degraded') {
        state.degradedReason = entry.degradedReason || entry.lastError;
      }
    }
  }

  function streamPriority(sessionId: string) {
    const state = stateFor(sessionId);
    if (state.submitting && activeSessionId.value === sessionId) return 60;
    if (state.pending && activeSessionId.value === sessionId) return 55;
    if (state.pending || state.submitting) return 45;
    if (activeSessionId.value === sessionId) return 40;
    return 15;
  }

  function refreshStreamPriorities() {
    for (const sessionId of streams.keys()) {
      updateLongLivedConnectionPriority(`chat:${sessionId}`, streamPriority(sessionId));
    }
  }

  function connect(sessionId: string, leaseGranted = false) {
    if (streams.has(sessionId)) {
      updateLongLivedConnectionPriority(`chat:${sessionId}`, streamPriority(sessionId));
      return;
    }
    const state = stateFor(sessionId);
    cancelSessionReconnect(sessionId, false);
    if (state.reconnectBlocked) {
      if (leaseGranted) releaseLongLivedConnection(`chat:${sessionId}`);
      return;
    }
    if (streams.size >= MAX_ACTIVE_SESSION_STREAMS) {
      const requesterPriority = streamPriority(sessionId);
      const victim = [...streams.keys()]
        .map((candidate) => ({ sessionId: candidate, priority: streamPriority(candidate) }))
        .filter((candidate) => candidate.priority < requesterPriority)
        .sort((left, right) => left.priority - right.priority)[0];
      if (victim) {
        closeSessionStream(victim.sessionId);
        const victimState = stateFor(victim.sessionId);
        victimState.streamState = 'degraded';
        victimState.degradedReason = 'session observer yielded to the selected or submitting conversation';
      } else {
        if (leaseGranted) releaseLongLivedConnection(`chat:${sessionId}`);
        state.streamState = 'degraded';
        state.degradedReason = `session connection budget reached (${MAX_ACTIVE_SESSION_STREAMS})`;
        return;
      }
    }
    state.streamState = 'connecting';
    state.degradedReason = '';
    if (typeof EventSource === 'undefined') {
      if (leaseGranted) releaseLongLivedConnection(`chat:${sessionId}`);
      state.streamState = 'offline';
      return;
    }
    if (!leaseGranted && !acquireLongLivedConnection(
      `chat:${sessionId}`,
      streamPriority(sessionId),
      () => {
        closeSessionStream(sessionId);
        state.streamState = 'degraded';
        state.degradedReason = 'session observer yielded the shared live-connection budget';
      },
      () => connect(sessionId, true),
    )) {
      state.streamState = 'degraded';
      state.degradedReason = 'shared live-connection budget reached';
      return;
    }
    const cursor = state.runtimeCommitCursor > 0
      ? `?from_cursor=${encodeURIComponent(state.runtimeCommitCursor)}`
      : '';
    const stream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream${cursor}`);
    const generation = ++state.streamGeneration;
    streams.set(sessionId, stream);
    activeStreams.value = streams.size;
    stream.onopen = () => {
      if (!isCurrentStream(sessionId, stream, generation)) return;
      streamOpenedAt.set(sessionId, Date.now());
      state.streamState = 'connected';
      state.lastEventAtMs = Date.now();
    };
    stream.onerror = () => {
      if (!isCurrentStream(sessionId, stream, generation)) return;
      const openedAt = streamOpenedAt.get(sessionId) || 0;
      const wasHealthy = openedAt > 0 && Date.now() - openedAt >= SESSION_STREAM_HEALTHY_MS;
      closeSessionStream(sessionId, stream);
      if (wasHealthy) reconnectAttempts.delete(sessionId);
      state.streamState = 'reconnecting';
      promoteDeferredStreams();
      void revalidateAndScheduleReconnect(sessionId, generation);
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
      const eventType = String(payload.type || '');
      const receivedSessionId = typeof payload.session_id === 'string'
        ? payload.session_id
        : '';
      if (
        (SESSION_SCOPED_STREAM_EVENTS.has(eventType) && receivedSessionId !== sessionId)
        || (receivedSessionId && receivedSessionId !== sessionId)
      ) {
        closeSessionStream(sessionId, stream);
        state.streamState = 'degraded';
        promoteDeferredStreams();
        requestCanonicalResync(
          sessionId,
          `${eventType || 'session event'} session identity mismatch: expected ${sessionId}, received ${receivedSessionId || 'missing'}`,
        );
        void revalidateAndScheduleReconnect(sessionId, generation);
        return;
      }
      state.lastEventAtMs = Date.now();
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
      if (payload.type === 'UserMessageCommitted') {
        const sequence = Number(payload.sequence);
        const executionId = String(payload.execution_id || '');
        if (executionId && (!Number.isFinite(sequence) || sequence >= state.latestIngressSequence)) {
          if (Number.isFinite(sequence)) state.latestIngressSequence = sequence;
          adoptExecution(sessionId, executionId, String(payload.turn_id || ''), true);
          const messageId = String(payload.message_id || '');
          if (messageId && !state.turns.some((turn) => turn.id === messageId)) {
            state.turns.push({
              id: messageId,
              role: 'user',
              content: String(payload.content || ''),
              status: 'complete',
              sequence: Number.isFinite(sequence) ? sequence : undefined,
            });
          }
          state.live = {
            ...(state.live || {}),
            status: 'queued',
            status_detail: 'durable input committed; awaiting runtime progress',
            last_progress_at_ms: Date.now(),
          };
          recordProgress(sessionId);
        }
      }
      if (payload.type === 'ExecutionGraphSummary') {
        const executionId = String(payload.execution_id || payload.summary?.graph_id || '');
        if (executionId && (!state.executionId || state.executionId === executionId)) {
          adoptExecution(sessionId, executionId, String(payload.turn_id || ''), true);
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
        refreshStreamPriorities();
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
          refreshStreamPriorities();
          // TerminalCommitted proves durable transcript materialization, not
          // lifecycle outcome. Only canonical ExecutionLive/TurnError may
          // classify the execution as complete, error, or cancelled.
          const turn = state.turns.find((item) => item.id === state.streamTurnId);
          if (turn && turn.status !== 'error') turn.status = 'complete';
        }
        // Replayed and unrelated terminals are durable transcript facts, not
        // lifecycle transitions for the currently selected execution.
        load(sessionId).catch(() => undefined);
        if (settlesCurrentTurn) refreshProjection(sessionId).catch(() => undefined);
        if (settlesCurrentTurn) void releaseWriter(sessionId);
      }
    };
  }

  function promoteDeferredStreams() {
    if (streams.size >= MAX_ACTIVE_SESSION_STREAMS) return;
    Object.values(states)
      .filter((state) => (
        state.streamState === 'degraded'
        && !state.reconnectBlocked
        && (
          state.degradedReason.startsWith('session connection budget')
          || state.degradedReason.startsWith('shared live-connection budget')
          || state.degradedReason.includes('yielded the shared live-connection budget')
          || state.degradedReason.includes('yielded to the selected')
        )
      ))
      .sort((left, right) => left.lastEventAtMs - right.lastEventAtMs)
      .slice(0, MAX_ACTIVE_SESSION_STREAMS - streams.size)
      .forEach((state) => connect(state.sessionId));
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

  async function attachSurface(
    sessionId: string,
    mode: 'collaborative' | 'exclusive' = 'collaborative',
  ) {
    return serializeAttachment(sessionId, async () => {
      const state = stateFor(sessionId);
      const epoch = state.attachmentEpoch;
      const invalidated = () => state.attachmentEpoch !== epoch || state.reconnectBlocked;
      const compensate = async () => {
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
      if (state.attachmentRole === 'writer' && state.writable) return true;
      try {
        if (state.attachmentRole !== 'detached') {
          const detached: any = await api.detachSession(sessionId);
          if (detached?.ok === false) throw new Error(String(detached.error || 'reader detach rejected'));
          if (invalidated()) {
            await compensate();
            return false;
          }
        }
        const attached: any = await api.attachSession(sessionId, 'writer');
        if (attached?.ok === false) throw new Error(String(attached.error || 'writer attachment rejected'));
        if (invalidated()) {
          await compensate();
          return false;
        }
        const lease: any = await api.acquireRuntimeLease(sessionId, mode);
        if (lease?.ok === false) throw new Error(String(lease.error || 'writer lease rejected'));
        if (invalidated()) {
          await compensate();
          return false;
        }
        state.attachmentRole = 'writer';
        state.writable = true;
        state.degradedReason = '';
        return true;
      } catch (error: any) {
        await compensate();
        if (invalidated()) return false;
        try {
          const reader: any = await api.attachSession(sessionId, 'reader');
          if (reader?.ok === false) throw new Error(String(reader.error || 'reader fallback rejected'));
          if (invalidated()) {
            await compensate();
            return false;
          }
          state.attachmentRole = 'reader';
        } catch {
          state.attachmentRole = 'detached';
        }
        state.writable = false;
        state.degradedReason = String(error?.message || error || 'writer attachment unavailable');
        return false;
      }
    });
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
          const detached: any = await api.detachSession(sessionId);
          if (detached?.ok === false) throw new Error(String(detached.error || 'writer detach rejected'));
          if (invalidated()) return false;
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
    refreshStreamPriorities();
    const state = stateFor(sessionId);
    state.unread = 0;
    if (state.reconnectBlocked) return;
    connect(sessionId);
    const existing = openFlights.get(sessionId);
    if (existing) return existing;
    let flight!: Promise<void>;
    flight = Promise.all([attachReader(sessionId), load(sessionId)])
      .then(() => undefined)
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
    if (state.pending || state.submitting) {
      state.lastError = 'a primary turn is already running for this session';
      return false;
    }
    state.submitting = true;
    activeSessionId.value = sessionId;
    refreshStreamPriorities();
    connect(sessionId);
    const epoch = ++state.submissionEpoch;
    const idempotencyKey = uniqueSubmissionKey(sessionId);
    state.lastError = '';
    state.live = {
      ...(state.live || {}),
      status: 'queued',
      status_detail: 'acquiring writer attachment',
      last_progress_at_ms: Date.now(),
    };
    const localId = `local:${idempotencyKey}`;
    try {
      if (!state.writable && !(await attachSurface(sessionId))) {
        throw new Error(state.degradedReason || 'this WebUI tab is attached read-only');
      }
      if (state.submissionEpoch !== epoch || state.reconnectBlocked) return false;
      state.pending = true;
      state.turns.push({ id: localId, role: 'user', content, status: 'streaming' });
      state.streamTurnId = `stream:${sessionId}:${idempotencyKey}`;
      clearStreamByteEnds(sessionId);
      ensureStreamTurn(state);
      state.live = {
        ...(state.live || {}),
        status: 'queued',
        status_detail: 'submitting durable session input',
        last_progress_at_ms: Date.now(),
      };
      const receipt: any = await api.sendMessage(
        sessionId,
        options.transportContent || content,
        options.resourceIds || [],
        idempotencyKey,
      );
      if (state.submissionEpoch !== epoch || state.reconnectBlocked) return false;
      const localTurn = state.turns.find((turn) => turn.id === localId);
      if (localTurn) localTurn.status = 'complete';
      const executionId = String(receipt?.execution?.graph_id || receipt?.execution_id || '');
      adoptExecution(sessionId, executionId, String(receipt?.execution?.turn_id || ''), true);
      state.terminalId = String(receipt?.execution?.terminal_id || `turn-terminal:${idempotencyKey}`);
      state.live = {
        ...(state.live || {}),
        status: String(receipt?.execution?.status || 'accepted_pending_materialization') as SurfaceExecutionStatus,
        status_detail: String(receipt?.execution?.materialization?.state || 'accepted_pending_graph'),
        last_progress_at_ms: Date.now(),
      };
      if (state.executionId) {
        projections.acquire(
          state.executionId,
          `chat:${sessionId}`,
          'full',
          'bounded',
          sessionId,
        );
        await refreshProjection(sessionId);
      }
      return true;
    } catch (error: any) {
      if (state.submissionEpoch !== epoch || state.reconnectBlocked) return false;
      state.pending = false;
      state.lastError = String(error?.message || error || 'send failed');
      state.live = { ...(state.live || {}), status: 'error', status_detail: state.lastError, error: state.lastError };
      state.turns = state.turns.filter((turn) => turn.id !== localId && turn.id !== state.streamTurnId);
      state.streamTurnId = '';
      void releaseWriter(sessionId);
      return false;
    } finally {
      if (state.submissionEpoch === epoch) {
        state.submitting = false;
        refreshStreamPriorities();
      }
    }
  }

  async function stop(sessionId: string) {
    const state = stateFor(sessionId);
    if (!state.writable && !(await attachSurface(sessionId))) {
      state.lastError = state.degradedReason || 'this WebUI tab is attached read-only';
      return false;
    }
    const receipt: any = await api.cancelSessionTurn(sessionId);
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
    cancelSessionReconnect(sessionId);
    closeSessionStream(sessionId);
    projections.release(`chat:${sessionId}`);
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    deltaBuffers.delete(sessionId);
    clearStreamByteEnds(sessionId);
    state.streamState = 'offline';
    state.degradedReason = '';
    state.writable = false;
    promoteDeferredStreams();
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
      streams.get(sessionId),
      String(detail.reason || 'Gateway revoked this session observer'),
    );
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('cowd:authorization-invalidated', authorizationInvalidated);
    window.addEventListener('cowd:session-authorization-invalidated', sessionAuthorizationInvalidated);
    onScopeDispose(() => {
      window.removeEventListener('cowd:authorization-invalidated', authorizationInvalidated);
      window.removeEventListener('cowd:session-authorization-invalidated', sessionAuthorizationInvalidated);
    });
  }

  function setDraft(sessionId: string, value: string) {
    stateFor(sessionId).draft = value;
  }

  function setScrollTop(sessionId: string, value: number) {
    stateFor(sessionId).scrollTop = Math.max(0, Number(value) || 0);
  }

  return {
    states,
    activeSessionId,
    active,
    activeStreamCount,
    maxActiveStreams: MAX_ACTIVE_SESSION_STREAMS,
    open,
    load,
    loadOlder,
    loadLatest,
    send,
    stop,
    close,
    refreshProjection,
    attachSurface,
    detachSurface,
    failClosedAllSessionAuthorization,
    refreshAuthorization,
    setDraft,
    setScrollTop,
  };
});
