import { describe, expect, it, vi } from 'vitest';
import { MfgLiveTransport } from './mfgLiveTransport';
import type { MfgLiveEnvelope } from '../types/mfg';

const snapshot = (epoch: string, cursor: string): MfgLiveEnvelope => ({
  kind: 'snapshot',
  view_epoch: epoch,
  cursor,
  generated_at: '2026-07-16T00:00:00Z',
  contract_version: 'mfg.frontend.v1',
  state: {
    cockpit: {}, alerts: {}, assignments: {}, incidents: {}, executions: {},
    reports: {}, reviews: {}, receipts: {}, data_compute: {},
  },
});

function sse(...envelopes: MfgLiveEnvelope[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const envelope of envelopes) {
        controller.enqueue(encoder.encode(`event: mfg_live\ndata: ${JSON.stringify(envelope)}\n\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function sseError(error: Record<string, unknown>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: mfg_live_error\ndata: ${JSON.stringify(error)}\n\n`));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('MfgLiveTransport', () => {
  it('installs snapshot, validates deltas, resyncs with a new generation, and never uses EventSource', async () => {
    const envelopes: Array<{ envelope: MfgLiveEnvelope; generation: number }> = [];
    const delta: MfgLiveEnvelope = {
      kind: 'delta',
      view_epoch: 'epoch-1',
      base_cursor: 'cursor-1',
      target_cursor: 'cursor-2',
      events: [],
    };
    const resync: MfgLiveEnvelope = {
      kind: 'resync',
      previous_view_epoch: 'epoch-1',
      reason: 'view_scope_changed',
      snapshot_url: '/api/apps/mfg/live/snapshot',
      latest_cursor: 'cursor-3',
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot('epoch-1', 'cursor-1'))))
      .mockResolvedValueOnce(sse(delta, resync))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot('epoch-2', 'cursor-4'))));
    let transport!: MfgLiveTransport;
    transport = new MfgLiveTransport({
      fetchImpl,
      onEnvelope: (envelope, generation) => {
        envelopes.push({ envelope, generation });
        if (envelope.kind === 'snapshot' && envelope.view_epoch === 'epoch-2') transport.stop();
      },
      onState: () => undefined,
    });
    transport.start();
    await vi.waitFor(() => expect(envelopes.map(({ envelope }) => envelope.kind)).toEqual([
      'snapshot', 'delta', 'resync', 'snapshot',
    ]));
    expect(envelopes.map(({ generation }) => generation)).toEqual([1, 1, 1, 2]);
    const streamHeaders = new Headers(fetchImpl.mock.calls[1][1].headers);
    expect(streamHeaders.get('Last-Event-ID')).toBe('cursor-1');
    expect(streamHeaders.get('x-mfg-view-epoch')).toBe('epoch-1');
    expect(streamHeaders.get('x-cowd-surface-id')).toBe('webui');
    expect(streamHeaders.get('x-cowd-observer-id')).toMatch(/^webui:/);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.credentials === 'same-origin')).toBe(true);
  });

  it('surfaces typed 401 and stops instead of reconnecting forever', async () => {
    const states: Array<{ state: string; status?: number }> = [];
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'authentication_required',
      message: 'sign in again',
      http_status: 401,
      retryable: false,
      recovery_actions: [],
    }), { status: 401 }));
    const transport = new MfgLiveTransport({
      fetchImpl,
      onEnvelope: () => undefined,
      onState: (state, error) => states.push({ state, status: error?.status }),
    });
    transport.start();
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ state: 'stopped', status: 401 }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reconnects after a temporary Broker authority restart instead of treating it as a sign-out', async () => {
    const states: Array<{ state: string; status?: number; reason?: string }> = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'authentication_required',
        message: 'the local authority is restarting',
        http_status: 401,
        retryable: true,
        details: { reason: 'authority_unavailable' },
        recovery_actions: [],
      }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot('epoch-after-restart', 'cursor-1'))));
    let transport!: MfgLiveTransport;
    transport = new MfgLiveTransport({
      fetchImpl,
      onEnvelope: (envelope) => {
        if (envelope.kind === 'snapshot') transport.stop();
      },
      onState: (state, error) => states.push({
        state,
        status: error?.status,
        reason: typeof error?.apiError?.details?.reason === 'string'
          ? error.apiError.details.reason
          : undefined,
      }),
    });
    transport.start();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(states).toContainEqual({
      state: 'reconnecting',
      status: 401,
      reason: 'authority_unavailable',
    });
    expect(states).not.toContainEqual(expect.objectContaining({ state: 'stopped', status: 401 }));
  });

  it('installs a new-generation snapshot after an ordinary stream closure', async () => {
    const installed: Array<{ kind: string; generation: number; epoch?: string }> = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot('epoch-1', 'cursor-1'))))
      .mockResolvedValueOnce(sse({
        kind: 'heartbeat',
        view_epoch: 'epoch-1',
        cursor: 'cursor-2',
        generated_at: '2026-07-16T00:00:01Z',
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot('epoch-1', 'cursor-3'))));
    let transport!: MfgLiveTransport;
    transport = new MfgLiveTransport({
      fetchImpl,
      onEnvelope: (envelope, generation) => {
        installed.push({
          kind: envelope.kind,
          generation,
          epoch: envelope.kind === 'snapshot' ? envelope.view_epoch : undefined,
        });
        if (envelope.kind === 'snapshot' && generation === 2) transport.stop();
      },
      onState: () => undefined,
    });
    transport.start();
    await vi.waitFor(() => expect(installed).toEqual([
      { kind: 'snapshot', generation: 1, epoch: 'epoch-1' },
      { kind: 'heartbeat', generation: 1, epoch: undefined },
      { kind: 'snapshot', generation: 2, epoch: 'epoch-1' },
    ]));
  });

  it('surfaces typed 403 and does not install an unauthorized snapshot', async () => {
    const envelopes: MfgLiveEnvelope[] = [];
    const states: Array<{ state: string; code?: string }> = [];
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'capability_denied',
      message: 'mfg.read is required',
      http_status: 403,
      retryable: false,
      recovery_actions: [],
    }), { status: 403 }));
    const transport = new MfgLiveTransport({
      fetchImpl,
      onEnvelope: (envelope) => envelopes.push(envelope),
      onState: (state, error) => states.push({ state, code: error?.apiError?.code }),
    });
    transport.start();
    await vi.waitFor(() => expect(states.at(-1)).toEqual({
      state: 'stopped',
      code: 'capability_denied',
    }));
    expect(envelopes).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops when an established stream emits a typed authorization error', async () => {
    const states: Array<{ state: string; status?: number; code?: string }> = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot('epoch-1', 'cursor-1'))))
      .mockResolvedValueOnce(sseError({
        code: 'authentication_required',
        message: 'profile revision changed',
        http_status: 401,
        retryable: false,
        recovery_actions: [],
      }));
    const transport = new MfgLiveTransport({
      fetchImpl,
      onEnvelope: () => undefined,
      onState: (state, error) => states.push({
        state,
        status: error?.status,
        code: error?.apiError?.code,
      }),
    });
    transport.start();
    await vi.waitFor(() => expect(states.at(-1)).toEqual({
      state: 'stopped',
      status: 401,
      code: 'authentication_required',
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a live contract mismatch', async () => {
    const states: Array<{ state: string; code?: string }> = [];
    const mismatched = snapshot('epoch-1', 'cursor-1');
    if (mismatched.kind === 'snapshot') mismatched.contract_version = 'mfg.frontend.v999';
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mismatched), { status: 200 }),
    );
    const transport = new MfgLiveTransport({
      fetchImpl,
      onEnvelope: () => {
        throw new Error('mismatched snapshot must not be installed');
      },
      onState: (state, error) => states.push({ state, code: error?.apiError?.code }),
    });
    transport.start();
    await vi.waitFor(() => expect(states.at(-1)).toEqual({
      state: 'stopped',
      code: 'contract_mismatch',
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts the single active fetch reader on explicit stop', async () => {
    let streamSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      if (String(path).endsWith('/snapshot')) {
        return Promise.resolve(new Response(JSON.stringify(snapshot('epoch-1', 'cursor-1'))));
      }
      streamSignal = init?.signal || undefined;
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          streamSignal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'));
          });
        },
      }), { status: 200 }));
    });
    const transport = new MfgLiveTransport({
      fetchImpl: fetchImpl as typeof fetch,
      onEnvelope: () => undefined,
      onState: () => undefined,
    });
    transport.start();
    await vi.waitFor(() => expect(streamSignal).toBeDefined());
    transport.stop();
    expect(streamSignal?.aborted).toBe(true);
  });
});
