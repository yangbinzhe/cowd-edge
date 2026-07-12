import { t } from '../index';

const statusKeys: Record<string, string> = {
  active: 'status.active',
  accepted: 'status.accepted',
  allowed: 'status.allowed',
  approved: 'status.approved',
  attached: 'status.attached',
  blocked: 'status.blocked',
  builtin: 'status.builtin',
  candidate: 'status.candidate',
  cancel_requested: 'status.cancelRequested',
  cancelled: 'status.cancelled',
  closed: 'status.closed',
  complete: 'status.complete',
  completed: 'status.complete',
  degraded: 'status.degraded',
  denied: 'status.denied',
  declared: 'status.declared',
  dead_letter: 'status.deadLetter',
  disabled: 'status.disabled',
  done: 'status.done',
  empty: 'status.empty',
  error: 'status.error',
  events_visible: 'status.eventsVisible',
  fail: 'status.failed',
  failed: 'status.failed',
  forbidden: 'status.forbidden',
  high: 'status.high',
  indexed: 'status.indexed',
  info: 'status.info',
  idle: 'status.idle',
  invalid: 'status.invalid',
  invalid_response: 'status.invalidResponse',
  missing: 'status.missing',
  missing_resources: 'status.missingResources',
  missing_routes: 'status.missingRoutes',
  no_events: 'status.noEvents',
  not_found: 'status.notFound',
  not_tested: 'status.notTested',
  observed: 'status.observed',
  offline: 'status.offline',
  ok: 'status.ok',
  open: 'status.open',
  optional: 'status.optional',
  pass: 'status.pass',
  pending: 'status.pending',
  planned: 'status.planned',
  processing: 'status.processing',
  policy: 'status.policy',
  present: 'status.present',
  preflight: 'status.preflight',
  queued: 'status.queued',
  ready: 'status.ready',
  received: 'status.received',
  recorded: 'status.recorded',
  required: 'status.required',
  reports: 'status.reports',
  retry_scheduled: 'status.retryScheduled',
  reply_retry_scheduled: 'status.replyRetryScheduled',
  replying: 'status.replying',
  safe: 'status.safe',
  sending: 'status.sending',
  spa: 'status.spa',
  static: 'status.static',
  stored: 'status.stored',
  loading: 'status.loading',
  running: 'status.running',
  seen: 'status.seen',
  server_error: 'status.serverError',
  stale: 'status.stale',
  streaming: 'status.streaming',
  unsupported: 'status.unsupported',
  usage: 'status.usage',
  warning: 'status.warning',
  warn: 'status.warning',
  unknown: 'status.unknown',
  valid: 'status.valid',
  waiting: 'status.waiting',
  low: 'status.low',
  medium: 'status.medium',
};

export function statusKeyFor(value: unknown): string {
  const normalized = String(value ?? 'unknown').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return statusKeys[normalized] || 'status.unknownWithValue';
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
