import { t } from '../index';

const statusKeys: Record<string, string> = {
  active: 'status.active',
  allowed: 'status.allowed',
  approved: 'status.approved',
  blocked: 'status.blocked',
  complete: 'status.complete',
  degraded: 'status.degraded',
  denied: 'status.denied',
  done: 'status.done',
  empty: 'status.empty',
  error: 'status.error',
  failed: 'status.failed',
  idle: 'status.idle',
  invalid: 'status.invalid',
  missing: 'status.missing',
  observed: 'status.observed',
  offline: 'status.offline',
  pending: 'status.pending',
  present: 'status.present',
  queued: 'status.queued',
  ready: 'status.ready',
  recorded: 'status.recorded',
  required: 'status.required',
  running: 'status.running',
  seen: 'status.seen',
  streaming: 'status.streaming',
  unsupported: 'status.unsupported',
  unknown: 'status.unknown',
};

export function statusKeyFor(value: unknown): string {
  return statusKeys[String(value ?? 'unknown').toLowerCase()] || 'status.unknownWithValue';
}

export function displayStatus(value: unknown): string {
  const raw = String(value ?? 'unknown');
  return t(statusKeyFor(raw), { value: raw });
}

export function displayBoolean(value: unknown): string {
  if (value === true || value === 'true' || value === 'yes') return t('boolean.yes');
  if (value === false || value === 'false' || value === 'no') return t('boolean.no');
  return t('status.unknownWithValue', { value: String(value ?? 'unknown') });
}
