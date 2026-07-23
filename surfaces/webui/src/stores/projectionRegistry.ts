import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';
import { api } from '../api/client';
import type { ExecutionProjection, ExecutionProjectionDelta } from '../types';

export type ProjectionDetailScope = 'summary' | 'full';
export type ProjectionConnectionState = 'idle' | 'materializing' | 'connecting' | 'live' | 'reconnecting' | 'degraded' | 'stale' | 'offline' | 'error' | 'terminal';

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
  materializingConsumers: Record<string, boolean>;
}

const terminalStatuses = new Set(['complete', 'cancelled', 'error']);
export const MAX_ACTIVE_PROJECTION_STREAMS = 8;
const INITIAL_MATERIALIZATION_DELAYS_MS = [50, 100, 200, 400, 800, 1_600];
const PROJECTION_RECONNECT_BASE_MS = 250;
const PROJECTION_RECONNECT_MAX_MS = 5_000;
const MAX_STREAM_RECONNECT_ATTEMPTS = 8;

export const useProjectionRegistryStore = defineStore('projectionRegistry', () => {
  const entries = reactive<Record<string, ExecutionProjectionRegistryEntry>>({});
  const streams = new Map<string, EventSource>();
  const streamScopes = new Map<string, ProjectionDetailScope>();
  const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const initialMaterializationAttempts = new Map<string, number>();
  const streamReconnectAttempts = new Map<string, number>();
  const connectionLoads = new Set<string>();
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
        materializingConsumers: {},
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

  // A restored historical receipt may outlive its graph. Only a fresh send or
  // an explicitly opened control-plane consumer receives a bounded initial
  // materialization budget; passive chat restore must never poll forever.
  function allowsInitialSnapshotRetry(entry: ExecutionProjectionRegistryEntry) {
    return Object.entries(entry.consumers).some(([consumer]) => (
      !consumer.startsWith('chat:') || entry.materializingConsumers[consumer]
    ));
  }

  function cancelReconnect(executionId: string, resetAttempts = true) {
    const timer = reconnectTimers.get(executionId);
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(executionId);
    if (resetAttempts) {
      initialMaterializationAttempts.delete(executionId);
      streamReconnectAttempts.delete(executionId);
    }
  }

  function scheduleInitialMaterialization(executionId: string, requestedScope?: ProjectionDetailScope) {
    const entry = entries[executionId];
    if (!entry
      || entry.reconnectBlocked
      || !hasActiveConsumer(entry)
      || isTerminal(entry.projection)
      || streams.has(executionId)) return;
    if (reconnectTimers.has(executionId)) return;
    const attempt = initialMaterializationAttempts.get(executionId) || 0;
    if (attempt >= INITIAL_MATERIALIZATION_DELAYS_MS.length) {
      entry.connectionState = 'degraded';
      entry.degradedReason = 'execution graph did not materialize within the bounded observer window';
      entry.lastUpdatedAt = Date.now();
      return;
    }
    const delay = INITIAL_MATERIALIZATION_DELAYS_MS[attempt];
    initialMaterializationAttempts.set(executionId, attempt + 1);
    entry.connectionState = 'materializing';
    const timer = setTimeout(() => {
      reconnectTimers.delete(executionId);
      if (!hasActiveConsumer(entry) || isTerminal(entry.projection)) return;
      establishConnection(executionId, requestedScope);
    }, delay);
    reconnectTimers.set(executionId, timer);
  }

  function scheduleStreamReconnect(executionId: string, requestedScope?: ProjectionDetailScope) {
    const entry = entries[executionId];
    if (!entry
      || entry.reconnectBlocked
      || !hasActiveConsumer(entry)
      || isTerminal(entry.projection)
      || streams.has(executionId)
      || reconnectTimers.has(executionId)) return;
    const attempt = streamReconnectAttempts.get(executionId) || 0;
    if (attempt >= MAX_STREAM_RECONNECT_ATTEMPTS) {
      entry.connectionState = 'degraded';
      entry.degradedReason = 'execution projection stream reconnect budget exhausted';
      entry.lastUpdatedAt = Date.now();
      return;
    }
    const delay = Math.min(
      PROJECTION_RECONNECT_BASE_MS * (2 ** Math.min(attempt, 5)),
      PROJECTION_RECONNECT_MAX_MS,
    );
    streamReconnectAttempts.set(executionId, attempt + 1);
    entry.connectionState = 'reconnecting';
    const timer = setTimeout(() => {
      reconnectTimers.delete(executionId);
      if (!hasActiveConsumer(entry) || isTerminal(entry.projection)) return;
      establishConnection(executionId, requestedScope);
    }, delay);
    reconnectTimers.set(executionId, timer);
  }

  async function load(executionId: string, requestedScope?: ProjectionDetailScope) {
    const id = executionId.trim();
    if (!id) return null;
    const entry = ensureEntry(id);
    const scope = requestedScope || desiredScope(entry);
    const epoch = ++entry.requestEpoch;
    if (!entry.projection && !entry.degradedReason) entry.connectionState = 'materializing';
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
        // The connection owner decides whether this missing snapshot receives
        // a bounded retry. `load` itself never creates a transport or timer,
        // so an incidental refresh cannot turn a stale receipt into a loop.
        if (!entry.projection) {
          closeStream(id);
        }
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
      initialMaterializationAttempts.delete(id);
      streamReconnectAttempts.delete(id);
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
          'stale',
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
      .filter((entry) => entry.connectionState === 'degraded'
        && entry.degradedReason.startsWith('projection connection budget')
        && Object.keys(entry.consumers).length > 0)
      .sort((left, right) => left.lastUpdatedAt - right.lastUpdatedAt)
      .slice(0, MAX_ACTIVE_PROJECTION_STREAMS - streams.size)
      .forEach((entry) => establishConnection(entry.executionId));
  }

  function establishConnection(executionId: string, requestedScope?: ProjectionDetailScope) {
    const entry = ensureEntry(executionId);
    const scope = requestedScope || desiredScope(entry);
    if (streams.has(executionId) && streamScopes.get(executionId) === scope) return;
    entry.detailScope = scope;
    if (streams.size >= MAX_ACTIVE_PROJECTION_STREAMS) {
      entry.connectionState = 'degraded';
      entry.degradedReason = `projection connection budget reached (${MAX_ACTIVE_PROJECTION_STREAMS})`;
      return;
    }
    if (connectionLoads.has(executionId)) return;
    connectionLoads.add(executionId);
    void (async () => {
      try {
        const projection = await load(executionId, scope);
        if (!hasActiveConsumer(entry) || entry.reconnectBlocked || isTerminal(entry.projection)) return;
        if (projection?.execution_id === executionId) {
          openStream(executionId, scope);
        } else if (!entry.projection && allowsInitialSnapshotRetry(entry)) {
          scheduleInitialMaterialization(executionId, scope);
        }
      } finally {
        connectionLoads.delete(executionId);
      }
    })();
  }

  function openStream(executionId: string, scope: ProjectionDetailScope) {
    const entry = ensureEntry(executionId);
    if (!entry.projection || isTerminal(entry.projection)) return;
    if (streams.has(executionId) && streamScopes.get(executionId) === scope) return;
    cancelReconnect(executionId, false);
    closeStream(executionId);
    if (typeof EventSource === 'undefined') {
      entry.connectionState = 'offline';
      return;
    }
    entry.connectionState = 'connecting';
    entry.degradedReason = '';
    const stream = new EventSource(`/api/runtime/executions/${encodeURIComponent(executionId)}/events?cursor=${entry.cursor}&detail_scope=${scope}`);
    streams.set(executionId, stream);
    streamScopes.set(executionId, scope);
    stream.onopen = () => {
      if (streams.get(executionId) === stream) {
        streamReconnectAttempts.delete(executionId);
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
        scheduleStreamReconnect(executionId, scope);
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
      establishConnection(executionId);
    });
  }

  function acquire(
    executionId: string,
    consumer: string,
    scope: ProjectionDetailScope = 'summary',
    initialSnapshotPolicy: 'passive' | 'bounded' = consumer.startsWith('chat:') ? 'passive' : 'bounded',
  ) {
    const id = executionId.trim();
    if (!id || !consumer.trim()) return;
    const previous = consumerExecutions.get(consumer);
    if (previous && previous !== id) release(consumer);
    const entry = ensureEntry(id);
    const wasMaterializing = !!entry.materializingConsumers[consumer];
    entry.consumers[consumer] = scope;
    entry.materializingConsumers[consumer] = initialSnapshotPolicy === 'bounded';
    consumerExecutions.set(consumer, id);
    if (!entry.projection && initialSnapshotPolicy === 'bounded' && !wasMaterializing) {
      cancelReconnect(id, false);
      initialMaterializationAttempts.delete(id);
      entry.degradedReason = '';
      entry.lastError = '';
    }
    establishConnection(id);
  }

  function release(consumer: string) {
    const executionId = consumerExecutions.get(consumer);
    if (!executionId) return;
    consumerExecutions.delete(consumer);
    const entry = entries[executionId];
    if (!entry) return;
    delete entry.consumers[consumer];
    delete entry.materializingConsumers[consumer];
    if (!Object.keys(entry.consumers).length) {
      cancelReconnect(executionId);
      closeStream(executionId);
      entry.connectionState = isTerminal(entry.projection) ? 'terminal' : 'offline';
      entry.degradedReason = '';
      promoteDeferredStreams();
      return;
    }
    establishConnection(executionId);
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
