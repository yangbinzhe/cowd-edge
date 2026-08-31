import { describe, expect, it } from 'vitest';
import type { ExecutionProjection, ExecutionProjectionDelta } from '../types';
import { PROJECTION_V3_GOLDEN } from '../generated/projection-v3-golden';
import {
  ProjectionDeltaError,
  reduceExecutionProjectionDelta,
} from './executionProjection';

function corpus() {
  return structuredClone(PROJECTION_V3_GOLDEN) as unknown as {
    initial: ExecutionProjection;
    delta: ExecutionProjectionDelta;
    expected: ExecutionProjection;
  };
}

describe('execution projection canonical reducer', () => {
  it('materializes the shared Rust/TUI/WebUI golden corpus', () => {
    const fixture = corpus();
    const reduced = reduceExecutionProjectionDelta(fixture.initial, fixture.delta);

    expect(reduced).toEqual(fixture.expected);
    expect(reduced.admissions).toHaveLength(1);
    expect(reduced.outcomes).toHaveLength(1);
    expect(reduced.evidence[0]?.payload?.type).toBe('evidence');
  });

  it('fails atomically on cursor and authority mismatch', () => {
    const fixture = corpus();
    const before = structuredClone(fixture.initial);
    const gap = structuredClone(fixture.delta);
    gap.base_cursor += 1;
    expect(() => reduceExecutionProjectionDelta(fixture.initial, gap))
      .toThrow(ProjectionDeltaError);
    expect(fixture.initial).toEqual(before);

    const recropped = structuredClone(fixture.delta);
    recropped.redaction_revision = 'sha256:different';
    expect(() => reduceExecutionProjectionDelta(fixture.initial, recropped))
      .toThrow(ProjectionDeltaError);
    expect(fixture.initial).toEqual(before);

    const wrongSchema = structuredClone(fixture.delta);
    wrongSchema.schema_version += 1;
    expect(() => reduceExecutionProjectionDelta(fixture.initial, wrongSchema))
      .toThrow(ProjectionDeltaError);

    const explicitResync = structuredClone(fixture.delta);
    explicitResync.resync_reason = 'explicit';
    expect(() => reduceExecutionProjectionDelta(fixture.initial, explicitResync))
      .toThrow(ProjectionDeltaError);
    expect(fixture.initial).toEqual(before);
  });

  it('keeps the global projection cursor separate from the graph commit cursor', () => {
    const fixture = corpus();
    const cursorOnly = structuredClone(fixture.delta);
    cursorOnly.target_revision = fixture.initial.revision;
    cursorOnly.target_cursor = fixture.initial.cursor + 4;
    cursorOnly.operations = [{
      op: 'advance_cursor',
      cursor: cursorOnly.target_cursor,
    }];

    const reduced = reduceExecutionProjectionDelta(fixture.initial, cursorOnly);
    expect(reduced.cursor).toBe(cursorOnly.target_cursor);
    expect(reduced.graph.commit_cursor).toBe(fixture.initial.graph.commit_cursor);
  });

  it('replaces delivery, presentation, and cancellation truth in one v3 operation', () => {
    const fixture = corpus();
    const delta = structuredClone(fixture.delta);
    delta.operations.splice(-1, 0, {
      op: 'set_delivery_truth',
      delivery_envelope: { envelope_id: 'envelope-v3', revision: 3, objective_id: 'objective-v3' },
      terminal_presentation: {
        presentation_id: 'presentation-v3',
        attempt_id: 'attempt-v3',
        envelope_id: 'envelope-v3',
        envelope_revision: 3,
        state: 'committed',
      },
      cancellation_receipt: {
        cancellation_id: 'cancel-v3',
        execution_id: fixture.initial.execution_id,
        status: 'cancelled',
      },
    } as any);

    const reduced = reduceExecutionProjectionDelta(fixture.initial, delta);

    expect(reduced.delivery_envelope?.envelope_id).toBe('envelope-v3');
    expect(reduced.terminal_presentation?.presentation_id).toBe('presentation-v3');
    expect(reduced.cancellation_receipt?.cancellation_id).toBe('cancel-v3');
  });

  it('replaces root, inclusive, and capacity counts atomically', () => {
    const fixture = corpus();
    const delta = structuredClone(fixture.delta);
    const concurrency = {
      root: {
        total: 2, planned: 0, ready: 1, running: 1,
        waiting_input: 0, waiting_approval: 0, waiting_external: 0,
        paused: 0, blocked: 0, terminal: 0,
      },
      inclusive: {
        total: 18, planned: 2, ready: 4, running: 12,
        waiting_input: 0, waiting_approval: 0, waiting_external: 0,
        paused: 0, blocked: 0, terminal: 0,
      },
      resources: [{
        kind: 'provider',
        effective_limit: 16,
        active_leases: 12,
        queued_waiters: 4,
        utilization_basis_points: 7_500,
        scope: 'process_global',
      }],
    };
    delta.operations.splice(-1, 0, {
      op: 'replace_concurrency',
      concurrency,
    });

    const reduced = reduceExecutionProjectionDelta(fixture.initial, delta);
    expect(reduced.concurrency).toEqual(concurrency);
  });
});
