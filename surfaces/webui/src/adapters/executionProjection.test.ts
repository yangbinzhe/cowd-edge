import { describe, expect, it } from 'vitest';
import type { ExecutionProjection, ExecutionProjectionDelta } from '../types';
import { PROJECTION_V2_GOLDEN } from '../generated/projection-v2-golden';
import {
  ProjectionDeltaError,
  reduceExecutionProjectionDelta,
} from './executionProjection';

function corpus() {
  return structuredClone(PROJECTION_V2_GOLDEN) as unknown as {
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
});
