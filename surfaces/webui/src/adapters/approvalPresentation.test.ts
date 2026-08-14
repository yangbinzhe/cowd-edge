import { describe, expect, it } from 'vitest';
import { approvalPresentation, policyAxisValue } from './approvalPresentation';
import type { ApprovalPendingItem } from '../types';

function approval(fields: Record<string, unknown>): ApprovalPendingItem {
  return {
    approval_id: 'approval-1',
    action: 'tool.call',
    blocks_execution: true,
    context: {},
    domain: 'execution',
    risk: 'high',
    source: {},
    status: 'pending',
    summary: 'Review this operation',
    ...fields,
  } as ApprovalPendingItem;
}

describe('approvalPresentation', () => {
  it('never makes a write operation skippable even when the wire flag is incorrect', () => {
    const view = approvalPresentation(approval({
      skippable: true,
      allowed_scopes: ['once', 'session'],
      effect_assessment: { read_write_class: 'write' },
    }));

    expect(view.canSkip).toBe(false);
    expect(view.allowedScopes).toEqual(['once', 'session']);
  });

  it('uses typed read effects, backend scopes, posture and revisions without guessing', () => {
    const view = approvalPresentation(approval({
      skippable: true,
      allowed_scopes: ['turn', 'task', 'not-a-scope'],
      context: {
        approval_profile: 'balanced',
        policy_revision: 7,
        requested_sandbox_posture: 'workspace_write_sandbox',
        effective_sandbox_posture: 'read_only_sandbox',
        resource_targets: ['workspace:read:README.md'],
        effect: {
          tool_id: 'file.read',
          effect_kind: 'read',
          assessment: {
            reversibility: 'reversible',
            externality: 'internal',
            data_sensitivity: 'internal',
          },
        },
      },
      revision: 3,
    }));

    expect(view.canSkip).toBe(true);
    expect(view.allowedScopes).toEqual(['turn', 'task']);
    expect(view.operation).toBe('file.read');
    expect(view.resources).toEqual(['workspace:read:README.md']);
    expect(view.approvalProfile).toBe('balanced');
    expect(view.requestedPosture).toBe('workspace_write_sandbox');
    expect(view.effectivePosture).toBe('read_only_sandbox');
    expect(view.policyRevision).toBe(7);
    expect(view.approvalRevision).toBe(3);
  });

  it('fails closed when authorization metadata is absent', () => {
    const view = approvalPresentation(approval({}));

    expect(view.allowedScopes).toEqual([]);
    expect(view.canSkip).toBe(false);
    expect(view.requestedPosture).toBe('');
    expect(view.effectivePosture).toBe('');
    expect(policyAxisValue({ permission_mode: 'read-only' }, 'sandbox_posture')).toBe('');
  });
});
