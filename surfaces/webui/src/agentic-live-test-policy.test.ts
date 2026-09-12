import { describe, expect, it } from 'vitest';
import { mayCancelFailedOwnedRun } from '../agentic-live-test-policy';

describe('live Agentic test cleanup ownership', () => {
  const admission = { sessionId: 'new-session', executionId: 'admitted-graph' };
  it.each(['', 'running', 'waiting', 'completed', 'failed'])('never cancels a resumed goal (%s)', (observedStatus) => {
    expect(mayCancelFailedOwnedRun({ resumeSessionId: 'original-session', admission, observedStatus })).toBe(false);
  });
  it.each([undefined, {}, { sessionId: 'new-session' }, { executionId: 'admitted-graph' }])('does not infer ownership before admission (%j)', (unbound) => {
    expect(mayCancelFailedOwnedRun({ admission: unbound })).toBe(false);
  });
  it.each(['complete', 'completed', 'failed', 'error', 'cancelled', 'blocked', 'COMPLETED'])('does not cancel after terminal %s', (observedStatus) => {
    expect(mayCancelFailedOwnedRun({ admission, observedStatus })).toBe(false);
  });
  it.each(['', 'running', 'waiting'])('cleans up its own admitted active run (%s)', (observedStatus) => {
    expect(mayCancelFailedOwnedRun({ admission, observedStatus })).toBe(true);
  });
});
