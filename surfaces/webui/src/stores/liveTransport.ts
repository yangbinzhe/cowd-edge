import { reactive, ref } from 'vue';
import { api, ApiWriteError, claimWebuiObserverId } from '../api/client';

export type LiveSourceKind = 'session' | 'execution' | 'mission';
export type LiveDetailScope = 'summary' | 'full';

export type LiveSourceSelector = {
  kind: LiveSourceKind;
  id: string;
  cursor?: number;
  revision?: number;
  detail_scope?: LiveDetailScope;
};

export type LiveEnvelope = {
  schema_version: number;
  subscription_id: string;
  subscription_revision: number;
  source_kind: string;
  source_id: string;
  detail_scope: LiveDetailScope;
  source_cursor?: number;
  delivery_class: 'durable' | 'snapshot_reconstructable' | 'ephemeral_preview';
  source_health: 'baseline' | 'live' | 'resync_required' | 'revoked';
  event: string;
  payload: any;
  session_id?: string;
  execution_id?: string;
  mission_id?: string;
  agent_id?: string;
  stream_revision?: number;
  start_bytes?: number;
  end_bytes?: number;
};

type SourceCallbacks = {
  open?: () => void;
  error?: (reason: string) => void;
  envelope: (envelope: LiveEnvelope) => void;
};

export type LiveSourceLease = {
  close: () => void;
  update: (selector: LiveSourceSelector) => void;
};

export type SessionLiveSource = LiveSourceLease & {
  onopen: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
};

type SourceOwner = {
  selector: LiveSourceSelector;
  consumers: Map<string, SourceCallbacks>;
};

type LiveSubscription = {
  id: string;
  revision: number;
  selector_hash: string;
  stream_url: string;
};

type PendingCreate = {
  request_fingerprint: string;
  idempotency_key: string;
};

const sources = new Map<string, SourceOwner>();
const physical = reactive({
  state: 'offline' as 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'degraded',
  subscriptionId: '',
  revision: 0,
  selectorHash: '',
  lastEventAtMs: 0,
  reconnectCount: 0,
  error: '',
});
const subscriptionHealth = reactive({
  state: 'offline' as 'offline' | 'syncing' | 'ready' | 'degraded',
  revision: 0,
  error: '',
});
const sourceHealth = reactive(new Map<string, LiveEnvelope['source_health']>());
const physicalConnectionCount = ref(0);
let subscription: LiveSubscription | null = null;
let stream: EventSource | null = null;
let lastAuthorizationReloadAt = 0;

function authorizationReasonNeedsRecovery(reason: string) {
  return /credential epoch changed|no longer current|principal expired|no longer active/.test(reason);
}

function scheduleAuthorizationRecovery(reason: string) {
  if (!authorizationReasonNeedsRecovery(reason)) return;
  const now = Date.now();
  if (now - lastAuthorizationReloadAt < 60_000) return;
  lastAuthorizationReloadAt = now;
  if (typeof window !== 'undefined') {
    // F2: at most one automatic reload per browser session. Subsequent
    // revocation events only surface the recovery prompt; reloading in a
    // loop cannot make an invalid principal valid.
    let reloadUsed = false;
    try {
      reloadUsed = globalThis.sessionStorage?.getItem('cowd.auth_recovery_used') === '1';
    } catch {
      // sessionStorage unavailable: keep the previous 60s in-memory throttle.
    }
    window.dispatchEvent(new CustomEvent('cowd:authorization-invalidated', {
      detail: { reason, automaticRecovery: !reloadUsed },
    }));
    if (!reloadUsed) {
      try {
        globalThis.sessionStorage?.setItem('cowd.auth_recovery_used', '1');
      } catch {
        // Reload still proceeds for this one event; storage was unavailable.
      }
      window.setTimeout(() => window.location.reload(), 400);
    }
  }
}
let readyRevision = 0;
let pendingRevisionEnvelopes: LiveEnvelope[] = [];
let syncGeneration = 0;
let syncedGeneration = 0;
let syncFlight: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimerGeneration = 0;
let physicalGeneration = 0;
let pendingDelete: LiveSubscription | null = null;
let pendingCreate: PendingCreate | null = null;
let subscriptionMutationInFlight = false;
let pendingAcknowledgementEnvelopes: LiveEnvelope[] = [];
let activeEnvelopeConsumer: ((envelope: LiveEnvelope) => void) | null = null;
// C6: each tab owns a document-local nonce. The writer lease
// (`x-cowd-observer-id`) stays per browser session, while the live
// surface_instance becomes `observerId:tab:<nonce>` so parallel tabs never
// share one subscription counter and cannot trigger the 429 live-cap ceiling.
const TAB_NONCE = (() => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
})();

export function parseLiveEnvelope(data: string): LiveEnvelope {
  const envelope = JSON.parse(data) as LiveEnvelope;
  if (
    envelope?.schema_version !== 1
    || !envelope.subscription_id
    || !Number.isInteger(envelope.subscription_revision)
    || envelope.subscription_revision < 1
    || !envelope.source_kind
    || !envelope.source_id
    || !['summary', 'full'].includes(envelope.detail_scope)
    || !['durable', 'snapshot_reconstructable', 'ephemeral_preview']
      .includes(envelope.delivery_class)
    || !['baseline', 'live', 'resync_required', 'revoked'].includes(envelope.source_health)
    || !envelope.event
  ) {
    throw new Error('Gateway live stream emitted an invalid LiveEnvelope');
  }
  return envelope;
}

function randomId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sourceKey(selector: LiveSourceSelector) {
  return `${selector.kind}:${selector.id}`;
}

function normalizedSelector(selector: LiveSourceSelector): LiveSourceSelector {
  return {
    kind: selector.kind,
    id: selector.id.trim(),
    cursor: Math.max(0, Number(selector.cursor || 0)),
    revision: Math.max(0, Number(selector.revision || 0)),
    detail_scope: selector.detail_scope || 'summary',
  };
}

function mergedSelector(owner: SourceOwner, next: LiveSourceSelector) {
  owner.selector.cursor = Math.max(
    Number(owner.selector.cursor || 0),
    Number(next.cursor || 0),
  );
  owner.selector.revision = Math.max(
    Number(owner.selector.revision || 0),
    Number(next.revision || 0),
  );
  if (next.detail_scope === 'full') owner.selector.detail_scope = 'full';
}

function selectorPayload() {
  return [...sources.values()]
    .map((owner) => normalizedSelector(owner.selector))
    .sort((left, right) => sourceKey(left).localeCompare(sourceKey(right)));
}

function liveCreateRequest(surfaceInstance: string, selected: LiveSourceSelector[]) {
  const requestFingerprint = JSON.stringify({
    surface_instance: surfaceInstance,
    selector: { sources: selected },
  });
  if (pendingCreate?.request_fingerprint !== requestFingerprint) {
    pendingCreate = {
      request_fingerprint: requestFingerprint,
      idempotency_key: `webui-live:${surfaceInstance}:${randomId()}`,
    };
  }
  return {
    surface_instance: surfaceInstance,
    selector: { sources: selected },
    idempotency_key: pendingCreate.idempotency_key,
  };
}

function closePhysical() {
  physicalGeneration += 1;
  stream?.close();
  stream = null;
  activeEnvelopeConsumer = null;
  physicalConnectionCount.value = 0;
}

function cancelReconnectTimer(generation?: number) {
  if (
    !reconnectTimer
    || (generation !== undefined && reconnectTimerGeneration !== generation)
  ) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectTimerGeneration = 0;
}

function notifyError(reason: string) {
  physical.error = reason;
  subscriptionHealth.state = 'degraded';
  subscriptionHealth.error = reason;
  for (const owner of sources.values()) {
    for (const callbacks of owner.consumers.values()) callbacks.error?.(reason);
  }
}

function deliverEnvelope(envelope: LiveEnvelope) {
  const key = `${envelope.source_kind}:${envelope.source_id}`;
  sourceHealth.set(key, envelope.source_health);
  const owner = sources.get(key);
  if (!owner) return;
  if (Number.isFinite(Number(envelope.source_cursor))) {
    owner.selector.cursor = Math.max(
      Number(owner.selector.cursor || 0),
      Number(envelope.source_cursor),
    );
  }
  if (envelope.source_kind === 'execution') {
    const revision = envelope.event === 'projection_snapshot'
      ? Number(envelope.payload?.revision)
      : envelope.event === 'projection_delta'
        ? Number(envelope.payload?.target_revision)
        : Number.NaN;
    if (Number.isFinite(revision)) {
      owner.selector.revision = Math.max(Number(owner.selector.revision || 0), revision);
    }
  }
  for (const callbacks of owner.consumers.values()) callbacks.envelope(envelope);
}

function openPhysical(expected: LiveSubscription) {
  cancelReconnectTimer();
  closePhysical();
  const generation = physicalGeneration;
  if (typeof EventSource === 'undefined') {
    physical.state = 'offline';
    return;
  }
  physical.state = physical.reconnectCount ? 'reconnecting' : 'connecting';
  const next = new EventSource(expected.stream_url);
  stream = next;
  physicalConnectionCount.value = 1;
  next.onopen = () => {
    if (stream !== next || generation !== physicalGeneration) return;
    // EventSource owns transient network recovery. Once the same physical
    // connection reopens, its pending application-level rebuild is stale.
    cancelReconnectTimer(generation);
    physical.state = 'connected';
    physical.error = '';
    for (const owner of sources.values()) {
      for (const callbacks of owner.consumers.values()) callbacks.open?.();
    }
  };
  const consumeEnvelope = (envelope: LiveEnvelope) => {
    if (envelope.schema_version !== 1 || envelope.subscription_id !== expected.id) {
      notifyError('Gateway live stream identity or revision mismatch');
      scheduleRecreate();
      return;
    }
    const currentRevision = Number(subscription?.revision || 0);
    if (envelope.subscription_revision < currentRevision) return;
    if (envelope.subscription_revision > currentRevision) {
      if (
        subscriptionMutationInFlight
        && envelope.subscription_revision === currentRevision + 1
      ) {
        if (pendingAcknowledgementEnvelopes.length >= 1_024) {
          notifyError('Gateway live acknowledgement buffer exceeded its safety bound');
          scheduleRecreate();
          return;
        }
        pendingAcknowledgementEnvelopes.push(envelope);
        return;
      }
      notifyError('Gateway live stream advanced beyond the acknowledged subscription revision');
      scheduleRecreate();
      return;
    }
    physical.lastEventAtMs = Date.now();
    if (
      envelope.event === 'subscription.ready'
      || envelope.event === 'subscription.revision.changed'
    ) {
      readyRevision = envelope.subscription_revision;
      subscriptionHealth.state = 'ready';
      subscriptionHealth.revision = readyRevision;
      subscriptionHealth.error = '';
      physical.state = 'connected';
      const pending = pendingRevisionEnvelopes;
      pendingRevisionEnvelopes = [];
      for (const queued of pending) {
        if (queued.subscription_revision === readyRevision) deliverEnvelope(queued);
      }
      return;
    }
    if (
      envelope.source_kind === 'subscription'
      && envelope.source_health === 'resync_required'
    ) {
      notifyError(String(envelope.payload?.reason || 'Gateway requested subscription resync'));
      scheduleRecreate();
      return;
    }
    const canPrecedeBarrier = envelope.source_health === 'baseline'
      || envelope.source_health === 'revoked'
      || envelope.source_health === 'resync_required';
    if (readyRevision !== envelope.subscription_revision && !canPrecedeBarrier) {
      if (pendingRevisionEnvelopes.length >= 1_024) {
        notifyError('Gateway live revision barrier buffer exceeded its safety bound');
        scheduleRecreate();
        return;
      }
      pendingRevisionEnvelopes.push(envelope);
      return;
    }
    deliverEnvelope(envelope);
  };
  activeEnvelopeConsumer = consumeEnvelope;
  const handleLiveEvent = (event: MessageEvent) => {
    if (stream !== next || generation !== physicalGeneration) return;
    let envelope: LiveEnvelope;
    try {
      envelope = parseLiveEnvelope(event.data);
    } catch {
      notifyError('Gateway live stream emitted invalid JSON');
      scheduleRecreate();
      return;
    }
    consumeEnvelope(envelope);
  };
  next.addEventListener('live', handleLiveEvent as EventListener);
  next.onerror = () => {
    if (stream !== next || generation !== physicalGeneration) return;
    physical.state = 'reconnecting';
    physical.reconnectCount += 1;
    // A physical transport interruption is owned and recovered here. Logical
    // source consumers remain attached and must not start competing reconnects.
    scheduleRecreate(generation);
  };
}

function scheduleRecreate(generation = physicalGeneration) {
  if (reconnectTimer && reconnectTimerGeneration === generation) return;
  cancelReconnectTimer();
  reconnectTimerGeneration = generation;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectTimerGeneration = 0;
    if (generation !== physicalGeneration) return;
    closePhysical();
    pendingDelete = subscription;
    subscription = null;
    readyRevision = 0;
    pendingRevisionEnvelopes = [];
    pendingAcknowledgementEnvelopes = [];
    physical.subscriptionId = '';
    physical.revision = 0;
    subscriptionHealth.state = 'syncing';
    subscriptionHealth.revision = 0;
    syncedGeneration = 0;
    requestSync();
  }, 5_000);
}

async function synchronize() {
  while (syncedGeneration !== syncGeneration) {
    const targetGeneration = syncGeneration;
    const selected = selectorPayload();
    if (!selected.length) {
      closePhysical();
      if (subscription) {
        try {
          await api.deleteLiveSubscription(subscription.id);
        } catch {
          // The server may already have expired a disconnected subscription.
        }
      }
      subscription = null;
      readyRevision = 0;
      pendingRevisionEnvelopes = [];
      physical.subscriptionId = '';
      physical.revision = 0;
      physical.state = 'offline';
      subscriptionHealth.state = 'offline';
      subscriptionHealth.revision = 0;
      subscriptionHealth.error = '';
      sourceHealth.clear();
      syncedGeneration = targetGeneration;
      continue;
    }
    try {
      subscriptionHealth.state = 'syncing';
      const observerId = await claimWebuiObserverId();
      const surfaceInstance = `${observerId}:tab:${TAB_NONCE}`;
      if (!subscription && pendingDelete) {
        const stale = pendingDelete;
        try {
          await api.deleteLiveSubscription(stale.id);
          pendingDelete = null;
        } catch (error) {
          if (error instanceof ApiWriteError && [404, 410].includes(error.status)) {
            pendingDelete = null;
          } else {
            throw error;
          }
        }
      }
      const previousRevision = subscription?.revision || 0;
      subscriptionMutationInFlight = true;
      const response: any = subscription
        ? await api.patchLiveSubscription(subscription.id, {
          expected_revision: subscription.revision,
          idempotency_key: `webui-live-patch:${subscription.id}:${subscription.revision}`,
          selector: { sources: selected },
        }, surfaceInstance)
        : await api.createLiveSubscription(liveCreateRequest(surfaceInstance, selected), surfaceInstance);
      if (response?.__state && response.__state !== 'ready') {
        throw new Error(String(response.__error || response.__state));
      }
      const changedIdentity = !subscription || subscription.id !== String(response.id);
      pendingCreate = null;
      subscription = {
        id: String(response.id),
        revision: Number(response.revision),
        selector_hash: String(response.selector_hash || ''),
        stream_url: String(response.stream_url),
      };
      physical.subscriptionId = subscription.id;
      physical.revision = subscription.revision;
      physical.selectorHash = subscription.selector_hash;
      subscriptionMutationInFlight = false;
      if (previousRevision !== subscription.revision) {
        readyRevision = 0;
        pendingRevisionEnvelopes = [];
        subscriptionHealth.revision = subscription.revision;
      }
      const acknowledged = pendingAcknowledgementEnvelopes;
      pendingAcknowledgementEnvelopes = [];
      for (const envelope of acknowledged) activeEnvelopeConsumer?.(envelope);
      syncedGeneration = targetGeneration;
      if (changedIdentity || !stream) openPhysical(subscription);
    } catch (error) {
      subscriptionMutationInFlight = false;
      pendingAcknowledgementEnvelopes = [];
      physical.state = 'degraded';
      notifyError(error instanceof Error ? error.message : String(error));
      scheduleRecreate();
      return;
    }
  }
}

function requestSync() {
  syncGeneration += 1;
  if (syncFlight) return;
  syncFlight = synchronize().finally(() => {
    syncFlight = null;
    if (syncedGeneration !== syncGeneration && !reconnectTimer) requestSync();
  });
}

export function openLiveSource(
  selector: LiveSourceSelector,
  callbacks: SourceCallbacks,
): LiveSourceLease {
  const normalized = normalizedSelector(selector);
  const key = sourceKey(normalized);
  const consumerId = randomId();
  const owner = sources.get(key) || {
    selector: normalized,
    consumers: new Map<string, SourceCallbacks>(),
  };
  mergedSelector(owner, normalized);
  owner.consumers.set(consumerId, callbacks);
  sources.set(key, owner);
  requestSync();
  return {
    close: () => {
      const current = sources.get(key);
      current?.consumers.delete(consumerId);
      if (current && current.consumers.size === 0) sources.delete(key);
      requestSync();
    },
    update: (next) => {
      const current = sources.get(key);
      if (!current) return;
      mergedSelector(current, normalizedSelector(next));
      requestSync();
    },
  };
}

export function openSessionLiveSource(
  sessionId: string,
  cursor: number,
): SessionLiveSource {
  let adapter: SessionLiveSource;
  const lease = openLiveSource(
    {
      kind: 'session',
      id: sessionId,
      cursor,
      detail_scope: 'summary',
    },
    {
      open: () => adapter.onopen?.(),
      error: () => adapter.onerror?.(new Event('error')),
      envelope: (envelope) => {
        let payload = envelope.payload;
        if (
          payload
          && typeof payload === 'object'
          && !Array.isArray(payload)
          && typeof payload.session_id !== 'string'
        ) {
          payload = {
            ...payload,
            session_id: envelope.source_id,
          };
        }
        if (envelope.event === 'source.authorization_revoked') {
          scheduleAuthorizationRecovery(String(envelope.payload?.reason || ''));
          payload = {
            type: 'SessionAuthorizationRevoked',
            session_id: sessionId,
            reason: envelope.payload?.reason,
          };
        } else if (envelope.source_health === 'resync_required') {
          payload = {
            type: 'session_stream_resync',
            session_id: sessionId,
            runtime_commit_cursor: envelope.source_cursor,
            reason: envelope.payload?.reason,
          };
        }
        adapter.onmessage?.(
          new MessageEvent('message', { data: JSON.stringify(payload) }),
        );
      },
    },
  );
  adapter = {
    ...lease,
    onopen: null,
    onerror: null,
    onmessage: null,
  };
  return adapter;
}

export function liveTransportHealth() {
  return {
    physical,
    subscription: subscriptionHealth,
    sources: sourceHealth,
    physicalConnectionCount,
    sourceCount: () => sources.size,
  };
}

export function resetLiveTransportForTests() {
  if (import.meta.env.MODE !== 'test') return;
  cancelReconnectTimer();
  closePhysical();
  sources.clear();
  subscription = null;
  syncGeneration = 0;
  syncedGeneration = 0;
  syncFlight = null;
  pendingDelete = null;
  pendingCreate = null;
  subscriptionMutationInFlight = false;
  pendingAcknowledgementEnvelopes = [];
  activeEnvelopeConsumer = null;
  readyRevision = 0;
  pendingRevisionEnvelopes = [];
  physicalGeneration = 0;
  physical.state = 'offline';
  physical.subscriptionId = '';
  physical.revision = 0;
  physical.selectorHash = '';
  physical.lastEventAtMs = 0;
  physical.reconnectCount = 0;
  physical.error = '';
  subscriptionHealth.state = 'offline';
  subscriptionHealth.revision = 0;
  subscriptionHealth.error = '';
  sourceHealth.clear();
}
