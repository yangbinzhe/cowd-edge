import type { Component } from 'vue';
import type { components as GatewayComponents } from './generated/gateway-api';

export type CoreNavId = 'chat' | 'mission' | 'runtime' | 'context' | 'reality' | 'memory' | 'skills' | 'agents' | 'tools' | 'surfaces' | 'gateway' | 'audit' | 'settings';
export type NavId = CoreNavId | (string & {});
export type CompanionTab = 'activity' | 'workspace' | 'inspector';
export type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';
export type ApiReadStatus = 'ready' | 'offline' | 'timeout' | 'forbidden' | 'not_found' | 'invalid_response' | 'server_error' | 'error' | 'stale';

export interface ApiReadState {
  __state?: ApiReadStatus;
  __error?: string;
  __http_status?: number;
  __refreshed_at?: string;
  __last_success_at?: string;
}

export interface NavItem {
  id: NavId;
  label: string;
  labelKey?: string;
  route: string;
  icon: Component;
  group: string;
}

export interface SessionSummary {
  id: string;
  title?: string;
  model?: string;
  status?: string;
  active_stream_id?: string | null;
  pending_user_message?: string | null;
  is_streaming?: boolean;
  pinned?: boolean;
  parent_session_id?: string;
  branch_count?: number;
  updated_at?: number | string;
  created_at?: number | string;
  snippet?: string;
  summary?: string;
  first_message?: string;
  message_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  execution?: SessionExecutionIndexProjection;
}

export type BranchSessionReceipt = GatewayComponents['schemas']['BranchSessionReceipt'];
export type MissionCommand = GatewayComponents['schemas']['MissionCommand'];
export type MissionCommandResponse = GatewayComponents['schemas']['MissionCommandResponse'];
export type MissionControlProjection = GatewayComponents['schemas']['MissionControlProjection'];
export type MissionControlResponse = GatewayComponents['schemas']['MissionControlResponse'];
export type ApprovalPendingResponse = GatewayComponents['schemas']['ApprovalPendingResponse'];
export type ApprovalPendingItem = ApprovalPendingResponse['pending'][number];
export type SessionExecutionPolicyResponse = GatewayComponents['schemas']['SessionExecutionPolicyResponse'] & ApiReadState;

/// M-01/M-04: lightweight mission summary envelope. The full typed
/// MissionMaterializedSnapshot stays on the main route; this is the small
/// payload for first-panel consumers that do not need the full graph.
export interface MissionControlSummaryEnvelope {
  ok: boolean;
  summary: {
    mission_id?: string;
    cursor: number;
    revision: number;
    graph: {
      available: boolean;
      node_count: number;
      edge_count: number;
      hash: string;
    };
    projection: Record<string, unknown>;
  };
}
export type MissionMaterializedSnapshot = GatewayComponents['schemas']['MissionMaterializedSnapshot'];
export type MissionProjectionDelta = GatewayComponents['schemas']['MissionProjectionDelta'];
export type SessionHistoryIndexProjection = GatewayComponents['schemas']['SessionHistoryIndexProjection'];

export type SessionRoutingFocusProjection = GatewayComponents['schemas']['SessionRoutingFocus'];
export type TaskFocusProjection = GatewayComponents['schemas']['TaskFocusProjection'];
export type MissionFocusProjection = GatewayComponents['schemas']['MissionFocusProjection'];
export type TaskTurnBindingProjection = GatewayComponents['schemas']['TaskTurnBinding'];
export type TaskAggregateProjection = GatewayComponents['schemas']['TaskAggregate'];
export type TaskDetailProjection = GatewayComponents['schemas']['TaskDetailResponse'];
export type MissionOrganizationDecisionProjection = GatewayComponents['schemas']['MissionOrganizationDecision'];

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  status?: 'streaming' | 'complete' | 'error';
  submission_error?: string;
  activity?: ActivityEvent[];
  activity_open?: boolean;
  blocks?: Array<Record<string, unknown>>;
  sequence?: number;
  created_at_ms?: number;
  tool_use_id?: string;
  tool_name?: string;
  tool_output?: string;
  tool_error?: boolean;
  token_usage?: Record<string, unknown>;
  execution_id?: string;
  turn_id?: string;
  ingress_message_id?: string;
  /// C-02: durable SessionInput id bound to this user message. Badge status
  /// lookup must use this id, never content matching.
  input_id?: string;
  presentation_id?: string;
  presentation_attempt_id?: string;
  answer_origin?: AnswerOrigin;
  preview?: boolean;
}

export interface ActivityEvent {
  id: string;
  kind: 'execution' | 'goal' | 'team' | 'agent' | 'skill' | 'model' | 'reasoning' | 'tool_batch' | 'tool'
    | 'think' | 'runtime' | 'context' | 'approval' | 'verify' | 'artifact' | 'outcome'
    | 'replan' | 'recovery' | 'error';
  title: string;
  display_label?: string;
  detail?: string;
  result_summary?: string;
  status_reason?: string;
  required?: boolean;
  status?: string;
  phase?: string;
  role?: string;
  at?: string | number;
  domain?: string;
  event_kind?: string;
  sequence?: string | number;
  route?: string;
  correlation?: string;
  refs?: string[];
  duration_ms?: number;
  input?: unknown;
  output?: unknown;
  raw?: Record<string, unknown>;
  session_id?: string;
  execution_id?: string;
  parent_execution_id?: string;
  graph_id?: string;
  node_id?: string;
  team_id?: string;
  agent_id?: string;
  team_run_id?: string;
  agent_instance_id?: string;
  agent_run_id?: string;
  skill_id?: string;
  skill_revision?: string;
  skill_activation_id?: string;
  tool_contract_id?: string;
  turn_id?: string;
  model_step_id?: string;
  item_id?: string;
  segment_id?: string;
  tool_call_id?: string;
  causal_sequence?: number;
  delta_sequence?: number;
  causal_parent_ids?: string[];
  commit_cursor?: number;
  wave?: number;
  lane?: number;
  lane_count?: number;
  agent_lane?: number;
  agent_lane_count?: number;
  agent_lane_label?: string;
  activity_id?: string;
  activity_binding?: Record<string, unknown>;
  parent_activity_id?: string;
  initiator_activity_id?: string;
  dependency_ids?: string[];
  parallel_group_id?: string;
  approval_id?: string;
  artifact_refs?: string[];
  evidence_refs?: string[];
  definition_refs?: string[];
  visibility?: Array<'narrative' | 'operational' | 'audit'>;
  completed_at_ms?: number;
  detail_capability?: string;
}

export type ExecutionScopeProjection = GatewayComponents['schemas']['ExecutionScopeProjection'];
export type ExecutionActivityProjection = GatewayComponents['schemas']['ExecutionActivityProjection'] & {
  display_label?: string | null;
  phase?: string | null;
  result_summary?: string | null;
  status_reason?: string | null;
  required?: boolean;
};
export type ExecutionActivityRelation = GatewayComponents['schemas']['ExecutionActivityRelation'];
export type ExecutionActivityContentProjection = GatewayComponents['schemas']['ExecutionActivityContentProjection'];
export type ExecutionActivityDetailProjection = GatewayComponents['schemas']['ExecutionActivityDetailProjection'];

export type ExecutionProjectionEntity = GatewayComponents['schemas']['ExecutionProjectionEntity'];
export type StrategyDecisionProjection = GatewayComponents['schemas']['StrategyDecisionProjection'];
export type StrategyCandidateEstimate = GatewayComponents['schemas']['ExecutionCandidateEstimate'];
export type StrategyActualProjection = GatewayComponents['schemas']['StrategyActualProjection'];
export type ExecutionLiveStatus = 'queued' | 'preparing_context' | 'calling_model' | 'thinking' | 'calling_tool' | 'waiting_approval' | 'finalizing' | 'complete' | 'cancelled' | 'error';

export interface ContextComponentUsage {
  kind: string;
  tokens: number;
  occurrences: number;
}

export interface ContextUsageProjection {
  model?: string | null;
  window_tokens?: number | null;
  window_source?: string | null;
  input_tokens?: number | null;
  input_source?: string | null;
  remaining_tokens?: number | null;
  usage_percent_bp?: number | null;
  request_sequence?: number | null;
  components: ContextComponentUsage[];
}

export interface RunMetricsProjection {
  tool_calls: number;
  memory_recalls: number;
  memory_evidence: number;
  approvals: number;
  context_items: number;
  files_touched: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ExecutionLatencyProjection {
  total_elapsed_ms: number;
  harness_elapsed_ms: number;
  provider_wall_ms: number;
  first_token_latency_ms?: number | null;
  provider_active_stream_ms: number;
}

export interface ExecutionLiveState {
  revision: number;
  status: ExecutionLiveStatus;
  status_detail?: string | null;
  turn_id?: string | null;
  started_at_ms: number;
  updated_at_ms: number;
  last_progress_at_ms: number;
  context_usage?: ContextUsageProjection | null;
  metrics: RunMetricsProjection;
  latency: ExecutionLatencyProjection;
  output_preview?: string | null;
  output_preview_start_bytes?: number;
  output_bytes?: number;
  output_parts?: Array<{
    model_step_id: string;
    item_id: string;
    part_id: string;
    causal_sequence: number;
    completed?: boolean;
    preview?: string | null;
    preview_start_bytes?: number;
    bytes?: number;
  }>;
  terminal_ref?: string | null;
  error?: string | null;
}

export interface ExecutionLiveUpdate {
  schema_version: number;
  execution_id: string;
  live: ExecutionLiveState;
}

export interface SessionExecutionIndexProjection {
  session_id: string;
  executions: SessionExecutionEntryProjection[];
  active_execution_ids: string[];
  latest_execution_id?: string | null;
  latest_graph_id?: string | null;
  latest_status?: ExecutionLiveStatus | null;
  latest_live_revision?: number | null;
  last_progress_at_ms?: number | null;
  terminal_ref?: string | null;
}

export interface SessionExecutionEntryProjection {
  execution_id: string;
  graph_id?: string | null;
  turn_id?: string | null;
  status: ExecutionLiveStatus;
  live_revision?: number | null;
  started_at_ms?: number | null;
  updated_at_ms: number;
  terminal_ref?: string | null;
}

export type EvidenceFreshness = 'live' | 'durable' | 'unavailable';

export interface TurnEvidenceProjection {
  session_id: string;
  turn_id: string;
  input_message_id: string;
  execution_id: string;
  terminal_ref?: string | null;
  assistant_message_id?: string | null;
  context_report_id?: string | null;
  evidence_refs: string[];
  freshness: EvidenceFreshness;
}

export interface SessionEvidenceProjection {
  session_id: string;
  evidence_refs: string[];
  turns: TurnEvidenceProjection[];
  freshness: EvidenceFreshness;
}

export type PipelineStatus = 'waiting' | 'completed' | 'failed' | 'cancelled';
export type DeliveryStatus = 'satisfied' | 'partial' | 'denied' | 'unavailable';
export type DeliveryBranchStatus = 'completed' | 'failed' | 'cancelled' | 'blocked';
export type VerifiedEffectStatus = 'applied' | 'not_applied' | 'uncertain';
export type AnswerOrigin = 'model_direct' | 'terminal_delegate' | 'team_synthesizer'
  | 'terminal_narrator' | 'fallback_model' | 'programmatic_fallback'
  | 'cancellation_receipt';
export type TerminalPresentationState = 'started' | 'streaming' | 'validating'
  | 'committed' | 'aborted' | 'superseded';

export interface CancellationReceipt {
  cancellation_id: string;
  session_id: string;
  turn_id: string;
  execution_id: string;
  actor_id: string;
  cause: 'user_requested' | 'system' | 'parent' | 'deadline' | 'lease_lost';
  reason?: string | null;
  requested_at_ms: number;
  effective_at_ms?: number | null;
  status: 'requested' | 'cancelled' | 'already_terminal';
  journal_sequence: number;
  projection_revision: number;
}

export interface DeliveryCoverage {
  required_obligation_ids: string[];
  satisfied_obligation_ids: string[];
  coverage_basis_points: number;
}

export interface DeliveryUnresolved {
  unresolved_id: string;
  kind: string;
  summary: string;
  source_execution_id?: string | null;
  obligation_id?: string | null;
}

export interface DeliveryEnvelope {
  envelope_id: string;
  revision: number;
  objective_id: string;
  pipeline_status: PipelineStatus;
  delivery_status: DeliveryStatus;
  branch_terminals: Array<{
    branch_id: string;
    execution_id?: string | null;
    status: DeliveryBranchStatus;
    result_ref?: string | null;
    failure_ref?: string | null;
  }>;
  verified_receipts: Array<{
    reference_id: string;
    kind: string;
    source_execution_id?: string | null;
  }>;
  verified_artifacts: Array<{
    reference_id: string;
    kind: string;
    source_execution_id?: string | null;
  }>;
  verified_effects: Array<{
    effect_id: string;
    kind: string;
    status: VerifiedEffectStatus;
    receipt_ref?: string | null;
    source_execution_id?: string | null;
  }>;
  coverage: DeliveryCoverage;
  unresolved: DeliveryUnresolved[];
  conflicts: Array<{
    conflict_id: string;
    summary: string;
    source_execution_ids: string[];
  }>;
  cancellation?: CancellationReceipt | null;
  user_answer_contract: {
    language: string;
    format: 'human_text' | 'markdown' | 'strict_json' | 'other';
    detail: 'concise' | 'balanced' | 'detailed';
    conclusion_only: boolean;
    evidence_preference: 'none' | 'when_useful' | 'required';
    citation_preference: 'none' | 'when_available' | 'required';
    structural_constraints: string[];
    other_format?: string | null;
  };
  created_at_ms: number;
}

export interface TerminalPresentation {
  presentation_id: string;
  attempt_id: string;
  envelope_id: string;
  envelope_revision: number;
  state: TerminalPresentationState;
  answer_origin: AnswerOrigin;
  source_execution_id?: string | null;
  narrator_model?: string | null;
  narrator_provider?: string | null;
  models_attempted: Array<{ provider: string; model: string; failure?: string | null }>;
  validation: {
    status: 'pending' | 'valid' | 'invalid';
    findings: string[];
    envelope_revision?: number | null;
  };
  fallback_reason?: string | null;
  generated_at_ms: number;
  committed_at_ms?: number | null;
}

export interface TerminalDeliveryCorrelation {
  session_id?: string;
  execution_id?: string;
  turn_id?: string;
}

export type TerminalDeliveryEvent = ({
  event: 'terminal_presentation_started';
  presentation_id: string;
  attempt_id: string;
  envelope_id: string;
  envelope_revision: number;
  objective_scope?: 'root' | 'subtask';
} | {
  event: 'text_delta';
  presentation_id: string;
  attempt_id: string;
  byte_start: number;
  byte_end: number;
  delta: string;
} | {
  event: 'terminal_presentation_superseded' | 'terminal_presentation_aborted';
  presentation_id: string;
  attempt_id: string;
  reason: string;
} | {
  event: 'terminal_presentation_committed';
  presentation_id: string;
  attempt_id: string;
  answer_origin: AnswerOrigin;
  terminal_id: string;
} | {
  event: 'cancellation_committed';
  receipt: CancellationReceipt;
}) & TerminalDeliveryCorrelation;

export interface ActiveTerminalPresentation {
  presentation_id: string;
  attempt_id: string;
  envelope_id: string;
  envelope_revision: number;
  state: TerminalPresentationState;
  answer_origin?: AnswerOrigin;
  terminal_id?: string;
}

export type ExecutionProjection = GatewayComponents['schemas']['ExecutionProjection'] & {
  live?: ExecutionLiveState | null;
  task_id?: string | null;
  turn_id?: string | null;
  activities?: ExecutionActivityProjection[];
  activity_relations?: ExecutionActivityRelation[];
  delivery_envelope?: DeliveryEnvelope | null;
  terminal_presentation?: TerminalPresentation | null;
  cancellation_receipt?: CancellationReceipt | null;
};
export type ExecutionProjectionDelta = GatewayComponents['schemas']['ProjectionDelta'];

export interface WorkspaceFile {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  is_dir?: boolean;
  size?: number;
  modified?: string;
}

export interface SessionAttachment {
  ref_id: string;
  kind: string;
  path: string;
  label: string;
  size: number;
  sha256: string;
  added_at_ms: number;
  resource_id?: string;
  uri?: string;
  detected_mime?: string;
  status?: string;
}

export interface GatewayCapabilityHttp {
  method: string;
  path: string;
  handler?: string;
  source?: string;
  stability?: string;
  criticality?: string;
}

export interface GatewayCapabilityAvailability {
  available: boolean;
  executable: boolean;
}

export interface GatewayCapabilityDiscoverability {
  http: boolean;
  openapi: boolean;
  ai_tool: boolean;
}

export interface GatewayCapabilityAiAffordance {
  expose_as_tool?: boolean;
  tool_name?: string | null;
  when_to_use?: string;
  cautions?: string[];
}

export interface GatewayCapability {
  id: string;
  domain: string;
  title: string;
  description?: string;
  http: GatewayCapabilityHttp;
  auth?: string;
  risk?: string;
  side_effects?: string[];
  idempotency?: string;
  streaming?: string;
  availability?: GatewayCapabilityAvailability;
  discoverability?: GatewayCapabilityDiscoverability;
  consumed_by: string[];
  verified_by?: string[];
  ai_affordance?: GatewayCapabilityAiAffordance;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  tests?: string[];
}

export interface GatewayCapabilityCoverage {
  route_count: number;
  capability_count: number;
  p1_count: number;
  webui_required_count: number;
  tui_required_count: number;
  ai_tool_count: number;
  openapi_path_count: number;
  route_contract_parity: boolean;
}

export interface GatewayCapabilityContract {
  kind: string;
  schema_version: number;
  owner: string;
  source: string;
  route_count: number;
  capability_count: number;
  coverage: GatewayCapabilityCoverage;
  capabilities: GatewayCapability[];
  __state?: ApiReadStatus;
  __error?: string;
}

export interface GatewayOpenAiToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GatewayOpenAiTool {
  type: string;
  function: GatewayOpenAiToolFunction;
}

export interface GatewayOpenAiTools {
  kind?: string;
  schema_version?: number;
  source?: string;
  tool_count?: number;
  tools: GatewayOpenAiTool[];
  __state?: ApiReadStatus;
  __error?: string;
}

export interface RuntimeResourceEnvelope {
  id: string;
  uri: string;
  source: string;
  source_message_id?: string;
  session_id?: string;
  original_name: string;
  declared_mime?: string;
  detected_mime?: string;
  kind: string;
  size_bytes: number;
  sha256: string;
  artifact: {
    selector: string;
    sha256: string;
    bytes: number;
    media_type: string;
    durability: 'pending' | 'durable' | 'unavailable';
    visibility_scope: string;
  };
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeResourceUpload {
  resource: RuntimeResourceEnvelope;
  hint?: Record<string, unknown>;
}

export interface Metric {
  label: string;
  value: string | number;
  delta?: string;
  tone?: Tone;
}

export interface CapabilityAction {
  label: string;
  kind: 'primary' | 'secondary' | 'danger';
  endpoint?: string;
}

export interface CapabilitySection {
  id: string;
  label: string;
  description: string;
  displayMode?: 'summary' | 'table' | 'timeline' | 'tree' | 'graph' | 'form' | 'reader' | 'governance' | 'queue' | 'detail';
  density?: 'compact' | 'standard' | 'inspect';
  primaryObject?: string;
  riskLevel?: Tone;
}

export interface ChartPoint {
  name: string;
  value: number;
  series?: string;
}

export interface CapabilitySpec {
  id: NavId;
  title: string;
  subtitle: string;
  primaryAction: string;
  metrics: Metric[];
  chartKind: 'line' | 'bar' | 'donut' | 'radar' | 'heatmap' | 'graph';
  chartTitle: string;
  chartData: ChartPoint[];
  tableTitle: string;
  rows: Array<Record<string, string | number>>;
  sections: CapabilitySection[];
  actions: CapabilityAction[];
  inspector: Array<{ label: string; value: string }>;
}
