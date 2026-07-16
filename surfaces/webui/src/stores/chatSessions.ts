import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { api } from '../api/client';
import type {
  ChatTurn,
  ExecutionLiveState,
  SessionEvidenceProjection,
} from '../types';
import { useProjectionRegistryStore } from './projectionRegistry';

type LiveExecutionState = Pick<ExecutionLiveState, 'status'>
  & Partial<Omit<ExecutionLiveState, 'status'>>;

export type SessionChatState = {
  sessionId: string;
  turns: ChatTurn[];
  executionId: string;
  live: LiveExecutionState | null;
  evidence: SessionEvidenceProjection | null;
  streamState: 'connected' | 'connecting' | 'reconnecting' | 'offline';
  requestEpoch: number;
  pending: boolean;
  lastError: string;
  unread: number;
};

const states = reactive<Record<string, SessionChatState>>({});
const streams = new Map<string, EventSource>();
const deltaBuffers = new Map<string, string>();
const flushFrames = new Map<string, number>();

function stateFor(sessionId: string) {
  if (!states[sessionId]) {
    states[sessionId] = {
      sessionId, turns: [], executionId: '', live: null, evidence: null, streamState: 'offline',
      requestEpoch: 0, pending: false, lastError: '', unread: 0,
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
      if (projection.live) state.live = projection.live;
      const status = String(projection.live?.status || state.live?.status || '');
      if (['complete', 'error', 'cancelled'].includes(status)) {
        const wasPending = state.pending;
        state.pending = false;
        if (wasPending) await load(sessionId);
      }
    }
  }

  function connect(sessionId: string) {
    if (streams.has(sessionId)) return;
    const state = stateFor(sessionId);
    state.streamState = 'connecting';
    const stream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
    streams.set(sessionId, stream);
    stream.onopen = () => { state.streamState = 'connected'; };
    stream.onerror = () => { state.streamState = 'reconnecting'; };
    stream.onmessage = (event) => {
      let payload: any;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type === 'session_stream_resync' || payload.type === 'RuntimeStreamLagged') {
        load(sessionId).catch(() => undefined);
        refreshProjection(sessionId).catch(() => undefined);
        return;
      }
      if (payload.type === 'TextDelta') {
        queueDelta(sessionId, String(payload.text || payload.content || ''));
      }
      if (payload.type === 'ExecutionPhase') {
        state.live = {
          ...(state.live || {}),
          status: payload.status,
          status_detail: payload.detail,
          last_progress_at_ms: Date.now(),
        };
      }
      if (payload.type === 'TerminalCommitted') {
        state.pending = false;
        state.live = { ...(state.live || {}), status: 'complete', last_progress_at_ms: Date.now() };
        load(sessionId).catch(() => undefined);
        refreshProjection(sessionId).catch(() => undefined);
      }
    };
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
    const epoch = ++state.requestEpoch;
    state.lastError = '';
    state.pending = true;
    state.live = {
      ...(state.live || {}),
      status: 'queued',
      status_detail: 'message accepted locally',
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
        `webui:${sessionId}:${epoch}`,
      );
      if (state.requestEpoch !== epoch) return false;
      state.executionId = String(receipt?.execution?.graph_id || receipt?.execution_id || '');
      if (state.executionId) {
        projections.acquire(state.executionId, `chat:${sessionId}`, 'full');
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
  }

  return { states, activeSessionId, active, open, load, send, stop, close, refreshProjection };
});
