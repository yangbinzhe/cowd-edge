import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { api } from '../api/client';
import type {
  ChatTurn,
  ExecutionLiveState,
  SessionEvidenceProjection,
} from '../types';
import { useProjectionRegistryStore } from './projectionRegistry';

type SurfaceExecutionStatus = ExecutionLiveState['status'] | 'accepted_pending_materialization' | 'running' | 'terminal';
type LiveExecutionState = Omit<ExecutionLiveState, 'status'>
  & { status: SurfaceExecutionStatus }
  & Partial<Omit<ExecutionLiveState, 'status'>>;

export type SessionChatState = {
  sessionId: string;
  turns: ChatTurn[];
  executionId: string;
  terminalId: string;
  live: LiveExecutionState | null;
  evidence: SessionEvidenceProjection | null;
  streamState: 'connected' | 'connecting' | 'reconnecting' | 'degraded' | 'offline';
  requestEpoch: number;
  pending: boolean;
  lastError: string;
  unread: number;
  lastEventAtMs: number;
  lastProgressAtMs: number;
  degradedReason: string;
  resyncCount: number;
};

const states = reactive<Record<string, SessionChatState>>({});
const streams = new Map<string, EventSource>();
const deltaBuffers = new Map<string, string>();
const flushFrames = new Map<string, number>();
export const MAX_ACTIVE_SESSION_STREAMS = 12;

function stateFor(sessionId: string) {
  if (!states[sessionId]) {
    states[sessionId] = {
      sessionId, turns: [], executionId: '', terminalId: '', live: null, evidence: null, streamState: 'offline',
      requestEpoch: 0, pending: false, lastError: '', unread: 0,
      lastEventAtMs: 0, lastProgressAtMs: 0, degradedReason: '', resyncCount: 0,
    };
  }
  return states[sessionId];
}

function textFromBlocks(blocks: any[]) {
  return (blocks || []).map((block) => block?.text || block?.content || block?.output || block?.thinking || '').join('');
}

function normalizeTurns(messages: any[]): ChatTurn[] {
  return (messages || []).map((message: any, index: number) => ({
    id: String(message.id || message.message_id || `message-${index}`),
    role: ['user', 'assistant', 'system'].includes(String(message.role)) ? message.role : 'assistant',
    content: typeof message.content === 'string' ? message.content : textFromBlocks(message.blocks),
    status: 'complete', sequence: message.sequence, blocks: message.blocks, token_usage: message.usage,
  }));
}

function flush(sessionId: string) {
  flushFrames.delete(sessionId);
  const delta = deltaBuffers.get(sessionId);
  if (!delta) return;
  deltaBuffers.delete(sessionId);
  const state = stateFor(sessionId);
  const turn = state.turns.find((item) => item.id === `stream:${sessionId}`);
  if (turn) turn.content += delta.slice(0, 12_000);
}

function queueDelta(sessionId: string, content: string) {
  deltaBuffers.set(sessionId, `${deltaBuffers.get(sessionId) || ''}${content}`);
  if (!flushFrames.has(sessionId)) {
    flushFrames.set(sessionId, requestAnimationFrame(() => flush(sessionId)));
  }
}

export const useChatSessionsStore = defineStore('chatSessions', () => {
  const projections = useProjectionRegistryStore();
  const activeSessionId = ref('');
  const active = computed(() => activeSessionId.value ? stateFor(activeSessionId.value) : null);
  const activeStreamCount = computed(() => streams.size);

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

  async function load(sessionId: string) {
    const state = stateFor(sessionId);
    const epoch = ++state.requestEpoch;
    const [data, evidence, execution] = await Promise.all([
      api.messages(sessionId),
      api.sessionEvidence(sessionId),
      api.sessionExecution(sessionId),
    ]);
    if (state.requestEpoch !== epoch) return;
    const streaming = state.turns.find((turn) => turn.id === `stream:${sessionId}` && turn.content);
    state.turns = normalizeTurns(data.messages);
    state.evidence = evidence;
    const recoveredExecutionId = String(execution.latest_execution_id || '');
    if (!state.executionId && recoveredExecutionId) state.executionId = recoveredExecutionId;
    if (streaming && !state.turns.some((turn) => turn.role === 'assistant' && turn.content === streaming.content)) state.turns.push(streaming);
    if (state.executionId) {
      projections.acquire(state.executionId, `chat:${sessionId}`, 'full');
      refreshProjection(sessionId).catch(() => undefined);
    }
  }

  async function refreshProjection(sessionId: string) {
    const state = stateFor(sessionId);
    if (!state.executionId) return;
    const projection = await projections.load(state.executionId, 'full');
    if (projection?.execution_id === state.executionId) {
      state.degradedReason = '';
      if (projection.live) state.live = projection.live;
      const status = String(projection.live?.status || state.live?.status || '');
      if (['complete', 'error', 'cancelled'].includes(status)) {
        const wasPending = state.pending;
        state.pending = false;
        if (wasPending) await load(sessionId);
      }
    } else {
      const entry = projections.entries[state.executionId];
      if (entry?.connectionState === 'degraded') {
        state.degradedReason = entry.degradedReason || entry.lastError;
      }
    }
  }

  function connect(sessionId: string) {
    if (streams.has(sessionId)) return;
    const state = stateFor(sessionId);
    if (streams.size >= MAX_ACTIVE_SESSION_STREAMS) {
      state.streamState = 'degraded';
      state.degradedReason = `session connection budget reached (${MAX_ACTIVE_SESSION_STREAMS})`;
      return;
    }
    state.streamState = 'connecting';
    state.degradedReason = '';
    if (typeof EventSource === 'undefined') {
      state.streamState = 'offline';
      return;
    }
    const stream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
    streams.set(sessionId, stream);
    stream.onopen = () => {
      state.streamState = 'connected';
      state.lastEventAtMs = Date.now();
    };
    stream.onerror = () => { state.streamState = 'reconnecting'; };
    stream.onmessage = (event) => {
      let payload: any;
      try { payload = JSON.parse(event.data); } catch { return; }
      state.lastEventAtMs = Date.now();
      if (payload.type === 'session_stream_resync' || payload.type === 'RuntimeStreamLagged') {
        state.resyncCount += 1;
        load(sessionId).catch(() => undefined);
        refreshProjection(sessionId).catch(() => undefined);
        return;
      }
      if (payload.type === 'TextDelta' && matchesActiveExecution(state, payload)) {
        recordProgress(sessionId);
        queueDelta(sessionId, String(payload.text || payload.content || ''));
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
      if (payload.type === 'TerminalCommitted') {
        const settlesCurrentTurn = !payload.replayed
          && matchesActiveExecution(state, payload)
          && !!state.terminalId
          && payload.terminal_id === state.terminalId;
        if (settlesCurrentTurn) {
          recordProgress(sessionId);
          state.pending = false;
          state.live = { ...(state.live || {}), status: 'complete', last_progress_at_ms: Date.now() };
        }
        // Replayed and unrelated terminals are durable transcript facts, not
        // lifecycle transitions for the currently selected execution.
        load(sessionId).catch(() => undefined);
        if (settlesCurrentTurn) refreshProjection(sessionId).catch(() => undefined);
      }
    };
  }

  function promoteDeferredStreams() {
    if (streams.size >= MAX_ACTIVE_SESSION_STREAMS) return;
    Object.values(states)
      .filter((state) => state.streamState === 'degraded')
      .sort((left, right) => left.lastEventAtMs - right.lastEventAtMs)
      .slice(0, MAX_ACTIVE_SESSION_STREAMS - streams.size)
      .forEach((state) => connect(state.sessionId));
  }

  async function open(sessionId: string) {
    if (!sessionId) return;
    activeSessionId.value = sessionId;
    const state = stateFor(sessionId);
    state.unread = 0;
    connect(sessionId);
    await load(sessionId);
  }

  async function send(
    sessionId: string,
    content: string,
    options: { transportContent?: string; resourceIds?: string[] } = {},
  ) {
    const state = stateFor(sessionId);
    if (state.pending) {
      state.lastError = 'a primary turn is already running for this session';
      return false;
    }
    const epoch = ++state.requestEpoch;
    const idempotencyKey = `webui:${sessionId}:${epoch}`;
    state.lastError = '';
    state.pending = true;
    state.live = {
      ...(state.live || {}),
      status: 'queued',
      status_detail: 'submitting durable session input',
      last_progress_at_ms: Date.now(),
    };
    state.turns.push({ id: `local:${epoch}`, role: 'user', content, status: 'complete' });
    if (!state.turns.some((turn) => turn.id === `stream:${sessionId}`)) {
      state.turns.push({ id: `stream:${sessionId}`, role: 'assistant', content: '', status: 'streaming' });
    }
    try {
      const receipt: any = await api.sendMessage(
        sessionId,
        options.transportContent || content,
        options.resourceIds || [],
        idempotencyKey,
      );
      if (state.requestEpoch !== epoch) return false;
      state.executionId = String(receipt?.execution?.graph_id || receipt?.execution_id || '');
      state.terminalId = String(receipt?.execution?.terminal_id || `turn-terminal:${idempotencyKey}`);
      state.live = {
        ...(state.live || {}),
        status: String(receipt?.execution?.status || 'accepted_pending_materialization') as SurfaceExecutionStatus,
        status_detail: String(receipt?.execution?.materialization?.state || 'accepted_pending_graph'),
        last_progress_at_ms: Date.now(),
      };
      if (state.executionId) {
        projections.acquire(state.executionId, `chat:${sessionId}`, 'full', 'bounded');
        await refreshProjection(sessionId);
      }
      return true;
    } catch (error: any) {
      if (state.requestEpoch !== epoch) return;
      state.pending = false;
      state.lastError = String(error?.message || error || 'send failed');
      state.live = { ...(state.live || {}), status: 'error', status_detail: state.lastError, error: state.lastError };
      const stream = state.turns.find((turn) => turn.id === `stream:${sessionId}`);
      if (stream) stream.status = 'error';
      return false;
    }
  }

  async function stop(sessionId: string) {
    await api.cancelSessionTurn(sessionId);
    const state = stateFor(sessionId);
    state.pending = false;
    await refreshProjection(sessionId);
  }

  function close(sessionId: string) {
    streams.get(sessionId)?.close();
    streams.delete(sessionId);
    projections.release(`chat:${sessionId}`);
    const frame = flushFrames.get(sessionId);
    if (frame) cancelAnimationFrame(frame);
    flushFrames.delete(sessionId);
    deltaBuffers.delete(sessionId);
    const state = stateFor(sessionId);
    state.streamState = 'offline';
    state.degradedReason = '';
    promoteDeferredStreams();
  }

  return {
    states,
    activeSessionId,
    active,
    activeStreamCount,
    maxActiveStreams: MAX_ACTIVE_SESSION_STREAMS,
    open,
    load,
    send,
    stop,
    close,
    refreshProjection,
  };
});
