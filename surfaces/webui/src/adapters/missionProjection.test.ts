import { describe, expect, it } from 'vitest';
import { applyMissionProjectionDelta } from './missionProjection';
import type { MissionMaterializedSnapshot, MissionProjectionDelta } from '../types';

function snapshot(): MissionMaterializedSnapshot {
  return {
    schema_version: 1,
    kind: 'mission_control.materialized_snapshot',
    cursor: 10,
    revision: 4,
    needs_resync: false,
    projection: {
      schema_version: 1,
      kind: 'mission_control.projection',
      workspace: {
        workspace_id: 'workspace',
        title: 'Mission Control',
        active_session_id: null,
        session_count: 0,
        running_agent_count: 0,
        pending_approval_count: 0,
        recovery_required_count: 0,
      },
      summary: {
        session_count: 0,
        active_session_id: null,
        background_session_count: 0,
        paused_session_count: 0,
        closed_session_count: 0,
        task_count: 0,
        team_count: 0,
        agent_count: 0,
        pending_approval_count: 0,
        recovery_required_count: 0,
      },
      control_readiness: {
        kind: 'mission_control.control_readiness',
        ready_count: 0,
        blocked_count: 0,
        actions: [],
      },
      mission: {},
      sessions: [],
      tasks: [],
      teams: [],
      agents: [],
      approvals: [],
      relations: {},
      execution_graphs: {},
      conflicts: {},
      evidence: {},
      capabilities: {},
      event_digest: {
        total_recent_events: 0,
        scope_counts: {},
        latest_errors: [],
        recovery_required: [],
        latest: [],
      },
      health: {},
    },
  };
}

function delta(): MissionProjectionDelta {
  return {
    schema_version: 1,
    kind: 'mission_control.projection_delta',
    from_cursor: 10,
    from_revision: 4,
    to_cursor: 12,
    revision: 5,
    needs_resync: false,
    changed_domains: ['tasks'],
    events: [],
    patch: {
      tasks: [{
        task_id: 'task-1',
        mission_id: 'mission-1',
        source_session_id: 'session-1',
        objective: 'verify Mission projection',
        status: 'running',
        revision: 1,
        current_phase_id: null,
        phase_count: 1,
        graph_count: 0,
        failure_count: 0,
        blocker_reason: null,
        created_at_ms: 1,
        updated_at_ms: 1,
      }],
    },
  };
}

describe('applyMissionProjectionDelta', () => {
  it('applies only an exact cursor and revision chain', () => {
    const next = applyMissionProjectionDelta(snapshot(), delta());
    expect(next?.cursor).toBe(12);
    expect(next?.revision).toBe(5);
    expect(next?.projection.tasks[0]?.task_id).toBe('task-1');
  });

  it('rejects gaps and explicit resync requests', () => {
    expect(applyMissionProjectionDelta(snapshot(), { ...delta(), from_cursor: 9 })).toBeNull();
    expect(applyMissionProjectionDelta(snapshot(), { ...delta(), needs_resync: true })).toBeNull();
  });
});
