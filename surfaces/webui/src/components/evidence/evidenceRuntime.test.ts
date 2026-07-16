import { describe, expect, it } from 'vitest';
import { evidenceBacklinks, evidenceComparison, evidenceDisplayState, evidenceSourceRoute } from './evidenceRuntime';

describe('evidence runtime presentation contracts', () => {
  it('keeps redacted, missing, expired, invalid and resolved states distinct', () => {
    expect(evidenceDisplayState({ status: 'resolved', evidence: { available: true } })).toBe('resolved');
    expect(evidenceDisplayState({ status: 'resolved', evidence: { available: true, body_policy: 'metadata_only' } })).toBe('redacted');
    expect(evidenceDisplayState({ status: 'unavailable', evidence: { available: false, reason: 'resource ref not found' } })).toBe('missing');
    expect(evidenceDisplayState({ evidence: { available: true, expires_at: '2025-01-01T00:00:00Z' } }, Date.parse('2026-01-01T00:00:00Z'))).toBe('expired');
    expect(evidenceDisplayState({ evidence: { available: true, verified: false } })).toBe('invalid');
  });

  it('derives source and typed backlinks without inventing a second evidence fact', () => {
    const item = {
      ref: 'tool://tool-7/evidence/ev-7',
      status: 'resolved',
      evidence: {
        available: true,
        session_id: 'session-7',
        event: { sequence: 12, metadata: { tool_call_id: 'tool-7' } },
        projection: { access: { visibility_scope: 'session:session-7', retrieval_selector: 'session-event://session-7/12' } },
      },
    };
    expect(evidenceSourceRoute(item)).toContain('/runtime?');
    expect(evidenceBacklinks(item).map((link) => link.kind)).toEqual(['source', 'session', 'timeline', 'retrieval']);
  });

  it('compares only normalized public evidence fields', () => {
    const rows = evidenceComparison([
      { status: 'resolved', evidence: { kind: 'tool', available: true, source: 'runtime' } },
      { status: 'unavailable', evidence: { kind: 'resource', available: false, reason: 'not found' } },
    ]);
    expect(rows.find((row) => row.field === 'state')?.values).toEqual(['resolved', 'missing']);
    expect(rows.map((row) => row.field)).not.toContain('raw');
  });
});
