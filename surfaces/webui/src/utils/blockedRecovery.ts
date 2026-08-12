import type { ChatTurn } from '../types';

export interface BlockedRecoveryFacts {
  kind: string;
  reason: string;
  recoveryHints: string[];
  retryable: boolean;
}

/**
 * Structured blocking-card extraction (F4). A card is rendered only when
 * durable structured facts exist (failure kind and/or recovery hints); prose
 * substring matching is deliberately not used.
 */
export function blockedRecoveryForTurn(
  turn: ChatTurn | undefined,
): BlockedRecoveryFacts | null {
  if (!turn) return null;
  // 1. Durable message blocks: a structured failure block is authoritative.
  for (const block of turn.blocks || []) {
    const record = block as Record<string, unknown>;
    const failureKind = record.failure_kind || record.failureKind;
    const recoveryHints = record.recovery_hints || record.recoveryHints;
    if (failureKind || recoveryHints) {
      return blockingFacts(
        String(failureKind || record.kind || 'blocked'),
        String(record.reason || record.message || ''),
        recoveryHints,
        record.retryable,
      );
    }
  }
  // 2. Structured runtime receipt embedded in assistant content or the
  // submission error.
  for (const candidate of [turn.content, turn.submission_error]) {
    if (!candidate) continue;
    const parsed = parseStructuredReport(String(candidate));
    if (!parsed) continue;
    const decision = parsed.decision || parsed;
    const recoveryHints = decision.recovery_hints
      || decision.recoveryHints
      || parsed.recovery_hints
      || parsed.recoveryHints;
    const failureKind = parsed.failure_kind
      || parsed.failureKind
      || decision.failure_kind
      || decision.failureKind;
    if (!recoveryHints && !failureKind) continue;
    return blockingFacts(
      String(failureKind || parsed.status || decision.status || 'blocked'),
      String(decision.reason || parsed.reason || parsed.message || ''),
      recoveryHints,
      parsed.retryable,
    );
  }
  return null;
}

export function parseStructuredReport(value: string) {
  const candidates = [value];
  const fenced = value.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const jsonStart = value.indexOf('{');
  if (jsonStart >= 0) {
    const embedded = value.slice(jsonStart);
    // Trim trailing prose after the JSON object. The scan is bounded by the
    // receipt length and stops at the first parseable object.
    for (let end = embedded.length; end > 0; end -= 1) {
      try {
        const parsed = JSON.parse(embedded.slice(0, end));
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // Keep trimming trailing characters.
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Try the next candidate representation.
    }
  }
  return null;
}

export function blockingFacts(
  kind: string,
  reason: string,
  recoveryHints: unknown,
  retryable: unknown,
): BlockedRecoveryFacts {
  const hints = Array.isArray(recoveryHints)
    ? recoveryHints
      .map((hint: any) => String(hint?.message || hint?.code || hint || '').trim())
      .filter(Boolean)
    : recoveryHints
      ? [String(recoveryHints).trim()]
      : [];
  const normalizedKind = String(kind || '').toLowerCase();
  return {
    kind: normalizedKind || 'blocked',
    reason: (reason || hints.join('；') || normalizedKind).slice(0, 320),
    recoveryHints: hints,
    retryable: retryable === true || (Array.isArray(recoveryHints)
      && recoveryHints.some((hint: any) => hint?.retryable === true)),
  };
}
