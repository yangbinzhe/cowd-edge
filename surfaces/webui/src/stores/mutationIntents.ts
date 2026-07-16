import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  MfgApiErrorV1,
  MfgMutationIntent,
  MfgMutationIntentStatus,
  MfgMutationRisk,
} from '../types/mfg';

const STORAGE_KEY = 'cowd.webui.mfg.mutation-intents.v1';
export const MFG_RETRY_SAME_INTENT_ACTION = 'retry_same_intent' as const;
const TERMINAL = new Set<MfgMutationIntentStatus>([
  'replayed',
  'succeeded',
  'conflict',
  'forbidden',
  'failed',
  'cancelled',
]);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function digestPayload(value: unknown) {
  const input = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function nonce() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadIntents(): MfgMutationIntent[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.intent_id === 'string');
  } catch {
    return [];
  }
}

const intentState = ref<MfgMutationIntent[]>(loadIntents());

function persist() {
  if (typeof sessionStorage === 'undefined') return;
  const recoverable = intentState.value
    .filter((intent) => !TERMINAL.has(intent.status) || intent.status === 'conflict')
    .map((intent) => intent.risk === 'high'
      ? { ...intent, receipt: undefined, error: intent.error ? { ...intent.error, details: null } : null }
      : intent);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(recoverable));
}

function replace(intent: MfgMutationIntent) {
  const index = intentState.value.findIndex((item) => item.intent_id === intent.intent_id);
  if (index >= 0) intentState.value.splice(index, 1, intent);
  else intentState.value.unshift(intent);
  persist();
  return intent;
}

export function createMfgMutationIntent(
  actionId: string,
  resourceRef: string,
  payload: unknown,
  options: { expectedRevision?: number; risk?: MfgMutationRisk } = {},
) {
  const createdAt = new Date().toISOString();
  const payloadDigest = digestPayload(payload);
  const recoverable = intentState.value.find((intent) => (
    ['draft', 'submitting', 'pending'].includes(intent.status)
    && intent.action_id === actionId
    && intent.resource_ref === resourceRef
    && intent.payload_digest === payloadDigest
    && intent.expected_revision === options.expectedRevision
  ));
  if (recoverable) return recoverable;
  const id = nonce();
  return replace({
    intent_id: `mfg-intent:${id}`,
    action_id: actionId,
    resource_ref: resourceRef,
    expected_revision: options.expectedRevision,
    idempotency_key: `webui-mfg:${actionId}:${id}`,
    payload_digest: payloadDigest,
    risk: options.risk || 'medium',
    status: 'draft',
    error: null,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

export function updateMfgMutationIntent(
  intent: MfgMutationIntent,
  patch: Partial<Pick<MfgMutationIntent, 'status' | 'error' | 'receipt'>>,
) {
  return replace({
    ...intent,
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

export function classifyMfgIntentFailure(status: number, retryable = false): MfgMutationIntentStatus {
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (retryable || status === 0 || status === 429 || status >= 500) return 'pending';
  return 'failed';
}

export function mutationIntentSnapshot() {
  return [...intentState.value];
}

export function resetMfgMutationIntents() {
  intentState.value = [];
  persist();
}

export const useMutationIntentsStore = defineStore('mfg-mutation-intents', () => {
  const intents = intentState;
  const pending = computed(() => intents.value.filter((intent) => !TERMINAL.has(intent.status)));
  const latest = computed(() => intents.value[0] || null);

  function begin(
    actionId: string,
    resourceRef: string,
    payload: unknown,
    options: { expectedRevision?: number; risk?: MfgMutationRisk } = {},
  ) {
    return createMfgMutationIntent(actionId, resourceRef, payload, options);
  }

  function clearTerminal() {
    intents.value = intents.value.filter((intent) => !TERMINAL.has(intent.status));
    persist();
  }

  function cancel(intent: MfgMutationIntent) {
    updateMfgMutationIntent(intent, { status: 'cancelled' });
  }

  function fail(intent: MfgMutationIntent, error: MfgApiErrorV1) {
    updateMfgMutationIntent(intent, {
      status: classifyMfgIntentFailure(error.http_status, error.retryable),
      error,
    });
  }

  return { intents, pending, latest, begin, clearTerminal, cancel, fail };
});
