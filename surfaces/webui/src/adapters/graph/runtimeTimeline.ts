export function adaptRuntimeTimeline(events: any[]) {
  return events.map((event: any) => {
    const payload = event.payload || {};
    const refs = Array.isArray(event.refs)
      ? event.refs.map((ref: any) => String(ref.id || ref.ref || ref)).filter(Boolean)
      : [];
    const executionId = String(event.execution_id || payload.execution_id || payload.graph_id || '');
    const turnId = String(event.turn_id || payload.turn_id || '');
    const taskId = String(event.task_id || payload.task_id || '');
    const approvalId = String(event.approval_id || payload.approval_id || payload.request_id || '');
    const toolCallId = String(event.tool_call_id || payload.tool_call_id || payload.call_id || '');
    const recoveryId = String(event.recovery_id || payload.recovery_id || '');
    return {
      sequence: event.sequence ?? event.id ?? '-',
      scope: event.scope || event.kind || event.type || '-',
      kind: event.kind || event.type || '-',
      status: event.status || event.phase || payload.status || '-',
      detail: event.detail || event.summary || event.message || payload.summary || payload.detail || '-',
      execution_id: executionId,
      turn_id: turnId,
      task_id: taskId,
      approval_id: approvalId,
      tool_call_id: toolCallId,
      recovery_id: recoveryId,
      refs,
      correlation: [executionId, turnId, taskId, approvalId, toolCallId, recoveryId, ...refs].filter(Boolean).join(' · '),
      route: executionId ? `/mission?section=overview&execution_id=${encodeURIComponent(executionId)}` : undefined,
      raw: event,
    };
  });
}
