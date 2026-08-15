import { describe, expect, it, vi } from 'vitest';
import { IframeBridgeHost } from './iframeBridge';

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: unknown[] = [];
  closed = false;
  postMessage(message: unknown) { this.sent.push(message); }
  start() {}
  close() { this.closed = true; }
  receive(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

function harness(fetchImpl?: typeof fetch) {
  let listener: ((event: MessageEvent) => void) | null = null;
  const eventTarget = {
    addEventListener: vi.fn((_type: string, callback: EventListener) => { listener = callback as (event: MessageEvent) => void; }),
    removeEventListener: vi.fn((_type: string, callback: EventListener) => {
      if (listener === callback) listener = null;
    }),
  };
  const hostPort = new FakePort();
  const appPort = new FakePort();
  const frameWindow = { postMessage: vi.fn() } as unknown as Window;
  const ready = vi.fn();
  const navigate = vi.fn();
  const resize = vi.fn();
  const coreNavigation = vi.fn();
  const bridge = new IframeBridgeHost({
    appId: 'reference-app', frameNonce: 'nonce-1', protocolDigest: 'sha256:test',
    catalogGeneration: 'catalog-1', eventTarget: eventTarget as never, fetchImpl,
    channelFactory: () => ({ port1: hostPort, port2: appPort }) as unknown as MessageChannel,
    now: () => 1_000, onReady: ready, onNavigate: navigate, onResize: resize, onCoreNavigation: coreNavigation,
  });
  bridge.connect(frameWindow);
  return { bridge, eventTarget, frameWindow, hostPort, appPort, ready, navigate, resize, coreNavigation,
    dispatch: (event: Partial<MessageEvent>) => listener?.(event as MessageEvent) };
}

function windowMessage(kind: string, messageId: string, extra: Record<string, unknown> = {}) {
  return { kind, schema_version: 1, app_id: 'reference-app', frame_nonce: 'nonce-1', message_id: messageId, ...extra };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('iframe bridge v1', () => {
  it('transfers a dedicated port and accepts only opaque exact-source, exact-identity, unreplayed messages', () => {
    const h = harness();
    expect(h.frameWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'host_init' }), '*', [h.appPort]);
    const ready = windowMessage('app_ready', 'm-1');
    h.dispatch({ source: {} as Window, origin: 'null', data: ready });
    h.dispatch({ source: h.frameWindow, origin: 'https://cowd.invalid', data: ready });
    h.dispatch({ source: h.frameWindow, origin: 'null', data: { ...ready, frame_nonce: 'wrong' } });
    expect(h.ready).not.toHaveBeenCalled();
    h.dispatch({ source: h.frameWindow, origin: 'null', data: ready });
    h.dispatch({ source: h.frameWindow, origin: 'null', data: ready });
    expect(h.ready).toHaveBeenCalledTimes(1);
    h.dispatch({ source: h.frameWindow, origin: 'null', data: { ...windowMessage('app_navigate', 'm-2'), route: '/safe' } });
    h.dispatch({ source: h.frameWindow, origin: 'null', data: { ...windowMessage('app_navigate', 'm-3'), route: '//foreign.invalid' } });
    expect(h.navigate).toHaveBeenCalledOnce();
    expect(h.navigate).toHaveBeenCalledWith('/safe');
  });

  it('strictly validates resize/core-navigation shapes', () => {
    const h = harness();
    h.dispatch({ source: h.frameWindow, origin: 'null', data: { ...windowMessage('app_resize', 'r-1'), height_css_px: 900 } });
    h.dispatch({ source: h.frameWindow, origin: 'null', data: { ...windowMessage('app_resize', 'r-2'), height_css_px: 900, extra: true } });
    h.dispatch({ source: h.frameWindow, origin: 'null', data: { ...windowMessage('app_request_core_navigation', 'n-1'), object_kind: 'mission', object_id: 'mission-7' } });
    expect(h.resize).toHaveBeenCalledWith(900);
    expect(h.resize).toHaveBeenCalledTimes(1);
    expect(h.coreNavigation).toHaveBeenCalledWith('mission', 'mission-7');
  });

  it('streams only after credit and uses credit as a byte budget', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200,
      headers: { 'content-type': 'application/octet-stream' } }));
    const h = harness(fetchImpl);
    h.hostPort.receive({ kind: 'app_api_request', schema_version: 1, request_id: 'q-1', method: 'GET',
      path: '/api/apps/reference-app/items', deadline_unix_ms: 10_000, headers: {}, body: null });
    await flush();
    expect(h.hostPort.sent).toContainEqual(expect.objectContaining({ kind: 'host_api_headers', request_id: 'q-1' }));
    expect(h.hostPort.sent).not.toContainEqual(expect.objectContaining({ kind: 'host_api_data' }));
    h.hostPort.receive({ kind: 'app_api_credit', schema_version: 1, request_id: 'q-1', bytes: 2 });
    await flush();
    expect(h.hostPort.sent).toContainEqual(expect.objectContaining({ kind: 'host_api_data', sequence: 0, data_base64url: 'AQI' }));
    expect(h.hostPort.sent).not.toContainEqual(expect.objectContaining({ kind: 'host_api_end' }));
    h.hostPort.receive({ kind: 'app_api_credit', schema_version: 1, request_id: 'q-1', bytes: 3 });
    await flush();
    expect(h.hostPort.sent).toContainEqual(expect.objectContaining({ kind: 'host_api_data', sequence: 1, data_base64url: 'AwQF' }));
    expect(h.hostPort.sent).toContainEqual(expect.objectContaining({ kind: 'host_api_end', sequence: 2 }));
  });

  it('rejects cross-APP API paths, handles cancellation and releases resources on disposal', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal || undefined;
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }) as typeof fetch;
    const h = harness(fetchImpl);
    h.hostPort.receive({ kind: 'app_api_request', schema_version: 1, request_id: 'bad', method: 'GET',
      path: '/api/apps/foreign-app/items', deadline_unix_ms: 10_000, headers: {}, body: null });
    expect(h.hostPort.sent).toContainEqual(expect.objectContaining({ kind: 'host_api_error', request_id: 'bad' }));
    h.hostPort.receive({ kind: 'app_api_request', schema_version: 1, request_id: 'active', method: 'GET',
      path: '/api/apps/reference-app/items', deadline_unix_ms: 10_000, headers: {}, body: null });
    await flush();
    h.hostPort.receive({ kind: 'app_api_cancel', schema_version: 1, request_id: 'active' });
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(h.hostPort.sent).toContainEqual(expect.objectContaining({ kind: 'host_api_error', request_id: 'active' }));
    h.bridge.dispose();
    expect(h.hostPort.closed).toBe(true);
    expect(h.eventTarget.removeEventListener).toHaveBeenCalledOnce();
  });
});
