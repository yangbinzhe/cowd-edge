export interface MfgWidgetPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MfgWidgetInstance {
  instance_id: string;
  definition_id: string;
  placement: MfgWidgetPlacement;
  config?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
  visible?: boolean;
}

export interface MfgWidgetDefinition {
  definition_id: string;
  title: string;
  renderer: string;
  renderer_version: number;
  config_schema?: MfgJsonSchema;
  query_schema?: MfgJsonSchema;
  min_width: number;
  min_height: number;
  max_width: number;
  max_height: number;
  required_capability: string;
  default_placement: MfgWidgetPlacement;
}

export interface MfgJsonSchema {
  type?: string;
  properties?: Record<string, MfgJsonSchema>;
  items?: MfgJsonSchema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean;
}

export interface MfgCockpitCatalogContract {
  items: MfgWidgetDefinition[];
  global_filter_schema?: MfgJsonSchema;
  filter_merge_policy?: {
    policy_id?: string;
    precedence?: string[];
    semantics?: string;
    legacy_fallback?: Record<string, string>;
  };
}

export interface MfgCockpitProfile {
  profile_id: string;
  owner_ref: string;
  display_name: string;
  focus_refs: string[];
  focus_metric_ids: string[];
  thresholds: Record<string, unknown> | null;
  cadence: string;
  revision: number;
  scope: { kind: string; scope_ref?: string | null };
  layout: { columns: number; row_height: number; gap: number };
  global_filters: Record<string, unknown> | null;
  widget_instances: MfgWidgetInstance[];
  sharing_policy: { visibility: string; viewer_refs: string[]; editor_refs: string[] };
  template_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MfgCockpitWidget {
  widget_id: string;
  instance_id: string;
  definition_id: string;
  title: string;
  status: string;
  priority_score: number;
  data: Record<string, unknown> | null;
  source_refs: string[];
  freshness: Record<string, unknown> | null;
  error?: string | null;
}

export interface MfgCockpitProjection {
  projection_id?: string;
  profile: MfgCockpitProfile;
  widgets: MfgCockpitWidget[];
  summary: string;
  generated_at: string;
}

export interface MfgCockpitWidgetProjection {
  projection_id: string;
  profile_id: string;
  profile_revision: number;
  widget: MfgCockpitWidget;
  generated_at: string;
}

export interface MfgAlertOccurrence {
  occurrence_id: string;
  rule_id: string;
  status: string;
  severity: string;
  summary: string;
  evidence_refs: string[];
  revision: number;
  snoozed_until?: string | null;
  updated_at?: string;
}

export interface MfgAssignment {
  assignment_id: string;
  task_ref: string;
  workflow_id?: string | null;
  workflow_node_id?: string | null;
  incident_id?: string | null;
  assignee_ref: string;
  assignee_kind: string;
  watcher_refs: string[];
  priority: string;
  status: string;
  visibility: string;
  revision: number;
  due_at?: string | null;
  sla_minutes?: number | null;
  notification_targets?: Array<{ surface: string; recipient: string; thread?: string | null }>;
}

export interface MfgLiveProjection {
  kind: 'snapshot' | 'delta' | 'resync' | string;
  cursor: number;
  recoverable: boolean;
  snapshot?: Record<string, unknown>;
  events?: Array<{ cursor: number; event_type: string; subject_ref: string; payload: Record<string, unknown>; created_at: string }>;
  resync_reason?: string | null;
}
