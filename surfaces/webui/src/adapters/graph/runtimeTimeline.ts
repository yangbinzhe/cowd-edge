export type RuntimeTimelineDomain = 'app' | 'context' | 'surface' | 'tool' | 'runtime';

export interface RuntimeTimelineRow {
  id: string;
  sequence: string | number;
  domain: RuntimeTimelineDomain;
  scope: string;
  kind: string;
  title: string;
  status: string;
  detail: string;
  at: string | number;
  execution_id: string;
  turn_id: string;
  task_id: string;
  approval_id: string;
  tool_call_id: string;
  tool_name: string;
  recovery_id: string;
  correlation_id: string;
  refs: string[];
  correlation: string;
  route?: string;
  raw: Record<string, unknown>;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function firstText(...values: unknown[]) {
  return values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .find(Boolean) || '';
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (character) => character.toUpperCase());
}

function eventDomain(kind: string): RuntimeTimelineDomain {
  const normalized = kind.toLowerCase();
  if (normalized.startsWith('application.') || normalized.startsWith('app.')) return 'app';
  if (normalized.startsWith('context.')) return 'context';
  if (normalized.startsWith('surface.')) return 'surface';
  if (
    normalized.startsWith('tool.')
    || ['toolstart', 'toolprogress', 'toolcomplete', 'toolexecuted'].includes(normalized)
  ) return 'tool';
  return 'runtime';
}

function countResources(payload: Record<string, any>) {
  const currentItems = Array.isArray(payload.current) ? payload.current : [];
  const recentItems = Array.isArray(payload.recent) ? payload.recent : [];
  const current = currentItems.length;
  const recent = recentItems.length;
  const failed = [...currentItems, ...recentItems]
    .filter((item: any) => item?.status === 'failed').length;
  return { total: current + recent, failed };
}

function toolName(payload: Record<string, any>, event: Record<string, any>) {
  const metadata = record(payload.metadata);
  return firstText(
    event.tool_name,
    event.tool,
    event.name,
    payload.tool_name,
    payload.tool,
    payload.name,
    metadata.tool_name,
  );
}

function semanticTitle(
  domain: RuntimeTimelineDomain,
  kind: string,
  payload: Record<string, any>,
  event: Record<string, any>,
) {
  const explicit = firstText(event.title, payload.title);
  if (explicit) return explicit;

  if (domain === 'tool') {
    const name = toolName(payload, event) || 'Tool';
    const normalized = kind.toLowerCase();
    if (normalized === 'tool.execution_plan.created') return 'Tool execution plan';
    if (normalized.includes('start')) return `${name} started`;
    if (normalized.includes('progress')) return `${name} progress`;
    if (normalized.includes('denied')) return `${name} denied`;
    if (normalized.includes('fail')) return `${name} failed`;
    if (normalized.includes('complete') || normalized === 'toolexecuted') return `${name} completed`;
    return `${name} · ${humanize(kind)}`;
  }

  if (domain === 'surface') {
    const surface = firstText(payload.surface, 'Surface');
    return `${surface} · ${humanize(kind.slice('surface.'.length))}`;
  }
  if (domain === 'context') return humanize(kind);
  if (domain === 'app') return firstText(payload.domain, payload.kind, humanize(kind));
  return humanize(kind);
}

function semanticDetail(
  domain: RuntimeTimelineDomain,
  kind: string,
  payload: Record<string, any>,
  event: Record<string, any>,
) {
  const explicit = firstText(event.detail, event.summary, event.message, payload.summary, payload.detail);
  if (explicit) return explicit;

  if (domain === 'app') {
    const title = firstText(payload.title, payload.domain, payload.kind, 'Application execution');
    return `${title} · ${firstText(payload.status, event.status, 'recorded')}`;
  }

  if (domain === 'context') {
    const action = firstText(payload.action, payload.governance_decision, payload.recommendation);
    const note = firstText(payload.note, payload.reason);
    const identity = firstText(payload.report_id, payload.envelope_id, payload.checkpoint_id);
    if (action && note) return `${action}: ${note}`;
    if (action) return action;
    if (identity) return `${humanize(kind)} · ${identity}`;
    return humanize(kind);
  }

  if (domain === 'tool') {
    const category = firstText(payload.command_category);
    const output = firstText(
      payload.output_preview,
      payload.model_visible_preview,
      payload.progress,
      payload.preview,
      payload.input_preview,
      payload.error,
      payload.failure_kind,
    );
    const duration = Number(payload.duration_ms);
    const metrics = [
      Number.isFinite(duration) && duration >= 0 ? `${duration} ms` : '',
      payload.full_output_ref ? `evidence ${payload.full_output_ref}` : '',
      Number(payload.context_saved_tokens) > 0 ? `${payload.context_saved_tokens} context tokens saved` : '',
    ].filter(Boolean).join(' · ');
    return [category, output, metrics].filter(Boolean).join(' · ') || humanize(kind);
  }

  switch (kind) {
    case 'surface.message_received':
      return `Received ${firstText(payload.message_id, 'message')} from ${firstText(payload.surface, 'Surface')}: ${firstText(payload.content_preview, 'content recorded')}`;
    case 'surface.runtime_activated':
      return `${firstText(payload.surface, 'Surface')} activated Runtime Session ${firstText(payload.session_id, 'unknown')}`;
    case 'surface.resources_registered': {
      const resources = countResources(payload);
      return resources.total === 0
        ? `No resources attached to ${firstText(payload.message_id, 'message')}`
        : `${resources.total} resource${resources.total === 1 ? '' : 's'} registered${resources.failed ? `, ${resources.failed} failed` : ''}`;
    }
    case 'surface.message_accepted':
      return `${firstText(payload.surface, 'Surface')} message ${firstText(payload.message_id, '')} accepted as turn ${firstText(payload.turn_id, 'unknown')}`;
    case 'surface.message_replied':
      return payload.empty_terminal
        ? `Terminal ${firstText(payload.terminal_id, 'result')} completed without a text reply`
        : `Reply delivered for ${firstText(payload.message_id, 'message')} from terminal ${firstText(payload.terminal_id, 'result')}`;
    default:
      return firstText(payload.recommendation, payload.action, payload.status, event.status, humanize(kind));
  }
}

function semanticStatus(
  domain: RuntimeTimelineDomain,
  kind: string,
  payload: Record<string, any>,
  event: Record<string, any>,
) {
  const explicit = firstText(event.status, event.phase, payload.status);
  if (explicit) return explicit;
  const normalized = kind.toLowerCase();
  if (domain === 'tool') {
    if (normalized.includes('start') || normalized.includes('progress')) return 'running';
    if (normalized.includes('denied')) return 'denied';
    if (normalized.includes('fail')) return 'failed';
    if (normalized.includes('complete') || normalized === 'toolexecuted') return 'completed';
    if (normalized.includes('plan')) return 'planned';
  }
  if (kind === 'surface.message_received') return 'received';
  if (kind === 'surface.runtime_activated') return 'active';
  if (kind === 'surface.resources_registered') return 'registered';
  if (kind === 'surface.message_accepted') return 'accepted';
  if (kind === 'surface.message_replied') return payload.empty_terminal ? 'empty_terminal' : 'replied';
  return 'recorded';
}

function collectRefs(event: Record<string, any>, payload: Record<string, any>) {
  const refValues = [
    ...(Array.isArray(event.refs) ? event.refs : []),
    ...(Array.isArray(payload.refs) ? payload.refs : []),
    ...(Array.isArray(payload.evidence_refs) ? payload.evidence_refs : []),
  ];
  const refs = refValues
    .map((ref: any) => String(ref?.id || ref?.ref || ref?.reference || ref))
    .filter(Boolean);
  const outputRef = record(payload.output_ref);
  return Array.from(new Set([
    ...refs,
    firstText(payload.full_output_ref, outputRef.ref_id),
  ].filter(Boolean)));
}

export function adaptRuntimeTimeline(events: unknown[]): RuntimeTimelineRow[] {
  if (!Array.isArray(events)) return [];
  return events.map((value, index) => {
    const event = record(value);
    const payload = record(event.payload);
    const kind = String(event.kind || event.type || 'runtime.event');
    const domain = eventDomain(kind);
    const refs = collectRefs(event, payload);
    const executionId = String(event.execution_id || payload.execution_id || payload.graph_id || '');
    const turnId = String(event.turn_id || payload.turn_id || '');
    const taskId = String(event.task_id || payload.task_id || '');
    const approvalId = String(event.approval_id || payload.approval_id || payload.request_id || '');
    const toolCallId = String(event.tool_call_id || payload.tool_call_id || payload.call_id || payload.invocation_id || '');
    const recoveryId = String(event.recovery_id || payload.recovery_id || '');
    const correlationId = String(event.correlation_id || payload.correlation_id || '');
    const sequence = event.sequence ?? event.id ?? index;
    const route = executionId
      ? `/mission?section=overview&execution_id=${encodeURIComponent(executionId)}`
      : domain === 'tool' && toolCallId
        ? `/tools?section=ledger&tool_call_id=${encodeURIComponent(toolCallId)}`
        : undefined;
    return {
      id: String(event.event_id || event.id || `${kind}:${sequence}`),
      sequence,
      domain,
      scope: String(event.scope || domain),
      kind,
      title: semanticTitle(domain, kind, payload, event),
      status: semanticStatus(domain, kind, payload, event),
      detail: semanticDetail(domain, kind, payload, event),
      at: event.created_at_ms ?? event.created_at ?? event.timestamp ?? event.at ?? '',
      execution_id: executionId,
      turn_id: turnId,
      task_id: taskId,
      approval_id: approvalId,
      tool_call_id: toolCallId,
      tool_name: toolName(payload, event),
      recovery_id: recoveryId,
      correlation_id: correlationId,
      refs,
      correlation: [correlationId, executionId, turnId, taskId, approvalId, toolCallId, recoveryId, ...refs].filter(Boolean).join(' · '),
      route,
      raw: event,
    };
  });
}
