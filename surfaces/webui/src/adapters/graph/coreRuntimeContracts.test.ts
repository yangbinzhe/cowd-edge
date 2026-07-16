import { describe, expect, it } from 'vitest';
import { graphDiagnostics } from '../../components/graph/graphRuntime';
import { adaptExecutionGraph } from './execution';
import { adaptRuntimeTimeline } from './runtimeTimeline';
import { adaptTeamTopology } from './teamTopology';

describe('Mission, Agent, Team, and Runtime graph contracts', () => {
  it('preserves child, approval, recovery, command, cycle, orphan, status, and evidence facts in an execution graph', () => {
    const model = adaptExecutionGraph({
      graph_id: 'exec-9',
      revision: 12,
      status: 'waiting_approval',
      nodes: [
        { node_id: 'parent', kind: 'agent_task', status: 'running', evidence_refs: ['ev-parent'] },
        { node_id: 'child', kind: 'child_execution', status: 'ready', parent_execution_id: 'exec-parent' },
        { node_id: 'approval', kind: 'approval', status: 'waiting_approval', approval_id: 'approval-1' },
        { node_id: 'recovery', kind: 'recovery', status: 'planned', recovery_id: 'recovery-1' },
        { node_id: 'command', kind: 'command', status: 'complete', result_ref: 'result-1' },
      ],
      edges: [
        { from: 'parent', to: 'child', kind: 'spawns' },
        { from: 'child', to: 'parent', kind: 'reports_to' },
        { from: 'child', to: 'approval', kind: 'awaits', evidence_refs: ['ev-approval'] },
        { from: 'approval', to: 'recovery', kind: 'unblocks' },
        { from: 'recovery', to: 'command', kind: 'executes' },
        { from: 'orphan', to: 'command', kind: 'depends_on' },
      ],
    });

    expect(model.status).toBe('waiting_approval');
    expect(model.nodes.map((node) => node.type)).toEqual(['agent_task', 'child_execution', 'approval', 'recovery', 'command']);
    expect(model.nodes[0].evidenceRefs).toEqual(['ev-parent']);
    expect(model.nodes[1].correlationRefs).toContain('exec-parent');
    expect(model.nodes.every((node) => node.href?.includes('execution_id=exec-9'))).toBe(true);
    expect(model.edges.find((edge) => edge.type === 'awaits')?.evidenceRefs).toEqual(['ev-approval']);
    expect(graphDiagnostics(model.nodes, model.edges).danglingEdgeIds).toHaveLength(1);
  });

  it('combines a revisioned Team template with canonical live working state', () => {
    const model = adaptTeamTopology({
      revision_ref: { template_id: 'template-1', revision: 7 },
      name: 'Review team',
      roles: [
        { role_id: 'lead', agent_definition_id: 'agent-lead', responsibility: 'coordinate' },
        { role_id: 'reviewer', agent_definition_id: 'agent-review', responsibility: 'verify' },
      ],
      dependencies: [{ from_role_id: 'lead', to_role_id: 'reviewer', evidence_refs: ['protocol-1'] }],
    }, {
      team_id: 'team-live-1',
      working_state: { entries: [{ node_id: 'reviewer', status: 'running', execution_id: 'exec-review', refs: ['work-1'] }] },
    });

    expect(model.id).toBe('team-live-1');
    expect(model.revision).toBe(7);
    expect(model.nodes.find((node) => node.id === 'reviewer')).toMatchObject({ status: 'running', evidenceRefs: ['work-1'] });
    expect(model.edges[0].evidenceRefs).toEqual(['protocol-1']);
    expect(graphDiagnostics(model.nodes, model.edges).danglingEdgeIds).toEqual([]);
  });

  it('keeps runtime turn, task, tool, approval, recovery, terminal and typed refs correlated', () => {
    const rows = adaptRuntimeTimeline([
      {
        sequence: 41,
        kind: 'TerminalCommitted',
        scope: 'turn',
        payload: {
          status: 'complete',
          execution_id: 'exec-41',
          turn_id: 'turn-41',
          task_id: 'task-41',
          tool_call_id: 'tool-41',
          approval_id: 'approval-41',
          recovery_id: 'recovery-41',
        },
        refs: [{ kind: 'context', id: 'ctx-41' }, { kind: 'terminal', id: 'terminal-41' }],
      },
    ]);

    expect(rows[0]).toMatchObject({
      execution_id: 'exec-41', turn_id: 'turn-41', task_id: 'task-41', tool_call_id: 'tool-41', approval_id: 'approval-41', recovery_id: 'recovery-41',
    });
    expect(rows[0].correlation).toContain('ctx-41');
    expect(rows[0].route).toContain('execution_id=exec-41');
  });
});
