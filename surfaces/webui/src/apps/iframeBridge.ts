export const IFRAME_BRIDGE_SCHEMA_VERSION = 1 as const;

export interface AppErrorDetailV1 {
  code: 'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'OPERATION_NOT_GRANTED' | 'APP_NOT_FOUND'
    | 'RECEIPT_NOT_FOUND' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT'
    | 'CALL_CYCLE_DETECTED' | 'PROTOCOL_INCOMPATIBLE' | 'APP_ACTIVATION_OVERLOADED'
    | 'REQUEST_TOO_LARGE' | 'CURSOR_EXPIRED' | 'DEADLINE_EXCEEDED' | 'APP_UNAVAILABLE'
    | 'DEPENDENCY_UNAVAILABLE' | 'INTERNAL_ERROR';
  message: string;
  retryable: boolean;
  receipt_id?: string | null;
  retry_after_ms?: number | null;
  details?: unknown;
}

export interface IframeBridgeHostOptions {
  entry: {
    app_id: string;
    generation: string;
    artifact_version: string;
  };
  frameNonce: string;
  protocolDigest: string;
  catalogGeneration: string;
  fetchImpl?: typeof fetch;
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  channelFactory?: () => MessageChannel;
  now?: () => number;
  onReady?: () => void;
  onNavigate?: (route: string) => void;
  onResize?: (heightCssPx: number) => void;
  onCoreNavigation?: (objectKind: string, objectId: string) => void;
}

type HostWindowKind = 'host_theme' | 'host_locale' | 'host_visibility' | 'host_error';
type PortLike = Pick<MessagePort, 'postMessage' | 'close' | 'start'> & {
  onmessage: ((event: MessageEvent) => void) | null;
};

interface ActiveRequest {
  controller: AbortController;
  credit: number;
  waiters: Array<() => void>;
}

export interface SanitizedAppDetailV1 {
  schema_version: 1;
  entry: unknown;
  manifest: unknown;
  operations: unknown[];
}

const inboundKeys: Record<string, readonly string[]> = {
  app_ready: ['kind', 'schema_version', 'app_id', 'frame_nonce', 'message_id'],
  app_navigate: ['kind', 'schema_version', 'app_id', 'frame_nonce', 'message_id', 'route'],
  app_resize: ['kind', 'schema_version', 'app_id', 'frame_nonce', 'message_id', 'height_css_px'],
  app_request_core_navigation: [
    'kind', 'schema_version', 'app_id', 'frame_nonce', 'message_id', 'object_kind', 'object_id',
  ],
};

const portKeys: Record<string, readonly string[]> = {
  app_api_request: [
    'kind', 'schema_version', 'request_id', 'method', 'path', 'deadline_unix_ms', 'headers', 'body',
  ],
  app_api_cancel: ['kind', 'schema_version', 'request_id'],
  app_api_credit: ['kind', 'schema_version', 'request_id', 'bytes'],
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function exactShape(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function canonicalSegment(segment: string) {
  if (!segment || segment === '.' || segment === '..') return false;
  try {
    return encodeURIComponent(decodeURIComponent(segment)) === segment;
  } catch {
    return false;
  }
}

function safeAppRoute(appId: string, method: string, path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')
    || /[\u0000-\u001f]/.test(path) || path.includes('?') || path.includes('#')) return null;
  const segments = path.slice(1).split('/');
  if (!segments.every(canonicalSegment)) return null;
  const matches = (
    (method === 'POST' && segments.length === 3 && segments[0] === 'operations'
      && ['invoke', 'stream'].includes(segments[2]))
    || (method === 'GET' && segments.length === 2 && segments[0] === 'receipts')
    || (method === 'DELETE' && segments.length === 2 && segments[0] === 'subscriptions')
    || (method === 'POST' && segments.length === 3 && segments[0] === 'subscriptions'
      && segments[2] === 'ack')
    || (method === 'POST' && segments.length === 4 && segments[0] === 'tui'
      && segments[1] === 'views' && ['actions', 'open', 'stream'].includes(segments[3]))
  );
  return matches ? `/api/apps/${encodeURIComponent(appId)}${path}` : null;
}

function safeNavigationRoute(route: string) {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || /[\u0000-\u001f]/.test(route)) return false;
  return new URL(route, 'http://cowd.invalid').origin === 'http://cowd.invalid';
}

function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function responseHeaders(headers: Headers) {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!['set-cookie', 'www-authenticate', 'proxy-authenticate'].includes(key.toLowerCase())) output[key] = value;
  });
  return output;
}

export class IframeBridgeHost {
  private readonly fetchImpl: typeof fetch;
  private readonly eventTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  private readonly now: () => number;
  private readonly channelFactory: () => MessageChannel;
  private frameWindow: Window | null = null;
  private port: PortLike | null = null;
  private attached = false;
  private disposed = false;
  private nextMessage = 0;
  private replayOrder: string[] = [];
  private replaySet = new Set<string>();
  private requests = new Map<string, ActiveRequest>();
  private requestReplayOrder: string[] = [];
  private requestReplaySet = new Set<string>();
  private detailPromise: Promise<SanitizedAppDetailV1> | null = null;
  private detailController: AbortController | null = null;
  private authorizationValid = true;

  constructor(private readonly options: IframeBridgeHostOptions) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.eventTarget = options.eventTarget || window;
    this.now = options.now || Date.now;
    this.channelFactory = options.channelFactory || (() => new MessageChannel());
  }

  attach() {
    if (this.attached || this.disposed) return;
    this.eventTarget.addEventListener('message', this.onWindowMessage as EventListener);
    this.attached = true;
  }

  connect(frameWindow: Window) {
    if (this.disposed) return;
    this.attach();
    for (const request of this.requests.values()) {
      request.controller.abort();
      request.waiters.splice(0).forEach((resolve) => resolve());
    }
    this.requests.clear();
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
    }
    this.replayOrder = [];
    this.replaySet.clear();
    this.requestReplayOrder = [];
    this.requestReplaySet.clear();
    this.detailController?.abort();
    this.detailController = null;
    this.detailPromise = null;
    this.authorizationValid = true;
    this.frameWindow = frameWindow;
    const channel = this.channelFactory();
    this.port = channel.port1;
    this.port.onmessage = (event) => this.onPortMessage(event);
    this.port.start();
    frameWindow.postMessage(this.envelope('host_init', {
      protocol_digest: this.options.protocolDigest,
      catalog_generation: this.options.catalogGeneration,
    }), '*', [channel.port2]);
  }

  sendTheme(theme: string) { this.sendWindow('host_theme', { theme }); }
  sendLocale(locale: string) { this.sendWindow('host_locale', { locale }); }
  sendVisibility(visible: boolean) { this.sendWindow('host_visibility', { visible }); }
  sendError(error: AppErrorDetailV1) { this.sendWindow('host_error', { error }); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.attached) this.eventTarget.removeEventListener('message', this.onWindowMessage as EventListener);
    for (const request of this.requests.values()) {
      request.controller.abort();
      request.waiters.splice(0).forEach((resolve) => resolve());
    }
    this.requests.clear();
    this.detailController?.abort();
    this.detailController = null;
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
    }
    this.port = null;
    this.frameWindow = null;
    this.replayOrder = [];
    this.replaySet.clear();
  }

  private envelope(kind: string, extra: Record<string, unknown>) {
    return {
      kind,
      schema_version: IFRAME_BRIDGE_SCHEMA_VERSION,
      app_id: this.options.entry.app_id,
      frame_nonce: this.options.frameNonce,
      message_id: `host-${++this.nextMessage}`,
      ...extra,
    };
  }

  private sendWindow(kind: HostWindowKind, extra: Record<string, unknown>) {
    if (!this.disposed) this.frameWindow?.postMessage(this.envelope(kind, extra), '*');
  }

  private readonly onWindowMessage = (event: MessageEvent) => {
    if (this.disposed || event.source !== this.frameWindow || event.origin !== 'null') return;
    const message = plainRecord(event.data);
    if (!message || !nonEmptyString(message.kind) || !inboundKeys[message.kind]
      || !exactShape(message, inboundKeys[message.kind])
      || message.schema_version !== IFRAME_BRIDGE_SCHEMA_VERSION
      || message.app_id !== this.options.entry.app_id || message.frame_nonce !== this.options.frameNonce
      || !nonEmptyString(message.message_id) || this.remembered(message.message_id)) return;
    this.remember(message.message_id);
    if (message.kind === 'app_ready') this.options.onReady?.();
    if (message.kind === 'app_navigate' && nonEmptyString(message.route) && safeNavigationRoute(message.route)) {
      this.options.onNavigate?.(message.route);
    }
    if (message.kind === 'app_resize' && safeInteger(message.height_css_px) && message.height_css_px <= 16_384) {
      this.options.onResize?.(message.height_css_px);
    }
    if (message.kind === 'app_request_core_navigation'
      && nonEmptyString(message.object_kind) && nonEmptyString(message.object_id)) {
      this.options.onCoreNavigation?.(message.object_kind, message.object_id);
    }
  };

  private remembered(id: string) { return this.replaySet.has(id); }

  private remember(id: string) {
    this.replaySet.add(id);
    this.replayOrder.push(id);
    if (this.replayOrder.length > 2048) this.replaySet.delete(this.replayOrder.shift()!);
  }

  private onPortMessage(event: MessageEvent) {
    const message = plainRecord(event.data);
    if (!message || !nonEmptyString(message.kind) || !portKeys[message.kind]
      || !exactShape(message, portKeys[message.kind]) || message.schema_version !== 1
      || !nonEmptyString(message.request_id)) return;
    if (message.kind === 'app_api_cancel') {
      const request = this.requests.get(message.request_id);
      request?.controller.abort();
      request?.waiters.splice(0).forEach((resolve) => resolve());
      return;
    }
    if (message.kind === 'app_api_credit') {
      if (!safeInteger(message.bytes) || message.bytes === 0) return;
      const request = this.requests.get(message.request_id);
      if (!request) return;
      request.credit = Math.min(Number.MAX_SAFE_INTEGER, request.credit + message.bytes);
      request.waiters.splice(0).forEach((resolve) => resolve());
      return;
    }
    void this.startRequest(message).catch(() => undefined);
  }

  private async startRequest(message: Record<string, unknown>) {
    const requestId = message.request_id as string;
    if (!this.authorizationValid) return this.postError(requestId, 'UNAUTHENTICATED', 'The APP host authorization is no longer valid.');
    if (this.requestReplaySet.has(requestId)) return this.postError(requestId, 'INVALID_REQUEST', 'Duplicate or replayed request identifier.');
    this.rememberRequest(requestId);
    if (this.requests.size >= 16) return this.postError(requestId, 'APP_ACTIVATION_OVERLOADED', 'Too many active APP requests.', true);
    const requestHeaders = plainRecord(message.headers);
    if (!nonEmptyString(message.method) || !nonEmptyString(message.path)
      || !safeInteger(message.deadline_unix_ms) || !requestHeaders) {
      return this.postError(requestId, 'INVALID_REQUEST', 'The APP API request is invalid.');
    }
    const method = message.method.toUpperCase();
    const requestPath = safeAppRoute(this.options.entry.app_id, method, message.path);
    if (!requestPath) return this.postError(requestId, 'INVALID_REQUEST', 'Only this APP’s generic operation routes are allowed.');
    const headers = new Headers();
    for (const [key, value] of Object.entries(requestHeaders)) {
      if (typeof value !== 'string' || !['accept', 'content-type', 'if-none-match'].includes(key.toLowerCase())) {
        return this.postError(requestId, 'INVALID_REQUEST', 'A request header is not allowed.');
      }
      headers.set(key, value);
    }
    headers.set('x-cowd-surface-id', 'webui');
    const controller = new AbortController();
    const active: ActiveRequest = { controller, credit: 0, waiters: [] };
    this.requests.set(requestId, active);
    const remaining = message.deadline_unix_ms - this.now();
    if (remaining <= 0) controller.abort();
    const timer = setTimeout(() => controller.abort(), Math.min(2_147_483_647, Math.max(0, remaining)));
    try {
      const detail = await this.appDetail();
      if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      this.post({ kind: 'host_app_detail', schema_version: 1, request_id: requestId, detail });
      const hasBody = !['GET', 'HEAD'].includes(method) && message.body !== null;
      const body = hasBody
        ? (typeof message.body === 'string' ? message.body : JSON.stringify(message.body))
        : undefined;
      if (hasBody && typeof message.body !== 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
      const response = await this.fetchImpl(requestPath, {
        method, headers, body, credentials: 'same-origin', signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        this.invalidateAuthorization(response.status === 401 ? 'UNAUTHENTICATED' : 'OPERATION_NOT_GRANTED');
        return;
      }
      this.post({ kind: 'host_api_headers', schema_version: 1, request_id: requestId,
        status: response.status, headers: responseHeaders(response.headers) });
      if (response.body) {
        const reader = response.body.getReader();
        let sequence = 0;
        let firstRead = true;
        while (!this.disposed) {
          if (firstRead) {
            await this.waitForCredit(active);
            if (controller.signal.aborted || this.disposed) break;
            firstRead = false;
          }
          const { done, value } = await reader.read();
          if (done) break;
          let offset = 0;
          while (offset < value.length && !controller.signal.aborted && !this.disposed) {
            await this.waitForCredit(active);
            if (controller.signal.aborted || this.disposed) break;
            const length = Math.min(active.credit, value.length - offset);
            active.credit -= length;
            this.post({ kind: 'host_api_data', schema_version: 1, request_id: requestId,
              sequence: sequence++, data_base64url: base64url(value.subarray(offset, offset + length)) });
            offset += length;
          }
        }
        if (!controller.signal.aborted && !this.disposed) {
          this.post({ kind: 'host_api_end', schema_version: 1, request_id: requestId, sequence });
        }
      } else {
        this.post({ kind: 'host_api_end', schema_version: 1, request_id: requestId, sequence: 0 });
      }
    } catch (error) {
      if (!this.disposed && this.authorizationValid) this.postError(requestId, controller.signal.aborted ? 'DEADLINE_EXCEEDED' : 'DEPENDENCY_UNAVAILABLE',
        controller.signal.aborted ? 'The APP API request was cancelled or exceeded its deadline.' : 'The APP API request failed.', true);
    } finally {
      clearTimeout(timer);
      this.requests.delete(requestId);
      active.waiters.splice(0).forEach((resolve) => resolve());
    }
  }

  private rememberRequest(id: string) {
    this.requestReplaySet.add(id);
    this.requestReplayOrder.push(id);
    if (this.requestReplayOrder.length > 2048) this.requestReplaySet.delete(this.requestReplayOrder.shift()!);
  }

  private appDetail() {
    if (!this.detailPromise) {
      this.detailController = new AbortController();
      this.detailPromise = this.loadAppDetail().catch((error) => {
        if (this.authorizationValid) this.detailPromise = null;
        throw error;
      });
    }
    return this.detailPromise;
  }

  private async loadAppDetail(): Promise<SanitizedAppDetailV1> {
    const response = await this.fetchImpl(`/api/apps/${encodeURIComponent(this.options.entry.app_id)}`, {
      method: 'GET', credentials: 'same-origin', headers: { 'x-cowd-surface-id': 'webui' },
      signal: this.detailController?.signal,
    });
    if (response.status === 401 || response.status === 403) {
      this.invalidateAuthorization(response.status === 401 ? 'UNAUTHENTICATED' : 'OPERATION_NOT_GRANTED');
      throw new Error('APP host authorization invalidated');
    }
    if (!response.ok) throw new Error(`APP detail failed with ${response.status}`);
    return this.sanitizeDetail(await response.json());
  }

  private sanitizeDetail(value: unknown): SanitizedAppDetailV1 {
    const input = plainRecord(value);
    const entry = plainRecord(input?.entry);
    const manifest = plainRecord(input?.manifest);
    if (!input || !exactShape(input, ['schema_version', 'entry', 'manifest', 'operations'])
      || input.schema_version !== 1 || !entry || !manifest || !Array.isArray(input.operations)
      || entry.app_id !== this.options.entry.app_id || entry.generation !== this.options.entry.generation
      || entry.artifact_version !== this.options.entry.artifact_version
      || manifest.app_id !== this.options.entry.app_id
      || manifest.artifact_version !== this.options.entry.artifact_version) {
      throw new Error('Gateway returned an invalid APP detail identity');
    }
    const operations = input.operations.map((operation) => {
      const descriptor = plainRecord(operation);
      if (!descriptor || !nonEmptyString(descriptor.operation_id)) throw new Error('Gateway returned an invalid APP operation');
      return this.jsonClone(descriptor);
    });
    if (new Set(operations.map((operation) => (operation as Record<string, unknown>).operation_id)).size !== operations.length) {
      throw new Error('Gateway returned duplicate APP operations');
    }
    return Object.freeze({ schema_version: 1, entry: this.jsonClone(entry), manifest: this.jsonClone(manifest), operations });
  }

  private jsonClone(value: unknown): unknown {
    const serialized = JSON.stringify(value, (key, item) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe APP detail key');
      return item;
    });
    if (serialized.length > 1024 * 1024) throw new Error('APP detail exceeds 1 MiB');
    return JSON.parse(serialized);
  }

  private invalidateAuthorization(code: 'UNAUTHENTICATED' | 'OPERATION_NOT_GRANTED') {
    if (!this.authorizationValid) return;
    this.authorizationValid = false;
    this.detailController?.abort();
    for (const [requestId, request] of this.requests) {
      this.postError(requestId, code, 'The APP host authorization was invalidated.');
      request.controller.abort();
      request.waiters.splice(0).forEach((resolve) => resolve());
    }
    this.sendError({ code, message: 'The APP host authorization was invalidated.', retryable: false });
  }

  private async waitForCredit(active: ActiveRequest) {
    while (active.credit === 0 && !active.controller.signal.aborted && !this.disposed) {
      await new Promise<void>((resolve) => active.waiters.push(resolve));
    }
  }

  private postError(requestId: string, code: AppErrorDetailV1['code'], message: string, retryable = false) {
    this.post({ kind: 'host_api_error', schema_version: 1, request_id: requestId,
      error: { code, message, retryable } });
  }

  private post(message: Record<string, unknown>) {
    if (!this.disposed) this.port?.postMessage(message);
  }
}
