import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import {
  liveTransportHealth,
  openLiveSource,
  openSessionLiveSource,
  parseLiveEnvelope,
  resetLiveTransportForTests,
  terminalDeliveryEventFromEnvelope,
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
  it('extracts the typed terminal delivery discriminator from the canonical envelope', () => {
    const envelope: LiveEnvelope = {
      schema_version: 1,
      subscription_id: 'live-terminal',
      subscription_revision: 1,
      source_kind: 'session',
      source_id: 'session-terminal',
      detail_scope: 'summary',
      delivery_class: 'ephemeral_preview',
      source_health: 'live',
      event: 'TerminalDelivery',
      payload: {
        type: 'TerminalDelivery',
        session_id: 'session-terminal',
        execution_id: 'execution-terminal',
        turn_id: 'turn-terminal',
        delivery: {
          event: 'terminal_presentation_started',
          presentation_id: 'presentation-1',
          attempt_id: 'attempt-1',
          envelope_id: 'envelope-1',
          envelope_revision: 3,
          objective_scope: 'root',
        },
      },
    };

    expect(terminalDeliveryEventFromEnvelope(envelope)).toEqual({
      event: 'terminal_presentation_started',
      presentation_id: 'presentation-1',
      attempt_id: 'attempt-1',
      envelope_id: 'envelope-1',
      envelope_revision: 3,
      objective_scope: 'root',
      session_id: 'session-terminal',
      execution_id: 'execution-terminal',
      turn_id: 'turn-terminal',
    });
    expect(() => terminalDeliveryEventFromEnvelope({
      ...envelope,
      payload: {
        ...envelope.payload,
        delivery: {
          event: 'text_delta',
          presentation_id: 'presentation-1',
          attempt_id: 'attempt-1',
        },
      },
    })).toThrow('invalid text_delta payload');
  });

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

  it('does not reuse a create idempotency key for a different selector after reload', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const requests: any[] = [];
    vi.spyOn(api, 'createLiveSubscription').mockImplementation(async (request: any) => {
      requests.push(structuredClone(request));
      return {
        schema_version: 1,
        id: `live-${requests.length}`,
        surface_instance: request.surface_instance,
        revision: 1,
        selector: request.selector,
        selector_hash: `selector-${requests.length}`,
        expires_at_ms: Date.now() + 60_000,
        stream_url: `/api/runtime/live/live-${requests.length}`,
      } as any;
    });
    vi.spyOn(api, 'deleteLiveSubscription').mockResolvedValue({} as any);

    openLiveSource(
      { kind: 'session', id: 'session-before-reload' },
      { envelope: vi.fn() },
    );
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    // A document reload loses the in-memory subscription before it can issue
    // DELETE, while sessionStorage intentionally preserves the observer ID.
    resetLiveTransportForTests();
    const current = openLiveSource(
      { kind: 'execution', id: 'execution-after-reload', detail_scope: 'full' },
      { envelope: vi.fn() },
    );
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[0].surface_instance).toBe(requests[1].surface_instance);
    expect(requests[0].selector).not.toEqual(requests[1].selector);
    expect(requests[0].idempotency_key).not.toBe(requests[1].idempotency_key);
    current.close();
  });

  it('retains the create idempotency key while retrying the same selector', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const requests: any[] = [];
    vi.spyOn(api, 'createLiveSubscription').mockImplementation(async (request: any) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) throw new Error('response lost after request dispatch');
      return {
        schema_version: 1,
        id: 'live-retried',
        surface_instance: request.surface_instance,
        revision: 1,
        selector: request.selector,
        selector_hash: 'selector-retried',
        expires_at_ms: Date.now() + 60_000,
        stream_url: '/api/runtime/live/live-retried',
      } as any;
    });
    vi.spyOn(api, 'deleteLiveSubscription').mockResolvedValue({} as any);

    const lease = openLiveSource(
      { kind: 'session', id: 'session-retry' },
      { envelope: vi.fn() },
    );
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[1].selector).toEqual(requests[0].selector);
    expect(requests[1].idempotency_key).toBe(requests[0].idempotency_key);
    lease.close();
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

  it('buffers the next subscription revision until its PATCH acknowledgement arrives', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    let resolvePatch!: (response: any) => void;
    vi.spyOn(api, 'createLiveSubscription').mockResolvedValue({
      schema_version: 1,
      id: 'live-race',
      surface_instance: 'webui:test',
      revision: 1,
      selector: { sources: [{ kind: 'session', id: 'A' }] },
      selector_hash: 'selector-1',
      expires_at_ms: Date.now() + 60_000,
      stream_url: '/api/runtime/live/live-race',
    } as any);
    const patch = vi.spyOn(api, 'patchLiveSubscription').mockImplementation(
      async () => new Promise((resolve) => { resolvePatch = resolve; }),
    );
    vi.spyOn(api, 'deleteLiveSubscription').mockResolvedValue({} as any);

    const first = openLiveSource({ kind: 'session', id: 'A' }, { envelope: vi.fn() });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const second = openLiveSource({ kind: 'session', id: 'B' }, { envelope: vi.fn() });
    await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(1));

    FakeEventSource.instances[0].emit({
      schema_version: 1,
      subscription_id: 'live-race',
      subscription_revision: 2,
      source_kind: 'subscription',
      source_id: 'live-race',
      detail_scope: 'summary',
      delivery_class: 'snapshot_reconstructable',
      source_health: 'baseline',
      event: 'subscription.revision.changed',
      payload: { revision: 2 },
    });
    expect(liveTransportHealth().physical.error).toBe('');
    expect(FakeEventSource.instances).toHaveLength(1);

    resolvePatch({
      schema_version: 1,
      id: 'live-race',
      surface_instance: 'webui:test',
      revision: 2,
      selector: { sources: [{ kind: 'session', id: 'A' }, { kind: 'session', id: 'B' }] },
      selector_hash: 'selector-2',
      expires_at_ms: Date.now() + 60_000,
      stream_url: '/api/runtime/live/live-race',
    });
    await vi.waitFor(() => expect(liveTransportHealth().subscription.revision).toBe(2));
    expect(liveTransportHealth().subscription.state).toBe('ready');
    expect(liveTransportHealth().physical.error).toBe('');
    expect(FakeEventSource.instances).toHaveLength(1);

    first.close();
    second.close();
  });

  it('still rejects an unacknowledged future revision without an active selector mutation', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    mockSubscriptionApi();
    const lease = openLiveSource(
      { kind: 'session', id: 'session-strict-revision' },
      { envelope: vi.fn() },
    );
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.instances[0].emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: 2,
      source_kind: 'subscription',
      source_id: 'live-test',
      detail_scope: 'summary',
      delivery_class: 'snapshot_reconstructable',
      source_health: 'baseline',
      event: 'subscription.revision.changed',
      payload: { revision: 2 },
    });

    expect(liveTransportHealth().subscription.state).toBe('degraded');
    expect(liveTransportHealth().physical.error)
      .toBe('Gateway live stream advanced beyond the acknowledged subscription revision');
    lease.close();
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

  it('projects the authorized session source identity into unscoped runtime payloads', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const subscriptionApi = mockSubscriptionApi();
    const received: any[] = [];
    const source = openSessionLiveSource('session-input', 0);
    source.onmessage = (event) => received.push(JSON.parse(event.data));
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const revision = subscriptionApi.revision();
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
    FakeEventSource.instances[0].emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: revision,
      source_kind: 'session',
      source_id: 'session-input',
      detail_scope: 'summary',
      delivery_class: 'durable',
      source_health: 'live',
      event: 'SessionInputProjection',
      payload: {
        type: 'SessionInputProjection',
        projection: { pending_count: 1 },
      },
    });
    FakeEventSource.instances[0].emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: revision,
      source_kind: 'session',
      source_id: 'session-input',
      detail_scope: 'summary',
      delivery_class: 'ephemeral_preview',
      source_health: 'live',
      event: 'TerminalDelivery',
      payload: {
        type: 'TerminalDelivery',
        session_id: 'session-input',
        execution_id: 'execution-input',
        turn_id: 'turn-input',
        delivery: {
          event: 'text_delta',
          presentation_id: 'presentation-input',
          attempt_id: 'attempt-input',
          byte_start: 0,
          byte_end: 2,
          delta: 'ok',
        },
      },
    });

    expect(received).toEqual([
      {
        type: 'SessionInputProjection',
        session_id: 'session-input',
        projection: { pending_count: 1 },
      },
      {
        event: 'text_delta',
        presentation_id: 'presentation-input',
        attempt_id: 'attempt-input',
        byte_start: 0,
        byte_end: 2,
        delta: 'ok',
        session_id: 'session-input',
        execution_id: 'execution-input',
        turn_id: 'turn-input',
      },
    ]);
    source.close();
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

  it('uses a tab-nonce surface instance for live subscriptions (C6)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const subscriptionApi = mockSubscriptionApi();
    const lease = openLiveSource(
      { kind: 'session', id: 'session-tab-nonce' },
      { envelope: vi.fn() },
    );
    await vi.waitFor(() => expect(subscriptionApi.create).toHaveBeenCalledTimes(1));
    const request = subscriptionApi.create.mock.calls[0][0];
    expect(request.surface_instance).toMatch(/:tab:/);
    expect(request.surface_instance).not.toBe('webui:test');
    // The same tab-nonce instance must be carried as the observer header so
    // the Gateway's header/body binding matches (C6).
    expect(subscriptionApi.create.mock.calls[0][1]).toBe(request.surface_instance);
    lease.close();
  });

  it('recovers authorization automatically at most once per browser session (F2)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const subscriptionApi = mockSubscriptionApi();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });
    globalThis.sessionStorage?.removeItem('cowd.auth_recovery_used');

    const source = openSessionLiveSource('session-auth-recovery', 0);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const stream = FakeEventSource.instances[0];
    const ready = {
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
    };
    stream.emit(ready);
    stream.emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: subscriptionApi.revision(),
      source_kind: 'session',
      source_id: 'session-auth-recovery',
      detail_scope: 'summary',
      delivery_class: 'snapshot_reconstructable',
      source_health: 'revoked',
      event: 'source.authorization_revoked',
      payload: { reason: 'credential epoch changed' },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(globalThis.sessionStorage?.getItem('cowd.auth_recovery_used')).toBe('1');

    // Pass the in-memory throttle so the sessionStorage gate is the only
    // remaining guard.
    await vi.advanceTimersByTimeAsync(61_000);
    stream.emit({
      schema_version: 1,
      subscription_id: 'live-test',
      subscription_revision: subscriptionApi.revision(),
      source_kind: 'session',
      source_id: 'session-auth-recovery',
      detail_scope: 'summary',
      delivery_class: 'snapshot_reconstructable',
      source_health: 'revoked',
      event: 'source.authorization_revoked',
      payload: { reason: 'principal expired' },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(1);
    source.close();
  });
});
