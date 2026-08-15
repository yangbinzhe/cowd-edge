import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { useProjectionRegistryStore } from './projectionRegistry';
import {
  acquireLongLivedConnection,
  releaseLongLivedConnection,
  resetLongLivedConnectionBudgetForTests,
} from '../utils/longLivedConnectionBudget';

const { liveSelectorUpdates } = vi.hoisted(() => ({
  liveSelectorUpdates: [] as any[],
}));

vi.mock('./liveTransport', () => ({
  openLiveSource: (selector: any, callbacks: any) => {
    const stream: any = typeof EventSource === 'undefined'
      ? {
        addEventListener: () => undefined,
        close: () => undefined,
      }
      : new EventSource(`/test/live/${selector.kind}/${selector.id}`);
    stream.onopen = () => callbacks.open?.();
    stream.onerror = () => callbacks.error?.('test transport interrupted');
    const forward = (eventName: string, sourceHealth = 'live') => {
      stream.addEventListener(eventName, (event: MessageEvent) => {
        let payload: any = {};
        try { payload = JSON.parse(event.data); } catch { payload = {}; }
        callbacks.envelope({
          schema_version: 1,
          subscription_id: 'test-live',
          subscription_revision: 1,
          source_kind: selector.kind,
          source_id: selector.id,
          detail_scope: selector.detail_scope || 'summary',
          delivery_class: 'snapshot_reconstructable',
          source_health: sourceHealth,
          event: eventName === 'projection_authorization_revoked'
            ? 'source.authorization_revoked'
            : eventName,
          payload,
        });
      });
    };
    forward('projection_delta');
    forward('projection_live');
    forward('projection_snapshot');
    forward('projection_authorization_revoked', 'revoked');
    forward('source_resync', 'resync_required');
    return {
      close: () => stream.close(),
      update: (next: any) => liveSelectorUpdates.push(next),
    };
  },
}));

describe('projectionRegistry contract gate', () => {
  beforeEach(() => {
    resetLongLivedConnectionBudgetForTests();
    liveSelectorUpdates.length = 0;
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetLongLivedConnectionBudgetForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fails fast and retains no incompatible companion projection', async () => {
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 3,
      execution_id: 'execution-mismatch',
      revision: 1,
      cursor: 1,
    } as any);
    const registry = useProjectionRegistryStore();

    const projection = await registry.load('execution-mismatch', 'full');

    expect(projection).toBeNull();
    expect(registry.projectionFor('execution-mismatch')).toBeNull();
    expect(registry.stateFor('execution-mismatch')).toBe('error');
    expect(registry.entries['execution-mismatch']?.lastError).toContain('unsupported execution projection schema_version 3');
  });

  it('fails closed when a snapshot carries another execution identity', async () => {
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      ...readyProjection('execution-other'),
      execution_id: 'execution-other',
    } as any);
    const registry = useProjectionRegistryStore();

    expect(await registry.load('execution-expected', 'full')).toBeNull();
    expect(registry.projectionFor('execution-expected')).toBeNull();
    expect(registry.entries['execution-expected']?.reconnectBlocked).toBe(true);
    expect(registry.entries['execution-expected']?.lastError).toContain(
      'expected execution-expected, received execution-other',
    );
    expect(registry.entries['execution-other']).toBeUndefined();
  });

  it('stops a live consumer when a delta contract version changes', async () => {
    vi.spyOn(api, 'executionProjection')
      .mockResolvedValue(readyProjection('execution-live', 4) as any);
    const registry = useProjectionRegistryStore();
    await registry.load('execution-live', 'full');

    registry.applyDelta({
      schema_version: 3,
      reducer_version: 1,
      execution_id: 'execution-live',
      from_revision: 1,
      target_revision: 1,
      base_cursor: 4,
      target_cursor: 5,
      detail_scope: 'full',
      authorization_revision: 1,
      redaction_revision: 'redaction-1',
      source_health: 'fresh',
      operations: [],
    } as any);

    expect(registry.stateFor('execution-live')).toBe('stale');
    expect(registry.entries['execution-live']?.lastError).toContain('unsupported execution projection delta schema_version 3');
  });

  it('rejects a newer nested strategy contract without treating it as legacy', async () => {
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      ...readyProjection('execution-strategy-mismatch'),
      execution_id: 'execution-strategy-mismatch',
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
        ...readyProjection('execution-recropped'),
        execution_id: 'execution-recropped',
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
        ...readyProjection('execution-upgrade'),
        execution_id: 'execution-upgrade',
        strategy: {
          schema_version: 1,
          id: 'strategy-v1',
          kind: 'strategy_decision',
          revision: 1,
          evidence_refs: [],
        },
      } as any)
      .mockResolvedValueOnce({
        ...readyProjection('execution-upgrade', 2),
        execution_id: 'execution-upgrade',
        revision: 2,
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
    expect(streams).toHaveLength(0);
    expect(registry.activeSourceCount).toBe(0);
    expect(registry.stateFor('execution-retry')).toBe('materializing');

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(streams).toHaveLength(1);
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
    expect(streams).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(registry.projectionFor('execution-forbidden')).toBeNull();
    expect(registry.stateFor('execution-forbidden')).toBe('error');
    expect(streams).toHaveLength(0);
    registry.release('runtime-page');
  });

  it('does not open a transport or consume a budget when the first projection is terminal', async () => {
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
      expect(registry.activeSourceCount).toBe(0);
    });
    expect(streams).toHaveLength(0);
    registry.release('runtime-page');
  });

  it('keeps eight logical projection sources active without the former per-topic cap', async () => {
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    const projectionReads = vi.spyOn(api, 'executionProjection').mockImplementation(async (executionId: string) => (
      readyProjection(executionId) as any
    ));
    const registry = useProjectionRegistryStore();

    for (let index = 0; index < 8; index += 1) {
      registry.acquire(`budget-${index}`, `consumer-${index}`, 'summary');
    }
    await vi.waitFor(() => {
      expect(projectionReads).toHaveBeenCalledTimes(8);
    });
    await vi.waitFor(() => {
      expect(registry.activeSourceCount).toBe(8);
    });
    expect(streams).toHaveLength(8);
    expect(Object.values(registry.entries).every((entry) => !entry.degradedReason)).toBe(true);
    for (let index = 0; index < 8; index += 1) registry.release(`consumer-${index}`);
  });

  it('does not let the retired HTTP connection budget evict logical projection sources', async () => {
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    vi.spyOn(api, 'executionProjection').mockImplementation(async (executionId: string) => (
      readyProjection(executionId) as any
    ));
    const registry = useProjectionRegistryStore();
    registry.acquire('shared-budget-a', 'consumer-a', 'full');
    registry.acquire('shared-budget-b', 'consumer-b', 'full');
    await vi.waitFor(() => expect(registry.activeSourceCount).toBe(2));

    expect(acquireLongLivedConnection('chat:budget-a', 15, () => undefined)).toBe(true);
    expect(acquireLongLivedConnection('chat:budget-b', 15, () => undefined)).toBe(true);
    expect(acquireLongLivedConnection('app:reference-app:live:test', 20, () => undefined)).toBe(true);
    expect(registry.activeSourceCount).toBe(2);
    expect(Object.values(registry.entries).every((entry) => !entry.degradedReason)).toBe(true);

    releaseLongLivedConnection('app:reference-app:live:test');
    releaseLongLivedConnection('chat:budget-a');
    releaseLongLivedConnection('chat:budget-b');
    registry.release('consumer-a');
    registry.release('consumer-b');
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
    expect(registry.activeSourceCount).toBe(0);
    registry.release('runtime-page');
  });

  it('purges only the revoked session projection and fences its late snapshot', async () => {
    let finishRevoked!: (value: unknown) => void;
    let sessionAReads = 0;
    const projection = vi.spyOn(api, 'executionProjection')
      .mockImplementation(async (executionId: string) => {
        if (executionId === 'execution-A') {
          sessionAReads += 1;
          if (sessionAReads === 1) {
            return {
              ...readyProjection(executionId),
              agents: [{ id: 'installed-private-agent' }],
            } as any;
          }
          return new Promise((resolve) => {
            finishRevoked = resolve;
          }) as any;
        }
        return readyProjection(executionId) as any;
      });
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-A', 'chat:session-A', 'full', 'bounded', 'session-A');
    registry.acquire('execution-B', 'chat:session-B', 'full', 'bounded', 'session-B');
    await vi.waitFor(() => {
      expect(registry.projectionFor('execution-A')?.agents?.[0]?.id).toBe('installed-private-agent');
      expect(registry.projectionFor('execution-B')?.execution_id).toBe('execution-B');
    });

    const lateRefresh = registry.load('execution-A', 'full', 'session-A');
    await vi.waitFor(() => expect(finishRevoked).toBeTypeOf('function'));
    registry.revokeSessionAuthorization('session-A', 'observer scope recropped');
    expect(registry.projectionFor('execution-A')).toBeNull();
    finishRevoked({
      ...readyProjection('execution-A'),
      agents: [{ id: 'late-private-agent' }],
    });
    await lateRefresh;
    await vi.waitFor(() => {
      expect(registry.entries['execution-A']?.reconnectBlocked).toBe(true);
    });

    expect(registry.projectionFor('execution-A')).toBeNull();
    expect(JSON.stringify(registry.entries['execution-A'])).not.toContain('late-private-agent');
    expect(registry.projectionFor('execution-B')?.execution_id).toBe('execution-B');
    expect(registry.entries['execution-B']?.reconnectBlocked).toBe(false);
    expect(projection).toHaveBeenCalledWith('execution-A', 'full', 'session-A');
    expect(projection).toHaveBeenCalledWith('execution-B', 'full', 'session-B');
    registry.release('chat:session-A');
    registry.release('chat:session-B');
  });

  it('rejects a wrong-execution delta on the current stream without loading the foreign execution', async () => {
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    const projection = vi.spyOn(api, 'executionProjection')
      .mockResolvedValue(readyProjection('execution-owned') as any);
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-owned', 'runtime-page', 'full');
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0].emit('projection_delta', JSON.stringify({
      schema_version: 2,
      reducer_version: 1,
      execution_id: 'execution-foreign',
      from_revision: 1,
      target_revision: 1,
      base_cursor: 1,
      target_cursor: 2,
      detail_scope: 'full',
      authorization_revision: 1,
      redaction_revision: 'redaction-1',
      source_health: 'fresh',
      operations: [{ op: 'advance_cursor', cursor: 2 }],
    }));

    expect(registry.projectionFor('execution-owned')).toBeNull();
    expect(registry.entries['execution-owned']?.reconnectBlocked).toBe(true);
    expect(registry.entries['execution-owned']?.lastError).toContain('delta identity mismatch');
    expect(registry.entries['execution-foreign']).toBeUndefined();
    expect(projection).toHaveBeenCalledTimes(1);
    registry.release('runtime-page');
  });

  it('leaves physical reconnect ownership outside the projection reducer', async () => {
    vi.useFakeTimers();
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    vi.spyOn(api, 'executionProjection').mockImplementation(async (executionId: string) => (
      readyProjection(executionId) as any
    ));
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-flap', 'runtime-page', 'full');
    await vi.advanceTimersByTimeAsync(0);
    expect(streams).toHaveLength(1);
    streams[0].onopen?.();
    streams[0].onerror?.(new Event('error'));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(streams).toHaveLength(1);
    expect(registry.activeSourceCount).toBe(1);
    expect(registry.stateFor('execution-flap')).toBe('reconnecting');
    expect(registry.entries['execution-flap']?.degradedReason).toContain('transport interrupted');
    registry.release('runtime-page');
  });

  it('writes a recovered snapshot cursor and revision back to the live selector', async () => {
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    const recovered = {
      ...readyProjection('execution-resync', 8),
      revision: 3,
      graph: {
        ...readyProjection('execution-resync', 8).graph,
        revision: 3,
      },
    };
    const projection = vi.spyOn(api, 'executionProjection')
      .mockResolvedValueOnce(readyProjection('execution-resync', 4) as any)
      .mockResolvedValueOnce(recovered as any);
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-resync', 'runtime-page', 'full');
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0].emit('source_resync', JSON.stringify({
      reason: 'retention gap',
      cursor: 4,
    }));

    await vi.waitFor(() => {
      expect(projection).toHaveBeenCalledTimes(2);
      expect(liveSelectorUpdates).toContainEqual({
        kind: 'execution',
        id: 'execution-resync',
        cursor: 8,
        revision: 3,
        detail_scope: 'full',
      });
    });
    expect(registry.projectionFor('execution-resync')?.revision).toBe(3);
    expect(registry.entries['execution-resync']?.resyncCount).toBe(1);
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

    expect(streams).toHaveLength(2);
    expect(registry.projectionFor('execution-refresh')?.execution_id).toBe('execution-refresh');
    registry.release('runtime-page');
  });

  it('caps a missing initial snapshot without creating an EventSource storm', async () => {
    vi.useFakeTimers();
    const streams: FakeProjectionEventSource[] = [];
    vi.stubGlobal('EventSource', class extends FakeProjectionEventSource {
      constructor(url: string) {
        super(url);
        streams.push(this);
      }
    });
    const projection = vi.spyOn(api, 'executionProjection').mockResolvedValue({
      __state: 'not_found',
      __error: 'still materializing',
    } as any);
    const registry = useProjectionRegistryStore();

    registry.acquire('execution-never-ready', 'runtime-page', 'full');
    await vi.advanceTimersByTimeAsync(3_500);
    await vi.advanceTimersByTimeAsync(0);

    const callsAtBudget = projection.mock.calls.length;
    expect(callsAtBudget).toBe(7);
    expect(streams).toHaveLength(0);
    expect(registry.stateFor('execution-never-ready')).toBe('degraded');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(projection).toHaveBeenCalledTimes(callsAtBudget);
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

function readyProjection(executionId: string, cursor = 1) {
  return {
    schema_version: 2,
    execution_id: executionId,
    revision: 1,
    cursor,
    detail_scope: 'full',
    authorization_revision: 1,
    redaction_revision: 'redaction-1',
    graph: {
      graph_id: executionId,
      revision: 1,
      objective: 'test projection',
      service_class: 'interactive',
      nodes: [],
      edges: [],
      commit_cursor: cursor,
      terminal_result_ref: null,
    },
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
