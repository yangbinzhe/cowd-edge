import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { useProjectionRegistryStore } from './projectionRegistry';

describe('projectionRegistry contract gate', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fails fast and retains no incompatible companion projection', async () => {
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 2,
      execution_id: 'execution-mismatch',
      revision: 1,
      cursor: 1,
    } as any);
    const registry = useProjectionRegistryStore();

    const projection = await registry.load('execution-mismatch', 'full');

    expect(projection).toBeNull();
    expect(registry.projectionFor('execution-mismatch')).toBeNull();
    expect(registry.stateFor('execution-mismatch')).toBe('error');
    expect(registry.entries['execution-mismatch']?.lastError).toContain('unsupported execution projection schema_version 2');
  });

  it('stops a live consumer when a delta contract version changes', async () => {
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 1,
      execution_id: 'execution-live',
      revision: 1,
      cursor: 4,
      graph: {},
      goals: [],
      agents: [],
      teams: [],
      relations: [],
      approvals: [],
      interventions: [],
      usage: [],
      context: [],
      evidence: [],
      health: [],
      recovery: [],
      child_executions: [],
      available_commands: [],
    } as any);
    const registry = useProjectionRegistryStore();
    await registry.load('execution-live', 'full');

    registry.applyDelta({
      schema_version: 2,
      execution_id: 'execution-live',
      base_cursor: 4,
      target_cursor: 5,
      events: [],
    } as any);

    expect(registry.stateFor('execution-live')).toBe('stale');
    expect(registry.entries['execution-live']?.lastError).toContain('unsupported execution projection delta schema_version 2');
  });

  it('rejects a newer nested strategy contract without treating it as legacy', async () => {
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 1,
      execution_id: 'execution-strategy-mismatch',
      revision: 1,
      cursor: 1,
      strategy: {
        schema_version: 2,
        id: 'strategy-newer',
        kind: 'strategy_decision',
        revision: 1,
        evidence_refs: [],
      },
    } as any);
    const registry = useProjectionRegistryStore();

    expect(await registry.load('execution-strategy-mismatch', 'full')).toBeNull();
    expect(registry.stateFor('execution-strategy-mismatch')).toBe('error');
    expect(registry.entries['execution-strategy-mismatch']?.lastError).toContain('unsupported strategy projection schema_version 2');
  });

  it('clears authorized full projection data when a later read is forbidden', async () => {
    vi.spyOn(api, 'executionProjection')
      .mockResolvedValueOnce({
        schema_version: 1,
        execution_id: 'execution-recropped',
        revision: 1,
        cursor: 1,
        graph: {},
        agents: [{ id: 'private-agent', detail: { graph_id: 'private-graph' } }],
        strategy: {
          schema_version: 1,
          id: 'private-strategy',
          kind: 'strategy_decision',
          revision: 1,
          evidence_refs: ['read:private/source'],
        },
      } as any)
      .mockResolvedValueOnce({
        __state: 'forbidden',
        __error: 'authorization scope was recropped',
      } as any);
    const registry = useProjectionRegistryStore();

    expect(await registry.load('execution-recropped', 'full')).not.toBeNull();
    expect(registry.projectionFor('execution-recropped')?.agents[0]?.id).toBe('private-agent');
    expect(await registry.load('execution-recropped', 'full')).toBeNull();
    expect(registry.projectionFor('execution-recropped')).toBeNull();
    expect(registry.entries['execution-recropped']?.cursor).toBe(0);
    expect(registry.stateFor('execution-recropped')).toBe('error');
  });

  it('clears an installed v1 projection when a newer nested strategy schema mismatches', async () => {
    vi.spyOn(api, 'executionProjection')
      .mockResolvedValueOnce({
        schema_version: 1,
        execution_id: 'execution-upgrade',
        revision: 1,
        cursor: 1,
        graph: {},
        agents: [],
        strategy: {
          schema_version: 1,
          id: 'strategy-v1',
          kind: 'strategy_decision',
          revision: 1,
          evidence_refs: [],
        },
      } as any)
      .mockResolvedValueOnce({
        schema_version: 1,
        execution_id: 'execution-upgrade',
        revision: 2,
        cursor: 2,
        graph: {},
        agents: [],
        strategy: {
          schema_version: 2,
          id: 'strategy-v2',
          kind: 'strategy_decision',
          revision: 2,
          evidence_refs: ['read:must-not-remain'],
        },
      } as any);
    const registry = useProjectionRegistryStore();

    expect(await registry.load('execution-upgrade', 'full')).not.toBeNull();
    expect(await registry.load('execution-upgrade', 'full')).toBeNull();
    expect(registry.projectionFor('execution-upgrade')).toBeNull();
    expect(registry.entries['execution-upgrade']?.lastError).toContain(
      'unsupported strategy projection schema_version 2',
    );
  });

  it('retries a projection that is materialized after the initial Gateway 404', async () => {
    vi.useFakeTimers();
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    vi.spyOn(api, 'executionProjection')
      .mockResolvedValueOnce({ __state: 'not_found', __error: 'execution pending' } as any)
      .mockResolvedValueOnce(readyProjection('execution-retry') as any);
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-retry', 'runtime-page', 'full');
    await vi.advanceTimersByTimeAsync(0);
    expect(streams).toHaveLength(1);
    expect(registry.activeStreamCount).toBe(0);
    expect(registry.stateFor('execution-retry')).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(0);
    expect(streams).toHaveLength(2);
    expect(registry.projectionFor('execution-retry')?.execution_id).toBe('execution-retry');
    registry.release('runtime-page');
  });

  it('does not reconnect after an authorization fail-closed result', async () => {
    vi.useFakeTimers();
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      __state: 'forbidden',
      __error: 'authorization scope recropped',
    } as any);
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-forbidden', 'runtime-page', 'full');
    await vi.advanceTimersByTimeAsync(0);
    streams[0]?.onerror?.(new Event('error'));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(registry.projectionFor('execution-forbidden')).toBeNull();
    expect(registry.stateFor('execution-forbidden')).toBe('error');
    expect(streams).toHaveLength(1);
    registry.release('runtime-page');
  });

  it('closes the transport and frees its budget when a loaded projection is terminal', async () => {
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      ...readyProjection('execution-terminal'),
      live: { status: 'complete' },
    } as any);
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-terminal', 'runtime-page', 'full');
    await vi.waitFor(() => {
      expect(registry.stateFor('execution-terminal')).toBe('terminal');
      expect(registry.activeStreamCount).toBe(0);
    });
    expect(streams).toHaveLength(1);
    expect(streams[0]?.closed).toBe(true);
    registry.release('runtime-page');
  });

  it('fails closed when Gateway revokes an already-open projection stream', async () => {
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    vi.spyOn(api, 'executionProjection').mockResolvedValue(readyProjection('execution-revoked') as any);
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-revoked', 'runtime-page', 'full');
    await vi.waitFor(() => expect(registry.projectionFor('execution-revoked')).not.toBeNull());
    streams[0]?.emit('projection_authorization_revoked', '{}');

    expect(registry.projectionFor('execution-revoked')).toBeNull();
    expect(registry.stateFor('execution-revoked')).toBe('error');
    expect(registry.activeStreamCount).toBe(0);
    registry.release('runtime-page');
  });

  it('retries a transient first snapshot after an explicit authorization refresh', async () => {
    vi.useFakeTimers();
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    vi.spyOn(api, 'executionProjection')
      .mockResolvedValueOnce(readyProjection('execution-refresh') as any)
      .mockRejectedValueOnce(new Error('Gateway temporarily unavailable after login'))
      .mockResolvedValueOnce(readyProjection('execution-refresh') as any);
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-refresh', 'runtime-page', 'full');
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.projectionFor('execution-refresh')).not.toBeNull();
    registry.refreshAuthorization();
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.entries['execution-refresh']?.reconnectBlocked).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(0);

    expect(streams).toHaveLength(3);
    expect(registry.projectionFor('execution-refresh')?.execution_id).toBe('execution-refresh');
    registry.release('runtime-page');
  });
});

class FakeProjectionEventSource {
  static readonly instances: FakeProjectionEventSource[] = [];
  onopen?: () => void;
  onerror?: (event: Event) => void;
  closed = false;
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(readonly url: string) {
    FakeProjectionEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(name: string, data: string) {
    for (const listener of this.listeners.get(name) || []) {
      listener({ data } as MessageEvent);
    }
  }
}

function readyProjection(executionId: string) {
  return {
    schema_version: 1,
    execution_id: executionId,
    revision: 1,
    cursor: 1,
    graph: {},
    goals: [],
    agents: [],
    teams: [],
    relations: [],
    approvals: [],
    interventions: [],
    usage: [],
    context: [],
    evidence: [],
    health: [],
    recovery: [],
    child_executions: [],
    available_commands: [],
  };
}
