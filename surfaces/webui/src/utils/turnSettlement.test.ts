import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../types';
import { mergeActivityEvent } from './turnSettlement';

describe('mergeActivityEvent', () => {
  it('preserves planned input while applying the settled output', () => {
    const planned: ActivityEvent = {
      id: 'call-1',
      kind: 'tool',
      title: 'bash',
      status: 'queued',
      input: { command: 'date +%Y' },
      raw: { phase: 'planned' },
    };
    const settled: ActivityEvent = {
      id: 'call-1',
      kind: 'tool',
      title: 'bash',
      status: 'complete',
      output: '2026',
      duration_ms: 12,
      raw: { phase: 'settled' },
    };

    expect(mergeActivityEvent(planned, settled)).toMatchObject({
      status: 'complete',
      input: { command: 'date +%Y' },
      output: '2026',
      duration_ms: 12,
      raw: { phase: 'settled' },
    });
  });
});
