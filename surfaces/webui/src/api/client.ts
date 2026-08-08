import type {
  ApiReadState,
  ApiReadStatus,
  BranchSessionReceipt,
  GatewayCapabilityContract,
  GatewayOpenAiTools,
  MissionCommand,
  MissionCommandResponse,
  MissionControlResponse,
  MissionProjectionDelta,
  ExecutionLiveUpdate,
  ExecutionActivityDetailProjection,
  ExecutionProjection,
  SessionEvidenceProjection,
  SessionExecutionIndexProjection,
  SessionHistoryIndexProjection,
  SessionSummary,
  TaskFocusProjection,
  MissionFocusProjection,
  TaskDetailProjection,
  MissionOrganizationDecisionProjection,
  WorkspaceFile,
} from '../types';
import { apiReadPolicy, type ApiReadClass } from './readPolicy';

export interface ApiReceipt<T = any> {
  ok: boolean;
  endpoint: string;
  method: string;
  payload_summary?: string;
  status?: number;
  status_text?: string;
  data?: T;
  error?: string;
  retryable?: boolean;
}

export interface ApiWriteResponseMetadata {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  receiptId: string;
  requestId: string;
  correlationId: string;
}

export interface ApiWriteWithMetadataResult<T> {
  data: T;
  metadata: ApiWriteResponseMetadata;
}

export interface ApiWriteMetadataValidation<T> {
  requireReceiptIdentity?: boolean;
  receiptIdFromBody?: (data: T) => string | undefined | null;
}

export interface SessionMessagesPage extends ApiReadState {
  session_id: string;
  messages: any[];
  total: number;
  offset?: number;
  from_seq?: number;
  next_seq?: number;
  limit: number;
  has_more: boolean;
}

export interface SessionMessageSearchResult {
  session_id: string;
  sequence: number;
  role: string;
  blocks: Array<Record<string, unknown>>;
  content_preview: string;
  tool_use_id?: string | null;
  tool_name?: string | null;
  created_at_ms: number;
}

export interface SessionMessageSearchResponse extends ApiReadState {
  query: string;
  results: SessionMessageSearchResult[];
  total: number;
}

export interface HarnessEvalRunOptions {
  level?: 'quick' | 'full' | 'deep' | 'deep-real';
  provider?: string;
  budget?: string;
  allow_real_model?: boolean;
  actor?: string;
  objective?: string;
}

export interface CowdApiError {
  code?: string;
  message?: string;
  http_status?: number;
  details?: Record<string, unknown> | null;
  retryable?: boolean;
  recovery_actions?: Array<Record<string, unknown>>;
  request_id?: string | null;
}

export class ApiWriteError extends Error {
  endpoint: string;
  method: string;
  payload_summary: string;
  status: number;
  status_text: string;
  body: string;
  retryable: boolean;
  apiError: CowdApiError | null;
  code: string;
  details: Record<string, unknown> | null;
  recoveryActions: Array<Record<string, unknown>>;
  requestId: string | null;

  constructor(message: string, options: {
    endpoint: string;
    method: string;
    payload_summary: string;
    status: number;
    status_text: string;
    body: string;
    api_error?: CowdApiError | null;
  }) {
    super(message);
    this.name = 'ApiWriteError';
    this.endpoint = options.endpoint;
    this.method = options.method;
    this.payload_summary = options.payload_summary;
    this.status = options.status;
    this.status_text = options.status_text;
    this.body = options.body;
    this.apiError = options.api_error || null;
    this.code = this.apiError?.code || ('http_' + (options.status || 0));
    this.details = this.apiError?.details && typeof this.apiError.details === 'object'
      ? this.apiError.details
      : null;
    this.recoveryActions = this.apiError?.recovery_actions || [];
    this.requestId = this.apiError?.request_id || null;
    this.retryable = this.apiError?.retryable
      ?? (options.status === 0 || options.status >= 500 || options.status === 429);
  }
}

function headers(init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (!headers.has('x-cowd-surface-id')) headers.set('x-cowd-surface-id', 'webui');
  if (!headers.has('x-cowd-observer-id')) headers.set('x-cowd-observer-id', webuiObserverId());
  return headers;
}

let fallbackObserverId = '';
let claimedObserverId = '';
let observerLeaseChannel: BroadcastChannel | null = null;
let observerClaim: Promise<string> | null = null;

function newObserverId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `webui:${suffix}`;
}

function ensureObserverLeaseChannel() {
  if (observerLeaseChannel || typeof globalThis.BroadcastChannel !== 'function') {
    return observerLeaseChannel;
  }
  observerLeaseChannel = new globalThis.BroadcastChannel('cowd.webui.observer.lease');
  observerLeaseChannel.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as { type?: string; observer_id?: string; nonce?: string };
    if (
      message?.type !== 'probe'
      || !message.nonce
      || message.observer_id !== claimedObserverId
    ) return;
    observerLeaseChannel?.postMessage({
      type: 'occupied',
      observer_id: claimedObserverId,
      nonce: message.nonce,
    });
  });
  return observerLeaseChannel;
}

export function webuiObserverId() {
  if (claimedObserverId) return claimedObserverId;
  const key = 'cowd.webui.observer_id';
  try {
    const existing = globalThis.sessionStorage?.getItem(key);
    claimedObserverId = existing || newObserverId();
    globalThis.sessionStorage?.setItem(key, claimedObserverId);
  } catch {
    if (!fallbackObserverId) fallbackObserverId = newObserverId();
    claimedObserverId = fallbackObserverId;
  }
  ensureObserverLeaseChannel();
  return claimedObserverId;
}

export function claimWebuiObserverId(): Promise<string> {
  if (observerClaim) return observerClaim;
  const current = webuiObserverId();
  const channel = ensureObserverLeaseChannel();
  if (!channel) {
    observerClaim = Promise.resolve(current);
    return observerClaim;
  }
  observerClaim = new Promise<string>((resolve) => {
    const nonce = newObserverId();
    let occupied = false;
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; observer_id?: string; nonce?: string };
      if (
        message?.type === 'occupied'
        && message.observer_id === current
        && message.nonce === nonce
      ) occupied = true;
    };
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'probe', observer_id: current, nonce });
    setTimeout(() => {
      channel.removeEventListener('message', onMessage);
      if (occupied) {
        claimedObserverId = newObserverId();
        fallbackObserverId = claimedObserverId;
        try {
          globalThis.sessionStorage?.setItem('cowd.webui.observer_id', claimedObserverId);
        } catch {
          // The process-local identity remains authoritative for this document.
        }
      }
      resolve(claimedObserverId);
    }, 40);
  });
  return observerClaim;
}

export function resetWebuiObserverIdentityForTests() {
  if (import.meta.env.MODE !== 'test') return;
  observerLeaseChannel?.close();
  observerLeaseChannel = null;
  observerClaim = null;
  claimedObserverId = '';
  fallbackObserverId = '';
}

function requestIdempotencyKey(scope: string) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${scope}:${suffix}`;
}

function withoutServerActor(value: Record<string, unknown>, fields = ['actor_principal']): Record<string, unknown> {
  const forbidden = new Set(fields);
  const sanitize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sanitize);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .filter(([key]) => !forbidden.has(key))
        .map(([key, nested]) => [key, sanitize(nested)]),
    );
  };
  return sanitize(value) as Record<string, unknown>;
}

async function parseResponse(response: Response, path = '') {
  const text = await response.text();
  if (!text) return {};
  const contentType = response.headers.get('content-type') || '';
  const trimmed = text.trim().toLowerCase();
  const isApi = path.startsWith('/api/') || response.url.includes('/api/');
  if (isApi && (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html'))) {
    throw new Error(`Expected JSON from API but received ${contentType || 'unknown content type'}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    if (isApi) throw new Error('Expected JSON from API but received non-JSON body');
    return text;
  }
}

class ApiReadError extends Error {
  constructor(
    message: string,
    readonly state: ApiReadStatus,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiReadError';
  }
}

interface CachedRead {
  data: unknown;
  refreshedAt: string;
  cacheUntil: number;
  sessionId: string;
  referencedSessionIds: string[];
  dataScopes: string[];
}

interface SharedRead {
  promise: Promise<unknown>;
  controller: AbortController;
  authorization: RequestAuthorizationStamp;
  dataScopes: string[];
  subscribers: number;
  settled: boolean;
}

const lastSuccessfulReads = new Map<string, CachedRead>();
const inFlightReads = new Map<string, SharedRead>();
let authenticationEpoch = 0;
let readRevision = 0;
const sessionAuthorizationEpochs = new Map<string, number>();
const sessionReadRevisions = new Map<string, number>();
const dataScopeRevisions = new Map<string, number>();

interface RequestAuthorizationStamp {
  globalEpoch: number;
  sessionId: string;
  sessionEpoch: number;
}

interface ApiWriteRequestContext {
  authorizationSessionId?: string;
  invalidationScopes?: string[];
}

function sessionIdFromRequest(path: string, init: RequestInit = {}) {
  const pathMatch = path.match(/^\/api\/(?:mission\/)?sessions\/([^/?#]+)/);
  if (pathMatch?.[1] && pathMatch[1] !== 'search') return decodeURIComponent(pathMatch[1]);
  try {
    const querySessionId = new URL(path, 'http://cowd.local').searchParams.get('session_id');
    if (querySessionId) return querySessionId;
  } catch {
    // A malformed path will be rejected by fetch; it has no usable scope here.
  }
  if (init.body instanceof FormData) {
    const formSessionId = init.body.get('session_id');
    if (typeof formSessionId === 'string') return formSessionId;
  }
  if (typeof init.body === 'string' && init.body) {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (typeof body.session_id === 'string') return body.session_id;
    } catch {
      // Non-JSON bodies are not session scoped by contract.
    }
  }
  return '';
}

function authorizationStamp(
  path: string,
  init: RequestInit = {},
  explicitSessionId = '',
): RequestAuthorizationStamp {
  const sessionId = explicitSessionId.trim() || sessionIdFromRequest(path, init);
  return {
    globalEpoch: authenticationEpoch,
    sessionId,
    sessionEpoch: sessionAuthorizationEpochs.get(sessionId) || 0,
  };
}

function authorizationStampIsCurrent(stamp: RequestAuthorizationStamp) {
  return stamp.globalEpoch === authenticationEpoch
    && (!stamp.sessionId
      || stamp.sessionEpoch === (sessionAuthorizationEpochs.get(stamp.sessionId) || 0));
}

function invalidateRejectedAuthorization(
  stamp: RequestAuthorizationStamp,
  status: number,
  reason: string,
  invalidateSession = true,
) {
  if (status === 403 && stamp.sessionId && invalidateSession) {
    invalidateSessionAuthorization(stamp.sessionId, reason);
    return;
  }
  // A global 403 means that the authenticated principal lacks one
  // capability. It must remain a local operation error. Only 401 proves that
  // the browser credential itself is no longer valid.
  if (status === 401) invalidateAuthentication(reason);
}

export function invalidateApiReadCache() {
  authenticationEpoch += 1;
  readRevision += 1;
  sessionReadRevisions.clear();
  dataScopeRevisions.clear();
  lastSuccessfulReads.clear();
  for (const pending of inFlightReads.values()) pending.controller.abort();
  inFlightReads.clear();
}

export function invalidateAuthentication(reason = 'Gateway authorization changed') {
  invalidateApiReadCache();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cowd:authorization-invalidated', {
      detail: { reason, authenticationEpoch },
    }));
  }
}

export function invalidateSessionAuthorization(
  sessionId: string,
  reason = 'Gateway revoked session authorization',
) {
  const normalized = sessionId.trim();
  if (!normalized) {
    invalidateAuthentication(reason);
    return;
  }
  const sessionEpoch = (sessionAuthorizationEpochs.get(normalized) || 0) + 1;
  sessionAuthorizationEpochs.set(normalized, sessionEpoch);
  // Authorization revocation is a security boundary, not a normal data
  // mutation. Fence every in-flight aggregate response even if its transport
  // ignores AbortSignal, while ordinary session writes stay session-scoped.
  readRevision += 1;
  sessionReadRevisions.set(normalized, (sessionReadRevisions.get(normalized) || 0) + 1);
  for (const [key, cached] of lastSuccessfulReads.entries()) {
    if (
      cached.sessionId === normalized
      || cached.referencedSessionIds.includes(normalized)
    ) lastSuccessfulReads.delete(key);
  }
  for (const [key, pending] of inFlightReads.entries()) {
    if (
      !pending.authorization.sessionId
      || pending.authorization.sessionId === normalized
    ) {
      pending.controller.abort();
      inFlightReads.delete(key);
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cowd:session-authorization-invalidated', {
      detail: { reason, sessionId: normalized, sessionEpoch, authenticationEpoch },
    }));
  }
}

function readRevisionIsCurrent(globalRevision: number, sessionId: string, sessionRevision: number) {
  return globalRevision === readRevision
    && (!sessionId || sessionRevision === (sessionReadRevisions.get(sessionId) || 0));
}

function isProjectionNeutralControlWrite(path: string) {
  const pathname = path.split('?', 1)[0];
  return /^\/api\/sessions\/[^/]+\/(?:attach|detach)$/.test(pathname)
    || pathname === '/api/runtime/session-leases/acquire'
    || pathname === '/api/runtime/session-leases/release';
}

function apiPathname(path: string) {
  try {
    return new URL(path, 'http://cowd.local').pathname;
  } catch {
    return path.split('?', 1)[0];
  }
}

function sessionDataScope(path: string, sessionId: string) {
  const pathname = apiPathname(path);
  if (pathname.startsWith('/api/runtime/executions/')) {
    return `session:${sessionId}:execution`;
  }
  const encoded = encodeURIComponent(sessionId);
  const suffix = pathname.replace(new RegExp(`^/api/sessions/${encoded}`), '');
  if (
    /^\/messages(?:\/|$)/.test(suffix)
    || suffix === '/history-index'
  ) return `session:${sessionId}:transcript`;
  if (
    /^\/(?:execution|evidence|inputs|turns)(?:\/|$)/.test(suffix)
    || suffix === '/cancel'
    || suffix === '/compact'
  ) return `session:${sessionId}:execution`;
  if (/^\/attachments(?:\/|$)/.test(suffix)) return `session:${sessionId}:resources`;
  return `session:${sessionId}:metadata`;
}

function readDataScopes(path: string, sessionId: string) {
  const pathname = apiPathname(path);
  if (sessionId) return [
    `session:${sessionId}`,
    sessionDataScope(path, sessionId),
  ];
  if (pathname === '/api/sessions' || pathname.startsWith('/api/sessions/search')) {
    return ['sessions:catalog'];
  }
  const domain = pathname.split('/').filter(Boolean)[1] || 'gateway';
  return [`domain:${domain}`];
}

function writeInvalidationScopes(path: string, sessionId: string) {
  if (isProjectionNeutralControlWrite(path)) return [];
  const pathname = apiPathname(path);
  if (!sessionId) {
    if (pathname === '/api/sessions') return ['sessions:catalog'];
    const domain = pathname.split('/').filter(Boolean)[1] || 'gateway';
    return [`domain:${domain}`];
  }

  const encoded = encodeURIComponent(sessionId);
  const suffix = pathname.replace(new RegExp(`^/api/sessions/${encoded}`), '');
  if (!suffix || suffix === '/') {
    return [`session:${sessionId}`, 'sessions:catalog'];
  }
  if (/^\/messages(?:\/|$)/.test(suffix)) {
    return [
      `session:${sessionId}:transcript`,
      `session:${sessionId}:execution`,
      'sessions:catalog',
    ];
  }
  if (suffix === '/branch') return ['sessions:catalog'];
  if (suffix === '/compact') {
    return [
      `session:${sessionId}:transcript`,
      `session:${sessionId}:metadata`,
    ];
  }
  if (/^\/attachments(?:\/|$)/.test(suffix)) {
    return [`session:${sessionId}:resources`];
  }
  if (
    /^\/(?:inputs|turns)(?:\/|$)/.test(suffix)
    || suffix === '/cancel'
    || suffix.startsWith('/context/')
  ) return [`session:${sessionId}:execution`];
  return [sessionDataScope(path, sessionId)];
}

function dataScopeMatches(invalidated: string, candidate: string) {
  return invalidated === candidate
    || candidate.startsWith(`${invalidated}:`);
}

function captureDataScopeRevisions(scopes: string[]) {
  return scopes.map((scope) => [scope, dataScopeRevisions.get(scope) || 0] as const);
}

function dataScopeRevisionsAreCurrent(stamp: ReadonlyArray<readonly [string, number]>) {
  return stamp.every(([scope, revision]) => (
    revision === (dataScopeRevisions.get(scope) || 0)
  ));
}

function invalidateDataScopes(scopes: string[]) {
  if (!scopes.length) return;
  for (const scope of scopes) {
    dataScopeRevisions.set(scope, (dataScopeRevisions.get(scope) || 0) + 1);
  }
  const invalidates = (candidateScopes: string[]) => scopes.some((scope) => (
    candidateScopes.some((candidate) => dataScopeMatches(scope, candidate))
  ));
  for (const [key, cached] of lastSuccessfulReads.entries()) {
    if (invalidates(cached.dataScopes)) lastSuccessfulReads.delete(key);
  }
  for (const [key, pending] of inFlightReads.entries()) {
    if (!invalidates(pending.dataScopes)) continue;
    pending.controller.abort();
    inFlightReads.delete(key);
  }
}

function invalidateReadsAfterWrite(path: string, sessionId: string) {
  invalidateDataScopes(writeInvalidationScopes(path, sessionId));
}

function requestedCapabilityProbeSubset(capabilities: readonly string[]) {
  return [...new Set(
    capabilities
      .map((capability) => capability.trim())
      .filter((capability) => capability.length > 0 && capability !== '*'),
  )];
}

function readStatusFor(response: Response): ApiReadStatus {
  if (response.status === 401 || response.status === 403) return 'forbidden';
  if (response.status === 404) return 'not_found';
  if (response.status >= 500) return 'server_error';
  return 'error';
}

function withReadState<T>(data: T, state: ApiReadState): T & ApiReadState {
  if (Array.isArray(data)) return Object.assign([...data], state) as T & ApiReadState;
  if (data && typeof data === 'object') return { ...(data as object), ...state } as T & ApiReadState;
  return { value: data, ...state } as T & ApiReadState;
}

function positiveReadTtlMs(path: string) {
  if (
    path === '/api/config'
    || path === '/api/config/providers'
    || path === '/api/config/provider-catalog'
    || path === '/api/profiles'
    || path.startsWith('/api/slash?')
    || path === '/api/skills/catalog'
    || path.startsWith('/api/skills/projection?')
  ) return 750;
  return 0;
}

function referencedSessionIds(value: unknown): string[] {
  const found = new Set<string>();
  if (!value || typeof value !== 'object') return [];
  const pending: Array<{ record: Record<string, unknown>; depth: number }> = [{
    record: value as Record<string, unknown>,
    depth: 0,
  }];
  const visited = new WeakSet<object>();
  const addSessionId = (candidate: unknown) => {
    if (typeof candidate === 'string' && candidate.trim()) found.add(candidate.trim());
  };
  let inspected = 0;
  while (pending.length && inspected < 64) {
    const { record, depth } = pending.shift()!;
    if (visited.has(record)) continue;
    visited.add(record);
    inspected += 1;
    addSessionId(record.session_id);

    const sessions = record.sessions;
    if (Array.isArray(sessions)) {
      for (const candidate of sessions.slice(0, 1_000)) {
        if (!candidate || typeof candidate !== 'object') continue;
        const session = candidate as Record<string, unknown>;
        addSessionId(session.session_id);
        addSessionId(session.id);
        if (depth < 3) pending.push({ record: session, depth: depth + 1 });
      }
    }

    for (const field of ['items', 'turns', 'tasks', 'executions']) {
      const entries = record[field];
      if (!Array.isArray(entries)) continue;
      for (const candidate of entries.slice(0, 1_000)) {
        if (!candidate || typeof candidate !== 'object') continue;
        const item = candidate as Record<string, unknown>;
        addSessionId(item.session_id);
        if (depth < 3) pending.push({ record: item, depth: depth + 1 });
      }
    }

    if (depth >= 3) continue;
    for (const field of ['snapshot', 'projection', 'data', 'result', 'receipt', 'payload']) {
      const nested = record[field];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        pending.push({ record: nested as Record<string, unknown>, depth: depth + 1 });
      }
    }
  }
  return [...found];
}

function waitForSharedRead<T>(shared: SharedRead, signal?: AbortSignal | null): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
  shared.subscribers += 1;
  return new Promise<T>((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      shared.subscribers = Math.max(0, shared.subscribers - 1);
      if (shared.subscribers === 0 && !shared.settled) shared.controller.abort();
    };
    const abort = () => {
      release();
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    shared.promise.then(
      (value) => {
        signal?.removeEventListener('abort', abort);
        release();
        resolve(value as T);
      },
      (error) => {
        signal?.removeEventListener('abort', abort);
        release();
        reject(error);
      },
    );
  });
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /\b(?:abort(?:ed)?|user aborted a request)\b/i.test(message);
}

async function readAtRevision<T>(
  path: string,
  fallback: T,
  init: RequestInit = {},
  authorizationSessionId = '',
  requestedReadClass?: ApiReadClass,
  retryAfterInvalidation = true,
): Promise<T & ApiReadState> {
  const requestAuthorization = authorizationStamp(path, init, authorizationSessionId);
  const requestDataScopes = readDataScopes(path, requestAuthorization.sessionId);
  const requestDataScopeRevisions = captureDataScopeRevisions(requestDataScopes);
  const requestReadRevision = readRevision;
  const requestSessionReadRevision = requestAuthorization.sessionId
    ? (sessionReadRevisions.get(requestAuthorization.sessionId) || 0)
    : 0;
  const requestHeaders = headers(init);
  const readPolicy = apiReadPolicy(path, requestedReadClass);
  const cacheKey = [
    requestAuthorization.globalEpoch,
    requestAuthorization.sessionId,
    requestAuthorization.sessionEpoch,
    requestSessionReadRevision,
    requestDataScopeRevisions.map(([scope, revision]) => `${scope}@${revision}`).join(','),
    readPolicy.class,
    path,
    [...requestHeaders.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&'),
  ].join(':');
  const positiveTtlMs = positiveReadTtlMs(path);
  const positiveCached = lastSuccessfulReads.get(cacheKey);
  if (
    positiveTtlMs > 0
    &&
    positiveCached
    && positiveCached.cacheUntil >= Date.now()
    && authorizationStampIsCurrent(requestAuthorization)
  ) {
    return withReadState(positiveCached.data as T, {
      __state: 'ready',
      __refreshed_at: positiveCached.refreshedAt,
      __last_success_at: positiveCached.refreshedAt,
    });
  }
  try {
    let shared = inFlightReads.get(cacheKey);
    // A cancelled shared transport may remain in the registry until its
    // rejection microtask settles. Never let a new reader subscribe to that
    // already-dead transport.
    if (shared?.controller.signal.aborted) {
      if (inFlightReads.get(cacheKey) === shared) inFlightReads.delete(cacheKey);
      shared = undefined;
    }
    if (!shared) {
      const { signal: _callerSignal, ...sharedInit } = init;
      const controller = new AbortController();
      let deadlineExpired = false;
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const promise = (async () => {
        try {
          const response = await fetch(path, {
            credentials: 'same-origin',
            ...sharedInit,
            headers: requestHeaders,
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new ApiReadError(
              await response.text() || `${response.status} ${response.statusText}`,
              readStatusFor(response),
              response.status,
            );
          }
          try {
            return await parseResponse(response, path) as T;
          } catch (error) {
            if (error instanceof ApiReadError) throw error;
            throw new ApiReadError(
              error instanceof Error ? error.message : String(error),
              'invalid_response',
              response.status,
            );
          }
        } catch (error) {
          if (deadlineExpired && controller.signal.aborted) {
            throw new ApiReadError(
              `${readPolicy.class} read exceeded ${readPolicy.deadlineMs}ms`,
              'timeout',
            );
          }
          throw error;
        } finally {
          if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
        }
      })();
      if (readPolicy.deadlineMs !== null) {
        deadlineTimer = setTimeout(() => {
          deadlineExpired = true;
          controller.abort();
        }, readPolicy.deadlineMs);
      }
      shared = {
        promise,
        controller,
        authorization: requestAuthorization,
        dataScopes: requestDataScopes,
        subscribers: 0,
        settled: false,
      };
      inFlightReads.set(cacheKey, shared);
      const owned = shared;
      void promise.finally(() => {
        owned.settled = true;
        if (inFlightReads.get(cacheKey) === owned) inFlightReads.delete(cacheKey);
      }).catch(() => {});
    }
    try {
      const parsed = await waitForSharedRead<T>(shared, init.signal);
      if (!authorizationStampIsCurrent(requestAuthorization)) {
        throw new ApiReadError(
          'authorization changed while this response was in flight',
          'forbidden',
          403,
        );
      }
      if (!readRevisionIsCurrent(
        requestReadRevision,
        requestAuthorization.sessionId,
        requestSessionReadRevision,
      )) {
        if (retryAfterInvalidation) {
          return readAtRevision(
            path,
            fallback,
            init,
            authorizationSessionId,
            requestedReadClass,
            false,
          );
        }
        throw new ApiReadError(
          'read invalidated while this response was in flight',
          'stale',
        );
      }
      if (!dataScopeRevisionsAreCurrent(requestDataScopeRevisions)) {
        if (retryAfterInvalidation) {
          return readAtRevision(
            path,
            fallback,
            init,
            authorizationSessionId,
            requestedReadClass,
            false,
          );
        }
        throw new ApiReadError(
          'read data scope changed while this response was in flight',
          'stale',
        );
      }
      const refreshedAt = new Date().toISOString();
      lastSuccessfulReads.set(cacheKey, {
        data: parsed,
        refreshedAt,
        cacheUntil: positiveTtlMs > 0 ? Date.now() + positiveTtlMs : 0,
        sessionId: requestAuthorization.sessionId,
        referencedSessionIds: referencedSessionIds(parsed),
        dataScopes: requestDataScopes,
      });
      return withReadState(parsed, {
        __state: 'ready',
        __refreshed_at: refreshedAt,
        __last_success_at: refreshedAt,
      });
    } catch (error) {
      if (error instanceof ApiReadError) throw error;
      throw error;
    }
  } catch (error) {
    if (init.signal?.aborted) {
      throw error;
    }
    if (isAbortError(error)) {
      if (!authorizationStampIsCurrent(requestAuthorization)) {
        return withReadState(fallback, {
          __state: 'forbidden',
          __error: 'authorization changed while this response was in flight',
          __http_status: 403,
          __refreshed_at: new Date().toISOString(),
        });
      }
      if (
        !readRevisionIsCurrent(
          requestReadRevision,
          requestAuthorization.sessionId,
          requestSessionReadRevision,
        )
        && retryAfterInvalidation
      ) {
        return readAtRevision(
          path,
          fallback,
          init,
          authorizationSessionId,
          requestedReadClass,
          false,
        );
      }
      if (
        !dataScopeRevisionsAreCurrent(requestDataScopeRevisions)
        && retryAfterInvalidation
      ) {
        return readAtRevision(
          path,
          fallback,
          init,
          authorizationSessionId,
          requestedReadClass,
          false,
        );
      }
      // Fetch implementations may cancel an idempotent request during a
      // navigation/connection transition even though this caller did not
      // abort it. Retry that transport once; explicit caller cancellation,
      // authorization changes and governed deadlines are handled above.
      if (retryAfterInvalidation) {
        return readAtRevision(
          path,
          fallback,
          init,
          authorizationSessionId,
          requestedReadClass,
          false,
        );
      }
      throw error;
    }
    const readError = error instanceof ApiReadError
      ? error
      : new ApiReadError(error instanceof Error ? error.message : String(error), 'offline');
    if (readError.state === 'forbidden') {
      if (authorizationStampIsCurrent(requestAuthorization)) {
        invalidateRejectedAuthorization(
          requestAuthorization,
          readError.status || 403,
          readError.message || 'Gateway rejected the current authorization',
        );
      }
      lastSuccessfulReads.delete(cacheKey);
    }
    const cached = lastSuccessfulReads.get(cacheKey);
    const mayRetainCachedProjection = authorizationStampIsCurrent(requestAuthorization)
      && cached
      && (
        readError.state === 'offline'
        || readError.state === 'server_error'
        || readError.state === 'timeout'
      );
    return withReadState((mayRetainCachedProjection ? cached.data : fallback) as T, {
      __state: mayRetainCachedProjection ? 'stale' : readError.state,
      __error: readError.message,
      __http_status: readError.status,
      __refreshed_at: new Date().toISOString(),
      __last_success_at: cached?.refreshedAt,
    });
  }
}

export async function read<T>(
  path: string,
  fallback: T,
  init: RequestInit = {},
  authorizationSessionId = '',
  readClass?: ApiReadClass,
): Promise<T & ApiReadState> {
  return readAtRevision(path, fallback, init, authorizationSessionId, readClass);
}

function payloadSummary(body: BodyInit | null | undefined): string {
  if (!body) return '';
  if (body instanceof FormData) {
    return Array.from(body.keys()).join(', ');
  }
  const text = typeof body === 'string' ? body : String(body);
  return text.length > 280 ? `${text.slice(0, 280)}...` : text;
}

export async function writeWithMetadata<T>(
  path: string,
  init: RequestInit = {},
  validation: ApiWriteMetadataValidation<T> = {},
  context: ApiWriteRequestContext = {},
): Promise<ApiWriteWithMetadataResult<T>> {
  const requestAuthorization = authorizationStamp(
    path,
    init,
    context.authorizationSessionId || '',
  );
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: headers(init) });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      if (authorizationStampIsCurrent(requestAuthorization)) {
        invalidateRejectedAuthorization(
          requestAuthorization,
          response.status,
          body || `${response.status} ${response.statusText}`,
          false,
        );
      }
    }
    let apiError: CowdApiError | null = null;
    let parsedErrorMessage = '';
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
        apiError = {
          code: parsed.code,
          message: parsed.message,
          http_status: Number(parsed.http_status || response.status),
          details: parsed.details && typeof parsed.details === 'object' ? parsed.details as Record<string, unknown> : null,
          retryable: Boolean(parsed.retryable),
          recovery_actions: Array.isArray(parsed.recovery_actions) ? parsed.recovery_actions.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [],
          request_id: typeof parsed.request_id === 'string' ? parsed.request_id : null,
        };
      } else if (typeof parsed?.error === 'string') {
        parsedErrorMessage = parsed.error;
      } else if (
        parsed?.error
        && typeof parsed.error === 'object'
        && typeof (parsed.error as Record<string, unknown>).message === 'string'
      ) {
        parsedErrorMessage = String((parsed.error as Record<string, unknown>).message);
      }
    } catch {
      apiError = null;
    }
    throw new ApiWriteError(apiError?.message || parsedErrorMessage || body || (response.status + ' ' + response.statusText), {
      endpoint: path,
      method: init.method || 'POST',
      payload_summary: payloadSummary(init.body),
      status: response.status,
      status_text: response.statusText,
      body,
      api_error: apiError,
    });
  }
  const parsed = await parseResponse(response, path) as T;
  if (!authorizationStampIsCurrent(requestAuthorization)) {
    throw new ApiWriteError('authorization changed while this response was in flight', {
      endpoint: path,
      method: init.method || 'POST',
      payload_summary: payloadSummary(init.body),
      status: 403,
      status_text: 'Authorization Changed',
      body: '',
    });
  }
  const responseHeaders = Object.fromEntries(response.headers.entries());
  const metadata: ApiWriteResponseMetadata = {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    receiptId: response.headers.get('x-cowd-receipt-id')?.trim() || '',
    requestId: response.headers.get('x-request-id')?.trim()
      || response.headers.get('x-cowd-request-id')?.trim()
      || '',
    correlationId: response.headers.get('x-cowd-correlation-id')?.trim() || '',
  };
  if (validation.requireReceiptIdentity || validation.receiptIdFromBody) {
    const bodyReceiptId = validation.receiptIdFromBody?.(parsed)?.trim() || '';
    if (
      !metadata.receiptId
      || !bodyReceiptId
      || metadata.receiptId !== bodyReceiptId
    ) {
      const message = !metadata.receiptId
        ? 'write response omitted X-Cowd-Receipt-Id'
        : !bodyReceiptId
          ? 'write response omitted its canonical body receipt identity'
          : `write response receipt identity mismatch: header ${metadata.receiptId}, body ${bodyReceiptId}`;
      throw new ApiWriteError(message, {
        endpoint: path,
        method: init.method || 'POST',
        payload_summary: payloadSummary(init.body),
        status: 422,
        status_text: 'Receipt Identity Mismatch',
        body: message,
        api_error: {
          code: 'receipt_identity_mismatch',
          message,
          http_status: 422,
          retryable: false,
          details: {
            header_receipt_id: metadata.receiptId || null,
            body_receipt_id: bodyReceiptId || null,
          },
          recovery_actions: [],
          request_id: metadata.requestId || null,
        },
      });
    }
  }
  if (context.invalidationScopes) {
    invalidateDataScopes(context.invalidationScopes);
  } else {
    invalidateReadsAfterWrite(path, requestAuthorization.sessionId);
  }
  return { data: parsed, metadata };
}

export async function write<T>(
  path: string,
  init: RequestInit = {},
  context: ApiWriteRequestContext = {},
): Promise<T> {
  return (await writeWithMetadata<T>(path, init, {}, context)).data;
}

async function writeWithReceipt<T>(path: string, init: RequestInit = {}): Promise<ApiReceipt<T>> {
  const method = init.method || 'POST';
  const summary = payloadSummary(init.body);
  try {
    const data = await write<T>(path, init);
    return {
      ok: true,
      endpoint: path,
      method,
      payload_summary: summary,
      data,
    };
  } catch (error) {
    if (error instanceof ApiWriteError) {
      return {
        ok: false,
        endpoint: error.endpoint,
        method: error.method,
        payload_summary: error.payload_summary,
        status: error.status,
        status_text: error.status_text,
        error: error.body || error.message,
        retryable: error.retryable,
      };
    }
    return {
      ok: false,
      endpoint: path,
      method,
      payload_summary: summary,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}

export const api = {
  createLiveSubscription: (request: any) => write('/api/runtime/live-subscriptions', {
    method: 'POST',
    body: JSON.stringify(request),
  }),
  patchLiveSubscription: (subscriptionId: string, request: any) => write(
    `/api/runtime/live-subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(request),
    },
  ),
  deleteLiveSubscription: (subscriptionId: string) => write(
    `/api/runtime/live-subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: 'DELETE' },
  ),
  executionProjection: (
    executionId: string,
    detailScope: 'summary' | 'full' = 'summary',
    authorizationSessionId = '',
  ) => read<ExecutionProjection>(`/api/runtime/executions/${encodeURIComponent(executionId)}?detail_scope=${detailScope}`, {
    schema_version: 2,
    execution_id: executionId,
    revision: 0,
    cursor: 0,
    detail_scope: detailScope,
    authorization_revision: 0,
    redaction_revision: 'offline',
    graph: {
      graph_id: executionId,
      revision: 0,
      objective: '',
      service_class: 'foreground',
      nodes: [],
      edges: [],
      commit_cursor: 0,
      terminal_result_ref: null,
    },
    child_executions: [],
    goals: [],
    agents: [],
    teams: [],
    relations: [],
    approvals: [],
    admissions: [],
    outcomes: [],
    interventions: [],
    usage: [],
    context: [],
    evidence: [],
    health: [],
    recovery: [],
    available_commands: [],
  }, {}, authorizationSessionId),
  executionActivity: (
    executionId: string,
    activityId: string,
    authorizationSessionId = '',
  ) => read<ExecutionActivityDetailProjection>(
    `/api/runtime/executions/${encodeURIComponent(executionId)}/activity?activity_id=${encodeURIComponent(activityId)}`,
    {
      schema_version: 5,
      execution_id: executionId,
      activity: null as never,
      relations: [],
      related_entities: [],
    },
    {},
    authorizationSessionId,
    'interactive',
  ),
  executeProjectionCommand: (
    executionId: string,
    request: Record<string, unknown>,
    authorizationSessionId = '',
  ) => write(`/api/runtime/executions/${encodeURIComponent(executionId)}/commands`, {
    method: 'POST', body: JSON.stringify(request),
  }, {
    authorizationSessionId,
    invalidationScopes: authorizationSessionId
      ? [`session:${authorizationSessionId}:execution`]
      : ['domain:runtime'],
  }),
  writeReceipt: writeWithReceipt,
  health: (signal?: AbortSignal) => read('/api/webui/manifest', {
    kind: 'cowd.webui.manifest',
    status: 'offline',
    static_webui: 'local vite fallback',
  }, { signal }),
  gatewayCapabilityContract: () => read<GatewayCapabilityContract>('/api/gateway/capability-contract', {
    kind: 'gateway.capability_contract',
    schema_version: 1,
    owner: 'gateway',
    source: 'offline',
    route_count: 0,
    capability_count: 0,
    coverage: {
      route_count: 0,
      capability_count: 0,
      p1_count: 0,
      ai_visible_count: 0,
      openapi_path_count: 0,
      openai_tool_count: 0,
      route_contract_parity: false,
    },
    capabilities: [],
  }),
  gatewayOpenApi: () => read('/api/gateway/openapi.json', { openapi: '3.1.0', paths: {} }),
  gatewayOpenAiTools: () => read<GatewayOpenAiTools>('/api/gateway/openai-tools', {
    kind: 'gateway.openai_tools',
    schema_version: 1,
    source: 'offline',
    tool_count: 0,
    tools: [],
  }),
  // Normal login sends an empty set so the Broker catalogue remains authoritative.
  // A bounded explicit subset exists only for permission-probe tests.
  authLogin: (credential: string, capabilityProbe: readonly string[] = []) => write<{
    success: boolean;
    surface_id: string;
    entitlement?: Record<string, unknown>;
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      token: credential,
      surface_id: 'webui',
      requested_capabilities: requestedCapabilityProbeSubset(capabilityProbe),
    }),
  }),
  authVerify: () => read<{
    valid?: boolean;
    auth_required?: boolean;
    entitlement?: Record<string, unknown>;
  }>('/api/auth/verify', { valid: false, auth_required: true }),
  authLogout: () => write('/api/auth/logout', { method: 'POST' }),
  sessions: (limit = 50, offset = 0, includeExecution = false) => read<{ sessions: SessionSummary[] }>(
    `/api/sessions?limit=${limit}&offset=${offset}&include_execution=${includeExecution}`,
    { sessions: [] },
  ),
  runningSessionExecutions: () => read<{ items: SessionExecutionIndexProjection[] }>(
    '/api/sessions/executions',
    { items: [] },
  ),
  searchSessions: (query: string, limit = 50, offset = 0) => read<{ sessions: SessionSummary[] }>(
    `/api/sessions?limit=${limit}&offset=${offset}&include_execution=true${query ? `&q=${encodeURIComponent(query)}` : ''}`,
    { sessions: [] },
  ),
  searchMessages: (query: string, limit = 100) => read<SessionMessageSearchResponse>(
    `/api/sessions/search?q=${encodeURIComponent(query)}&limit=${Math.max(1, Math.min(100, limit))}`,
    { query, results: [], total: 0 },
  ),
  session: (sessionId: string) => read<SessionSummary>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    { id: sessionId },
  ),
  createSession: (model?: string) => write<SessionSummary>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ model }),
  }),
  deleteSession: (sessionId: string) => write(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  branchSession: (sessionId: string) => writeWithReceipt<BranchSessionReceipt>(`/api/sessions/${encodeURIComponent(sessionId)}/branch`, {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: requestIdempotencyKey(`session-branch:${sessionId}`) }),
  }),
  compactSession: (sessionId: string) => write(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, { method: 'POST' }),
  cancelSessionTurn: (sessionId: string) => writeWithReceipt(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'cancel requested from WebUI' }),
  }),
  sessionStats: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/stats`, {}),
  sessionExecution: (sessionId: string, signal?: AbortSignal) => read<SessionExecutionIndexProjection>(
    `/api/sessions/${encodeURIComponent(sessionId)}/execution`,
    {
      session_id: sessionId,
      executions: [],
      active_execution_ids: [],
    },
    { signal },
  ),
  sessionHistoryIndex: (sessionId: string, metadataLimit = 128, cardLimit = 64) => read<SessionHistoryIndexProjection>(
    `/api/sessions/${encodeURIComponent(sessionId)}/history-index?metadata_limit=${Math.max(1, Math.min(500, metadataLimit))}&card_limit=${Math.max(1, Math.min(200, cardLimit))}`,
    {
      schema_version: 1,
      session_id: sessionId,
      projection_generation: 0,
      durable_cursor: 0,
      event_cursor: 0,
      history_revision: 0,
      total_messages: 0,
      total_bytes: 0,
      index_generation: 0,
      index_card_count: 0,
      index_complete: false,
      recovery_state: 'index_pending',
      recent_metadata: [],
      cards: [],
    },
  ),
  sessionExecutionLive: (sessionId: string) => read<ExecutionLiveUpdate>(`/api/sessions/${encodeURIComponent(sessionId)}/execution/live`, {
    schema_version: 2,
    execution_id: '',
    live: {
      revision: 0,
      status: 'queued',
      started_at_ms: 0,
      updated_at_ms: 0,
      last_progress_at_ms: 0,
      metrics: {
        tool_calls: 0,
        approvals: 0,
        files_touched: 0,
        context_items: 0,
        memory_recalls: 0,
        memory_evidence: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
      latency: {
        total_elapsed_ms: 0,
        harness_elapsed_ms: 0,
        provider_wall_ms: 0,
        provider_active_stream_ms: 0,
      },
    },
  }),
  sessionEvidence: (sessionId: string) => read<SessionEvidenceProjection>(`/api/sessions/${encodeURIComponent(sessionId)}/evidence`, {
    session_id: sessionId,
    evidence_refs: [],
    turns: [],
    freshness: 'unavailable',
  }),
  updateSession: (sessionId: string, patch: Record<string, unknown>) => write(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }),
  messages: (
    sessionId: string,
    options: { offset?: number; fromSeq?: number; limit?: number; tail?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    params.set('limit', String(Math.max(1, Math.min(500, options.limit || 100))));
    if (options.fromSeq !== undefined) params.set('from_seq', String(Math.max(0, options.fromSeq)));
    else params.set('offset', String(Math.max(0, options.offset || 0)));
    if (options.tail) params.set('tail', 'true');
    return read<SessionMessagesPage>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`,
      {
        session_id: sessionId,
        messages: [],
        total: 0,
        offset: options.offset || 0,
        from_seq: options.fromSeq,
        limit: options.limit || 100,
        has_more: false,
      },
    );
  },
  sendMessage: (sessionId: string, content: string, resourceIds: string[] = [], idempotencyKey?: string) => write(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, resource_ids: resourceIds, idempotency_key: idempotencyKey }),
  }),
  sessionInputs: (sessionId: string, signal?: AbortSignal) => read(
    `/api/sessions/${encodeURIComponent(sessionId)}/inputs`,
    {},
    { signal },
  ),
  sessionInputProjection: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/input-projection`, {}),
  turnInbox: (sessionId: string, turnId?: string, signal?: AbortSignal) => {
    const query = turnId ? `?turn_id=${encodeURIComponent(turnId)}` : '';
    return read(`/api/sessions/${encodeURIComponent(sessionId)}/turn-inbox${query}`, {}, { signal });
  },
  turnInboxByTurn: (sessionId: string, turnId: string) => read(
    `/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/inbox`,
    {},
  ),
  cancelSessionInput: (sessionId: string, inputId: string, reason = '') => write(`/api/sessions/${encodeURIComponent(sessionId)}/inputs/${encodeURIComponent(inputId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  reclassifySessionInput: (sessionId: string, inputId: string, decision: string, reason = '') => write(`/api/sessions/${encodeURIComponent(sessionId)}/inputs/${encodeURIComponent(inputId)}/reclassify`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  }),
  workspace: (signal?: AbortSignal) => read('/api/workspace', {
    workspace_root: '',
    workspace_canonical: '',
    profile_id: '',
  }, { signal }),
  workspaces: () => read('/api/workspaces', { workspaces: [] }),
  files: (dir = '', signal?: AbortSignal) => {
    const suffix = dir ? `?dir=${encodeURIComponent(dir)}` : '';
    return read<{ dir: string; files: WorkspaceFile[] }>(`/api/workspace/files${suffix}`, {
      dir,
      files: [],
    }, { signal });
  },
  workspaceRawUrl: (path: string) => `/api/file/raw?path=${encodeURIComponent(path)}`,
  workspaceDownloadUrl: (path: string) => `/api/workspace/download?path=${encodeURIComponent(path)}`,
  rawFile: (path: string) => readText(`/api/file/raw?path=${encodeURIComponent(path)}`),
  saveFile: (path: string, content: string) => write('/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  }),
  uploadFile: (file: File, dir = '', overwrite = false) => {
    const body = new FormData();
    body.set('file', file);
    body.set('dir', dir);
    body.set('overwrite', overwrite ? 'true' : 'false');
    return write('/api/upload', { method: 'POST', body });
  },
  uploadResource: (file: File, sessionId = '') => {
    const body = new FormData();
    body.set('source', 'webui');
    if (sessionId) body.set('session_id', sessionId);
    if (file.type) body.set('declared_mime', file.type);
    body.set('file', file);
    return write('/api/resources', { method: 'POST', body });
  },
  createDir: (path: string) => write('/api/workspace/dirs', {
    method: 'POST',
    body: JSON.stringify({ path }),
  }),
  deleteWorkspacePath: (path: string) => write(`/api/workspace/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  renameWorkspacePath: (path: string, to: string) => write('/api/workspace/rename', {
    method: 'POST',
    body: JSON.stringify({ path, to }),
  }),
  workspaceMeta: (path: string) => read(`/api/workspace/meta?path=${encodeURIComponent(path)}`, {}),
  sessionAttachments: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, { attachments: [] }),
  attachSession: (sessionId: string, role: 'reader' | 'writer' = 'reader') => write(`/api/sessions/${encodeURIComponent(sessionId)}/attach`, {
    method: 'POST',
    body: JSON.stringify({ surface: 'webui', role }),
  }),
  detachSession: (sessionId: string) => write(`/api/sessions/${encodeURIComponent(sessionId)}/detach`, {
    method: 'POST',
    body: JSON.stringify({ surface: 'webui' }),
  }),
  addSessionAttachment: (sessionId: string, path: string, label = '') => write(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ path, label: label || path, kind: 'workspace_file' }),
  }),
  deleteSessionAttachment: (sessionId: string, refId: string) => write(`/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(refId)}`, { method: 'DELETE' }),
  runtimeTimeline: (sessionId: string, signal?: AbortSignal) => read(
    `/api/runtime/timeline?session_id=${encodeURIComponent(sessionId)}&limit=50`,
    { events: [] },
    { signal },
  ),
  runtimeControlPlane: (signal?: AbortSignal) => read('/api/runtime/control-plane', {}, { signal }),
  runtimeStatus: (signal?: AbortSignal) => read('/api/runtime/status', {}, { signal }),
  runtimeSnapshot: (signal?: AbortSignal) => read('/api/runtime/snapshot', {}, { signal }),
  runtimeSourceAudit: (signal?: AbortSignal) => read('/api/runtime/source-audit', {}, { signal }),
  runtimeSourceRepairPlan: (signal?: AbortSignal) => read('/api/runtime/source-repair-plan', {}, { signal }),
  runtimeTurns: (signal?: AbortSignal) => read('/api/runtime/turns', { turns: [] }, { signal }),
  submitRuntimeTurn: (prompt: string, sessionId?: string, taskId?: string) => writeWithReceipt('/api/runtime/turns', {
    method: 'POST',
    body: JSON.stringify({ prompt, session_id: sessionId, task_id: taskId }),
  }),
  runtimeTurn: (id: string) => read(`/api/runtime/turns/${encodeURIComponent(id)}`, {}),
  cancelRuntimeTurn: (id: string) => writeWithReceipt(`/api/runtime/turns/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  missionControl: (missionId = '') => {
    const params = new URLSearchParams();
    if (missionId.trim()) params.set('mission_id', missionId.trim());
    const suffix = params.size ? `?${params.toString()}` : '';
    return read<MissionControlResponse>(`/api/mission/control${suffix}`, {
    ok: true,
    snapshot: {
      schema_version: 1,
      kind: 'mission_control.materialized_snapshot',
      cursor: 0,
      revision: 1,
      needs_resync: false,
      projection: {
        schema_version: 5,
        kind: 'mission_control.projection',
        workspace: {},
        summary: {},
        control_readiness: {},
        selected_mission_id: '',
        missions: [],
        mission: {},
        sessions: [],
        tasks: [],
        teams: [],
        agents: [],
        approvals: [],
        organization_decisions: [],
        mission_graph: {
          schema_version: 5,
          mission_id: '',
          nodes: [],
          edges: [],
        },
        relations: {},
        execution_graphs: {},
        conflicts: {},
        evidence: {},
        capabilities: {},
        event_digest: {
          total_recent_events: 0,
          scope_counts: {},
          latest_errors: [],
          recovery_required: [],
          latest: [],
        },
        health: {},
      },
    },
    } as MissionControlResponse);
  },
  missionControlDelta: (cursor: number, revision?: number, missionId = '') => {
    const params = new URLSearchParams({ cursor: String(Math.max(0, cursor)) });
    if (Number.isFinite(revision)) params.set('revision', String(revision));
    if (missionId.trim()) params.set('mission_id', missionId.trim());
    return read<MissionProjectionDelta>(`/api/mission/control/delta?${params.toString()}`, {
      schema_version: 5,
      kind: 'mission_control.projection_delta',
      from_cursor: cursor,
      from_revision: revision,
      to_cursor: cursor,
      revision: revision || 1,
      needs_resync: false,
      changed_domains: [],
      events: [],
      patch: {},
    });
  },
  missionControlCommand: (body: MissionCommand) => writeWithReceipt<MissionCommandResponse>('/api/mission/control', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  interpretMissionCommand: (body: Record<string, unknown>) => writeWithReceipt('/api/mission/control/interpret', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  bridgeMissionSession: (body: Record<string, unknown>) => writeWithReceipt('/api/mission/control/sessions/bridge', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  teamExecutionPlan: (teamId: string) => read(`/api/mission/control/teams/${encodeURIComponent(teamId)}/execution`, {}),
  collaborationRuns: () => read('/api/mission/control/teams', { projection: { runs: [] } }),
  collaborationRun: (teamId: string) => read(`/api/mission/control/teams/${encodeURIComponent(teamId)}/run`, {}),
  cancelTeamRuntime: (teamId: string) => {
    const commandId = `mission-team-cancel-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
    return writeWithReceipt<MissionCommandResponse>('/api/mission/control', {
      method: 'POST',
      body: JSON.stringify({
        command_id: commandId,
        action: 'cancel',
        target: { kind: 'team', team_id: teamId },
        actor: 'webui',
        correlation_id: commandId,
        payload: {},
        evidence_refs: [],
      } satisfies MissionCommand),
    });
  },
  teamMissionEvidence: (teamId: string) => read(`/api/mission/control/teams/${encodeURIComponent(teamId)}/evidence`, { events: [], tasks: [], evidence: [] }),
  agentMissionEvents: (agentId: string) => read(`/api/mission/control/agents/${encodeURIComponent(agentId)}/events`, { events: [], tasks: [] }),
  runtimeRecoveryReport: () => read('/api/runtime/events/replay-report', {}),
  applyRuntimeRecovery: () => writeWithReceipt('/api/runtime/events/recover', { method: 'POST' }),
  missionApprovals: () => read('/api/mission/approvals', { approvals: { requests: [], pending_count: 0 } }),
  missionRelations: () => read('/api/mission/relations', { relations: { relations: [], proxies: [] } }),
  missionConflicts: () => read('/api/mission/conflicts', { conflicts: { receipts: [], count: 0 } }),
  missionSessionDetail: (sessionId: string) => read(`/api/mission/sessions/${encodeURIComponent(sessionId)}`, {}),
  decideMissionApproval: (approvalId: string, approved: boolean, reason = '') => writeWithReceipt(`/api/mission/approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ approved, decided_by: 'webui', reason }),
  }),
  missionSchedules: () => read('/api/mission/schedules', {
    ok: true,
    schedules: { schedules: [], fires: [] },
    policy: {},
  }),
  createMissionSchedule: (body: Record<string, unknown>) => writeWithReceipt('/api/mission/schedules', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  updateMissionSchedule: (scheduleId: string, body: Record<string, unknown>) => writeWithReceipt(`/api/mission/schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
  runMissionSchedule: (scheduleId: string) => writeWithReceipt(`/api/mission/schedules/${encodeURIComponent(scheduleId)}/run`, { method: 'POST' }),
  pauseMissionSchedule: (scheduleId: string) => writeWithReceipt(`/api/mission/schedules/${encodeURIComponent(scheduleId)}/pause`, { method: 'POST' }),
  resumeMissionSchedule: (scheduleId: string) => writeWithReceipt(`/api/mission/schedules/${encodeURIComponent(scheduleId)}/resume`, { method: 'POST' }),
  deleteMissionSchedule: (scheduleId: string) => writeWithReceipt(`/api/mission/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' }),
  realityStatus: () => read('/api/reality/status', {}),
  realityStatic: () => read('/api/reality/static', { core_map: [] }),
  realityFlow: (sessionId?: string, limit = 50, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (sessionId) params.set('session_id', sessionId);
    params.set('limit', String(limit));
    const suffix = params.toString();
    const query = suffix ? `?${suffix}` : '';
    return read(`/api/reality/flow${query}`, { stages: [], events: [], promotions: [] }, { signal });
  },
  realityPromotions: (filters: { sessionId?: string; target?: string; status?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.sessionId) params.set('session_id', filters.sessionId);
    if (filters.target) params.set('target', filters.target);
    if (filters.status) params.set('status', filters.status);
    params.set('limit', String(filters.limit || 100));
    return read(`/api/reality/promotions?${params.toString()}`, { promotions: [] });
  },
  realityBoundaries: () => read('/api/reality/boundaries', { boundaries: [] }),
  growthStatus: (signal?: AbortSignal) => read('/api/growth/status', {}, { signal }),
  growthEvents: (signal?: AbortSignal) => read('/api/growth/events', { events: [], promotions: [] }, { signal }),
  providers: () => read('/api/config/providers', { providers: [], models: [], catalog: { providers: [], models: [], profiles: [], sources: [], warnings: [] } }),
  providerCatalog: () => read('/api/config/provider-catalog', { catalog: { providers: [], models: [], profiles: [], sources: [], warnings: [] } }),
  effectiveConfig: (signal?: AbortSignal) => read('/api/runtime/config/effective', {}, { signal }),
  configReloadStatus: () => read('/api/runtime/config/reload/status', {}),
  approvalConfig: () => read('/api/approval/config', {}),
  updateApprovalConfig: (config: Record<string, unknown>) => write('/api/approval/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  }),
  approvalPending: (signal?: AbortSignal) => read('/api/approval/pending', [], { signal }),
  approvalRiskReceipt: (toolName: string, input: unknown, sessionId?: string) => writeWithReceipt('/api/approval/risk-receipt', {
    method: 'POST',
    body: JSON.stringify({ tool_name: toolName, input, session_id: sessionId }),
  }),
  approvalRespond: (id: string, approved: boolean, scope = 'once', reason = '') => write('/api/approval/respond', {
    method: 'POST',
    body: JSON.stringify({ id, approved, scope, reason }),
  }),
  approvalHistory: () => read('/api/approval/history?limit=20', []),
  approvalGrants: (signal?: AbortSignal) => read('/api/approval/grants', { grants: [] }, { signal }),
  revokeApprovalGrant: (id: string, reason = '') => write(`/api/approval/grants/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  runtimeSessionLeases: (signal?: AbortSignal) => read('/api/runtime/session-leases', {}, { signal }),
  acquireRuntimeLease: (sessionId: string, mode = 'collaborative') => write('/api/runtime/session-leases/acquire', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, mode }),
  }),
  releaseRuntimeLease: (sessionId: string) => write('/api/runtime/session-leases/release', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  }),
  contextCurrent: (sessionId: string, q = '', profile = 'main_turn', signal?: AbortSignal) => read(
    `/api/context/current?session_id=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(q)}&profile=${encodeURIComponent(profile)}`,
    {},
    { signal },
  ),
  contextHistory: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/context?limit=20&include_envelopes=true`, {}),
  contextRecommendations: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/context/recommendations?limit=20`, {}),
  recordContextRecommendation: (sessionId: string, envelopeId: string, recommendation: string, action = 'acknowledged') => write(`/api/sessions/${encodeURIComponent(sessionId)}/context/recommendations`, {
    method: 'POST',
    body: JSON.stringify({ envelope_id: envelopeId, recommendation, action }),
  }),
  resolveEvidence: (ref: string) => read(`/api/evidence/resolve?ref=${encodeURIComponent(ref)}`, {}),
  resolveEvidenceBatch: (refs: string[], sessionId?: string) => write('/api/evidence/resolve/batch', {
    method: 'POST', body: JSON.stringify({ refs, session_id: sessionId || undefined }),
  }),
  memoryStatus: () => read('/api/memory/status', {}),
  memoryContextEnvelope: (sessionId = '', limit = 20) => {
    const suffix = sessionId ? `/${encodeURIComponent(sessionId)}` : '';
    return read(`/api/memory/context-envelope${suffix}?limit=${limit}`, {});
  },
  memoryKnowledge: () => read('/api/memory/knowledge', {}),
  memoryKnowledgeNamespaces: () => read('/api/memory/knowledge/namespaces', { namespace_tree: [] }),
  memoryKnowledgeConflicts: () => read('/api/memory/knowledge/conflicts', { conflict_projection: { conflicts: [] } }),
  memoryKnowledgeMaintenance: () => read('/api/memory/knowledge/maintenance', { maintenance_candidates: [], recall_quality: {} }),
  memoryKnowledgeCandidates: () => read('/api/memory/knowledge/candidates', { candidates: [], total: 0 }),
  rollbackMemoryKnowledgeCandidate: (candidateId: string, reason: string) => write(`/api/memory/knowledge/candidates/${encodeURIComponent(candidateId)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  memoryStats: () => read('/api/memory/stats', {}),
  memoryLayers: () => read('/api/memory/layers', { layers: [] }),
  memoryLayer: (layer: string) => read(`/api/memory/${encodeURIComponent(layer)}`, { entries: [] }),
  memoryRuntime: () => read('/api/memory/runtime', {}),
  memoryLifecycle: (id: string) => read(`/api/memory/lifecycle/${encodeURIComponent(id)}`, {}),
  memoryClusters: (limit = 24, focus = '', filter = '', cursor = 0, depth = 1) => {
    const query = new URLSearchParams({ limit: String(limit), cursor: String(cursor), depth: String(depth) });
    if (focus.trim()) query.set('focus', focus.trim());
    if (filter.trim()) query.set('filter', filter.trim());
    return read(`/api/memory/clusters?${query.toString()}`, { clusters: [], truncated: false, next_cursor: null });
  },
  memoryLinks: () => read('/api/memory/links', { links: [] }),
  memoryEntities: () => read('/api/memory/entities', { entities: [] }),
  memoryTriples: () => read('/api/memory/triples', { triples: [] }),
  memoryGraph: (focus = '', depth = 2, filter = '', limit = 80, cursor = 0) => {
    const query = new URLSearchParams({ depth: String(depth), limit: String(limit), cursor: String(cursor) });
    if (focus.trim()) query.set('focus', focus.trim());
    if (filter.trim()) query.set('filter', filter.trim());
    return read(`/api/memory/graph?${query.toString()}`, { entities: [], triples: [], truncated: false, next_cursor: null });
  },
  memoryPerformance: () => read('/api/memory/performance', {}),
  memoryMaintenance: (status = '', kind = '', limit = 100) => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (kind) query.set('kind', kind);
    query.set('limit', String(limit));
    return read(`/api/memory/maintenance?${query.toString()}`, { candidates: [] });
  },
  memorySearch: (q: string) => read(`/api/memory/search?q=${encodeURIComponent(q)}`, {}),
  memoryRecallExplain: (q: string, limit = 10) => read(`/api/memory/recall/explain?q=${encodeURIComponent(q)}&limit=${limit}`, { results: [] }),
  memoryPacket: (q: string, maxItems = 12, maxTokens = 2000) => read(`/api/memory/packet?q=${encodeURIComponent(q)}&max_items=${maxItems}&max_tokens=${maxTokens}`, {}),
  memorySymbolLinks: (symbol: string, limit = 80, cursor = 0) => read(`/api/memory/symbol-links?q=${encodeURIComponent(symbol)}&limit=${limit}&cursor=${cursor}`, { entries: [], truncated: false, next_cursor: null }),
  createMemorySymbolLink: (body: Record<string, unknown>) => write('/api/memory/symbol-links', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  createMemoryEntry: (layer: string, body: Record<string, unknown>) => write(`/api/memory/${encodeURIComponent(layer)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  updateMemoryEntry: (id: string, body: Record<string, unknown>) => write(`/api/memory/entry/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
  deleteMemoryEntry: (layer: string, id: string) => write(`/api/memory/${encodeURIComponent(layer)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  scanMemoryMaintenance: (body: Record<string, unknown> = {}) => write('/api/memory/maintenance', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  updateMemoryMaintenance: (id: string, status: string) => write(`/api/memory/maintenance/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }),
  structuredSources: () => read('/api/cowd/structured/sources', {}),
  structuredFacts: () => read('/api/cowd/structured/facts', {}),
  structuredEvidence: () => read('/api/cowd/structured/evidence', {}),
  structuredWatermarks: () => read('/api/cowd/structured/watermarks', {}),
  structuredIngestPlan: (body: Record<string, unknown>) => write('/api/cowd/structured/ingest-plan', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  skillCatalog: (signal?: AbortSignal) => read('/api/skills/catalog', {}, { signal }),
  skillProjection: (signal?: AbortSignal) => read('/api/skills/projection?surface=webui', {}, { signal }),
  createSkill: (body: Record<string, unknown>) => writeWithReceipt('/api/skills', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  installSkill: (file: File) => {
    const body = new FormData();
    body.append('package', file, file.name);
    return writeWithReceipt('/api/skills/install', { method: 'POST', body });
  },
  skillRuns: (signal?: AbortSignal) => read('/api/skills/runs', {}, { signal }),
  skillRunDetail: (id: string) => read(`/api/skills/runs/${encodeURIComponent(id)}`, {}),
  skillDetail: (id: string, signal?: AbortSignal) => read(`/api/skills/${encodeURIComponent(id)}`, {}, { signal }),
  deleteSkill: (id: string) => writeWithReceipt(`/api/skills/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
  skillFiles: (id: string, signal?: AbortSignal) => read(`/api/skills/${encodeURIComponent(id)}/files`, {}, { signal }),
  skillFileRaw: (id: string, path = 'SKILL.md', signal?: AbortSignal) => read(`/api/skills/${encodeURIComponent(id)}/files/raw?path=${encodeURIComponent(path)}`, {}, { signal }),
  skillTranslate: (id: string, content: string, path = 'SKILL.md', locale = 'zh-CN') => write(`/api/skills/${encodeURIComponent(id)}/translate`, {
    method: 'POST',
    body: JSON.stringify({ content, path, locale }),
  }),
  skillAction: (id: string, action: 'validate' | 'plan' | 'run', body: Record<string, unknown> = {}) => writeWithReceipt(`/api/skills/${encodeURIComponent(id)}/actions/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  tasks: (signal?: AbortSignal) => read('/api/tasks', {}, { signal }),
  taskDetail: (id: string, signal?: AbortSignal) => read<TaskDetailProjection>(
    `/api/tasks/${encodeURIComponent(id)}`,
    { task: null, turns: [] } as unknown as TaskDetailProjection,
    { signal },
  ),
  taskTurns: (id: string, signal?: AbortSignal) => read(
    `/api/tasks/${encodeURIComponent(id)}/turns`,
    { task_id: id, turns: [] },
    { signal },
  ),
  taskFocus: (sessionId: string, signal?: AbortSignal) => read<TaskFocusProjection>(
    `/api/sessions/${encodeURIComponent(sessionId)}/task-focus`,
    { revision: 0, task_focus: null },
    { signal },
  ),
  setTaskFocus: (sessionId: string, taskId: string, expectedRevision: number) => write(
    `/api/sessions/${encodeURIComponent(sessionId)}/task-focus`,
    {
      method: 'PUT',
      body: JSON.stringify({ task_id: taskId, expected_revision: expectedRevision }),
    },
  ),
  clearTaskFocus: (sessionId: string, expectedRevision: number) => write(
    `/api/sessions/${encodeURIComponent(sessionId)}/task-focus`,
    {
      method: 'DELETE',
      body: JSON.stringify({ expected_revision: expectedRevision }),
    },
  ),
  missionFocus: (sessionId: string, signal?: AbortSignal) => read<MissionFocusProjection>(
    `/api/sessions/${encodeURIComponent(sessionId)}/mission-focus`,
    { revision: 0, mission_focus: null },
    { signal },
  ),
  setMissionFocus: (sessionId: string, missionId: string, expectedRevision: number) => write(
    `/api/sessions/${encodeURIComponent(sessionId)}/mission-focus`,
    {
      method: 'PUT',
      body: JSON.stringify({ mission_id: missionId, expected_revision: expectedRevision }),
    },
  ),
  clearMissionFocus: (sessionId: string, expectedRevision: number) => write(
    `/api/sessions/${encodeURIComponent(sessionId)}/mission-focus`,
    {
      method: 'DELETE',
      body: JSON.stringify({ expected_revision: expectedRevision }),
    },
  ),
  previewTaskMission: (taskIds: string[], targetMissionId: string, expectedTaskRevisions: Record<string, number>) => write(
    '/api/tasks/mission/preview',
    {
      method: 'POST',
      body: JSON.stringify({
        operation_id: `webui-preview-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
        task_ids: taskIds,
        target_mission_id: targetMissionId,
        assignment: 'explicit_locked',
        expected_task_revisions: expectedTaskRevisions,
        evidence_refs: [],
      }),
    },
  ),
  commitTaskMission: (body: Record<string, unknown>) => write('/api/tasks/mission/commit', {
    method: 'POST',
    body: JSON.stringify({ ...body, confirmed: true }),
  }),
  missionOrganizationDecisions: (status = '', limit = 100, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set('status', status);
    return read<{ decisions: MissionOrganizationDecisionProjection[] }>(
      `/api/tasks/mission/organization?${params.toString()}`,
      { decisions: [] },
      { signal },
    );
  },
  startTask: async (objective: string, yoloMode = false, sessionId = '') => {
    if (!sessionId.trim()) throw new Error('Task creation requires an active Session');
    const control = await read<MissionControlResponse>('/api/mission/control', {} as MissionControlResponse);
    const missionId = String(control.snapshot?.projection?.selected_mission_id || '').trim();
    if (!missionId) throw new Error('Task creation requires a selected Mission');
    const suffix = globalThis.crypto?.randomUUID?.() || Date.now().toString(36);
    return write('/api/tasks/start', {
      method: 'POST',
      body: JSON.stringify({
        task_id: `task-${suffix}`,
        mission_id: missionId,
        origin_session_id: sessionId,
        origin_turn_id: `manual-${suffix}`,
        objective,
        yolo_mode: yoloMode,
        evidence_refs: [],
      }),
    });
  },
  cancelTask: (id: string, expectedRevision: number) => write(`/api/tasks/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ expected_revision: expectedRevision, note: 'cancelled by WebUI', evidence_refs: [] }),
  }),
  completeTask: (id: string, expectedRevision: number) => write(`/api/tasks/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ expected_revision: expectedRevision, note: 'completed by WebUI', evidence_refs: [] }),
  }),
  recordTaskFailure: (id: string, expectedRevision: number, reason: string) => write(`/api/tasks/${encodeURIComponent(id)}/failure`, {
    method: 'POST',
    body: JSON.stringify({ expected_revision: expectedRevision, reason, evidence_refs: [] }),
  }),
  startTaskPhase: (id: string, body: Record<string, unknown>) => write(`/api/tasks/${encodeURIComponent(id)}/phases`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  recordTaskArtifact: (id: string, phaseId: string, body: Record<string, unknown>) => write(`/api/tasks/${encodeURIComponent(id)}/phases/${encodeURIComponent(phaseId)}/artifacts`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  reviewTaskPhase: (id: string, phaseId: string, expectedRevision: number, result: string, completed = true) => write(`/api/tasks/${encodeURIComponent(id)}/phases/${encodeURIComponent(phaseId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ expected_revision: expectedRevision, result, completed, evidence_refs: [] }),
  }),
  agentCatalog: () => read('/api/agents/catalog', { agents: [], summary: {} }),
  agentDirectory: () => read('/api/agents/directory', { agents: [], summary: {} }),
  agentDiscover: (task: string) => read(`/api/agents/discover?task=${encodeURIComponent(task)}`, { agents: [], team: null }),
  agentAssemble: (task: string) => write('/api/agents/assemble', {
    method: 'POST',
    body: JSON.stringify({ task }),
  }),
  agentSelfModels: () => read('/api/agents/self-models', { items: [], summary: {} }),
  agentRuns: async () => {
    const response = await read<any>('/api/agents/execution-graphs', { graphs: [] });
    return {
      ...response,
      runs: Array.isArray(response) ? response : (response.runs || response.graphs || []),
    };
  },
  teamTemplates: () => read('/api/team-templates', { templates: [] }),
  instantiateTeamTemplate: (body: Record<string, unknown>) => write('/api/team-templates/instantiate', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  teamWorkingState: (id: string) => read(`/api/runtime/teams/${encodeURIComponent(id)}/working-state`, { working_state: { entries: [] } }),
  taskAgentGraph: (id: string) => read(`/api/tasks/${encodeURIComponent(id)}/execution-graph`, { nodes: [] }),
  toolRegistry: () => read('/api/tools', {}),
  toolExecute: (name: string, input: Record<string, unknown> = {}, mode = 'read_only') => write('/api/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ name, input, mode }),
  }),
  toolCacheStats: () => read('/api/tools/cache', {}),
  toolBatchReadonly: (calls: Array<Record<string, unknown>>, max_concurrency = 4) => write('/api/tools/batch-readonly', {
    method: 'POST',
    body: JSON.stringify({ calls, max_concurrency }),
  }),
  toolMutationPreview: (edits: Array<Record<string, unknown>>) => write('/api/tools/mutations/preview', {
    method: 'POST',
    body: JSON.stringify({ edits }),
  }),
  toolMutationApply: (edits: Array<Record<string, unknown>>, expected_hashes: Record<string, string> = {}) => write('/api/tools/mutations/apply', {
    method: 'POST',
    body: JSON.stringify({ edits, expected_hashes }),
  }),
  toolCheckpoints: () => read('/api/tools/checkpoints', { checkpoints: [] }),
  toolCheckpointCreate: (label = '') => write('/api/tools/checkpoints', {
    method: 'POST',
    body: JSON.stringify({ label: label || undefined }),
  }),
  toolCheckpointDiff: (id: string) => read(`/api/tools/checkpoints/${encodeURIComponent(id)}/diff`, {}),
  toolCheckpointRestore: (id: string) => write(`/api/tools/checkpoints/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  toolIntentPlan: (prompt: string, selected_tools: string[] = []) => write('/api/tools/intent-plan', {
    method: 'POST',
    body: JSON.stringify({ prompt, selected_tools }),
  }),
  toolContextFanoutPlan: (prompt: string) => write('/api/tools/context-fanout/plan', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  }),
  surfaceRegistry: () => read('/api/surfaces', { kind: 'surface.registry', registry: { surfaces: [] } }),
  surfaceHostHealth: () => read('/api/surfaces/health', { kind: 'surface.health', status: 'offline', registry: { surfaces: [] } }),
  surfaceDetail: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}`, {}),
  surfaceRoutes: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/routes`, { routes: [] }),
  surfaceResources: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/resources`, { resources: [] }),
  surfaceStatus: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/status`, {}),
  surfaceHealth: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/health`, {}),
  surfaceHealthCheck: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/health-check`, { method: 'POST' }),
  surfaceEvents: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/events`, { events: [] }),
  surfaceInbox: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/inbox`, { inbox: [], snapshot: {} }),
  surfaceOutbox: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/outbox`, { outbox: [], dead_letters: [] }),
  surfaceMessages: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/messages`, { kind: 'surface.messages', snapshot: {} }),
  surfaceTriggerEvents: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/trigger-events`, { kind: 'surface.trigger_events', events: [] }),
  surfaceRetryTriggerEvent: (id: string, idempotency_key: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/trigger-events/retry`, {
    method: 'POST',
    body: JSON.stringify({ idempotency_key }),
  }),
  surfaceArchiveMessages: (id: string, limit = 100, olderThanMs?: number) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/messages/archive`, {
    method: 'POST',
    body: JSON.stringify({ limit, older_than_ms: olderThanMs }),
  }),
  surfacePurgeArchivedMessages: (id: string, limit = 100, olderThanMs?: number) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/messages/purge-archived-events`, {
    method: 'POST',
    body: JSON.stringify({ limit, older_than_ms: olderThanMs }),
  }),
  surfaceDeliveries: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/deliveries`, { deliveries: [] }),
  surfaceReplayInbox: (id: string, messageId: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/inbox/${encodeURIComponent(messageId)}/replay`, { method: 'POST' }),
  surfaceRetryOutbox: (id: string, deliveryId: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/outbox/${encodeURIComponent(deliveryId)}/retry`, { method: 'POST' }),
  surfaceDeadLetterOutbox: (id: string, deliveryId: string, reason = 'operator moved delivery to dead letter') => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/outbox/${encodeURIComponent(deliveryId)}/dead-letter`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  surfaceStart: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/start`, { method: 'POST' }),
  surfaceStop: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  surfaceRestart: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/restart`, { method: 'POST' }),
  surfaceRepair: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/repair`, { method: 'POST' }),
  surfaceSend: (id: string, recipient: string, text: string, thread?: string, metadata: Record<string, unknown> = {}) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    body: JSON.stringify({ recipient, text, thread: thread || undefined, metadata }),
  }),
  surfaceAction: (id: string, action: string, payload: Record<string, unknown> = {}) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, payload }),
  }),
  edgeRegistry: () => read('/api/edges', { kind: 'edge.registry', health: {}, surfaces: [], message_connectors: [], source_connectors: [], automation_connectors: [] }),
  edgeHealth: () => read('/api/edges/health', { kind: 'edge.health', health: {} }),
  edgeSurfaces: () => read('/api/edges/surfaces', { kind: 'edge.surfaces', surfaces: [] }),
  edgeConnectors: () => read('/api/edges/connectors', { kind: 'edge.connectors', message_connectors: [], source_connectors: [], automation_connectors: [] }),
  edgeMessageConnectors: () => read('/api/edges/connectors/message', { kind: 'edge.connectors.message', connectors: [] }),
  edgeSourceConnectors: () => read('/api/edges/connectors/source', { kind: 'edge.connectors.source', connectors: [] }),
  matrixSourcePackUpsert: (source_pack: Record<string, unknown>) => writeWithReceipt('/api/matrix/source-packs/upsert', {
    method: 'POST',
    body: JSON.stringify({ source_pack, session_id: 'webui-edge' }),
  }),
  matrixSourceSnapshotPlan: (id: string, body: Record<string, unknown>) => writeWithReceipt(`/api/matrix/source-packs/${encodeURIComponent(id)}/snapshots/plan`, {
    method: 'POST',
    body: JSON.stringify({ ...body, session_id: body.session_id || 'webui-edge' }),
  }),
  matrixSourceSnapshotRun: (id: string, body: Record<string, unknown>) => writeWithReceipt(`/api/matrix/source-packs/${encodeURIComponent(id)}/snapshots/run`, {
    method: 'POST',
    body: JSON.stringify({ ...body, session_id: body.session_id || 'webui-edge' }),
  }),
  matrixSourceSnapshots: (id: string) => read(`/api/matrix/source-packs/${encodeURIComponent(id)}/snapshots`, { snapshots: [] }),
  matrixHealth: () => read('/api/matrix/health', {}),
  matrixEntities: () => read('/api/matrix/entities', { entities: [] }),
  matrixEntity: (id: string) => read(`/api/matrix/entities/${encodeURIComponent(id)}`, {}),
  matrixEntityRelations: (id: string) => read(`/api/matrix/entities/${encodeURIComponent(id)}/relations`, { relations: [] }),
  matrixEntityImpact: (id: string) => read(`/api/matrix/entities/${encodeURIComponent(id)}/impact-path`, {}),
  matrixMetrics: () => read('/api/matrix/metrics', { metrics: [] }),
  matrixMetric: (id: string) => read(`/api/matrix/metrics/${encodeURIComponent(id)}`, {}),
  matrixMetricLineage: (id: string) => read(`/api/matrix/metrics/${encodeURIComponent(id)}/lineage`, {}),
  connectorSources: () => read('/api/connectors/sources', { kind: 'connector.source_adapters', adapters: [] }),
  connectorSourceState: (adapterId: string) => read(`/api/connectors/sources/${encodeURIComponent(adapterId)}/state`, { state: {} }),
  connectorSourceRunIncremental: (adapterId: string, body: Record<string, unknown>) => writeWithReceipt(`/api/connectors/sources/${encodeURIComponent(adapterId)}/run-incremental`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  connectorSourcePollEvents: (adapterId: string, body: Record<string, unknown>) => writeWithReceipt(`/api/connectors/sources/${encodeURIComponent(adapterId)}/poll-events`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  connectorSourceCommitWatermark: (adapterId: string, watermark: Record<string, unknown>) => writeWithReceipt(`/api/connectors/sources/${encodeURIComponent(adapterId)}/commit-watermark`, {
    method: 'POST',
    body: JSON.stringify({ watermark }),
  }),
  platforms: () => read('/api/platforms', {}),
  platform: (name: string) => read(`/api/platforms/${encodeURIComponent(name)}`, {}),
  messageConnectors: () => read('/api/message-connectors', { kind: 'message.connector.registry', connectors: [] }),
  messageConnectorStatus: (name: string) => read(`/api/message-connectors/${encodeURIComponent(name)}/status`, {}),
  messageConnectorRepair: (name: string) => writeWithReceipt(`/api/message-connectors/${encodeURIComponent(name)}/repair`, { method: 'POST' }),
  messageEndpoints: () => read('/api/message-endpoints', { kind: 'message.endpoint.directory', endpoints: [] }),
  messageRoutes: () => read('/api/message-routes', { kind: 'message.delivery.routes', routes: [] }),
  messageBindings: () => read('/api/message-bindings', { kind: 'message.conversation.bindings', bindings: [] }),
  wechatIlinkQrStart: (botType = '3') => writeWithReceipt('/api/message-connectors/wechat-ilink/actions/account.login_qr.start', {
    method: 'POST',
    body: JSON.stringify({ bot_type: botType }),
  }),
  wechatIlinkQrPoll: (qrcode: string, baseUrl?: string) => writeWithReceipt('/api/message-connectors/wechat-ilink/actions/account.login_qr.poll', {
    method: 'POST',
    body: JSON.stringify({ qrcode, base_url: baseUrl }),
  }),
  wechatIlinkAccounts: () => read('/api/message-connectors/wechat-ilink/accounts', {
    kind: 'wechat_ilink_accounts',
    surface_available: false,
    usable: false,
    accounts: [],
  }),
  connectorsSummary: () => read('/api/connectors/summary', {}),
  connectorAccounts: () => read('/api/connectors/accounts', {}),
  connectorCapabilities: () => read('/api/connectors/capabilities', {}),
  connectorResources: () => read('/api/connectors/resources', {}),
  connectorMcpServers: () => read('/api/connectors/mcp/servers', {}),
  connectorServices: () => read('/api/connectors/services', { services: [] }),
  connectorServiceTools: (serviceId: string) => read(`/api/connectors/services/${encodeURIComponent(serviceId)}/tools`, { tools: [] }),
  connectorServiceExecute: (serviceId: string, body: Record<string, unknown>) => writeWithReceipt(`/api/connectors/services/${encodeURIComponent(serviceId)}/execute`, {
    method: 'POST',
    body: JSON.stringify(withoutServerActor(body)),
  }),
  connectorRevalidateResource: (reference: string) => write('/api/connectors/resources/revalidate', {
    method: 'POST',
    body: JSON.stringify({ reference }),
  }),
  connectorPromoteMemory: (reference: string) => write('/api/connectors/resources/promote-memory', {
    method: 'POST',
    body: JSON.stringify({ reference }),
  }),
  crossPlaneSummary: () => read('/api/cross-plane/summary', {}),
  crossPlaneIdentities: () => read('/api/cross-plane/identities', {}),
  crossPlaneCreateIdentity: (body: Record<string, unknown>) => write('/api/cross-plane/identities', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  crossPlaneRevokeIdentity: (id: string) => write(`/api/cross-plane/identities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  crossPlaneGrants: () => read('/api/cross-plane/grants', {}),
  crossPlaneCreateGrant: (body: Record<string, unknown>) => write('/api/cross-plane/grants', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  crossPlaneRevokeGrant: (id: string) => write(`/api/cross-plane/grants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  crossPlaneAudit: () => read('/api/cross-plane/audit', {}),
  crossPlaneAdapters: () => read('/api/cross-plane/action/adapters', {}),
  crossPlaneExecutions: () => read('/api/cross-plane/action/executions', {}),
  crossPlanePolicySimulate: (body: Record<string, unknown>) => write('/api/cross-plane/policy/simulate', {
    method: 'POST',
    body: JSON.stringify(withoutServerActor(body)),
  }),
  crossPlanePreflight: (body: Record<string, unknown>) => write('/api/cross-plane/action/preflight', {
    method: 'POST',
    body: JSON.stringify(withoutServerActor(body)),
  }),
  crossPlaneExecute: (action: Record<string, unknown>, mode = 'dry_run', idempotency_key?: string) => writeWithReceipt('/api/cross-plane/action/execute', {
    method: 'POST',
    body: JSON.stringify({ action: withoutServerActor(action), mode, idempotency_key }),
  }),
  crossPlaneResolveIdentity: (identity_ref: string) => write('/api/cross-plane/identity/resolve', {
    method: 'POST',
    body: JSON.stringify({ identity_ref }),
  }),
  auditExport: (source = 'all', limit = 50, offset = 0) => read(`/api/audit/export?source=${encodeURIComponent(source)}&limit=${limit}&offset=${offset}`, {}),
  usageSummary: () => read('/api/usage', {}),
  cowdCapabilities: () => read('/api/cowd/capabilities', {}),
  cowdProjection: (surface = 'webui') => read(`/api/cowd/projection?surface=${encodeURIComponent(surface)}`, {}),
  cowdSurfaces: () => read('/api/cowd/surfaces', {}),
  cowdReleaseGate: () => read('/api/cowd/release-gate', {}),
  harnessEvalLatestReport: () => read('/api/harness-eval/reports/latest', {}),
  harnessEvalReports: () => read('/api/harness-eval/reports', { reports: [] }),
  harnessEvalReport: (id: string) => read(`/api/harness-eval/reports/${encodeURIComponent(id)}`, {}),
  harnessEvalScenarios: () => read('/api/harness-eval/scenarios', { scenarios: [] }),
  harnessEvalRuns: () => read('/api/harness-eval/runs', { runs: [] }),
  harnessEvalRun: (id: string) => read(`/api/harness-eval/runs/${encodeURIComponent(id)}`, {}),
  harnessEvalRunStatus: (id: string) => read(`/api/harness-eval/runs/${encodeURIComponent(id)}`, {}),
  harnessEvalArtifacts: (id: string) => read(`/api/harness-eval/reports/${encodeURIComponent(id)}/artifacts`, { artifacts: [] }),
  harnessEvalReportGate: (id: string) => read(`/api/harness-eval/reports/${encodeURIComponent(id)}/gate`, {}),
  harnessEvalStartRun: (options: HarnessEvalRunOptions = {}) => writeWithReceipt('/api/harness-eval/runs', {
    method: 'POST',
    body: JSON.stringify({
      level: options.level === 'deep-real' ? 'deep' : options.level || 'quick',
      provider: options.provider || undefined,
      budget: options.budget || (options.level === 'full' || options.level === 'deep-real' ? 'full' : 'low'),
      actor: options.actor || 'webui.audit',
      objective: options.objective || `operator requested harness eval ${options.level || 'quick'}`,
      allow_real_model: Boolean(options.allow_real_model),
    }),
  }),
  harnessEvalRunSmoke: () => api.harnessEvalStartRun({
    level: 'quick',
    budget: 'low',
    allow_real_model: false,
    objective: 'operator requested harness eval smoke',
  }),
  harnessEvalCancelRun: (id: string) => writeWithReceipt(`/api/harness-eval/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  terminalGateRun: () => writeWithReceipt('/api/harness-eval/runs', {
    method: 'POST',
    body: JSON.stringify({
      level: 'full',
      budget: 'terminal-gate',
      actor: 'webui.audit',
      objective: 'operator requested terminal gate evaluation',
      allow_real_model: false,
    }),
  }),
  evolutionSignals: () => read('/api/evolution/signals', { signals: [] }),
  evolutionCreateSignal: (body: Record<string, unknown>) => writeWithReceipt('/api/evolution/signals', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  evolutionDiagnoses: () => read('/api/evolution/diagnoses', { diagnoses: [] }),
  evolutionCreateDiagnosis: (signal_ids: string[] = []) => writeWithReceipt('/api/evolution/diagnoses', {
    method: 'POST',
    body: JSON.stringify({ signal_ids }),
  }),
  evolutionMissionsSummary: () => read('/api/evolution/missions/summary', { missions: [] }),
  evolutionMissionDetail: (id: string) => read(`/api/evolution/missions/${encodeURIComponent(id)}/detail`, {}),
  evolutionProposals: () => read('/api/evolution/proposals', { proposals: [] }),
  evolutionCreateProposal: (signal_ids: string[] = []) => writeWithReceipt('/api/evolution/proposals', {
    method: 'POST',
    body: JSON.stringify({ signal_ids }),
  }),
  evolutionProposal: (id: string) => read(`/api/evolution/proposals/${encodeURIComponent(id)}`, {}),
  evolutionChain: (id: string) => read(`/api/evolution/chain/${encodeURIComponent(id)}`, {}),
  evolutionProposalDecision: (id: string, decision: 'approved' | 'rejected' | 'archived') => writeWithReceipt(`/api/evolution/proposals/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  }),
  evolutionSkillDraft: (id: string) => read(`/api/evolution/proposals/${encodeURIComponent(id)}/skill-draft`, {}),
  evolutionCandidates: () => read('/api/evolution/candidates', { candidates: [] }),
  evolutionCandidateDetail: (id: string) => read(`/api/evolution/candidates/${encodeURIComponent(id)}`, {}),
  evolutionCreateCandidate: (body: Record<string, unknown>) => writeWithReceipt('/api/evolution/candidates', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  evolutionCandidateEvaluate: (id: string) => writeWithReceipt(`/api/evolution/candidates/${encodeURIComponent(id)}/evaluate`, {
    method: 'POST',
    body: JSON.stringify({}),
  }),
  evolutionCandidateCanaryReview: (id: string) => writeWithReceipt(`/api/evolution/candidates/${encodeURIComponent(id)}/reviews/canary`, {
    method: 'POST',
    body: JSON.stringify({}),
  }),
  evolutionCandidateStableReview: (id: string) => writeWithReceipt(`/api/evolution/candidates/${encodeURIComponent(id)}/reviews/stable`, {
    method: 'POST',
    body: JSON.stringify({}),
  }),
  evolutionReviews: () => read('/api/evolution/reviews', { reviews: [] }),
  evolutionReview: (id: string) => read(`/api/evolution/reviews/${encodeURIComponent(id)}`, {}),
  evolutionCreateReleaseReview: (body: Record<string, unknown>) => writeWithReceipt('/api/evolution/reviews', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  evolutionReviewDecision: (id: string, decision: 'approve' | 'reject' | 'revise', reason = '') => writeWithReceipt(`/api/evolution/reviews/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  }),
  evolutionEvaluationPolicy: () => read('/api/evolution/evaluation-policy', {}),
  evolutionEvaluationPolicyReviews: () => read('/api/evolution/evaluation-policy/reviews', { reviews: [] }),
  evolutionCreateEvaluationPolicyReview: (body: Record<string, unknown>) => writeWithReceipt('/api/evolution/evaluation-policy/reviews', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  evolutionEvaluationPolicyReviewDecision: (id: string, decision: 'approve' | 'reject', reason = '') => writeWithReceipt(`/api/evolution/evaluation-policy/reviews/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  }),
  managedAgents: () => read('/api/runtime/managed-agents', { definitions: [], invocations: [], effects: [], health: [] }),
  managedAgentDefinitions: () => read('/api/runtime/managed-agents/definitions', { definitions: [] }),
  createManagedAgentDefinition: (body: Record<string, unknown>) => writeWithReceipt('/api/runtime/managed-agents/definitions', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  deactivateManagedAgentDefinition: (id: string) => writeWithReceipt(`/api/runtime/managed-agents/definitions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
  triggerManagedAgent: (id: string, request_id: string) => writeWithReceipt(`/api/runtime/managed-agents/${encodeURIComponent(id)}/trigger`, {
    method: 'POST',
    body: JSON.stringify({ request_id }),
  }),
  dispatchManagedAgents: (dispatcher_id = 'webui', limit = 16) => writeWithReceipt('/api/runtime/managed-agents/dispatch', {
    method: 'POST',
    body: JSON.stringify({ dispatcher_id, limit }),
  }),
  resetManagedAgentHealth: (id: string) => writeWithReceipt(`/api/runtime/managed-agents/${encodeURIComponent(id)}/health/reset`, {
    method: 'POST',
  }),
  managedAgentEffects: () => read('/api/runtime/managed-agents/effects', { effects: [] }),
  settings: () => read('/api/config', { model: 'unknown', version: 'unknown' }),
  saveConfig: (config: Record<string, unknown>) => write('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  }),
  commands: (surface = 'webui') => read(`/api/slash?surface=${encodeURIComponent(surface)}`, { commands: [] }),
  commandHistory: () => read('/api/slash/history', { history: [] }),
  resolveCommand: (command: string, surface = 'webui', context: Record<string, unknown> = {}) => write('/api/slash/resolve', {
    method: 'POST',
    body: JSON.stringify({ input: command, surface, context }),
  }),
  executeCommand: (command: string, args: Record<string, unknown> = {}) => write('/api/slash/dispatch', {
    method: 'POST',
    body: JSON.stringify({ command, args }),
  }),
  profiles: () => read('/api/profiles', { profiles: [], active_profile: '', runtime_profile: '' }),
  updateRuntimeConfig: (body: Record<string, unknown>) => write('/api/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  }),
  createProfile: (name: string) => write('/api/profiles', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  switchProfile: (profile: string) => write('/api/profiles/switch', {
    method: 'POST',
    body: JSON.stringify({ profile }),
  }),
  deleteProfile: (id: string) => write(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

async function readText(path: string, fallback = ''): Promise<string> {
  const requestAuthorization = authorizationStamp(path);
  try {
    const response = await fetch(path, { credentials: 'same-origin', headers: headers() });
    if (!response.ok) {
      const body = await response.text();
      if (
        (response.status === 401 || response.status === 403)
        && authorizationStampIsCurrent(requestAuthorization)
      ) {
        invalidateRejectedAuthorization(
          requestAuthorization,
          response.status,
          body || `${response.status} ${response.statusText}`,
        );
      }
      throw new Error(body || `${response.status} ${response.statusText}`);
    }
    const body = await response.text();
    if (!authorizationStampIsCurrent(requestAuthorization)) {
      throw new Error('authorization changed while this response was in flight');
    }
    return body;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export function providerModels(controlPlane: any, config: any): string[] {
  const providerProjection = controlPlane?.components?.provider || {};
  const catalogModels = config?.catalog?.models || providerProjection.catalog?.models;
  if (Array.isArray(catalogModels) && catalogModels.length) {
    return catalogModels
      .filter((model: any) => model?.status !== 'unavailable')
      .map((model: any) => model.id || model.name || model.model)
      .filter((model: any) => typeof model === 'string' && model.trim() && model !== 'unknown');
  }
  if (Array.isArray(config?.models) && config.models.length) {
    return config.models
      .map((model: any) => model.id || model.name || model)
      .filter((model: any) => typeof model === 'string' && model.trim() && model !== 'unknown');
  }
  const models = new Set<string>();
  const configured = providerProjection.configured_model || config?.configured_model || config?.model;
  const normalized = typeof configured === 'string' ? configured.trim() : '';
  if (normalized && normalized !== 'unknown') models.add(normalized);
  const providerNames = providerProjection.provider_names || [];
  const count = Number(providerProjection.model_count || 0);
  if (count > 0 && models.size === 0) {
    providerNames.forEach((name: string) => models.add(`${name}:default`));
  }
  return Array.from(models);
}
