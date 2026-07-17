import type { Component } from 'vue';
import type { components as GatewayComponents } from './generated/gateway-api';

export type NavId = 'chat' | 'mission' | 'runtime' | 'context' | 'reality' | 'memory' | 'skills' | 'agents' | 'tools' | 'surfaces' | 'gateway' | 'mfg' | 'audit' | 'settings';
export type CompanionTab = 'activity' | 'thinking' | 'workspace' | 'evidence' | 'inspector';
export type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';
export type ChatDisplayMode = 'panorama' | 'clean';
export type ApiReadStatus = 'ready' | 'offline' | 'forbidden' | 'not_found' | 'invalid_response' | 'server_error' | 'error' | 'stale';

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
  route: string;
  icon: Component;
  group: string;
}

export interface SessionSummary {
  id: string;
  title: string;
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
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: 'streaming' | 'complete' | 'error';
  activity?: ActivityEvent[];
  activity_open?: boolean;
  blocks?: Array<Record<string, unknown>>;
  sequence?: number;
  created_at_ms?: number;
  tool_use_id?: string;
  tool_name?: string;
  token_usage?: Record<string, unknown>;
}

export interface ActivityEvent {
  id: string;
  kind: 'tool' | 'think' | 'runtime' | 'context' | 'approval' | 'error';
  title: string;
  detail?: string;
  status?: string;
  at?: string;
}

export type ExecutionProjectionEntity = GatewayComponents['schemas']['ExecutionProjectionEntity'];
export type StrategyDecisionProjection = GatewayComponents['schemas']['StrategyDecisionProjection'];
export type StrategyCandidateEstimate = GatewayComponents['schemas']['StrategyCandidateEstimate'];
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
  output_preview?: string | null;
  terminal_ref?: string | null;
  error?: string | null;
}

export interface SessionExecutionIndexProjection {
  session_id: string;
  active_execution_ids: string[];
  latest_execution_id?: string | null;
  latest_status?: ExecutionLiveStatus | null;
  latest_live_revision?: number | null;
  last_progress_at_ms?: number | null;
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

export type ExecutionProjection = GatewayComponents['schemas']['ExecutionProjection'] & {
  live?: ExecutionLiveState | null;
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

export interface SessionTurnProjectionItem {
  turn_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  submitted_at_ms?: number | null;
  started_at_ms?: number | null;
  completed_at_ms?: number | null;
  user_preview?: string | null;
  assistant_preview?: string | null;
  tool_calls: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  context_events: Array<Record<string, unknown>>;
  usage: Array<Record<string, unknown>>;
  evidence_refs: string[];
  event_sequences: number[];
}

export interface SessionTurnProjection {
  kind: 'session.turn_projection';
  source?: string;
  session_id: string;
  turn_count: number;
  turns: SessionTurnProjectionItem[];
  unbound_event_count?: number;
  unbound_events?: Array<Record<string, unknown>>;
  paging?: {
    total: number;
    from_seq: number;
    next_seq?: number | null;
    limit: number;
    has_more: boolean;
  };
  __state?: ApiReadStatus;
  __error?: string;
}

export interface GatewayCapabilityHttp {
  method: string;
  path: string;
  handler?: string;
  source?: string;
  stability?: string;
  criticality?: string;
}

export interface GatewayCapabilityVisibility {
  webui?: boolean;
  tui?: boolean;
  llm?: boolean;
  edge?: boolean;
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
  surface_visibility?: GatewayCapabilityVisibility;
  ai_affordance?: GatewayCapabilityAiAffordance;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  tests?: string[];
}

export interface GatewayCapabilityCoverage {
  route_count: number;
  capability_count: number;
  p1_count: number;
  ai_visible_count: number;
  openapi_path_count: number;
  openai_tool_count: number;
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
  storage_path: string;
  created_at: string;
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
