import type {
  ActivityEvent,
  ExecutionActivityProjection,
  ExecutionActivityDetailProjection,
  ExecutionActivityRelation,
  ExecutionProjection,
} from '../types';
import { t } from '../i18n';

const TERMINAL = new Set([
  'complete',
  'completed',
  'completed_with_warnings',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
  'rejected',
  'error',
]);
const ATTENTION = new Set(['failed', 'blocked', 'rejected', 'error', 'waiting_approval']);

export type ActivityView = ActivityEvent & {
  canonical: ExecutionActivityProjection;
  tool_summary?: ToolActivitySummary;
};

export interface ActivityTreeNode {
  activity: ActivityView;
  children: ActivityTreeNode[];
}

export interface ToolActivitySummary {
  total: number;
  executed: number;
  succeeded: number;
  failed: number;
  running: number;
  pending: number;
}

export function presentActivityDetail(
  detail: ExecutionActivityDetailProjection,
  fallback: Record<string, any>,
) {
  const input = activityContentValue(detail.input);
  const output = activityContentValue(detail.output);
  const summary = activityContentSummary(detail.output)
    || activityContentSummary(detail.input)
    || String(detail.activity?.result_summary || detail.activity?.public_summary || fallback.detail || '');
  return {
    ...fallback,
    detail: summary,
    input,
    output,
    raw: {
      activity: detail.activity,
      relations: detail.relations,
      related_entities: detail.related_entities,
      input: detail.input,
      output: detail.output,
    },
  };
}

export function activityDisplaySummary(item: Record<string, any>) {
  const value = item.result_summary
    || item.detail
    || item.summary
    || item.message
    || item.output
    || '';
  return compactStructuredSummary(value);
}

export function activityEvidenceReferenceCount(item: Record<string, any>) {
  const raw = (item.raw || {}) as Record<string, any>;
  const direct = [
    ...(Array.isArray(item.evidence_refs) ? item.evidence_refs : []),
    ...(Array.isArray(raw.evidence_refs) ? raw.evidence_refs : []),
    raw.full_output_ref,
    raw.output_ref,
  ];
  const typed = [
    ...(Array.isArray(item.refs) ? item.refs : []),
    ...(Array.isArray(raw.refs) ? raw.refs : []),
  ].flatMap((reference: any) => {
    if (typeof reference === 'string') {
      return /^(?:evidence|tool|memory|matrix|audit):\/\//.test(reference)
        ? [reference]
        : [];
    }
    const kind = String(reference?.type || reference?.kind || '').toLowerCase();
    return kind.includes('evidence')
      || ['tool_output', 'memory', 'matrix', 'audit'].includes(kind)
      ? [reference?.ref || reference?.id]
      : [];
  });
  return new Set([...direct, ...typed].map(String).filter(Boolean)).size;
}

export function compactStructuredSummary(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return structuredValueSummary(value);
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^(?:\{|\[)/.test(text)) {
    try {
      return structuredValueSummary(JSON.parse(text));
    } catch {
      return t('component.workbench.timeline.structuredDetail');
    }
  }
  const starts = [text.indexOf(' {'), text.indexOf(' [')].filter((index) => index >= 0);
  const jsonStart = starts.length ? Math.min(...starts) : -1;
  return jsonStart >= 0 ? text.slice(0, jsonStart) : text;
}

function activityContentValue(content: any) {
  if (!content) return null;
  return content.structured ?? content.summary ?? content.content_ref ?? null;
}

function activityContentSummary(content: any) {
  if (!content) return '';
  return String(content.summary || compactStructuredSummary(content.structured) || '').trim();
}

function structuredValueSummary(value: any): string {
  if (Array.isArray(value)) {
    return t('component.workbench.timeline.items', { count: value.length });
  }
  if (!value || typeof value !== 'object') return String(value || '');
  for (const key of [
    'summary',
    'message',
    'error',
    'result_summary',
    'output_preview',
    'outcome',
    'result',
    'decision',
    'status',
  ]) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return t('component.workbench.timeline.fields', { count: Object.keys(value).length });
}

export function canonicalActivityEvents(
  projections: Array<ExecutionProjection | null>,
  visibility?: 'narrative' | 'operational' | 'audit',
): ActivityView[] {
  const rows = new Map<string, ExecutionActivityProjection>();
  for (const projection of projections) {
    for (const activity of projection?.activities || []) {
      if (visibility && !activity.visibility.includes(visibility)) continue;
      const previous = rows.get(activity.activity_id);
      if (
        previous
        && Number(previous.commit_cursor || 0) > Number(activity.commit_cursor || 0)
      ) continue;
      rows.set(activity.activity_id, activity);
    }
  }
  return [...rows.values()]
    .sort(compareActivities)
    .map(activityView);
}

export function canonicalActivityRelations(
  projections: Array<ExecutionProjection | null>,
): ExecutionActivityRelation[] {
  const rows = new Map<string, ExecutionActivityRelation>();
  for (const projection of projections) {
    for (const relation of projection?.activity_relations || []) {
      rows.set(relation.relation_id, relation);
    }
  }
  return [...rows.values()].sort((left, right) => (
    left.relation_id.localeCompare(right.relation_id)
  ));
}

export function activityTree(
  activities: ActivityView[],
  relations: ExecutionActivityRelation[],
): ActivityTreeNode[] {
  const nodes = new Map<string, ActivityTreeNode>(
    activities.map((activity) => [
      activity.id,
      { activity, children: [] } satisfies ActivityTreeNode,
    ]),
  );
  const relationParents = new Map<string, string>();
  for (const relation of relations) {
    if (!['contains', 'delegated_to', 'invoked'].includes(relation.kind)) continue;
    if (!relationParents.has(relation.to_activity_id)) {
      relationParents.set(relation.to_activity_id, relation.from_activity_id);
    }
  }
  const roots: ActivityTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.activity.parent_activity_id
      || relationParents.get(node.activity.id)
      || '';
    const parent = nodes.get(parentId);
    if (parent && parent !== node && !wouldCreateCycle(nodes, parentId, node.activity.id)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (items: ActivityTreeNode[]) => {
    items.sort((left, right) => compareActivityViews(left.activity, right.activity));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

export function activityEventViews(
  events: ActivityEvent[],
  scope: {
    workspaceId?: string;
    sessionId?: string;
    turnId?: string;
    executionId?: string;
  } = {},
): ActivityView[] {
  return events.map((event, index) => {
    const startedAt = timestamp(event.at);
    const status = normalizedStatus(event.status);
    const activityId = String(event.activity_id || event.id || `activity:event:${index}`);
    const executionId = String(event.execution_id || scope.executionId || '');
    const canonical = {
      schema_version: 1,
      activity_id: activityId,
      scope: {
        workspace_id: scope.workspaceId || 'workspace',
        session_id: event.session_id || scope.sessionId || undefined,
        turn_id: event.turn_id || scope.turnId || undefined,
        execution_id: executionId,
        parent_execution_id: event.parent_execution_id || undefined,
      },
      kind: canonicalKind(event),
      display_label: event.display_label || event.title || undefined,
      phase: event.phase || undefined,
      visibility: event.visibility || ['narrative', 'operational', 'audit'],
      parent_activity_id: event.parent_activity_id || undefined,
      initiator_activity_id: event.initiator_activity_id || undefined,
      causal_parent_ids: event.causal_parent_ids || [],
      dependency_ids: event.dependency_ids || [],
      parallel_group_id: event.parallel_group_id || undefined,
      team_run_id: event.team_run_id || event.team_id || undefined,
      agent_instance_id: event.agent_instance_id || event.agent_id || undefined,
      agent_run_id: event.agent_run_id || undefined,
      skill_id: event.skill_id || undefined,
      skill_revision: event.skill_revision || undefined,
      skill_activation_id: event.skill_activation_id || undefined,
      tool_contract_id: event.tool_contract_id || undefined,
      tool_call_id: event.tool_call_id || undefined,
      approval_id: event.approval_id || undefined,
      status,
      status_reason: event.status_reason || undefined,
      required: event.required !== false,
      started_at_ms: startedAt,
      completed_at_ms: event.completed_at_ms || (
        TERMINAL.has(status) && startedAt ? startedAt + Number(event.duration_ms || 0) : undefined
      ),
      duration_ms: event.duration_ms,
      sequence: numericSequence(event.sequence, index),
      commit_cursor: Number(event.commit_cursor || 0),
      public_summary: event.title || event.detail || undefined,
      result_summary: event.result_summary || (
        typeof event.output === 'string' ? event.output : undefined
      ),
      artifact_refs: event.artifact_refs || [],
      evidence_refs: event.evidence_refs || [],
      definition_refs: event.definition_refs || [],
      detail_capability: event.detail_capability || undefined,
    } satisfies ExecutionActivityProjection;
    return {
      ...event,
      id: activityId,
      activity_id: activityId,
      status,
      at: startedAt || event.at,
      execution_id: executionId || undefined,
      turn_id: event.turn_id || scope.turnId || undefined,
      refs: event.refs || [
        ...(event.evidence_refs || []),
        ...(event.artifact_refs || []),
      ],
      canonical,
    };
  });
}

export function conversationActivityTree(
  activities: ActivityView[],
  relations: ExecutionActivityRelation[],
): ActivityTreeNode[] {
  const roots = activityTree(
    compactBusinessActivities(activities.map(localizedActivity)),
    relations,
  ).flatMap(compactConversationNode);
  sortActivityNodes(roots);
  return roots;
}

export function businessGraphActivities(activities: ActivityView[]) {
  return compactBusinessActivities(activities.map(localizedActivity))
    .filter((activity) => activity.canonical.visibility.includes('narrative'))
    .filter(isBusinessGraphActivity);
}

export function activityAutoCollapsed(activity: ActivityView) {
  if (activity.tool_summary) {
    return activity.tool_summary.running === 0
      && activity.tool_summary.pending === 0
      && activity.tool_summary.failed === 0;
  }
  const status = normalizedStatus(activity.status);
  if (!TERMINAL.has(status) || ATTENTION.has(status)) return false;
  if (activity.kind === 'tool' || activity.kind === 'tool_batch') return true;
  return activity.kind === 'agent' && Boolean(activity.artifact_refs?.length);
}

export function activityNeedsAttention(activity: ActivityView) {
  return ATTENTION.has(normalizedStatus(activity.status));
}

export function isBusinessGraphActivity(activity: ActivityView) {
  if (activity.kind === 'runtime' || activity.kind === 'context') return false;
  if (activity.kind === 'approval' && !activity.approval_id) return false;
  if (
    activity.kind === 'model'
    && (technicalModelActivity(activity) || publicReasoningModelActivity(activity))
  ) return false;
  if (['execution', 'goal', 'team', 'agent'].includes(activity.kind)) return true;
  if (internalOperationalActivity(activity)) return false;
  if (activity.kind === 'artifact' && internalArtifact(activity)) return false;
  return !internalReference([
    activity.title,
    activity.detail,
    activity.canonical.detail,
    activity.canonical.public_summary,
  ].join(' '));
}

export function normalizedStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'complete' || status === 'succeeded') return 'completed';
  return status || 'planned';
}

function activityView(activity: ExecutionActivityProjection): ActivityView {
  const status = normalizedStatus(activity.status);
  return {
    id: activity.activity_id,
    activity_id: activity.activity_id,
    kind: activity.kind,
    title: activity.display_label || activity.public_summary || activity.kind.replaceAll('_', ' '),
    display_label: activity.display_label || undefined,
    detail: activity.public_summary || '',
    result_summary: activity.result_summary || undefined,
    status_reason: activity.status_reason || undefined,
    required: activity.required !== false,
    output: activity.result_summary || undefined,
    phase: activity.phase || undefined,
    status,
    at: activity.started_at_ms || undefined,
    duration_ms: activity.duration_ms || undefined,
    refs: [...activity.evidence_refs, ...activity.artifact_refs],
    evidence_refs: activity.evidence_refs,
    artifact_refs: activity.artifact_refs,
    visibility: activity.visibility,
    execution_id: activity.scope.execution_id || undefined,
    parent_execution_id: activity.scope.parent_execution_id || undefined,
    session_id: activity.scope.session_id || undefined,
    turn_id: activity.scope.turn_id || undefined,
    team_id: activity.team_run_id || undefined,
    agent_id: activity.agent_instance_id || activity.agent_run_id || undefined,
    team_run_id: activity.team_run_id || undefined,
    agent_instance_id: activity.agent_instance_id || undefined,
    agent_run_id: activity.agent_run_id || undefined,
    skill_id: activity.skill_id || undefined,
    skill_revision: activity.skill_revision || undefined,
    skill_activation_id: activity.skill_activation_id || undefined,
    tool_contract_id: activity.tool_contract_id || undefined,
    tool_call_id: activity.tool_call_id || undefined,
    approval_id: activity.approval_id || undefined,
    parent_activity_id: activity.parent_activity_id || undefined,
    initiator_activity_id: activity.initiator_activity_id || undefined,
    causal_parent_ids: activity.causal_parent_ids,
    dependency_ids: activity.dependency_ids,
    parallel_group_id: activity.parallel_group_id || undefined,
    completed_at_ms: activity.completed_at_ms || undefined,
    commit_cursor: activity.commit_cursor,
    sequence: activity.sequence,
    detail_capability: activity.detail_capability || undefined,
    raw: {
      activity_id: activity.activity_id,
      scope: activity.scope,
      relation: {
        parent_activity_id: activity.parent_activity_id,
        initiator_activity_id: activity.initiator_activity_id,
        causal_parent_ids: activity.causal_parent_ids,
        dependency_ids: activity.dependency_ids,
        parallel_group_id: activity.parallel_group_id,
      },
      artifact_refs: activity.artifact_refs,
      evidence_refs: activity.evidence_refs,
      definition_refs: activity.definition_refs,
      identity: {
        node_id: activity.node_id,
        team_run_id: activity.team_run_id,
        agent_instance_id: activity.agent_instance_id,
        agent_run_id: activity.agent_run_id,
        skill_id: activity.skill_id,
        skill_revision: activity.skill_revision,
        skill_activation_id: activity.skill_activation_id,
        tool_contract_id: activity.tool_contract_id,
        tool_call_id: activity.tool_call_id,
      },
      display_label: activity.display_label,
      phase: activity.phase,
      result_summary: activity.result_summary,
      status_reason: activity.status_reason,
      required: activity.required,
      detail_capability: activity.detail_capability,
    },
    canonical: activity,
  };
}

function canonicalKind(event: ActivityEvent): ExecutionActivityProjection['kind'] {
  if (event.kind === 'think') return 'model';
  if (event.kind === 'context' || event.kind === 'error') return 'runtime';
  return event.kind;
}

function localizedActivity(activity: ActivityView): ActivityView {
  const rawTitle = String(activity.title || activity.detail || '').trim();
  const title = businessTitle(activity, rawTitle);
  const rawDetail = String(activity.detail || '').trim();
  const detail = humanizeActivityDetail(activity, rawDetail);
  return {
    ...activity,
    title,
    detail: (
      detail
      && !internalReference(detail)
      && !(title !== rawTitle && detail === rawTitle)
    ) ? detail : '',
  };
}

function humanizeActivityDetail(activity: ActivityView, detail: string) {
  if (activity.kind !== 'agent') return detail;
  return detail.replace(
    /\b(agent\s+)?([a-z][a-z0-9]*?)[_-](\d+)\b/gi,
    (_match, prefix: string | undefined, role: string, ordinal: string) => (
      `${prefix || ''}${role} ${ordinal}`
    ),
  );
}

function businessTitle(activity: ActivityView, rawTitle: string) {
  const lowered = `${activity.id} ${rawTitle}`.toLowerCase();
  const explicit = String(activity.canonical.display_label || '').trim();
  if (activity.kind === 'execution' || activity.kind === 'goal') {
    return containsCjk(rawTitle) && !internalReference(rawTitle)
      ? rawTitle
      : t('execution.goal');
  }
  if (activity.kind === 'team') return t('execution.kind.team');
  if (activity.kind === 'agent') {
    const role = String(
      activity.role
      || activity.agent_instance_id
      || activity.agent_run_id
      || activity.agent_id
      || '',
    ).toLowerCase();
    if (role.includes('research')) return t('execution.agentRole.researcher');
    if (role.includes('synth')) return t('execution.agentRole.synthesizer');
    if (role.includes('primary')) return t('execution.agentRole.primary');
    return t('execution.kind.agentTask');
  }
  if (activity.kind === 'model') {
    return lowered.includes('synth')
      ? t('execution.kind.synthesize')
      : t('execution.kind.model');
  }
  if (activity.kind === 'tool_batch') return t('execution.kind.toolBatch');
  if (activity.kind === 'tool') return rawTitle || t('execution.kind.toolCall');
  if (activity.kind === 'think') return t('chat.activity.thinking');
  if (activity.kind === 'approval') return t('execution.kind.approval');
  if (activity.kind === 'verify') return t('execution.kind.verify');
  if (activity.kind === 'artifact') return t('execution.kind.artifact');
  if (activity.kind === 'outcome') return t('execution.kind.outcome');
  if (activity.kind === 'replan') return t('execution.kind.replan');
  if (activity.kind === 'recovery') return t('execution.kind.recovery');
  if (activity.kind === 'error') return t('execution.kind.error');
  if (explicit && !internalReference(explicit) && !protocolIdentifier(explicit)) {
    return humanizeIdentifier(explicit);
  }
  return rawTitle || String(activity.kind).replaceAll('_', ' ');
}

function compactConversationNode(node: ActivityTreeNode): ActivityTreeNode[] {
  const activity = node.activity;
  if (isToolActivity(activity)) return [];
  if (activity.kind === 'tool_batch') {
    const tools = deduplicatedTools(node.children.map((child) => child.activity));
    const children = node.children
      .filter((child) => !isToolActivity(child.activity))
      .flatMap(compactConversationNode);
    children.push(...tools.map((tool) => ({ activity: tool, children: [] })));
    sortActivityNodes(children);
    return isBusinessGraphActivity(activity) ? [{ activity, children }] : children;
  }
  const tools = deduplicatedTools(node.children.map((child) => child.activity));
  const children = node.children
    .filter((child) => !isToolActivity(child.activity))
    .flatMap(compactConversationNode);
  if (tools.length) children.push(toolGroupNode(tools, activity.id));
  if (!isBusinessGraphActivity(activity)) return children;
  sortActivityNodes(children);
  return [{ activity, children }];
}

function compactBusinessActivities(activities: ActivityView[]) {
  const approvals = new Map<string, ActivityView>();
  const rows: ActivityView[] = [];
  for (const activity of activities) {
    if (activity.kind !== 'approval' || !activity.approval_id) {
      rows.push(activity);
      continue;
    }
    const previous = approvals.get(activity.approval_id);
    if (!previous || activityFreshness(activity) >= activityFreshness(previous)) {
      approvals.set(activity.approval_id, activity);
    }
  }
  return [...rows, ...approvals.values()].sort(compareActivityViews);
}

function deduplicatedTools(activities: ActivityView[]) {
  const tools = new Map<string, ActivityView>();
  for (const activity of activities) {
    if (!isToolActivity(activity) || !isBusinessGraphActivity(activity)) continue;
    const key = String(activity.tool_call_id || activity.id);
    const previous = tools.get(key);
    if (!previous || activityFreshness(activity) >= activityFreshness(previous)) {
      tools.set(key, activity.kind === 'error'
        ? { ...activity, kind: 'tool', status: 'failed' }
        : activity);
    }
  }
  return [...tools.values()].sort(compareActivityViews);
}

function toolGroupNode(tools: ActivityView[], parentActivityId: string): ActivityTreeNode {
  const summary = toolSummary(tools);
  const first = tools[0].canonical;
  const starts = tools.map((tool) => timestamp(tool.at)).filter((value) => value > 0);
  const completions = tools
    .map((tool) => Number(tool.completed_at_ms || 0))
    .filter((value) => value > 0);
  const startedAt = starts.length ? Math.min(...starts) : undefined;
  const completedAt = summary.running === 0 && completions.length
    ? Math.max(...completions)
    : undefined;
  const status = summary.failed > 0
    ? 'failed'
    : summary.running > 0
      ? 'running'
      : summary.pending > 0
        ? 'planned'
        : 'completed';
  const canonical = {
    ...first,
    activity_id: `activity:view:tool-group:${parentActivityId}`,
    kind: 'tool_batch',
    parent_activity_id: parentActivityId,
    initiator_activity_id: parentActivityId,
    causal_parent_ids: [],
    dependency_ids: [],
    parallel_group_id: undefined,
    tool_contract_id: undefined,
    tool_call_id: undefined,
    status,
    started_at_ms: startedAt,
    completed_at_ms: completedAt,
    duration_ms: startedAt && completedAt ? completedAt - startedAt : undefined,
    sequence: Math.min(...tools.map((tool) => Number(tool.canonical.sequence || 0))),
    commit_cursor: Math.max(...tools.map((tool) => Number(tool.commit_cursor || 0))),
    public_summary: t('execution.kind.toolBatch'),
    artifact_refs: Array.from(new Set(tools.flatMap((tool) => tool.artifact_refs || []))),
    evidence_refs: Array.from(new Set(tools.flatMap((tool) => tool.evidence_refs || []))),
    definition_refs: Array.from(new Set(tools.flatMap(
      (tool) => tool.canonical.definition_refs || [],
    ))),
    detail_capability: undefined,
  } satisfies ExecutionActivityProjection;
  const activity: ActivityView = {
    id: canonical.activity_id,
    activity_id: canonical.activity_id,
    kind: 'tool_batch',
    title: t('execution.kind.toolBatch'),
    detail: '',
    status,
    at: startedAt,
    completed_at_ms: completedAt,
    duration_ms: canonical.duration_ms,
    turn_id: canonical.scope.turn_id || undefined,
    execution_id: canonical.scope.execution_id,
    parent_activity_id: parentActivityId,
    evidence_refs: canonical.evidence_refs,
    artifact_refs: canonical.artifact_refs,
    refs: [...canonical.evidence_refs, ...canonical.artifact_refs],
    commit_cursor: canonical.commit_cursor,
    sequence: canonical.sequence,
    raw: { aggregate: summary },
    canonical,
    tool_summary: summary,
  };
  return {
    activity,
    children: tools.map((tool) => ({ activity: tool, children: [] })),
  };
}

function toolSummary(tools: ActivityView[]): ToolActivitySummary {
  let executed = 0;
  let succeeded = 0;
  let failed = 0;
  let running = 0;
  for (const tool of tools) {
    const status = normalizedStatus(tool.status);
    if (status === 'completed') {
      executed += 1;
      succeeded += 1;
    } else if (ATTENTION.has(status) || ['cancelled', 'denied'].includes(status)) {
      executed += 1;
      failed += 1;
    } else if (['running', 'started', 'starting'].includes(status)) {
      executed += 1;
      running += 1;
    }
  }
  return {
    total: tools.length,
    executed,
    succeeded,
    failed,
    running,
    pending: Math.max(0, tools.length - executed),
  };
}

function isToolActivity(activity: ActivityView) {
  return activity.kind === 'tool' || Boolean(activity.tool_call_id);
}

function protocolIdentifier(value: string) {
  return /^(?:runtime|provider|authorization|context|projection|session|execution)\.[a-z0-9_.:-]+$/i
    .test(value);
}

function humanizeIdentifier(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function internalArtifact(activity: ActivityView) {
  const value = [
    activity.title,
    activity.detail,
    activity.canonical.public_summary,
    ...(activity.artifact_refs || []),
  ].join(' ').toLowerCase();
  return internalReference(value);
}

function technicalModelActivity(activity: ActivityView) {
  const value = `${activity.id} ${activity.canonical.public_summary || ''}`.toLowerCase();
  return value.includes('inline_model')
    || value.includes('model_step')
    || value.includes('provider.call')
    || value.includes('provider_call');
}

function publicReasoningModelActivity(activity: ActivityView) {
  const marker = [
    activity.id,
    activity.phase,
    activity.canonical.phase,
    activity.canonical.display_label,
  ].join(' ').toLowerCase();
  return marker.includes('public_reasoning')
    || marker.includes('reasoning_summary')
    || marker.includes('reasoning summary');
}

function internalOperationalActivity(activity: ActivityView) {
  const value = [
    activity.id,
    activity.title,
    activity.detail,
    activity.canonical.detail,
    activity.canonical.public_summary,
  ].join(' ').toLowerCase();
  return [
    'authorization.',
    'runtime.outcome.recorded',
    'provider intent',
    'runner applied goal intervention',
    'provider intervention',
    'provider_intervention',
    'budget decision',
    'budget_decision',
    'compile-target-guard',
    'target guard accepted',
    'session input was routed',
    'session-ingress-confirmed:',
    'lease.',
    'cache.',
    'projection.',
    'context assembled',
    'context packet',
  ].some((marker) => value.includes(marker));
}

function internalReference(value: string) {
  const normalized = value.toLowerCase();
  return normalized.includes('session-ingress-graph:')
    || normalized.includes('session-ingress-confirmed:')
    || normalized.includes(':tool-results:')
    || normalized.includes(':model-result')
    || normalized.includes('turn-result:');
}

function containsCjk(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function activityFreshness(activity: ActivityView) {
  const terminal = TERMINAL.has(normalizedStatus(activity.status)) ? 1_000_000_000 : 0;
  return terminal
    + Number(activity.commit_cursor || 0) * 1_000
    + Number(activity.canonical.sequence || 0);
}

function sortActivityNodes(nodes: ActivityTreeNode[]) {
  nodes.sort((left, right) => compareActivityViews(left.activity, right.activity));
  for (const node of nodes) sortActivityNodes(node.children);
}

function timestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function numericSequence(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  const head = Number(String(value || '').split('.')[0]);
  return Number.isFinite(head) ? head : fallback;
}

function compareActivities(
  left: ExecutionActivityProjection,
  right: ExecutionActivityProjection,
) {
  return (
    Number(left.started_at_ms || 0) - Number(right.started_at_ms || 0)
    || Number(left.commit_cursor || 0) - Number(right.commit_cursor || 0)
    || Number(left.sequence || 0) - Number(right.sequence || 0)
    || left.activity_id.localeCompare(right.activity_id)
  );
}

function compareActivityViews(left: ActivityView, right: ActivityView) {
  return compareActivities(left.canonical, right.canonical);
}

function wouldCreateCycle(
  nodes: Map<string, ActivityTreeNode>,
  parentId: string,
  childId: string,
) {
  const visited = new Set([childId]);
  let cursor = parentId;
  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = nodes.get(cursor)?.activity.parent_activity_id || '';
  }
  return false;
}
