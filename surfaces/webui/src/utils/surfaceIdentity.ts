/**
 * Single source of truth for Surface identity derivation (P8).
 *
 * The writer lease stays on the plain observer id (`x-cowd-observer-id`),
 * while every live subscription uses `observerId:tab:<nonce>` so parallel
 * tabs never share one subscription counter. All new live APIs must build
 * their surface instance through this helper and send the same value as the
 * observer header to satisfy the Gateway header/body binding.
 */
const TAB_NONCE = (() => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
})();

export function liveTabNonce(): string {
  return TAB_NONCE;
}

export function buildLiveSurfaceInstance(observerId: string): string {
  return `${observerId}:tab:${TAB_NONCE}`;
}

export function isLiveSurfaceInstance(value: string): boolean {
  return typeof value === 'string' && /:tab:[^:]+$/.test(value);
}
