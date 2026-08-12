import { describe, expect, it } from 'vitest';
import type { ChatTurn } from '../types';
import { blockedRecoveryForTurn, blockingFacts, parseStructuredReport } from './blockedRecovery';

function turn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: 't1',
    role: 'assistant',
    content: '',
    ...overrides,
  } as ChatTurn;
}

describe('blockedRecoveryForTurn', () => {
  it('renders from structured recovery_hints in the runtime receipt', () => {
    const receipt = JSON.stringify({
      status: 'blocked',
      decision: {
        reason: 'proposal exceeds parallel agent ceiling',
        recovery_hints: [
          { code: 'reduce_parallelism', message: 'Reduce parallel agents below the ceiling', retryable: true },
        ],
      },
    });
    const facts = blockedRecoveryForTurn(turn({ content: receipt }));
    expect(facts).not.toBeNull();
    expect(facts?.kind).toBe('blocked');
    expect(facts?.recoveryHints).toContain('Reduce parallel agents below the ceiling');
    expect(facts?.retryable).toBe(true);
  });

  it('renders from a structured failure block in durable message blocks', () => {
    const facts = blockedRecoveryForTurn(turn({
      content: 'plain prose must not trigger the card',
      blocks: [{
        type: 'failure',
        failure_kind: 'approval_skip_not_allowed_for_write',
        reason: 'skip denied',
        recovery_hints: ['Re-approve with a write-scoped grant'],
      }],
    }));
    expect(facts?.kind).toBe('approval_skip_not_allowed_for_write');
    expect(facts?.recoveryHints).toContain('Re-approve with a write-scoped grant');
  });

  it('does not render for plain prose even when it contains the word blocked', () => {
    expect(blockedRecoveryForTurn(turn({
      content: 'The execution was blocked by a transient error, please retry.',
    }))).toBeNull();
    expect(blockedRecoveryForTurn(turn({
      submission_error: 'live subscription count exceeded for this principal',
    }))).toBeNull();
  });

  it('handles fenced JSON receipts', () => {
    const fenced = '```json\n{"status":"error","failure_kind":"semantic_compile_failed","reason":"compile failed"}\n```';
    const facts = blockedRecoveryForTurn(turn({ content: fenced }));
    expect(facts?.kind).toBe('semantic_compile_failed');
    expect(facts?.reason).toContain('compile failed');
  });
});

describe('parseStructuredReport', () => {
  it('parses bare JSON, fenced JSON, and embedded JSON', () => {
    expect(parseStructuredReport('{"a":1}')).toMatchObject({ a: 1 });
    expect(parseStructuredReport('```json\n{"b":2}\n```')).toMatchObject({ b: 2 });
    expect(parseStructuredReport('prefix {"c":3} suffix')).toMatchObject({ c: 3 });
    expect(parseStructuredReport('no json here')).toBeNull();
  });
});

describe('blockingFacts', () => {
  it('deduplicates and normalizes hints', () => {
    const facts = blockingFacts('write', 'reason', [
      { message: 'hint one' },
      { code: 'hint-two', message: 'hint two' },
      '',
    ], false);
    expect(facts.recoveryHints).toEqual(['hint one', 'hint two']);
    expect(facts.retryable).toBe(false);
  });
});
