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

  it('projects canonical graph and node work estimates without recomputing them in the surface', () => {
    const model = adaptExecutionGraph({
      graph_id: 'exec-work',
      work: {
        node_count: 2,
        width: 2,
        depth: 1,
        expected_serial_ms: 2_000,
        expected_critical_path_ms: 1_000,
        expected_speedup_basis_points: 20_000,
        actual_serial_ms: 1_800,
        actual_critical_path_ms: 950,
        actual_speedup_basis_points: 18_947,
        input_tokens: 400,
        output_tokens: 200,
      },
      nodes: [
        {
          node_id: 'analyze',
          kind: 'agent_task',
          status: 'running',
          work: { role: 'evidence_analyze', expected_duration_ms: 1_000 },
        },
      ],
      edges: [],
    });

    expect(model.work).toMatchObject({
      width: 2,
      depth: 1,
      expectedCriticalPathMs: 1_000,
      actualCriticalPathMs: 950,
      actualSpeedupBasisPoints: 18_947,
    });
    expect(model.nodes[0].badges).toContain('evidence analyze');
    expect(model.nodes[0].badges).toContain('1 s');
  });

  it('shows canonical work claims, artifact blockers, and Team grouping', () => {
    const model = adaptExecutionGraph({
      graph_id: 'exec-marketplace',
      nodes: [{
        node_id: 'experiment',
        kind: 'agent_task',
        display_label: 'Experiment reviewer',
        team_run_id: 'team-experiment',
        status: 'waiting_external',
        status_reason: 'waiting for verified baseline',
        blocked_by_activity_ids: ['theory'],
        work: {
          status: 'claimed',
          claimant_role_id: 'reviewer',
          input_artifact_refs: ['artifact://theory/baseline'],
        },
      }],
      edges: [{ from: 'theory', to: 'experiment', kind: 'artifact_requires' }],
    });

    expect(model.nodes[0]).toMatchObject({
      label: 'Experiment reviewer',
      group: 'team-experiment',
      description: 'waiting for verified baseline',
    });
    expect(model.nodes[0].badges).toEqual(expect.arrayContaining([
      'claimed',
      '领取者 reviewer',
      '1 个阻塞项',
      '1 项输入产物',
    ]));
    expect(model.edges[0].label).toBe('需要产物');
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

  it('renders Runtime-provided Team labels and observed parallel groups without parsing IDs', () => {
    const graphId = 'execution-review-team';
    const model = adaptExecutionGraph({
      graph_id: graphId,
      nodes: [
        {
          node_id: 'agent-run-1',
          kind: 'agent_task',
          status: 'running',
          summary: 'researcher #1',
          parallel_group_id: 'parallel-research',
        },
        {
          node_id: 'agent-run-2',
          kind: 'agent_task',
          status: 'running',
          summary: 'researcher #2',
          parallel_group_id: 'parallel-research',
        },
        { node_id: 'verify', kind: 'verify', status: 'planned' },
      ],
      edges: [
        { from: 'agent-run-1', to: 'verify', kind: 'depends_on' },
        { from: 'agent-run-2', to: 'verify', kind: 'depends_on' },
      ],
    });

    expect(model.nodes[0]).toMatchObject({
      label: 'researcher #1',
      group: 'parallel-research',
    });
    expect(model.nodes[0].badges).toContain('并行执行');
  });

  it('preserves canonical Team labels after graphs are combined into an execution lineage', () => {
    const graphId = 'execution-review-team';
    const model = adaptExecutionGraph({
      graph_id: 'lineage:root-execution',
      nodes: [
        {
          node_id: 'activity-agent-run-1',
          execution_id: graphId,
          kind: 'agent_task',
          status: 'running',
          summary: 'researcher #1',
          parallel_group_id: 'parallel-research',
        },
        {
          node_id: 'activity-agent-run-2',
          execution_id: graphId,
          kind: 'agent_task',
          status: 'running',
          summary: 'researcher #2',
          parallel_group_id: 'parallel-research',
        },
      ],
      edges: [],
    });

    expect(model.nodes[0]).toMatchObject({
      label: 'researcher #1',
      group: 'parallel-research',
    });
    expect(model.nodes[1]).toMatchObject({
      label: 'researcher #2',
      group: 'parallel-research',
    });
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

  it('renders APP, Context, and every recoverable Surface phase as semantic timeline rows', () => {
    const events = [
      {
        sequence: 1,
        type: 'application.execution_outcome',
        scope: 'application_task',
        status: 'succeeded',
        payload: { title: 'Quality snapshot', summary: '12 facts synchronized', kind: 'structured_fact' },
      },
      {
        sequence: 2,
        type: 'context.recommendation_action',
        scope: 'context',
        payload: { recommendation: 'retain evidence', action: 'accepted', note: 'needed by the active turn' },
      },
      {
        sequence: 3,
        type: 'surface.message_received',
        scope: 'message',
        payload: { surface: 'feishu', message_id: 'om-1', content_preview: 'inspect incident' },
      },
      {
        sequence: 4,
        type: 'surface.runtime_activated',
        scope: 'session',
        payload: { surface: 'feishu', session_id: 'session-1', message_id: 'om-1' },
      },
      {
        sequence: 5,
        type: 'surface.resources_registered',
        scope: 'tool',
        payload: { message_id: 'om-1', current: [], recent: [] },
      },
      {
        sequence: 6,
        type: 'surface.message_accepted',
        scope: 'turn',
        payload: { surface: 'feishu', message_id: 'om-1', turn_id: 'turn-1', execution_id: 'exec-1' },
      },
      {
        sequence: 7,
        type: 'surface.message_replied',
        scope: 'message',
        payload: {
          surface: 'feishu',
          message_id: 'om-1',
          turn_id: 'turn-1',
          execution_id: 'exec-1',
          terminal_id: 'terminal-1',
          empty_terminal: true,
        },
      },
      {
        sequence: 8,
        event_id: 'tool-event-1',
        type: 'tool.invocation.completed',
        scope: 'tool',
        status: 'completed',
        refs: [{ kind: 'tool_call', id: 'tool-1' }],
        payload: {
          contract_version: 2,
          invocation_id: 'tool-inv-1',
          tool_call_id: 'tool-1',
          tool_name: 'glob_search',
          status: 'completed',
          output_preview: '12 matching files',
          full_output_ref: 'tool://raw-1',
          duration_ms: 42,
          context_saved_tokens: 90,
        },
      },
    ];

    const rows = adaptRuntimeTimeline(events);

    expect(rows.every((row) => row.detail !== '-' && row.status !== '-')).toBe(true);
    expect(rows[0].detail).toContain('12 facts synchronized');
    expect(rows[1].detail).toContain('needed by the active turn');
    expect(rows[2].detail).toContain('inspect incident');
    expect(rows[4].detail).toContain('No resources attached');
    expect(rows[6]).toMatchObject({
      status: 'empty_terminal',
      execution_id: 'exec-1',
      turn_id: 'turn-1',
      raw: events[6],
    });
    expect(rows[6].detail).toContain('without a text reply');
    expect(rows.map((row) => row.domain)).toEqual([
      'app',
      'context',
      'surface',
      'surface',
      'surface',
      'surface',
      'surface',
      'tool',
    ]);
    expect(rows[7]).toMatchObject({
      id: 'tool-event-1',
      domain: 'tool',
      title: 'glob_search completed',
      status: 'completed',
      tool_call_id: 'tool-1',
      tool_name: 'glob_search',
      raw: events[7],
    });
    expect(rows[7].detail).toContain('12 matching files');
    expect(rows[7].refs).toEqual(['tool-1', 'tool://raw-1']);
  });

  it('keeps unknown future events inspectable without serializing payload JSON as the primary label', () => {
    const event = {
      sequence: 9,
      type: 'runtime.future_signal',
      payload: { opaque: { nested: true } },
    };

    const [row] = adaptRuntimeTimeline([event]);

    expect(row).toMatchObject({
      domain: 'runtime',
      title: 'Runtime future signal',
      detail: 'Runtime future signal',
      status: 'recorded',
      raw: event,
    });
    expect(row.detail).not.toContain('"opaque"');
  });
});
