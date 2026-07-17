import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';
import { api } from '../api/client';
import type { ExecutionProjection, ExecutionProjectionDelta } from '../types';

export type ProjectionDetailScope = 'summary' | 'full';
export type ProjectionConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'degraded' | 'stale' | 'offline' | 'error' | 'terminal';

export interface ExecutionProjectionRegistryEntry {
  executionId: string;
  projection: ExecutionProjection | null;
  cursor: number;
  detailScope: ProjectionDetailScope;
  connectionState: ProjectionConnectionState;
  lastUpdatedAt: number;
  lastEventAt: number;
  lastError: string;
  degradedReason: string;
  resyncCount: number;
  requestEpoch: number;
  reconnectBlocked: boolean;
  consumers: Record<string, ProjectionDetailScope>;
}

const terminalStatuses = new Set(['complete', 'cancelled', 'error']);
export const MAX_ACTIVE_PROJECTION_STREAMS = 8;
const PROJECTION_RECONNECT_BASE_MS = 250;
const PROJECTION_RECONNECT_MAX_MS = 5_000;

export const useProjectionRegistryStore = defineStore('projectionRegistry', () => {
  const entries = reactive<Record<string, ExecutionProjectionRegistryEntry>>({});
  const streams = new Map<string, EventSource>();
  const streamScopes = new Map<string, ProjectionDetailScope>();
  const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const reconnectAttempts = new Map<string, number>();
  const consumerExecutions = new Map<string, string>();
  const activeStreamCount = computed(() => streams.size);

  function ensureEntry(executionId: string) {
    if (!entries[executionId]) {
      entries[executionId] = {
        executionId,
        projection: null,
        cursor: 0,
        detailScope: 'summary',
        connectionState: 'idle',
        lastUpdatedAt: 0,
        lastEventAt: 0,
        lastError: '',
        degradedReason: '',
        resyncCount: 0,
        requestEpoch: 0,
        reconnectBlocked: false,
        consumers: {},
      };
    }
    return entries[executionId];
  }

  function desiredScope(entry: ExecutionProjectionRegistryEntry): ProjectionDetailScope {
    return Object.values(entry.consumers).includes('full') ? 'full' : 'summary';
  }

  function isTerminal(projection: ExecutionProjection | null) {
    return terminalStatuses.has(String(projection?.live?.status || '').toLowerCase());
  }

  function failClosed(
    entry: ExecutionProjectionRegistryEntry,
    message: string,
    state: ProjectionConnectionState = 'error',
  ) {
    cancelReconnect(entry.executionId);
    closeStream(entry.executionId);
    entry.requestEpoch += 1;
    entry.reconnectBlocked = true;
    entry.projection = null;
    entry.cursor = 0;
    entry.connectionState = state;
    entry.lastError = message;
    entry.lastUpdatedAt = Date.now();
  }

  function hasActiveConsumer(entry: ExecutionProjectionRegistryEntry) {
    return Object.keys(entry.consumers).length > 0;
  }

  function cancelReconnect(executionId: string, resetAttempt = true) {
    const timer = reconnectTimers.get(executionId);
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(executionId);
    if (resetAttempt) reconnectAttempts.delete(executionId);
  }

  function scheduleReconnect(executionId: string, requestedScope?: ProjectionDetailScope) {
    const entry = entries[executionId];
    if (!entry
      || entry.reconnectBlocked
      || !hasActiveConsumer(entry)
      || isTerminal(entry.projection)
      || streams.has(executionId)) return;
    if (reconnectTimers.has(executionId)) return;
    const attempt = reconnectAttempts.get(executionId) || 0;
    const delay = Math.min(
      PROJECTION_RECONNECT_BASE_MS * (2 ** Math.min(attempt, 5)),
      PROJECTION_RECONNECT_MAX_MS,
    );
    reconnectAttempts.set(executionId, attempt + 1);
    entry.connectionState = 'reconnecting';
    const timer = setTimeout(() => {
      reconnectTimers.delete(executionId);
      if (!hasActiveConsumer(entry) || isTerminal(entry.projection)) return;
      connect(executionId, requestedScope);
    }, delay);
    reconnectTimers.set(executionId, timer);
  }

  async function load(executionId: string, requestedScope?: ProjectionDetailScope) {
    const id = executionId.trim();
    if (!id) return null;
    const entry = ensureEntry(id);
    const scope = requestedScope || desiredScope(entry);
    const epoch = ++entry.requestEpoch;
    if (!entry.projection && !entry.degradedReason) entry.connectionState = 'connecting';
    try {
      const projection = await api.executionProjection(id, scope);
      if (entry.requestEpoch !== epoch) return entry.projection;
      if (projection.__state && projection.__state !== 'ready') {
        const message = String(projection.__error || projection.__state);
        if (['forbidden', 'unauthorized'].includes(String(projection.__state))) {
          failClosed(entry, message);
          return null;
        }
        entry.connectionState = entry.projection ? 'stale' : 'error';
        entry.lastError = message;
        // A receipt can reference an execution before Gateway has materialized
        // its projection, or it can reference an execution that no longer
        // exists. Keeping EventSource alive in that state creates an immediate
        // 404 reconnect loop in Chromium and can starve every shell control.
        // A later acquire/load can reconnect after a valid snapshot exists.
        if (!entry.projection) closeStream(id);
        if (!entry.projection) scheduleReconnect(id, scope);
        return entry.projection;
      }
      if (Number(projection.schema_version) !== 1) {
        failClosed(
          entry,
          `unsupported execution projection schema_version ${String(projection.schema_version)}`,
        );
        return null;
      }
      const strategySchemaVersion = projection.strategy?.schema_version;
      if (strategySchemaVersion != null && Number(strategySchemaVersion) !== 1) {
        failClosed(
          entry,
          `unsupported strategy projection schema_version ${String(strategySchemaVersion)}`,
        );
        return null;
      }
      if (projection.execution_id !== id) return entry.projection;
      if (entry.projection && Number(projection.revision || 0) < Number(entry.projection.revision || 0)) {
        entry.lastError = 'ignored projection snapshot with a lower revision';
        return entry.projection;
      }
      entry.projection = projection;
      entry.reconnectBlocked = false;
      entry.cursor = Number(projection.cursor || 0);
      entry.detailScope = scope;
      entry.lastUpdatedAt = Date.now();
      entry.lastError = '';
      if (isTerminal(projection)) {
        cancelReconnect(id);
        closeStream(id);
        entry.connectionState = 'terminal';
        promoteDeferredStreams();
      } else {
        entry.connectionState = streams.has(id) ? 'live' : (entry.degradedReason ? 'degraded' : 'offline');
      }
      return projection;
    } catch (error) {
      if (entry.requestEpoch !== epoch) return entry.projection;
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.connectionState = entry.projection ? 'stale' : 'error';
      if (!entry.projection) {
        closeStream(id);
        scheduleReconnect(id, scope);
      }
      return entry.projection;
    }
  }

  function applyDelta(delta: ExecutionProjectionDelta) {
    const entry = entries[delta.execution_id];
    if (Number(delta.schema_version) !== 1) {
      if (entry) {
        failClosed(
          entry,
          `unsupported execution projection delta schema_version ${String(delta.schema_version)}`,
        );
      }
      return;
    }
    if (!entry || entry.cursor !== delta.base_cursor || delta.target_cursor < delta.base_cursor) {
      if (entry) {
        entry.resyncCount += 1;
        entry.lastError = `projection cursor mismatch (${entry.cursor} -> ${delta.base_cursor})`;
      }
      void load(delta.execution_id);
      return;
    }
    entry.cursor = delta.target_cursor;
    entry.lastUpdatedAt = Date.now();
    entry.lastEventAt = entry.lastUpdatedAt;
    if (delta.events.length) void load(delta.execution_id);
  }

  function closeStream(executionId: string) {
    streams.get(executionId)?.close();
    streams.delete(executionId);
    streamScopes.delete(executionId);
  }

  function promoteDeferredStreams() {
    if (streams.size >= MAX_ACTIVE_PROJECTION_STREAMS) return;
    Object.values(entries)
      .filter((entry) => entry.connectionState === 'degraded' && Object.keys(entry.consumers).length > 0)
      .sort((left, right) => left.lastUpdatedAt - right.lastUpdatedAt)
      .slice(0, MAX_ACTIVE_PROJECTION_STREAMS - streams.size)
      .forEach((entry) => connect(entry.executionId));
  }

  function connect(executionId: string, requestedScope?: ProjectionDetailScope) {
    const entry = ensureEntry(executionId);
    const scope = requestedScope || desiredScope(entry);
    if (streams.has(executionId) && streamScopes.get(executionId) === scope) return;
    cancelReconnect(executionId, false);
    closeStream(executionId);
    entry.detailScope = scope;
    if (streams.size >= MAX_ACTIVE_PROJECTION_STREAMS) {
      entry.connectionState = 'degraded';
      entry.degradedReason = `projection connection budget reached (${MAX_ACTIVE_PROJECTION_STREAMS})`;
      void load(executionId, scope);
      return;
    }
    entry.connectionState = 'connecting';
    entry.degradedReason = '';
    void load(executionId, scope);
    if (typeof EventSource === 'undefined') {
      entry.connectionState = entry.projection ? 'offline' : 'connecting';
      return;
    }
    const stream = new EventSource(`/api/runtime/executions/${encodeURIComponent(executionId)}/events?cursor=${entry.cursor}&detail_scope=${scope}`);
    streams.set(executionId, stream);
    streamScopes.set(executionId, scope);
    stream.onopen = () => {
      if (streams.get(executionId) === stream) {
        reconnectAttempts.delete(executionId);
        entry.lastEventAt = Date.now();
        entry.connectionState = isTerminal(entry.projection) ? 'terminal' : 'live';
      }
    };
    stream.addEventListener('projection_delta', (event) => {
      try {
        entry.lastEventAt = Date.now();
        applyDelta(JSON.parse((event as MessageEvent).data) as ExecutionProjectionDelta);
      } catch (error) {
        entry.lastError = error instanceof Error ? error.message : String(error);
        void load(executionId, scope);
      }
    });
    stream.addEventListener('projection_resync', () => {
      entry.lastEventAt = Date.now();
      entry.resyncCount += 1;
      void load(executionId, scope);
    });
    stream.addEventListener('projection_authorization_revoked', () => {
      if (streams.get(executionId) === stream) {
        // Gateway revalidated a stream that was opened under an older
        // credential.  Do not retain its last full snapshot or schedule a
        // retry with that credential: the next user-authenticated refresh is
        // the only authority allowed to restore it.
        failClosed(entry, 'Gateway revoked the execution projection stream');
      }
    });
    stream.onerror = () => {
      if (streams.get(executionId) === stream && !isTerminal(entry.projection)) {
        closeStream(executionId);
        entry.connectionState = 'reconnecting';
        void load(executionId, scope).then(() => scheduleReconnect(executionId, scope));
      }
    };
  }

  function refreshAuthorization() {
    const reconnect = Object.values(entries)
      .filter((entry) => Object.keys(entry.consumers).length > 0)
      .map((entry) => entry.executionId);
    for (const entry of Object.values(entries)) {
      failClosed(entry, 'authorization context changed; reloading projection', 'connecting');
    }
    reconnect.forEach((executionId) => {
      const entry = entries[executionId];
      if (!entry) return;
      // Only an explicit post-login/profile refresh may clear the auth stop
      // latch. A transport error or server-side revoke must stay closed until
      // this authenticated user action occurs.
      entry.reconnectBlocked = false;
      connect(executionId);
    });
  }

  function acquire(executionId: string, consumer: string, scope: ProjectionDetailScope = 'summary') {
    const id = executionId.trim();
    if (!id || !consumer.trim()) return;
    const previous = consumerExecutions.get(consumer);
    if (previous && previous !== id) release(consumer);
    const entry = ensureEntry(id);
    entry.consumers[consumer] = scope;
    consumerExecutions.set(consumer, id);
    connect(id);
  }

  function release(consumer: string) {
    const executionId = consumerExecutions.get(consumer);
    if (!executionId) return;
    consumerExecutions.delete(consumer);
    const entry = entries[executionId];
    if (!entry) return;
    delete entry.consumers[consumer];
    if (!Object.keys(entry.consumers).length) {
      cancelReconnect(executionId);
      closeStream(executionId);
      entry.connectionState = isTerminal(entry.projection) ? 'terminal' : 'offline';
      entry.degradedReason = '';
      promoteDeferredStreams();
      return;
    }
    connect(executionId);
  }

  function projectionFor(executionId: string) {
    return entries[executionId]?.projection || null;
  }

  function stateFor(executionId: string) {
    return entries[executionId]?.connectionState || 'idle';
  }

  async function executeCommand(executionId: string, command: string, payload: Record<string, unknown> = {}) {
    const entry = entries[executionId];
    const projection = entry?.projection;
    if (!projection) return null;
    const result = await api.executeProjectionCommand(executionId, {
      command_id: `webui-${executionId}-${Date.now()}`,
      expected_revision: projection.revision,
      command,
      payload,
    });
    if (result?.status === 'accepted') await load(executionId, entry.detailScope);
    return result;
  }

  return {
    entries,
    activeStreamCount,
    maxActiveStreams: MAX_ACTIVE_PROJECTION_STREAMS,
    acquire,
    release,
    load,
    applyDelta,
    projectionFor,
    stateFor,
    executeCommand,
    refreshAuthorization,
  };
});
