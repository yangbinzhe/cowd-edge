import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  claimWebuiObserverId,
  invalidateApiReadCache,
  invalidateAuthentication,
  providerModels,
  read,
  resetWebuiObserverIdentityForTests,
  writeWithMetadata,
} from './client';

describe('API authorization epoch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    invalidateApiReadCache();
    resetWebuiObserverIdentityForTests();
  });

  it('rejects an old-credential response that completes after the auth epoch changes', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    })));

    const pending = read('/api/session-sensitive', { value: 'fallback' });
    invalidateAuthentication('credential replaced during request');
    finish(new Response(JSON.stringify({ value: 'old-secret' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await pending;
    expect(result.__state).toBe('forbidden');
    expect(result.value).toBe('fallback');
    expect(JSON.stringify(result)).not.toContain('old-secret');
  });

  it('coalesces concurrent reads for the same authorized projection', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = read('/api/runtime/status', { status: 'fallback' });
    const second = read('/api/runtime/status', { status: 'fallback' });
    finish(new Response(JSON.stringify({ status: 'healthy' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult.status).toBe('healthy');
    expect(secondResult.status).toBe('healthy');
    expect(firstResult.__state).toBe('ready');
    expect(secondResult.__state).toBe('ready');
  });

  it('coalesces signalled reads while allowing one caller to cancel independently', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = read('/api/runtime/status', {}, { signal: firstController.signal });
    const second = read('/api/runtime/status', {}, { signal: secondController.signal });
    firstController.abort();
    finish(new Response(JSON.stringify({ status: 'healthy' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ status: 'healthy', __state: 'ready' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the shared fetch after every subscriber cancels', async () => {
    const fetchAborted = vi.fn();
    const fetchMock = vi.fn((_path: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        fetchAborted();
        reject(new DOMException('The operation was aborted', 'AbortError'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = read('/api/runtime/status', {}, { signal: firstController.signal });
    const second = read('/api/runtime/status', {}, { signal: secondController.signal });
    firstController.abort();
    secondController.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchAborted).toHaveBeenCalledTimes(1);
  });

  it('classifies a shared transport deadline as timeout without cancelling callers independently', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_path: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = read('/api/slow-bootstrap', { value: 'fallback' }, {}, '', 'bootstrap');
    const second = read('/api/slow-bootstrap', { value: 'fallback' }, {}, '', 'bootstrap');
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(first).resolves.toMatchObject({ value: 'fallback', __state: 'timeout' });
    await expect(second).resolves.toMatchObject({ value: 'fallback', __state: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the last successful projection as stale after a transport deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 'fresh' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockImplementationOnce((_path: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        }, { once: true });
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(read('/api/deadline-cache', { value: 'fallback' }, {}, '', 'bootstrap'))
      .resolves.toMatchObject({ value: 'fresh', __state: 'ready' });
    const timedOut = read('/api/deadline-cache', { value: 'fallback' }, {}, '', 'bootstrap');
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(timedOut).resolves.toMatchObject({
      value: 'fresh',
      __state: 'stale',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reassigns a copied-tab observer identity before opening a live subscription', async () => {
    vi.useFakeTimers();
    class OccupiedBroadcastChannel {
      private listeners = new Set<(event: MessageEvent) => void>();

      addEventListener(_type: string, listener: (event: MessageEvent) => void) {
        this.listeners.add(listener);
      }

      removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
        this.listeners.delete(listener);
      }

      postMessage(message: any) {
        if (message.type !== 'probe') return;
        queueMicrotask(() => {
          const occupied = new MessageEvent('message', {
            data: {
              type: 'occupied',
              observer_id: message.observer_id,
              nonce: message.nonce,
            },
          });
          for (const listener of this.listeners) listener(occupied);
        });
      }

      close() {}
    }
    resetWebuiObserverIdentityForTests();
    sessionStorage.setItem('cowd.webui.observer_id', 'webui:copied-tab');
    vi.stubGlobal('BroadcastChannel', OccupiedBroadcastChannel);

    const claimed = claimWebuiObserverId();
    await vi.advanceTimersByTimeAsync(40);

    await expect(claimed).resolves.not.toBe('webui:copied-tab');
    expect(sessionStorage.getItem('cowd.webui.observer_id')).not.toBe('webui:copied-tab');
  });

  it('does not allow a read started before a write to repopulate the cache', async () => {
    let finishOldRead!: (response: Response) => void;
    let catalogReads = 0;
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      if (String(path) === '/api/skills/catalog') {
        catalogReads += 1;
        if (catalogReads === 1) {
          return new Promise<Response>((resolve) => {
            finishOldRead = resolve;
          });
        }
        return Promise.resolve(new Response(JSON.stringify({ items: [{ id: 'fresh' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = read('/api/skills/catalog', { items: [] });
    await writeWithMetadata('/api/skills/reload', { method: 'POST' });
    finishOldRead(new Response(JSON.stringify({ items: [{ id: 'stale' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await pending;
    expect(result.items).toEqual([{ id: 'fresh' }]);
    expect((await read('/api/skills/catalog', { items: [] })).items).toEqual([{ id: 'fresh' }]);
    expect(catalogReads).toBe(2);
  });

  it('does not abort an execution projection when the same session attaches a reader', async () => {
    let finishExecution!: (response: Response) => void;
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      if (String(path) === '/api/sessions/session-A/execution') {
        return new Promise<Response>((resolve) => {
          finishExecution = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        session_id: 'session-A',
        role: 'reader',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const execution = api.sessionExecution('session-A');
    await api.attachSession('session-A', 'reader');
    finishExecution(new Response(JSON.stringify({
      session_id: 'session-A',
      latest_execution_id: 'execution-A',
      active_execution_ids: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(execution).resolves.toMatchObject({
      latest_execution_id: 'execution-A',
      __state: 'ready',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('briefly reuses static catalog projections but never live runtime state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await read('/api/skills/catalog', { items: [] });
    await read('/api/skills/catalog', { items: [] });
    await read('/api/runtime/status', {});
    await read('/api/runtime/status', {});

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps global authentication and unrelated caches for a capability-scoped forbidden response', async () => {
    const invalidated = vi.fn();
    window.addEventListener('cowd:authorization-invalidated', invalidated);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ secret: 'cached-A' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('definition.manage required', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await read('/api/a', { secret: '' })).secret).toBe('cached-A');
    expect((await read('/api/b', { secret: '' })).__state).toBe('forbidden');
    expect((await read('/api/a', { secret: 'fallback' })).secret).toBe('cached-A');
    expect(invalidated).not.toHaveBeenCalled();
    window.removeEventListener('cowd:authorization-invalidated', invalidated);
  });

  it('invalidates only the forbidden session while retaining another session cache', async () => {
    const invalidated = vi.fn();
    window.addEventListener('cowd:session-authorization-invalidated', invalidated);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ secret: 'cached-A' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ secret: 'cached-B' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('session A revoked', { status: 403 }))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await read('/api/sessions/A/messages', { secret: '' });
    await read('/api/sessions/B/messages', { secret: '' });
    const revoked = await read('/api/sessions/A/messages', { secret: 'fallback-A' });
    const retained = await read('/api/sessions/B/messages', { secret: 'fallback-B' });

    expect(revoked.__state).toBe('forbidden');
    expect(retained.__state).toBe('stale');
    expect(retained.secret).toBe('cached-B');
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect((invalidated.mock.calls[0][0] as CustomEvent).detail.sessionId).toBe('A');
    window.removeEventListener('cowd:session-authorization-invalidated', invalidated);
  });

  it('keeps browser authentication when one session write loses authorization', async () => {
    const globalInvalidated = vi.fn();
    const sessionInvalidated = vi.fn();
    window.addEventListener('cowd:authorization-invalidated', globalInvalidated);
    window.addEventListener('cowd:session-authorization-invalidated', sessionInvalidated);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('reader session attachment cannot execute mutations', { status: 403 }),
    ));

    await expect(api.sendMessage('session-A', 'continue')).rejects.toMatchObject({
      status: 403,
    });

    expect(globalInvalidated).not.toHaveBeenCalled();
    expect(sessionInvalidated).toHaveBeenCalledTimes(1);
    expect((sessionInvalidated.mock.calls[0][0] as CustomEvent).detail.sessionId).toBe('session-A');
    window.removeEventListener('cowd:authorization-invalidated', globalInvalidated);
    window.removeEventListener('cowd:session-authorization-invalidated', sessionInvalidated);
  });

  it('evicts aggregate cache entries that reference a revoked session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sessions: [
          { id: 'session-A', title: 'private A' },
          { id: 'session-B', title: 'allowed B' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('session A revoked', { status: 403 }))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    expect((await api.sessions()).sessions).toHaveLength(2);
    expect((await api.messages('session-A')).__state).toBe('forbidden');
    const aggregate = await api.sessions();

    expect(aggregate.__state).toBe('offline');
    expect(aggregate.sessions).toEqual([]);
    expect(JSON.stringify(aggregate)).not.toContain('private A');
  });

  it('evicts nested mission projections that reference a revoked session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        snapshot: {
          projection: {
            sessions: [{ id: 'session-A', title: 'private nested session' }],
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('session A revoked', { status: 403 }))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const aggregatePath = '/api/mission/control-projection';
    expect(JSON.stringify(await read(aggregatePath, {}))).toContain('private nested session');
    expect((await api.messages('session-A')).__state).toBe('forbidden');
    const aggregate = await read(aggregatePath, { snapshot: { projection: { sessions: [] } } });

    expect(aggregate.__state).toBe('offline');
    expect(JSON.stringify(aggregate)).not.toContain('private nested session');
  });

  it('does not return raw file text that completes after global logout', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    })));

    const pending = api.rawFile('private.txt');
    invalidateAuthentication('operator logged out');
    finish(new Response('old credential contents', { status: 200 }));

    await expect(pending).rejects.toThrow('authorization changed');
  });

  it('fails closed when canonical receipt header and body identities differ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      receipt: { receipt_id: 'body-receipt' },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'X-Cowd-Receipt-Id': 'header-receipt',
        'X-Cowd-Request-Id': 'request-1',
      },
    })));

    await expect(writeWithMetadata('/api/apps/mfg/mutation', {
      method: 'POST',
      body: JSON.stringify({ action: 'run' }),
    }, {
      requireReceiptIdentity: true,
      receiptIdFromBody: (data: any) => data.receipt?.receipt_id,
    })).rejects.toMatchObject({
      code: 'receipt_identity_mismatch',
      status: 422,
      retryable: false,
      requestId: 'request-1',
    });
  });

  it('returns immutable business data alongside readable write response metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      receipt: { receipt_id: 'receipt-1' },
      result: 'accepted',
    }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'X-Cowd-Receipt-Id': 'receipt-1',
        'X-Cowd-Correlation-Id': 'correlation-1',
      },
    })));

    const response = await writeWithMetadata('/api/apps/mfg/mutation', {
      method: 'POST',
    }, {
      requireReceiptIdentity: true,
      receiptIdFromBody: (data: any) => data.receipt?.receipt_id,
    });

    expect(response.data).toEqual({
      receipt: { receipt_id: 'receipt-1' },
      result: 'accepted',
    });
    expect(response.metadata).toMatchObject({
      status: 201,
      receiptId: 'receipt-1',
      correlationId: 'correlation-1',
    });
    expect(response.data).not.toHaveProperty('metadata');
  });
});

describe('Provider control-plane projection', () => {
  it('reads model fallback facts from the canonical provider component', () => {
    expect(providerModels({
      components: {
        provider: {
          configured_model: 'deepseek-pro',
          provider_names: ['deepseek'],
          model_count: 2,
        },
      },
    }, {})).toEqual(['deepseek-pro']);
  });
});

describe('WebUI authorization catalogue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delegates normal login capability selection to the broker catalogue', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      surface_id: 'webui',
      entitlement: { granted: ['approval.respond'] },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.authLogin('credential');

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request.body))).toEqual({
      token: 'credential',
      surface_id: 'webui',
      requested_capabilities: [],
    });
  });

  it('normalizes an explicit capability subset used by permission probes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      surface_id: 'webui',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.authLogin('credential', [
      ' approval.respond ',
      'approval.respond',
      '',
      '*',
      'mission.observe',
    ]);

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request.body)).requested_capabilities).toEqual([
      'approval.respond',
      'mission.observe',
    ]);
  });
});
