// An observation failure is not authority to cancel the user's original goal.
// Cleanup applies only to a run created and admitted by this isolated test.
export function mayCancelFailedOwnedRun({ resumeSessionId, admission, observedStatus }: {
  resumeSessionId?: string;
  admission?: { sessionId?: string; executionId?: string };
  observedStatus?: string;
}) {
  if (resumeSessionId || !admission?.sessionId || !admission?.executionId) return false;
  return !['complete', 'completed', 'failed', 'error', 'cancelled', 'blocked']
    .includes(String(observedStatus || '').toLowerCase());
}
