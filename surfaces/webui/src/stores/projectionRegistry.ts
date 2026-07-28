import { defineStore } from 'pinia';
import { onScopeDispose, reactive, ref } from 'vue';
import { api } from '../api/client';
import type { ExecutionProjection, ExecutionProjectionDelta } from '../types';
import {
  EXECUTION_PROJECTION_SCHEMA_VERSION,
  reduceExecutionProjectionDelta,
} from '../adapters/executionProjection';
import { openLiveSource } from './liveTransport';
import type { LiveEnvelope, LiveSourceLease } from './liveTransport';

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
const INITIAL_MATERIALIZATION_DELAYS_MS = [50, 100, 200, 400, 800, 1_600];
const MIN_PROJECTION_REFRESH_INTERVAL_MS = 100;

export const useProjectionRegistryStore = defineStore('projectionRegistry', () => {
  const entries = reactive<Record<string, ExecutionProjectionRegistryEntry>>({});
  const sourceLeases = new Map<string, LiveSourceLease>();
  const streamScopes = new Map<string, ProjectionDetailScope>();
  const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const initialMaterializationAttempts = new Map<string, number>();
  const connectionLoads = new Set<string>();
  const inFlightLoads = new Map<string, Promise<ExecutionProjection | null>>();
  const dirtyLoads = new Set<string>();
  const pendingLoadScopes = new Map<string, ProjectionDetailScope>();
  const lastLoadStartedAt = new Map<string, number>();
  const consumerExecutions = new Map<string, string>();
  const activeSourceCount = ref(0);

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
    }
  }

  function scheduleInitialMaterialization(executionId: string, requestedScope?: ProjectionDetailScope) {
    const entry = entries[executionId];
    if (!entry
      || entry.reconnectBlocked
      || !hasActiveConsumer(entry)
      || isTerminal(entry.projection)
      || sourceLeases.has(executionId)) return;
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
      if (Number(projection.schema_version) !== EXECUTION_PROJECTION_SCHEMA_VERSION) {
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
        entry.connectionState = sourceLeases.has(id) ? 'live' : (entry.degradedReason ? 'degraded' : 'offline');
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
      return false;
    }
    if (Number(delta.schema_version) !== EXECUTION_PROJECTION_SCHEMA_VERSION) {
      if (entry) {
        failClosed(
          entry,
          `unsupported execution projection delta schema_version ${String(delta.schema_version)}`,
          'stale',
        );
      }
      return false;
    }
    if (!entry?.projection) {
      if (entry) entry.lastError = 'projection delta arrived before its baseline snapshot';
      return false;
    }
    try {
      const projection = reduceExecutionProjectionDelta(entry.projection, delta);
      entry.projection = projection;
      entry.cursor = Number(projection.cursor || 0);
      entry.lastUpdatedAt = Date.now();
      entry.lastEventAt = entry.lastUpdatedAt;
      entry.lastError = '';
      entry.connectionState = isTerminal(projection) ? 'terminal' : 'live';
      if (isTerminal(projection)) closeStream(expectedExecutionId);
      return true;
    } catch (error) {
      entry.resyncCount += 1;
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.connectionState = 'stale';
      return false;
    }
  }

  async function recoverProjectionSource(
    executionId: string,
    scope: ProjectionDetailScope,
    lease: LiveSourceLease,
  ) {
    const projection = await load(executionId, scope);
    const entry = entries[executionId];
    if (
      sourceLeases.get(executionId) !== lease
      || entry?.reconnectBlocked
      || !projection
      || isTerminal(projection)
    ) return;
    lease.update({
      kind: 'execution',
      id: executionId,
      cursor: Number(projection.cursor || 0),
      revision: Number(projection.revision || 0),
      detail_scope: scope,
    });
  }

  function closeStream(executionId: string) {
    sourceLeases.get(executionId)?.close();
    sourceLeases.delete(executionId);
    activeSourceCount.value = sourceLeases.size;
    streamScopes.delete(executionId);
  }

  function promoteDeferredStreams() {
    Object.values(entries)
      .filter((entry) => hasActiveConsumer(entry) && !entry.reconnectBlocked)
      .forEach((entry) => establishConnection(entry.executionId));
  }

  function establishConnection(executionId: string, requestedScope?: ProjectionDetailScope) {
    const entry = ensureEntry(executionId);
    const scope = requestedScope || desiredScope(entry);
    entry.detailScope = scope;
    if (sourceLeases.has(executionId) && streamScopes.get(executionId) === scope) return;
    if (connectionLoads.has(executionId)) return;
    connectionLoads.add(executionId);
    void (async () => {
      try {
        const projection = await load(executionId, scope);
        if (!hasActiveConsumer(entry) || entry.reconnectBlocked || isTerminal(entry.projection)) return;
        const currentScope = desiredScope(entry);
        if (currentScope !== scope) return;
        if (projection?.execution_id === executionId) {
          openStream(executionId, scope);
        } else if (!entry.projection && allowsInitialSnapshotRetry(entry)) {
          scheduleInitialMaterialization(executionId, scope);
        }
      } finally {
        connectionLoads.delete(executionId);
        if (
          hasActiveConsumer(entry)
          && !entry.reconnectBlocked
          && !isTerminal(entry.projection)
          && entry.detailScope !== scope
        ) {
          establishConnection(executionId);
        }
      }
    })();
  }

  function openStream(
    executionId: string,
    scope: ProjectionDetailScope,
  ) {
    const entry = ensureEntry(executionId);
    if (!entry.projection || isTerminal(entry.projection)) return;
    if (sourceLeases.has(executionId) && streamScopes.get(executionId) === scope) return;
    cancelReconnect(executionId, false);
    if (sourceLeases.has(executionId)) closeStream(executionId);
    entry.connectionState = 'connecting';
    entry.degradedReason = '';
    const lease = openLiveSource(
      {
        kind: 'execution',
        id: executionId,
        cursor: entry.cursor,
        revision: Number(entry.projection?.revision || 0),
        detail_scope: scope,
      },
      {
        open: () => {
          if (sourceLeases.get(executionId) !== lease) return;
          const now = Date.now();
          entry.lastEventAt = now;
          entry.connectionState = isTerminal(entry.projection) ? 'terminal' : 'live';
        },
        error: (reason) => {
          if (sourceLeases.get(executionId) !== lease || isTerminal(entry.projection)) return;
          entry.connectionState = 'reconnecting';
          entry.degradedReason = reason;
        },
        envelope: (envelope) => applyProjectionEnvelope(executionId, scope, lease, envelope),
      },
    );
    sourceLeases.set(executionId, lease);
    activeSourceCount.value = sourceLeases.size;
    streamScopes.set(executionId, scope);
  }

  function applyProjectionEnvelope(
    executionId: string,
    scope: ProjectionDetailScope,
    lease: LiveSourceLease,
    envelope: LiveEnvelope,
  ) {
    if (sourceLeases.get(executionId) !== lease) return;
    const entry = ensureEntry(executionId);
    entry.lastEventAt = Date.now();
    if (envelope.event === 'source.authorization_revoked') {
      failClosed(
        entry,
        String(envelope.payload?.reason || 'Gateway revoked the execution projection source'),
      );
      return;
    }
    if (envelope.source_health === 'resync_required') {
      entry.resyncCount += 1;
      void recoverProjectionSource(executionId, scope, lease);
      return;
    }
    if (envelope.event === 'projection_delta') {
      const applied = applyDelta(envelope.payload as ExecutionProjectionDelta, executionId);
      if (!applied && !entry.reconnectBlocked) {
        void recoverProjectionSource(executionId, scope, lease);
      }
      return;
    }
    if (envelope.event === 'projection_live') {
      if (entry.projection && envelope.payload?.execution_id === executionId) {
        entry.projection.live = envelope.payload.live;
        entry.lastUpdatedAt = Date.now();
        entry.connectionState = isTerminal(entry.projection) ? 'terminal' : 'live';
        if (isTerminal(entry.projection)) closeStream(executionId);
      }
      return;
    }
    if (envelope.event === 'projection_snapshot') {
      const projection = envelope.payload as ExecutionProjection;
      if (
        Number(projection?.schema_version) !== EXECUTION_PROJECTION_SCHEMA_VERSION
        || projection?.execution_id !== executionId
      ) {
        failClosed(entry, 'Gateway live projection snapshot contract mismatch');
        return;
      }
      if (
        entry.projection
        && Number(projection.revision || 0) < Number(entry.projection.revision || 0)
      ) return;
      entry.projection = projection;
      entry.cursor = Math.max(entry.cursor, Number(projection.cursor || 0));
      entry.lastUpdatedAt = Date.now();
      entry.connectionState = isTerminal(projection) ? 'terminal' : 'live';
      lease.update({
        kind: 'execution',
        id: executionId,
        cursor: entry.cursor,
        revision: Number(entry.projection?.revision || 0),
        detail_scope: scope,
      });
      if (isTerminal(projection)) closeStream(executionId);
    }
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
    activeSourceCount,
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
