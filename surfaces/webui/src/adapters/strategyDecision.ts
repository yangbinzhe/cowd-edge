import type {
  ExecutionProjectionEntity,
  StrategyActualProjection,
  StrategyCandidateEstimate,
  StrategyDecisionProjection,
} from '../types';
import type { GraphEdgeView, GraphNodeView, GraphViewModel } from '../types/graph';

export type StrategyEstimateMode = 'assumed' | 'calibrated' | 'unknown';
export type StrategyProofMode = 'unknown' | 'not_proven' | 'calibrated';
export type StrategyActualMode = 'running' | 'observed' | 'not_observed' | 'unavailable';

export interface StrategyTimelineItem extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
  detail: string;
  revision: number | null;
  order: number;
  href: string;
}

export interface StrategyDecisionViewModel {
  id: string;
  revision: number;
  status: string;
  summary: string;
  legacy: boolean;
  running: boolean;
  degraded: boolean;
  proofMode: StrategyProofMode;
  selectedCandidate: string;
  pattern: string;
  source: string;
  confidence: number | null;
  estimateMode: StrategyEstimateMode;
  estimated: StrategyCandidateEstimate | null;
  actualStatus: 'unknown' | 'observed';
  actualMode: StrategyActualMode;
  actual: StrategyActualProjection | null;
  why: string[];
  whyNot: string[];
  evidenceScopes: NonNullable<StrategyDecisionProjection['evidence_scopes']>;
  downgrades: NonNullable<StrategyDecisionProjection['downgrade']>;
  earlyStops: NonNullable<StrategyDecisionProjection['early_stop']>;
  policyVersion: string;
  teamId: string;
  teamExecutionId: string;
  executionId: string;
  sessionId: string;
  turnId: string;
  graph: GraphViewModel;
  timeline: StrategyTimelineItem[];
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function publicText(value: unknown) {
  const text = stringValue(value).replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (
    containsAbsolutePath(text)
    || lower.includes('../')
    || lower.includes('..\\')
    || lower.includes('prompt')
    || lower.includes('chain of thought')
    || lower.includes('reasoning')
    || lower.includes('hidden')
    || /(^|\s)[a-z]:[\\/]/i.test(text)
  ) return 'redacted by strategy surface policy';
  return text;
}

const REDACTED = 'redacted by strategy surface policy';

function normalizedEnum(value: unknown, allowed: readonly string[], fallback = 'unknown') {
  const candidate = publicText(value).toLowerCase();
  return allowed.includes(candidate) ? candidate : fallback;
}

function strategyStatus(value: unknown) {
  return normalizedEnum(value, [
    'selected', 'running', 'downgraded', 'early_stopped', 'completed',
    'complete', 'cancelled', 'failed', 'error', 'degraded',
  ]);
}

function transitionStatus(value: unknown) {
  return normalizedEnum(value, [
    'running', 'downgraded', 'early_stopped', 'completed', 'cancelled', 'failed', 'error', 'degraded',
  ]);
}

function agentStatus(value: unknown) {
  return normalizedEnum(value, [
    'planned', 'queued', 'running', 'waiting', 'waiting_external', 'completed',
    'complete', 'cancelled', 'failed', 'blocked', 'error',
  ]);
}

function proofStatus(value: unknown): StrategyProofMode {
  const status = normalizedEnum(value, ['not_proven', 'calibrated']);
  return status === 'calibrated' ? 'calibrated' : status === 'not_proven' ? 'not_proven' : 'unknown';
}

function actualStatus(value: unknown): 'unknown' | 'observed' {
  return normalizedEnum(value, ['unknown', 'observed']) === 'observed' ? 'observed' : 'unknown';
}

// Keep this aligned with Runtime's projection redaction predicate.  Legacy
// entities are untrusted compatibility input, so a strategy surface must not
// assume only workspace-root paths are sensitive (`/etc`, mounted volumes and
// Windows paths are just as disclosive as `/home`).
function containsAbsolutePath(value: string) {
  // Treat path syntax as sensitive wherever it appears, not only when a
  // whitespace token happens to start with it.  Graph payloads are searched,
  // inspected and exported, so Markdown links, CSS url(), and key:value
  // forms are just as disclosive as a bare shell path.
  return /(?:^|[\s_\-([{:=,'"`><;|&])\/(?!\/)[^\s\])}>,'"`]*/.test(value)
    || /(?:^|[\s_\-([{:=,'"`><;|&])[a-z]:[\\/]/i.test(value)
    || /file:/i.test(value);
}

function publicReference(value: unknown) {
  const reference = stringValue(value).trim();
  const lower = reference.toLowerCase();
  if (
    !reference
    || reference.length > 256
    || /\s/.test(reference)
    || reference.startsWith('/')
    || reference.startsWith('\\')
    || reference.includes('../')
    || reference.includes('..\\')
    || containsAbsolutePath(reference)
    || lower.startsWith('file:')
    || lower.includes('/home/')
    || lower.includes('/media/')
    || lower.includes('/tmp/')
    || /^[a-z]:[\\/]/i.test(reference)
  ) return '';
  return reference;
}

// Graph IDs and route correlation keys are opaque identifiers, never
// workspace paths.  Reject any path separator rather than trying to preserve
// a partial value such as `agent-/etc/shadow`; those values flow into graph
// inspector/export data even when a node label is otherwise redacted.
function publicIdentifier(value: unknown) {
  const identifier = stringValue(value).trim();
  if (!identifier) return '';
  if (
    identifier.length > 256
    || /\s/.test(identifier)
    || /[\\/]/.test(identifier)
    || identifier.includes('../')
    || identifier.includes('..\\')
    || containsAbsolutePath(identifier)
  ) return REDACTED;
  return publicText(identifier) || REDACTED;
}

function safeArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function route(path: string, query: Record<string, string>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function resolveMfgRuntimeExecutionId(
  receiptPayload: unknown,
  workspaceData: unknown,
) {
  const receipt = (receiptPayload || {}) as any;
  const data = (workspaceData || {}) as any;
  const candidates = [
    receipt?.cross_plane_execution_receipt?.execution_graph_id,
    receipt?.execution?.receipt?.cross_plane_execution_receipt?.execution_graph_id,
    receipt?.skill_run?.runtime_execution_ref,
    data?.skillRun?.skill_run?.runtime_execution_ref,
    data?.skillRun?.runtime_execution_ref,
    data?.actionLoop?.after?.runtime_execution_ref,
    data?.actionLoop?.after?.execution?.runtime_execution_ref,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  if (typeof value !== 'string') return '';
  return publicReference(value.trim().replace(/^runtime-execution:\/\//, ''));
}

export function adaptStrategyDecision(
  projection: StrategyDecisionProjection | null | undefined,
  fallbackExecutionId = '',
  agents: ExecutionProjectionEntity[] = [],
): StrategyDecisionViewModel | null {
  if (!projection) return null;

  // Strategy data is received from a compatibility boundary.  Every string
  // that is rendered, indexed by the graph, or exported must cross the same
  // public-text policy; sanitizing only the visible summary still leaks via
  // graph IDs, links, search, inspector subject, and JSON export.
  const decisionId = publicIdentifier(projection.decision_id);
  const selectedCandidate = normalizedEnum(projection.selected_candidate, ['direct', 'parallel_tools', 'team']);
  const executionId = publicIdentifier(projection.execution_id || fallbackExecutionId);
  const sessionId = publicIdentifier(projection.session_id);
  const turnId = publicIdentifier(projection.turn_id);
  const teamId = publicIdentifier(projection.team_id);
  const teamExecutionId = publicIdentifier(projection.team_execution_id);
  const status = strategyStatus(projection.status);
  const legacy = !decisionId || decisionId === REDACTED || selectedCandidate === 'unknown';
  const downgrades = safeArray(projection.downgrade).map((transition) => ({
    kind: 'runtime.strategy.downgraded' as const,
    revision: Number(transition.revision || 0),
    status: transitionStatus(transition.status),
    summary: publicText(transition.summary),
  }));
  const earlyStops = safeArray(projection.early_stop).map((transition) => ({
    kind: 'runtime.strategy.early_stopped' as const,
    revision: Number(transition.revision || 0),
    status: transitionStatus(transition.status),
    summary: publicText(transition.summary),
  }));
  const evidenceScopes = safeArray(projection.evidence_scopes).map((scope) => ({
    role_id: publicIdentifier(scope.role_id),
    focus_id: publicIdentifier(scope.focus_id),
    responsibility_summary: publicText(scope.responsibility_summary),
    capability_cropped_refs: legacy
      ? []
      : safeArray(scope.capability_cropped_refs).map(publicReference).filter(Boolean),
    scope_hash: publicIdentifier(scope.scope_hash),
    overlap_budget_bp: Number(scope.overlap_budget_bp || 0),
    novelty_target_bp: Number(scope.novelty_target_bp || 0),
  }));
  const estimated = projection.estimated || null;
  const actual = projection.actual
    ? { ...projection.actual, terminal_reason: publicText(projection.actual.terminal_reason) }
    : null;
  const observedStatus = actualStatus(projection.actual_status);
  const running = observedStatus === 'unknown'
    && !['complete', 'completed', 'cancelled', 'failed', 'error'].includes(status.toLowerCase());
  const degraded = downgrades.length > 0
    || earlyStops.length > 0
    || ['degraded', 'downgraded', 'early_stopped'].includes(status.toLowerCase());
  const estimateMode: StrategyEstimateMode = !estimated
    ? 'unknown'
    : estimated.assumed
      ? 'assumed'
      : 'calibrated';
  const proofMode = proofStatus(projection.proof_status);
  const projectionKind = normalizedEnum(projection.kind, ['strategy_decision']);
  const pattern = normalizedEnum(
    projection.selected_pattern,
    ['direct', 'explore', 'execute', 'deliberate', 'collaborate', 'supervise'],
  );
  const source = normalizedEnum(
    projection.source,
    ['deterministic', 'model_validated', 'experience_adapted', 'resource_adapted'],
  );
  const actualMode: StrategyActualMode = actual
    ? 'observed'
    : legacy
      ? 'unavailable'
      : observedStatus === 'observed'
        ? 'unavailable'
        : running
          ? 'running'
          : 'not_observed';
  const runtimeHref = route('/runtime', {
    section: 'runs',
    execution_id: executionId,
    decision_id: decisionId,
    session_id: sessionId,
  });
  const evidenceHref = (reference: string) => route('/reality', {
    section: 'evidence',
    focus: reference,
    session_id: sessionId,
  });
  const teamHref = route('/mission', {
    section: 'teams',
    team_id: teamId,
    execution_id: teamExecutionId || executionId,
  });
  const publicEvidenceRefs = legacy
    ? []
    : safeArray(projection.evidence_refs).map(publicReference).filter(Boolean);
  const publicDecisionRaw: Record<string, unknown> = {
    schema_version: projection.schema_version,
    id: publicIdentifier(projection.id),
    kind: projectionKind,
    revision: projection.revision,
    status,
    summary: publicText(projection.summary),
    decision_id: decisionId || null,
    execution_id: executionId || null,
    session_id: sessionId || null,
    turn_id: turnId || null,
    selected_candidate: selectedCandidate || null,
    selected_pattern: pattern || null,
    policy_version: publicText(projection.policy_version) || null,
    source: source || null,
    confidence: typeof projection.confidence === 'number' ? projection.confidence : null,
    proof_status: proofMode,
    actual_status: observedStatus,
  };

  const nodes: GraphNodeView[] = [{
    id: decisionId || publicIdentifier(projection.id),
    type: 'strategy-decision',
    label: selectedCandidate || 'unknown',
    status: legacy ? 'unknown' : status,
    group: 'decision',
    summary: publicText(projection.summary) || pattern || publicIdentifier(projection.id),
    evidenceRefs: publicEvidenceRefs,
    correlationRefs: [executionId, sessionId, turnId].filter(Boolean),
    href: runtimeHref,
    badges: [
      pattern,
      estimateMode,
      proofMode,
    ].filter(Boolean),
    raw: publicDecisionRaw,
  }];
  const edges: GraphEdgeView[] = [];
  const decisionNodeId = nodes[0]!.id;

  evidenceScopes.forEach((scope, index) => {
    const id = `scope:${scope.role_id}:${scope.focus_id}:${index}`;
    nodes.push({
      id: publicIdentifier(id),
      type: 'evidence-scope',
      label: `${scope.role_id} · ${scope.focus_id}`,
      status: scope.capability_cropped_refs.length ? 'scoped' : 'unavailable',
      group: 'evidence',
      summary: scope.responsibility_summary,
      evidenceRefs: scope.capability_cropped_refs,
      correlationRefs: [scope.scope_hash],
      href: scope.capability_cropped_refs[0]
        ? evidenceHref(scope.capability_cropped_refs[0])
        : runtimeHref,
      badges: [
        `overlap≤${scope.overlap_budget_bp}bp`,
        `novelty≥${scope.novelty_target_bp}bp`,
      ],
      raw: scope as unknown as Record<string, unknown>,
    });
    edges.push({
      id: `${decisionNodeId}->${publicIdentifier(id)}`,
      source: decisionNodeId,
      target: publicIdentifier(id),
      type: 'scopes',
      label: 'scopes',
      evidenceRefs: scope.capability_cropped_refs,
    });
  });

  let teamNodeId = '';
  if ((teamId || teamExecutionId) && teamId !== REDACTED && teamExecutionId !== REDACTED) {
    const id = teamId || `team-execution:${teamExecutionId}`;
    teamNodeId = publicIdentifier(id);
    nodes.push({
      id: teamNodeId,
      type: 'team',
      label: teamId || teamExecutionId,
      status,
      group: 'team',
      summary: teamExecutionId || executionId,
      correlationRefs: [teamId, teamExecutionId, executionId].filter(Boolean),
      href: teamHref,
    });
    edges.push({
      id: `${decisionNodeId}->${teamNodeId}`,
      source: decisionNodeId,
      target: teamNodeId,
      type: 'selected-team',
      label: 'selected team',
    });
  }

  agents
    .filter((agent) => {
      if (!teamExecutionId || !agent.detail || typeof agent.detail !== 'object' || Array.isArray(agent.detail)) return false;
      return publicIdentifier((agent.detail as Record<string, unknown>).graph_id) === teamExecutionId;
    })
    .forEach((agent) => {
      const agentId = publicIdentifier(agent.id);
      const agentKind = normalizedEnum(agent.kind, ['agent']);
      const id = `agent:${agentId}`;
      nodes.push({
        id,
        type: 'agent',
        label: agentId,
        status: agentStatus(agent.status),
        group: 'agent',
        summary: publicText(agent.summary) || agentKind,
        evidenceRefs: safeArray(agent.evidence_refs).map(publicReference).filter(Boolean),
        correlationRefs: [agentId, teamId, teamExecutionId].filter(Boolean),
        href: route('/mission', {
          section: 'agents',
          agent_id: agentId,
          execution_id: executionId,
        }),
        raw: {
          id: agentId,
          kind: agentKind,
          revision: agent.revision,
          status: agentStatus(agent.status),
          summary: publicText(agent.summary),
          graph_id: teamExecutionId,
        },
      });
      edges.push({
        id: `${teamNodeId || decisionNodeId}->${id}`,
        source: teamNodeId || decisionNodeId,
        target: id,
        type: 'delegates',
        label: 'delegates',
        evidenceRefs: safeArray(agent.evidence_refs).map(publicReference).filter(Boolean),
      });
    });

  if (actual) {
    const id = `outcome:${decisionId || publicIdentifier(projection.id)}`;
    nodes.push({
      id,
      type: 'strategy-outcome',
      label: actual.terminal_reason || 'observed outcome',
      status: observedStatus,
      group: 'outcome',
      summary: `${actual.duration_ms}ms · ${actual.tool_calls} tool calls`,
      evidenceRefs: publicEvidenceRefs,
      correlationRefs: [executionId, decisionId].filter(Boolean),
      href: runtimeHref,
      raw: {
        duration_ms: actual.duration_ms,
        input_tokens: actual.input_tokens,
        output_tokens: actual.output_tokens,
        cached_tokens: actual.cached_tokens,
        tool_calls: actual.tool_calls,
        duplicate_tool_calls: actual.duplicate_tool_calls,
        max_tool_concurrency_observed: actual.max_tool_concurrency_observed,
        parallel_tool_batches: actual.parallel_tool_batches,
        evidence_overlap_bp: actual.evidence_overlap_bp,
        evidence_overlap_observed: actual.evidence_overlap_observed,
        working_state_verified: actual.working_state_verified,
        merge_cost_ms: actual.merge_cost_ms,
        parent_merge_count: actual.parent_merge_count,
        quality_score_bp: actual.quality_score_bp,
        actual_speedup_ratio_bp: actual.actual_speedup_ratio_bp,
        terminal_reason: publicText(actual.terminal_reason),
      },
    });
    edges.push({
      id: `${decisionNodeId}->${id}`,
      source: decisionNodeId,
      target: id,
      type: 'observed-outcome',
      label: 'observed outcome',
    });
  }

  const timeline: StrategyTimelineItem[] = [{
    id: `selected:${decisionId || publicIdentifier(projection.id)}`,
    title: 'strategy selected',
    status: legacy ? 'unknown' : 'selected',
    detail: selectedCandidate
      ? `${selectedCandidate} · ${pattern || 'unknown'} · exact revision unavailable`
      : 'legacy projection · typed selection unavailable',
    revision: null,
    order: 0,
    href: runtimeHref,
  }];
  downgrades.forEach((transition) => timeline.push({
    id: `downgrade:${transition.revision}`,
    title: 'strategy downgraded',
    status: transition.status,
    detail: transition.summary,
    revision: transition.revision,
    order: transition.revision,
    href: runtimeHref,
  }));
  earlyStops.forEach((transition) => timeline.push({
    id: `early-stop:${transition.revision}`,
    title: 'strategy lane stopped',
    status: transition.status,
    detail: transition.summary,
    revision: transition.revision,
    order: transition.revision,
    href: runtimeHref,
  }));
  if (actual) {
    timeline.push({
      id: `outcome:${decisionId || publicIdentifier(projection.id)}`,
      title: 'strategy outcome observed',
      status: observedStatus,
      detail: `${actual.duration_ms}ms · ${actual.tool_calls} tool calls · ${actual.terminal_reason}`,
      revision: Number(projection.revision || 0),
      order: Number(projection.revision || 0),
      href: runtimeHref,
    });
  }
  timeline.sort((left, right) => left.order - right.order);

  return {
    id: decisionId || publicIdentifier(projection.id),
    revision: Number(projection.revision || 0),
    status,
    summary: publicText(projection.summary),
    legacy,
    running,
    degraded,
    proofMode,
    selectedCandidate: selectedCandidate || 'unknown',
    pattern: pattern || 'unknown',
    source: source || 'unknown',
    confidence: typeof projection.confidence === 'number' ? projection.confidence : null,
    estimateMode,
    estimated,
    actualStatus: observedStatus,
    actualMode,
    actual,
    why: safeArray(projection.benefit_reason).map(publicText),
    whyNot: safeArray(projection.cost_reason).map(publicText),
    evidenceScopes,
    downgrades,
    earlyStops,
    policyVersion: publicText(projection.policy_version) || 'unknown',
    teamId,
    teamExecutionId,
    executionId,
    sessionId,
    turnId,
    graph: {
      id: `strategy:${decisionId || publicIdentifier(projection.id)}`,
      title: 'Strategy decision graph',
      revision: Number(projection.revision || 0),
      status: legacy ? 'unknown' : status,
      nodes,
      edges,
    },
    timeline,
  };
}
