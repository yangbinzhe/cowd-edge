import type { ApprovalPendingItem } from '../types';

export const APPROVAL_SCOPES = ['once', 'turn', 'task', 'session', 'global'] as const;
export type ApprovalScope = typeof APPROVAL_SCOPES[number];

export interface ApprovalPresentation {
  id: string;
  operation: string;
  summary: string;
  status: string;
  risk: string;
  effectKind: string;
  reversibility: string;
  externality: string;
  dataSensitivity: string;
  cost: string;
  resources: string[];
  authorizationStatus: string;
  approvalProfile: string;
  policyRevision: number | null;
  approvalRevision: number | null;
  requestedAtMs: number | null;
  expiresAtMs: number | null;
  requestedPosture: string;
  effectivePosture: string;
  allowedScopes: ApprovalScope[];
  canSkip: boolean;
  decisionActor: string;
  decisionReason: string;
  decidedAtMs: number | null;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function positiveNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function resourceLabel(value: unknown) {
  if (typeof value === 'string') return value.trim();
  const scope = record(value);
  const resource = firstString(scope.resource, scope.kind, scope.scope);
  const operation = firstString(scope.operation, scope.access);
  const target = firstString(scope.target, scope.path, scope.ref);
  return [resource, operation, target].filter(Boolean).join(':');
}

export function approvalPresentation(approval: ApprovalPendingItem): ApprovalPresentation {
  const root = record(approval);
  const context = record(root.context);
  const effect = record(root.effect_assessment || root.effect || context.effect);
  const assessment = record(root.effect_assessment || effect.assessment);
  const decision = record(root.decision || root.decision_receipt);
  const actor = record(decision.actor);
  const effectKind = firstString(
    assessment.read_write_class,
    effect.read_write_class,
    effect.effect_kind,
  ).toLowerCase();
  const allowedScopes = (Array.isArray(root.allowed_scopes) ? root.allowed_scopes : [])
    .map((scope) => String(scope || '').toLowerCase())
    .filter((scope): scope is ApprovalScope => APPROVAL_SCOPES.includes(scope as ApprovalScope));
  const resources = [
    ...(Array.isArray(assessment.resource_targets) ? assessment.resource_targets : []),
    ...(Array.isArray(root.resource_targets) ? root.resource_targets : []),
    ...(Array.isArray(context.resource_targets) ? context.resource_targets : []),
    ...(Array.isArray(effect.scopes) ? effect.scopes : []),
  ].map(resourceLabel).filter(Boolean);
  const readOnlyEffect = ['read', 'read_only', 'readonly'].includes(effectKind);

  return {
    id: firstString(root.approval_id, root.id, root.request_id),
    operation: firstString(assessment.operation, effect.operation, effect.tool_id, root.action),
    summary: firstString(root.summary, root.reason),
    status: firstString(root.status, 'pending').toLowerCase(),
    risk: firstString(assessment.risk, root.risk),
    effectKind,
    reversibility: firstString(assessment.reversibility),
    externality: firstString(assessment.externality, root.external_side_effect),
    dataSensitivity: firstString(assessment.data_sensitivity, root.secret_exposure),
    cost: firstString(
      assessment.monetary_or_irreversible_cost,
      root.monetary_or_irreversible_cost,
    ),
    resources: [...new Set(resources)].slice(0, 12),
    authorizationStatus: firstString(root.authorization_status, context.authorization_status),
    approvalProfile: firstString(root.approval_profile, context.approval_profile, context.profile_id),
    policyRevision: positiveNumber(root.policy_revision, context.policy_revision),
    approvalRevision: positiveNumber(root.revision, root.committed_revision),
    requestedAtMs: positiveNumber(root.requested_at_ms, root.created_at_ms),
    expiresAtMs: positiveNumber(root.expires_at_ms),
    requestedPosture: firstString(context.requested_sandbox_posture),
    effectivePosture: firstString(context.effective_sandbox_posture),
    allowedScopes: [...new Set(allowedScopes)],
    canSkip: root.skippable === true && readOnlyEffect,
    decisionActor: firstString(actor.actor_id, actor.id, decision.actor_id),
    decisionReason: firstString(decision.reason, decision.reason_code),
    decidedAtMs: positiveNumber(decision.decided_at_ms, root.resolved_at_ms),
  };
}

export function policyAxisValue(policy: unknown, axis: string) {
  return firstString(record(policy)[axis]);
}
