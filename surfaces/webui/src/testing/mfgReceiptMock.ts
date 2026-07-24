const MFG_INTENT_STORAGE_KEY = 'cowd.webui.mfg.mutation-intents.v1';

type StoredMfgIntent = {
  intent_id: string;
  action_id: string;
  resource_ref: string;
  expected_revision?: number;
  idempotency_key: string;
  correlation_id: string;
  payload_digest: string;
};

function storedIntentFor(idempotencyKey: string): StoredMfgIntent {
  const stored = JSON.parse(
    sessionStorage.getItem(MFG_INTENT_STORAGE_KEY) || '[]',
  ) as StoredMfgIntent[];
  const intent = stored.find((candidate) => (
    candidate.idempotency_key === idempotencyKey
  ));
  if (!intent) {
    throw new Error(
      `test MFG response has no persisted intent for ${idempotencyKey}`,
    );
  }
  return intent;
}

/**
 * Build the same receipt-identity envelope enforced at the real Gateway/APP
 * boundary. Tests calling governed MFG writes must not bypass the production
 * header/body identity check with a generic JSON response.
 */
export function canonicalMfgMutationResponse(
  init?: RequestInit,
  fallback: Record<string, unknown> = { kind: 'test.receipt' },
): Response {
  const requestHeaders = new Headers(init?.headers);
  const idempotencyKey = requestHeaders.get('Idempotency-Key')?.trim() || '';
  if (!idempotencyKey) {
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const intent = storedIntentFor(idempotencyKey);
  const receiptId = `test-receipt:${intent.intent_id}`;
  const receipt = {
    receipt_id: receiptId,
    idempotency_key: intent.idempotency_key,
    action_id: intent.action_id,
    actor_principal: 'test:webui',
    resource_ref: intent.resource_ref,
    expected_revision: intent.expected_revision ?? null,
    payload_digest: intent.payload_digest,
    correlation_id: intent.correlation_id,
    status: 'succeeded',
    idempotent_replay: false,
  };
  return new Response(JSON.stringify({ ...fallback, receipt }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Cowd-Receipt-Id': receiptId,
      'X-Cowd-Correlation-Id': intent.correlation_id,
    },
  });
}
