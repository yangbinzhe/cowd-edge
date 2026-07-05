import type { Component } from 'vue';

export type NavId = 'chat' | 'mission' | 'runtime' | 'context' | 'reality' | 'memory' | 'skills' | 'agents' | 'tools' | 'surfaces' | 'gateway' | 'mfg' | 'audit' | 'settings';
export type CompanionTab = 'activity' | 'thinking' | 'workspace' | 'evidence' | 'inspector';
export type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';
export type ChatDisplayMode = 'panorama' | 'clean';

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
  __offline?: boolean;
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
  __offline?: boolean;
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
  __offline?: boolean;
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
