import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import {
  liveTransportHealth,
  openLiveSource,
  parseLiveEnvelope,
  resetLiveTransportForTests,
  type LiveEnvelope,
} from './liveTransport';
import {
  LIVE_CONTRACT_SCHEMA_VERSION,
  LIVE_ENVELOPE_CANONICAL_FIXTURE,
  LIVE_ENVELOPE_SCHEMA_HASH,
} from '../generated/live-contract-meta';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(envelope: LiveEnvelope) {
    for (const listener of this.listeners.get('live') || []) {
      listener(new MessageEvent('live', { data: JSON.stringify(envelope) }));
    }
  }
}

function mockSubscriptionApi() {
  let revision = 1;
  const create = vi.spyOn(api, 'createLiveSubscription').mockImplementation(async (request: any) => ({
    schema_version: 1,
    id: 'live-test',
    surface_instance: request.surface_instance,
    revision,
    selector: request.selector,
    selector_hash: `selector-${revision}`,
    expires_at_ms: Date.now() + 60_000,
    stream_url: '/api/runtime/live/live-test',
  }) as any);
  const patch = vi.spyOn(api, 'patchLiveSubscription').mockImplementation(async (_id, request: any) => {
    revision += 1;
    return {
      schema_version: 1,
      id: 'live-test',
      surface_instance: 'webui:test',
      revision,
      selector: request.selector,
      selector_hash: `selector-${revision}`,
      expires_at_ms: Date.now() + 60_000,
      stream_url: '/api/runtime/live/live-test',
    } as any;
  });
  const remove = vi.spyOn(api, 'deleteLiveSubscription').mockResolvedValue({} as any);
  return { create, patch, remove, revision: () => revision };
}

afterEach(() => {
  resetLiveTransportForTests();
  FakeEventSource.instances = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WebUI multiplex live transport', () => {
  it('consumes the canonical Gateway LiveEnvelope fixture and schema hash', () => {
    const envelope = parseLiveEnvelope(JSON.stringify(LIVE_ENVELOPE_CANONICAL_FIXTURE));
    expect(LIVE_CONTRACT_SCHEMA_VERSION).toBe(1);
    expect(LIVE_ENVELOPE_SCHEMA_HASH)
      .toBe('53ccc1bb8fb6896f1e648035dad6985aba8754b2e5d88e47b7687ddc492a346c');
    expect(envelope.subscription_revision).toBe(7);
    expect(envelope.source_cursor).toBe(42);
    expect(envelope.stream_revision).toBe(3);
    expect(envelope.end_bytes).toBe(256);
  });

  it('serves eight sessions, execution and mission sources over one physical EventSource', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const subscriptionApi = mockSubscriptionApi();
    const delivered: string[] = [];
    const leases = Array.from({ length: 8 }, (_, index) => openLiveSource(
      { kind: 'session', id: `session-${index}` },
      { envelope: (event) => delivered.push(`${event.source_kind}:${event.source_id}`) },
    ));
    leases.push(openLiveSource(
      { kind: 'execution', id: 'execution-1', detail_scope: 'full' },
      { envelope: (event) => delivered.push(`${event.source_kind}:${event.source_id}`) },
    ));
    leases.push(openLiveSource(
      { kind: 'mission', id: 'mission-1', detail_scope: 'full' },
      { envelope: (event) => delivered.push(`${event.source_kind}:${event.source_id}`) },
    ));

    await vi.waitFor(() => expect(liveTransportHealth().sourceCount()).toBe(10));
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(liveTransportHealth().physicalConnectionCount.value).toBe(1);
    expect(subscriptionApi.create).toHaveBeenCalledTimes(1);
    expect(subscriptionApi.patch.mock.calls.length).toBeLessThan(10);

    FakeEventSource.instances[0].emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: subscriptionApi.revision(),
      source_kind: 'subscription',
      source_id: 'live-test',
      detail_scope: 'summary',
      delivery_class: 'snapshot_reconstructable',
      source_health: 'baseline',
      event: 'subscription.ready',
      payload: { revision: subscriptionApi.revision() },
    });
    FakeEventSource.instances[0].emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: subscriptionApi.revision(),
      source_kind: 'mission',
      source_id: 'mission-1',
      detail_scope: 'full',
      delivery_class: 'snapshot_reconstructable',
      source_health: 'live',
      event: 'mission_snapshot',
      payload: { mission: { mission_id: 'mission-1' } },
    });
    expect(delivered).toEqual(['mission:mission-1']);

    leases.forEach((lease) => lease.close());
    await vi.waitFor(() => expect(subscriptionApi.remove).toHaveBeenCalledTimes(1));
    expect(liveTransportHealth().physicalConnectionCount.value).toBe(0);
  });

  it('drops late envelopes from an old selector revision', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const subscriptionApi = mockSubscriptionApi();
    const delivered = vi.fn();
    const first = openLiveSource({ kind: 'session', id: 'A' }, { envelope: delivered });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const second = openLiveSource({ kind: 'session', id: 'B' }, { envelope: delivered });
    await vi.waitFor(() => expect(subscriptionApi.revision()).toBeGreaterThan(1));

    FakeEventSource.instances[0].emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: 1,
      source_kind: 'session',
      source_id: 'A',
      detail_scope: 'summary',
      delivery_class: 'durable',
      source_health: 'live',
      event: 'TerminalCommitted',
      payload: {},
    });
    expect(delivered).not.toHaveBeenCalled();
    first.close();
    second.close();
  });

  it('applies baselines before the revision barrier but withholds live deltas', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const subscriptionApi = mockSubscriptionApi();
    const delivered: string[] = [];
    const lease = openLiveSource(
      { kind: 'session', id: 'session-1' },
      { envelope: (event) => delivered.push(event.event) },
    );
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const revision = subscriptionApi.revision();
    const base = {
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: revision,
      source_kind: 'session',
      source_id: 'session-1',
      detail_scope: 'summary' as const,
      source_cursor: 1,
    };
    FakeEventSource.instances[0].emit({
      ...base,
      delivery_class: 'snapshot_reconstructable',
      source_health: 'baseline',
      event: 'session.connected',
      payload: {},
    });
    FakeEventSource.instances[0].emit({
      ...base,
      source_cursor: 2,
      delivery_class: 'durable',
      source_health: 'live',
      event: 'TerminalCommitted',
      payload: {},
    });
    expect(delivered).toEqual(['session.connected']);

    FakeEventSource.instances[0].emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: revision,
      source_kind: 'subscription',
      source_id: 'live-test',
      detail_scope: 'summary',
      delivery_class: 'snapshot_reconstructable',
      source_health: 'baseline',
      event: 'subscription.ready',
      payload: { revision },
    });
    expect(delivered).toEqual(['session.connected', 'TerminalCommitted']);
    expect(liveTransportHealth().subscription.state).toBe('ready');
    expect(liveTransportHealth().sources.get('session:session-1')).toBe('live');
    lease.close();
  });

  it('keeps a natively recovered EventSource instead of closing it with a stale timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const subscriptionApi = mockSubscriptionApi();
    const lease = openLiveSource(
      { kind: 'session', id: 'session-reconnect' },
      { envelope: vi.fn() },
    );
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const first = FakeEventSource.instances[0];

    first.onerror?.();
    expect(liveTransportHealth().physical.state).toBe('reconnecting');
    expect(first.closed).toBe(false);
    expect(subscriptionApi.remove).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(first.closed).toBe(false);

    first.onopen?.();
    expect(liveTransportHealth().physical.state).toBe('connected');

    await vi.advanceTimersByTimeAsync(5_001);
    expect(subscriptionApi.remove).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(first.closed).toBe(false);
    lease.close();
  });

  it('rebuilds a physical subscription when native EventSource recovery times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const subscriptionApi = mockSubscriptionApi();
    const lease = openLiveSource(
      { kind: 'session', id: 'session-reconnect-timeout' },
      { envelope: vi.fn() },
    );
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const first = FakeEventSource.instances[0];

    first.onerror?.();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(subscriptionApi.remove).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(first.closed).toBe(true);
    expect(subscriptionApi.create).toHaveBeenCalledTimes(2);
    lease.close();
  });
});
