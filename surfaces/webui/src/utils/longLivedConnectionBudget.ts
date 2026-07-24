type LiveConnectionLease = {
  key: string;
  priority: number;
  requestedAt: number;
  acquiredAt: number;
  onPreempt: () => void;
  onGranted?: () => void;
};

// Browsers commonly limit HTTP/1.1 to six sockets per origin. Four live
// observers leave two sockets available for navigation, cancellation and
// ordinary API traffic. Chat, projections and APPs all participate in the
// same scheduler, so a released APP lease can wake a deferred projection.
export const MAX_LIVE_CONNECTIONS = 4;
export const MAX_NON_CHAT_LIVE_CONNECTIONS = MAX_LIVE_CONNECTIONS;

const leases = new Map<string, LiveConnectionLease>();
const waiters = new Map<string, LiveConnectionLease>();
let sequence = 0;
let grantScheduled = false;
let rebalancing = false;

function orderedWaiters() {
  return [...waiters.values()].sort((left, right) => (
    right.priority - left.priority || left.requestedAt - right.requestedAt
  ));
}

function drainWaiters() {
  grantScheduled = false;
  while (leases.size < MAX_LIVE_CONNECTIONS) {
    const next = orderedWaiters()[0];
    if (!next) return;
    waiters.delete(next.key);
    next.acquiredAt = ++sequence;
    leases.set(next.key, next);
    if (next.onGranted) queueMicrotask(next.onGranted);
  }
}

function scheduleGrant() {
  if (grantScheduled || rebalancing) return;
  grantScheduled = true;
  queueMicrotask(drainWaiters);
}

export function acquireLongLivedConnection(
  key: string,
  priority: number,
  onPreempt: () => void,
  onGranted?: () => void,
) {
  const active = leases.get(key);
  if (active) {
    active.priority = priority;
    active.onPreempt = onPreempt;
    active.onGranted = onGranted;
    return true;
  }
  const queued = waiters.get(key);
  let candidate: LiveConnectionLease;
  if (queued) {
    waiters.delete(key);
    queued.priority = priority;
    queued.onPreempt = onPreempt;
    queued.onGranted = onGranted;
    candidate = queued;
  } else {
    candidate = {
      key,
      priority,
      requestedAt: ++sequence,
      acquiredAt: 0,
      onPreempt,
      onGranted,
    };
  }
  if (leases.size >= MAX_LIVE_CONNECTIONS) {
    const victim = [...leases.values()]
      .filter((lease) => lease.priority < priority)
      .sort((left, right) => (
        left.priority - right.priority || left.acquiredAt - right.acquiredAt
      ))[0];
    if (!victim) {
      waiters.set(key, candidate);
      return false;
    }
    rebalancing = true;
    leases.delete(victim.key);
    try {
      victim.onPreempt();
    } finally {
      rebalancing = false;
    }
    if (victim.onGranted) {
      victim.requestedAt = ++sequence;
      victim.acquiredAt = 0;
      waiters.set(victim.key, victim);
    }
  }
  candidate.acquiredAt = ++sequence;
  leases.set(key, candidate);
  scheduleGrant();
  return true;
}

export function updateLongLivedConnectionPriority(key: string, priority: number) {
  const lease = leases.get(key) || waiters.get(key);
  if (!lease) return false;
  lease.priority = priority;
  scheduleGrant();
  return true;
}

export function releaseLongLivedConnection(key: string) {
  const removed = leases.delete(key) || waiters.delete(key);
  if (removed) scheduleGrant();
}

export function activeLongLivedConnectionCount() {
  return leases.size;
}

export function queuedLongLivedConnectionCount() {
  return waiters.size;
}

export function resetLongLivedConnectionBudgetForTests() {
  leases.clear();
  waiters.clear();
  grantScheduled = false;
  rebalancing = false;
}
