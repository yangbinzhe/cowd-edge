import { defineStore } from 'pinia';
import { computed, onScopeDispose, reactive, ref } from 'vue';
import { api } from '../api/client';
import type { ExecutionProjection, ExecutionProjectionDelta } from '../types';
import {
  acquireLongLivedConnection,
  releaseLongLivedConnection,
} from '../utils/longLivedConnectionBudget';

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
  authorizationSessionId: string;
  consumers: Record<string, ProjectionDetailScope>;
  materializingConsumers: Record<string, boolean>;
}

const terminalStatuses = new Set(['complete', 'cancelled', 'error']);
// Two chat streams plus one selected execution projection and one optional
// APP stream keep the aggregate HTTP/1.1 long-lived budget at four, leaving
// two origin sockets for navigation, cancellation and ordinary API calls.
export const MAX_ACTIVE_PROJECTION_STREAMS = 2;
const INITIAL_MATERIALIZATION_DELAYS_MS = [50, 100, 200, 400, 800, 1_600];
const PROJECTION_RECONNECT_BASE_MS = 250;
const PROJECTION_RECONNECT_MAX_MS = 5_000;
const MAX_STREAM_RECONNECT_ATTEMPTS = 8;
const PROJECTION_STREAM_HEALTHY_MS = 10_000;
const MIN_PROJECTION_REFRESH_INTERVAL_MS = 100;

export const useProjectionRegistryStore = defineStore('projectionRegistry', () => {
  const entries = reactive<Record<string, ExecutionProjectionRegistryEntry>>({});
  const streams = new Map<string, EventSource>();
  const streamScopes = new Map<string, ProjectionDetailScope>();
  const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const initialMaterializationAttempts = new Map<string, number>();
  const streamReconnectAttempts = new Map<string, number>();
  const streamOpenedAt = new Map<string, number>();
  const connectionLoads = new Set<string>();
  const inFlightLoads = new Map<string, Promise<ExecutionProjection | null>>();
  const dirtyLoads = new Set<string>();
  const pendingLoadScopes = new Map<string, ProjectionDetailScope>();
  const lastLoadStartedAt = new Map<string, number>();
  const consumerExecutions = new Map<string, string>();
  const activeStreams = ref(0);
  const activeStreamCount = computed(() => activeStreams.value);

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
        authorizationSessionId: '',
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

  async function loadOnce(executionId: string, requestedScope?: ProjectionDetailScope) {
    const id = executionId.trim();
    if (!id) return null;
    const entry = ensureEntry(id);
    if (entry.reconnectBlocked) return null;
    const scope = requestedScope || desiredScope(entry);
    const epoch = ++entry.requestEpoch;
    if (!entry.projection && !entry.degradedReason) entry.connectionState = 'materializing';
    try {
      const projection = await api.executionProjection(
        id,
        scope,
        entry.authorizationSessionId,
      );
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
      if (projection.execution_id !== id) {
        failClosed(
          entry,
          `execution projection identity mismatch: expected ${id}, received ${String(projection.execution_id || 'missing')}`,
        );
        return null;
      }
      if (entry.projection && Number(projection.revision || 0) < Number(entry.projection.revision || 0)) {
        entry.lastError = 'ignored projection snapshot with a lower revision';
        return entry.projection;
      }
      entry.projection = projection;
      entry.reconnectBlocked = false;
      initialMaterializationAttempts.delete(id);
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

  function load(
    executionId: string,
    requestedScope?: ProjectionDetailScope,
    authorizationSessionId = '',
  ) {
    const id = executionId.trim();
    if (!id) return Promise.resolve(null);
    const entry = ensureEntry(id);
    const normalizedSessionId = authorizationSessionId.trim();
    if (
      normalizedSessionId
      && entry.authorizationSessionId
      && entry.authorizationSessionId !== normalizedSessionId
      && hasActiveConsumer(entry)
    ) {
      failClosed(
        entry,
        `execution projection session identity conflict: expected ${entry.authorizationSessionId}, received ${normalizedSessionId}`,
      );
      return Promise.resolve(null);
    }
    if (normalizedSessionId && entry.authorizationSessionId !== normalizedSessionId) {
      if (entry.authorizationSessionId) {
        failClosed(entry, 'execution projection moved to a different session authority');
        entry.reconnectBlocked = false;
      }
      entry.authorizationSessionId = normalizedSessionId;
    }
    const requested = requestedScope || desiredScope(entry);
    const previousScope = pendingLoadScopes.get(id);
    pendingLoadScopes.set(
      id,
      previousScope === 'full' || requested === 'full' ? 'full' : 'summary',
    );
    const existing = inFlightLoads.get(id);
    if (existing) {
      dirtyLoads.add(id);
      return existing;
    }
    let flight: Promise<ExecutionProjection | null>;
    flight = (async () => {
      let result: ExecutionProjection | null = entries[id]?.projection || null;
      do {
        dirtyLoads.delete(id);
        const scope = pendingLoadScopes.get(id) || requested;
        pendingLoadScopes.delete(id);
        const waitMs = MIN_PROJECTION_REFRESH_INTERVAL_MS
          - (Date.now() - (lastLoadStartedAt.get(id) || 0));
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        lastLoadStartedAt.set(id, Date.now());
        result = await loadOnce(id, scope);
      } while (dirtyLoads.has(id));
      return result;
    })().finally(() => {
      if (inFlightLoads.get(id) === flight) inFlightLoads.delete(id);
      dirtyLoads.delete(id);
      pendingLoadScopes.delete(id);
    });
    inFlightLoads.set(id, flight);
    return flight;
  }

  function applyDelta(delta: ExecutionProjectionDelta, expectedExecutionId = delta.execution_id) {
    const entry = entries[expectedExecutionId];
    if (delta.execution_id !== expectedExecutionId) {
      if (entry) {
        failClosed(
          entry,
          `execution projection delta identity mismatch: expected ${expectedExecutionId}, received ${String(delta.execution_id || 'missing')}`,
          'stale',
        );
      }
      return;
    }
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
      void load(expectedExecutionId);
      return;
    }
    streamReconnectAttempts.delete(expectedExecutionId);
    entry.cursor = delta.target_cursor;
    entry.lastUpdatedAt = Date.now();
    entry.lastEventAt = entry.lastUpdatedAt;
    if (delta.events.length) void load(expectedExecutionId);
  }

  function closeStream(executionId: string) {
    streams.get(executionId)?.close();
    streams.delete(executionId);
    releaseLongLivedConnection(`projection:${executionId}`);
    streamScopes.delete(executionId);
    streamOpenedAt.delete(executionId);
    activeStreams.value = streams.size;
  }

  function promoteDeferredStreams() {
    if (streams.size >= MAX_ACTIVE_PROJECTION_STREAMS) return;
    Object.values(entries)
      .filter((entry) => entry.connectionState === 'degraded'
        && (
          entry.degradedReason.startsWith('projection connection budget')
          || entry.degradedReason.startsWith('shared live-connection budget')
          || entry.degradedReason.includes('yielded the shared live-connection budget')
        )
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

  function openStream(
    executionId: string,
    scope: ProjectionDetailScope,
    leaseGranted = false,
  ) {
    const entry = ensureEntry(executionId);
    if (!entry.projection || isTerminal(entry.projection)) {
      if (leaseGranted) releaseLongLivedConnection(`projection:${executionId}`);
      return;
    }
    if (streams.has(executionId) && streamScopes.get(executionId) === scope) return;
    if (!streams.has(executionId) && streams.size >= MAX_ACTIVE_PROJECTION_STREAMS) {
      if (leaseGranted) releaseLongLivedConnection(`projection:${executionId}`);
      entry.connectionState = 'degraded';
      entry.degradedReason = `projection connection budget reached (${MAX_ACTIVE_PROJECTION_STREAMS})`;
      promoteDeferredStreams();
      return;
    }
    cancelReconnect(executionId, false);
    if (streams.has(executionId)) closeStream(executionId);
    if (typeof EventSource === 'undefined') {
      if (leaseGranted) releaseLongLivedConnection(`projection:${executionId}`);
      entry.connectionState = 'offline';
      return;
    }
    entry.connectionState = 'connecting';
    entry.degradedReason = '';
    if (!leaseGranted && !acquireLongLivedConnection(
      `projection:${executionId}`,
      10,
      () => {
        closeStream(executionId);
        entry.connectionState = 'degraded';
        entry.degradedReason = 'projection yielded the shared live-connection budget to higher-priority work';
      },
      () => {
        if (
          !hasActiveConsumer(entry)
          || entry.reconnectBlocked
          || !entry.projection
          || isTerminal(entry.projection)
        ) {
          releaseLongLivedConnection(`projection:${executionId}`);
          return;
        }
        openStream(executionId, desiredScope(entry), true);
      },
    )) {
      entry.connectionState = 'degraded';
      entry.degradedReason = 'shared live-connection budget reached';
      return;
    }
    const stream = new EventSource(`/api/runtime/executions/${encodeURIComponent(executionId)}/events?cursor=${entry.cursor}&detail_scope=${scope}`);
    streams.set(executionId, stream);
    streamScopes.set(executionId, scope);
    activeStreams.value = streams.size;
    stream.onopen = () => {
      if (streams.get(executionId) === stream) {
        const now = Date.now();
        streamOpenedAt.set(executionId, now);
        entry.lastEventAt = now;
        entry.connectionState = isTerminal(entry.projection) ? 'terminal' : 'live';
      }
    };
    stream.addEventListener('projection_delta', (event) => {
      if (streams.get(executionId) !== stream) return;
      try {
        entry.lastEventAt = Date.now();
        applyDelta(
          JSON.parse((event as MessageEvent).data) as ExecutionProjectionDelta,
          executionId,
        );
      } catch (error) {
        entry.lastError = error instanceof Error ? error.message : String(error);
        void load(executionId, scope);
      }
    });
    stream.addEventListener('projection_resync', () => {
      if (streams.get(executionId) !== stream) return;
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
        const openedAt = streamOpenedAt.get(executionId) || 0;
        const wasHealthy = openedAt > 0 && Date.now() - openedAt >= PROJECTION_STREAM_HEALTHY_MS;
        closeStream(executionId);
        if (wasHealthy) streamReconnectAttempts.delete(executionId);
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

  function failClosedAuthorization(reason: string) {
    for (const entry of Object.values(entries)) {
      failClosed(entry, `Gateway authorization invalidated: ${reason}`);
    }
  }

  function revokeSessionAuthorization(sessionId: string, reason: string) {
    const normalized = sessionId.trim();
    if (!normalized) {
      failClosedAuthorization(reason);
      return;
    }
    for (const entry of Object.values(entries)) {
      if (entry.authorizationSessionId !== normalized) continue;
      failClosed(
        entry,
        `Gateway revoked session authorization: ${reason}`,
      );
    }
  }

  function acquire(
    executionId: string,
    consumer: string,
    scope: ProjectionDetailScope = 'summary',
    initialSnapshotPolicy: 'passive' | 'bounded' = consumer.startsWith('chat:') ? 'passive' : 'bounded',
    authorizationSessionId = '',
  ) {
    const id = executionId.trim();
    if (!id || !consumer.trim()) return;
    const previous = consumerExecutions.get(consumer);
    if (previous && previous !== id) release(consumer);
    const entry = ensureEntry(id);
    const normalizedSessionId = authorizationSessionId.trim();
    if (
      normalizedSessionId
      && entry.authorizationSessionId
      && entry.authorizationSessionId !== normalizedSessionId
      && hasActiveConsumer(entry)
    ) {
      failClosed(
        entry,
        `execution projection session identity conflict: expected ${entry.authorizationSessionId}, received ${normalizedSessionId}`,
      );
      return;
    }
    if (normalizedSessionId && entry.authorizationSessionId !== normalizedSessionId) {
      if (entry.authorizationSessionId) {
        failClosed(entry, 'execution projection moved to a different session authority');
        entry.reconnectBlocked = false;
      }
      entry.authorizationSessionId = normalizedSessionId;
    }
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

  const authorizationInvalidated = (event: Event) => {
    failClosedAuthorization(String(
      (event as CustomEvent)?.detail?.reason || 'Gateway authorization changed',
    ));
  };
  const sessionAuthorizationInvalidated = (event: Event) => {
    const detail = (event as CustomEvent)?.detail || {};
    revokeSessionAuthorization(
      String(detail.sessionId || ''),
      String(detail.reason || 'Gateway revoked session authorization'),
    );
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('cowd:authorization-invalidated', authorizationInvalidated);
    window.addEventListener(
      'cowd:session-authorization-invalidated',
      sessionAuthorizationInvalidated,
    );
    onScopeDispose(() => {
      window.removeEventListener('cowd:authorization-invalidated', authorizationInvalidated);
      window.removeEventListener(
        'cowd:session-authorization-invalidated',
        sessionAuthorizationInvalidated,
      );
    });
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
    failClosedAuthorization,
    revokeSessionAuthorization,
    refreshAuthorization,
  };
});
