import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { api } from '../api/client';
import type { ExecutionProjection, ExecutionProjectionDelta } from '../types';

export type ProjectionDetailScope = 'summary' | 'full';
export type ProjectionConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'stale' | 'offline' | 'error' | 'terminal';

export interface ExecutionProjectionRegistryEntry {
  executionId: string;
  projection: ExecutionProjection | null;
  cursor: number;
  detailScope: ProjectionDetailScope;
  connectionState: ProjectionConnectionState;
  lastUpdatedAt: number;
  lastError: string;
  requestEpoch: number;
  consumers: Record<string, ProjectionDetailScope>;
}

const terminalStatuses = new Set(['complete', 'cancelled', 'error']);

export const useProjectionRegistryStore = defineStore('projectionRegistry', () => {
  const entries = reactive<Record<string, ExecutionProjectionRegistryEntry>>({});
  const streams = new Map<string, EventSource>();
  const streamScopes = new Map<string, ProjectionDetailScope>();
  const consumerExecutions = new Map<string, string>();

  function ensureEntry(executionId: string) {
    if (!entries[executionId]) {
      entries[executionId] = {
        executionId,
        projection: null,
        cursor: 0,
        detailScope: 'summary',
        connectionState: 'idle',
        lastUpdatedAt: 0,
        lastError: '',
        requestEpoch: 0,
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

  async function load(executionId: string, requestedScope?: ProjectionDetailScope) {
    const id = executionId.trim();
    if (!id) return null;
    const entry = ensureEntry(id);
    const scope = requestedScope || desiredScope(entry);
    const epoch = ++entry.requestEpoch;
    if (!entry.projection) entry.connectionState = 'connecting';
    try {
      const projection = await api.executionProjection(id, scope);
      if (entry.requestEpoch !== epoch) return entry.projection;
      if (projection.__state && projection.__state !== 'ready') {
        entry.connectionState = entry.projection ? 'stale' : 'error';
        entry.lastError = String(projection.__error || projection.__state);
        return entry.projection;
      }
      if (projection.execution_id !== id) return entry.projection;
      entry.projection = projection;
      entry.cursor = Number(projection.cursor || 0);
      entry.detailScope = scope;
      entry.lastUpdatedAt = Date.now();
      entry.lastError = '';
      entry.connectionState = isTerminal(projection) ? 'terminal' : (streams.has(id) ? 'live' : 'offline');
      return projection;
    } catch (error) {
      if (entry.requestEpoch !== epoch) return entry.projection;
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.connectionState = entry.projection ? 'stale' : 'error';
      return entry.projection;
    }
  }

  function applyDelta(delta: ExecutionProjectionDelta) {
    const entry = entries[delta.execution_id];
    if (!entry || entry.cursor !== delta.base_cursor || delta.target_cursor < delta.base_cursor) {
      void load(delta.execution_id);
      return;
    }
    entry.cursor = delta.target_cursor;
    entry.lastUpdatedAt = Date.now();
    if (delta.events.length) void load(delta.execution_id);
  }

  function closeStream(executionId: string) {
    streams.get(executionId)?.close();
    streams.delete(executionId);
    streamScopes.delete(executionId);
  }

  function connect(executionId: string) {
    const entry = ensureEntry(executionId);
    const scope = desiredScope(entry);
    if (streams.has(executionId) && streamScopes.get(executionId) === scope) return;
    closeStream(executionId);
    entry.detailScope = scope;
    entry.connectionState = 'connecting';
    void load(executionId, scope);
    if (typeof EventSource === 'undefined') {
      entry.connectionState = entry.projection ? 'offline' : 'connecting';
      return;
    }
    const stream = new EventSource(`/api/runtime/executions/${encodeURIComponent(executionId)}/events?cursor=${entry.cursor}&detail_scope=${scope}`);
    streams.set(executionId, stream);
    streamScopes.set(executionId, scope);
    stream.onopen = () => {
      if (streams.get(executionId) === stream) entry.connectionState = isTerminal(entry.projection) ? 'terminal' : 'live';
    };
    stream.addEventListener('projection_delta', (event) => {
      try {
        applyDelta(JSON.parse((event as MessageEvent).data) as ExecutionProjectionDelta);
      } catch (error) {
        entry.lastError = error instanceof Error ? error.message : String(error);
        void load(executionId, scope);
      }
    });
    stream.addEventListener('projection_resync', () => { void load(executionId, scope); });
    stream.onerror = () => {
      if (streams.get(executionId) === stream && !isTerminal(entry.projection)) entry.connectionState = 'reconnecting';
    };
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
      closeStream(executionId);
      entry.connectionState = isTerminal(entry.projection) ? 'terminal' : 'offline';
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

  return { entries, acquire, release, load, projectionFor, stateFor, executeCommand };
});
