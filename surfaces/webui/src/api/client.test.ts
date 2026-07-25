import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  invalidateApiReadCache,
  invalidateAuthentication,
  read,
  writeWithMetadata,
} from './client';

describe('API authorization epoch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateApiReadCache();
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

  it('a single forbidden response invalidates cached reads for every endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ secret: 'cached-A' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('authorization revoked', { status: 403 }))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    expect((await read('/api/a', { secret: '' })).secret).toBe('cached-A');
    expect((await read('/api/b', { secret: '' })).__state).toBe('forbidden');
    const afterRevoke = await read('/api/a', { secret: 'fallback' });
    expect(afterRevoke.__state).toBe('offline');
    expect(afterRevoke.secret).toBe('fallback');
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
