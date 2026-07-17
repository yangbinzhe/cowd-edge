import type { MfgApiErrorV1, MfgLiveEnvelope } from '../types/mfg';

const MFG_CONTRACT_VERSION = 'mfg.frontend.v1';

export type MfgLiveTransportState = 'connecting' | 'live' | 'reconnecting' | 'stopped';

export class MfgLiveTransportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly apiError: MfgApiErrorV1 | null,
  ) {
    super(message);
    this.name = 'MfgLiveTransportError';
  }
}

interface MfgLiveTransportOptions {
  onEnvelope: (envelope: MfgLiveEnvelope, generation: number) => void;
  onState: (state: MfgLiveTransportState, error?: MfgLiveTransportError) => void;
  fetchImpl?: typeof fetch;
}

export class MfgLiveTransport {
  private generation = 0;
  private running = false;
  private readonly observerId = `webui:${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  private controller: AbortController | null = null;
  private task: Promise<void> | null = null;
  private cursor = '';
  private viewEpoch = '';

  constructor(private readonly options: MfgLiveTransportOptions) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.task = this.run(this.generation);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.task = null;
    this.options.onState('stopped');
  }

  private async run(initialGeneration: number) {
    let generation = initialGeneration;
    let reconnectAttempt = 0;
    while (this.running && generation === this.generation) {
      try {
        this.options.onState(reconnectAttempt ? 'reconnecting' : 'connecting');
        const snapshot = await this.fetchSnapshot(generation);
        if (!this.running || generation !== this.generation) return;
        this.installEnvelope(snapshot, generation);
        reconnectAttempt = 0;
        while (this.running && generation === this.generation) {
          const outcome = await this.consumeStream(generation);
          if (!this.running || generation !== this.generation) return;
          if (outcome === 'resync') {
            generation = ++this.generation;
            this.controller?.abort();
            this.controller = null;
            break;
          }
          reconnectAttempt += 1;
          this.options.onState('reconnecting');
          await cancellableDelay(reconnectDelay(reconnectAttempt), () => !this.running || generation !== this.generation);
          if (!this.running || generation !== this.generation) return;
          // A closed response is a transport boundary. Revalidate through a
          // fresh transactional snapshot under a new generation before
          // opening the next stream.
          generation = ++this.generation;
          break;
        }
      } catch (cause) {
        if (!this.running || generation !== this.generation || isAbort(cause)) return;
        const error = cause instanceof MfgLiveTransportError
          ? cause
          : new MfgLiveTransportError(cause instanceof Error ? cause.message : String(cause), 0, null);
        this.options.onState('reconnecting', error);
        if (
          [401, 403].includes(error.status)
          || ['mfg_live_cursor_key_invalid', 'contract_mismatch'].includes(error.apiError?.code || '')
        ) {
          this.running = false;
          this.options.onState('stopped', error);
          return;
        }
        reconnectAttempt += 1;
        await cancellableDelay(reconnectDelay(reconnectAttempt), () => !this.running || generation !== this.generation);
      }
    }
  }

  private async fetchSnapshot(generation: number): Promise<MfgLiveEnvelope> {
    const envelope = await this.fetchJson('/api/apps/mfg/live/snapshot');
    if (generation !== this.generation || envelope.kind !== 'snapshot') {
      throw new MfgLiveTransportError('MFG live snapshot returned an invalid envelope', 0, null);
    }
    if (envelope.contract_version !== MFG_CONTRACT_VERSION) {
      throw new MfgLiveTransportError(
        `MFG live contract mismatch: expected ${MFG_CONTRACT_VERSION}, received ${envelope.contract_version}`,
        409,
        {
          code: 'contract_mismatch',
          message: 'Upgrade or reload the WebUI before resuming MFG live updates',
          http_status: 409,
          retryable: false,
          recovery_actions: [{ kind: 'reload', label: 'Reload WebUI', enabled: true }],
        },
      );
    }
    return envelope;
  }

  private async consumeStream(generation: number): Promise<'closed' | 'resync'> {
    const controller = new AbortController();
    this.controller = controller;
    const response = await this.request('/api/apps/mfg/live', {
      signal: controller.signal,
      headers: {
        Accept: 'text/event-stream',
        'Last-Event-ID': this.cursor,
        'x-mfg-view-epoch': this.viewEpoch,
      },
    });
    if (!response.body) throw new MfgLiveTransportError('MFG live response has no body', response.status, null);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (this.running && generation === this.generation) {
        const chunk = await reader.read();
        if (chunk.done) return 'closed';
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
          const parsed = parseSseFrame(frame);
          if (parsed.event === 'mfg_live_error') {
            throw liveStreamError(parsed.data);
          }
          if (parsed.event !== 'mfg_live' || !parsed.data) continue;
          let envelope: MfgLiveEnvelope;
          try {
            envelope = JSON.parse(parsed.data) as MfgLiveEnvelope;
          } catch {
            throw new MfgLiveTransportError('MFG live stream emitted invalid JSON', 0, null);
          }
          validateEnvelope(envelope, this.cursor, this.viewEpoch);
          this.installEnvelope(envelope, generation);
          if (envelope.kind === 'resync') return 'resync';
        }
      }
      return 'closed';
    } finally {
      await reader.cancel().catch(() => undefined);
      if (this.controller === controller) this.controller = null;
    }
  }

  private installEnvelope(envelope: MfgLiveEnvelope, generation: number) {
    if (!this.running || generation !== this.generation) return;
    if (envelope.kind === 'snapshot') {
      this.cursor = envelope.cursor;
      this.viewEpoch = envelope.view_epoch;
    } else if (envelope.kind === 'delta') {
      this.cursor = envelope.target_cursor;
      this.viewEpoch = envelope.view_epoch;
    } else if (envelope.kind === 'heartbeat') {
      this.cursor = envelope.cursor;
      this.viewEpoch = envelope.view_epoch;
    } else {
      this.cursor = envelope.latest_cursor;
      this.viewEpoch = '';
    }
    this.options.onEnvelope(envelope, generation);
    this.options.onState(envelope.kind === 'resync' ? 'reconnecting' : 'live');
  }

  private async fetchJson(path: string): Promise<MfgLiveEnvelope> {
    const response = await this.request(path);
    try {
      return await response.json() as MfgLiveEnvelope;
    } catch {
      throw new MfgLiveTransportError('MFG live endpoint returned invalid JSON', response.status, null);
    }
  }

  private async request(path: string, init: RequestInit = {}) {
    const fetchImpl = this.options.fetchImpl || fetch;
    const headers = new Headers(init.headers);
    headers.set('x-cowd-surface-id', 'webui');
    headers.set('x-cowd-observer-id', this.observerId);
    const response = await fetchImpl(path, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
    if (response.ok) return response;
    const text = await response.text();
    let apiError: MfgApiErrorV1 | null = null;
    try {
      const parsed = JSON.parse(text);
      apiError = parsed?.code ? parsed : null;
      if (!apiError && typeof parsed?.error === 'string' && parsed.error.startsWith('__mfg_api_error_v1__:')) {
        apiError = JSON.parse(parsed.error.slice('__mfg_api_error_v1__:'.length));
      }
    } catch {
      apiError = null;
    }
    throw new MfgLiveTransportError(apiError?.message || text || `${response.status} ${response.statusText}`, response.status, apiError);
  }
}

function parseSseFrame(frame: string) {
  const lines = frame.split('\n');
  return {
    event: lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim() || '',
    data: lines.filter((line) => line.startsWith('data:')).map((line) => line.slice('data:'.length).trim()).join('\n'),
  };
}

function liveStreamError(data: string) {
  let apiError: MfgApiErrorV1 | null = null;
  try {
    const parsed = JSON.parse(data) as MfgApiErrorV1;
    apiError = parsed && typeof parsed.code === 'string' && typeof parsed.http_status === 'number'
      ? parsed
      : null;
  } catch {
    apiError = null;
  }
  return new MfgLiveTransportError(
    apiError?.message || data || 'MFG live stream failed',
    apiError?.http_status || 0,
    apiError,
  );
}

function validateEnvelope(envelope: MfgLiveEnvelope, cursor: string, viewEpoch: string) {
  if (envelope.kind === 'delta' && (envelope.base_cursor !== cursor || envelope.view_epoch !== viewEpoch)) {
    throw new MfgLiveTransportError('MFG live delta does not extend the installed cursor', 409, null);
  }
  if (envelope.kind === 'heartbeat' && envelope.view_epoch !== viewEpoch) {
    throw new MfgLiveTransportError('MFG live heartbeat changed view epoch without resync', 409, null);
  }
  if (envelope.kind === 'resync' && envelope.snapshot_url !== '/api/apps/mfg/live/snapshot') {
    throw new MfgLiveTransportError('MFG live resync returned an unsafe snapshot URL', 400, null);
  }
}

function reconnectDelay(attempt: number) {
  const base = Math.min(8_000, 250 * (2 ** Math.min(5, attempt)));
  return base + ((attempt * 73) % 251);
}

async function cancellableDelay(ms: number, cancelled: () => boolean) {
  const until = Date.now() + ms;
  while (!cancelled() && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, until - Date.now())));
  }
}

function isAbort(cause: unknown) {
  return cause instanceof DOMException && cause.name === 'AbortError';
}
