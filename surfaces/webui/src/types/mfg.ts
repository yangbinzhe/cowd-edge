import type { components as GatewayComponents } from '../generated/gateway-api';

/** The only source of truth for MFG HTTP wire schemas is the generated OpenAPI contract. */
export const MFG_GENERATED_CONTRACT_KIND = 'generated_openapi_aliases' as const;

type MfgGeneratedSchemas = GatewayComponents['schemas'];
export type MfgWireApiErrorV1 = MfgGeneratedSchemas['MfgApiErrorV1'];
export type MfgWireRecoveryAction = MfgGeneratedSchemas['MfgRecoveryAction'];
export type MfgWireEntitlementProjection = MfgGeneratedSchemas['MfgEntitlementProjectionV2'];
export type MfgWireCockpitProfile = MfgGeneratedSchemas['MfgCockpitProfile'];
export type MfgWireAlertOccurrence = MfgGeneratedSchemas['MfgAlertOccurrence'];
export type MfgWireAssignment = MfgGeneratedSchemas['MfgAssignment'];
export type MfgWireReportDeliveryReview = MfgGeneratedSchemas['MfgReportDeliveryReview'];
export type MfgWireLiveEnvelope = MfgGeneratedSchemas['MfgLiveEnvelopeV1'];

export type MfgMutationRisk = 'low' | 'medium' | 'high';
export type MfgMutationIntentStatus =
  | 'draft'
  | 'submitting'
  | 'pending'
  | 'replayed'
  | 'succeeded'
  | 'conflict'
  | 'forbidden'
  | 'failed'
  | 'cancelled';

export interface MfgMutationIntent {
  intent_id: string;
  action_id: string;
  resource_ref: string;
  expected_revision?: number;
  idempotency_key: string;
  payload_digest: string;
  risk: MfgMutationRisk;
  status: MfgMutationIntentStatus;
  error?: MfgApiErrorV1 | null;
  receipt?: unknown;
  created_at: string;
  updated_at: string;
}

export type MfgRecoveryActionKind = MfgWireRecoveryAction['kind'] | 'reauthenticate';

export type MfgRecoveryAction = Omit<MfgWireRecoveryAction, 'kind' | 'target'> & {
  kind: MfgRecoveryActionKind;
  target?: string | null;
};

export type MfgApiErrorV1 = Omit<
  MfgWireApiErrorV1,
  'code' | 'details' | 'recovery_actions' | 'contract_version'
> & {
  /** UI also represents transport-only failures which have no server enum code. */
  code: string;
  details?: Record<string, unknown> | null;
  contract_version?: { major?: number; minor?: number } | string;
  recovery_actions: MfgRecoveryAction[];
};

export type MfgEntitlementProjection = Partial<MfgWireEntitlementProjection>;

export interface MfgFrontendContract {
  contract_version?: { major?: number; minor?: number } | string;
  schema_version?: number;
  routes?: Array<{
    route_id: string;
    method: string;
    path: string;
    availability: string;
    required_capability?: unknown;
  }>;
  actions?: Array<{
    action_id: string;
    route_id: string;
    availability: string;
    required_capabilities?: string[];
    risk?: string;
    confirmation?: string;
  }>;
  surfaces?: Array<{
    surface: string;
    role: string;
    capabilities?: string[];
    actions?: string[];
  }>;
}

export type MfgReportDeliveryReviewDecision = NonNullable<
  MfgWireReportDeliveryReview['decision']
>;

export interface MfgReportDeliveryReviewRerouteTarget {
  target_ref: string;
  provider_account: string;
  channel: string;
  requested_capability: string;
}

export interface MfgReportDeliveryReview {
  review_id: string;
  report_id: string;
  report_revision: number;
  delivery_revision: number;
  dead_letter_digest: string;
  requester_principal: string;
  approval_id?: string | null;
  correlation_id: string;
  requested_action?: MfgReportDeliveryReviewDecision | null;
  decision?: MfgReportDeliveryReviewDecision | null;
  reviewer_principal?: string | null;
  reason?: string;
  evidence_refs?: string[];
  decision_lease_ref?: string | null;
  effect_key?: string | null;
  effect_payload?: unknown;
  effect_receipt_ref?: string | null;
  effect_error?: string | null;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface MfgReportDeliveryReviewCollection {
  items: MfgReportDeliveryReview[];
  next_cursor?: string | null;
}

export type MfgWidgetPlacement = MfgWireCockpitProfile['$defs']['MfgWidgetPlacement'];

export type MfgWidgetInstance = Omit<
  MfgWireCockpitProfile['$defs']['MfgWidgetInstance'],
  'config' | 'query'
> & {
  config?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
};

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

export type MfgCockpitProfile = Omit<
  MfgWireCockpitProfile,
  'thresholds' | 'global_filters' | 'widget_instances' | 'scope' | 'sharing_policy' | 'template_id'
> & {
  thresholds: Record<string, unknown> | null;
  scope: { kind: string; scope_ref?: string | null };
  global_filters: Record<string, unknown> | null;
  widget_instances: MfgWidgetInstance[];
  sharing_policy: { visibility: string; viewer_refs: string[]; editor_refs: string[] };
  template_id?: string;
};

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

export type MfgAlertOccurrence = Partial<MfgWireAlertOccurrence> & {
  occurrence_id: string;
  rule_id: string;
  status: string;
  severity: string;
  summary: string;
  evidence_refs: string[];
  revision: number;
  snoozed_until?: string | null;
  updated_at?: string;
};

export type MfgAssignment = Partial<MfgWireAssignment> & {
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
};

export interface MfgLiveSnapshotState {
  cockpit: Record<string, unknown>;
  alerts: Record<string, unknown>;
  assignments: Record<string, unknown>;
  incidents: Record<string, unknown>;
  executions: Record<string, unknown>;
  reports: Record<string, unknown>;
  reviews: Record<string, unknown>;
  receipts: Record<string, unknown>;
  data_compute: Record<string, unknown>;
}

export interface MfgLiveEvent {
  event_type: string;
  subject_ref: string;
  revision: number;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export type MfgLiveEnvelope =
  | { kind: 'snapshot'; view_epoch: string; cursor: string; generated_at: string; contract_version: string; state: MfgLiveSnapshotState }
  | { kind: 'delta'; view_epoch: string; base_cursor: string; target_cursor: string; events: MfgLiveEvent[] }
  | { kind: 'resync'; previous_view_epoch: string; reason: string; snapshot_url: '/api/apps/mfg/live/snapshot'; latest_cursor: string }
  | { kind: 'heartbeat'; view_epoch: string; cursor: string; generated_at: string };
