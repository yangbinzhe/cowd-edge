import { describe, expect, it } from 'vitest';
import { adaptMissionControlGraph } from './missionControlGraph';

describe('adaptMissionControlGraph', () => {
  it('preserves typed mission ownership and explicit graph edges', () => {
    const graph = adaptMissionControlGraph({
      missions: [{
        mission_id: 'mission-1',
        objective: 'Ship the result',
        status: 'active',
        revision: 3,
      }],
      mission_graph: {
        schema_version: 1,
        mission_id: 'mission-1',
        nodes: [
          {
            node_id: 'mission:mission-1',
            kind: 'mission',
            label: 'Ship the result',
            status: 'active',
            mission_id: 'mission-1',
          },
          {
            node_id: 'agent:researcher',
            kind: 'agent',
            label: 'researcher',
            status: 'running',
            mission_id: 'mission-1',
            team_id: 'team-1',
            agent_id: 'researcher',
          },
        ],
        edges: [{
          edge_id: 'delegated',
          kind: 'delegated_to',
          from_node_id: 'mission:mission-1',
          to_node_id: 'agent:researcher',
        }],
      },
    } as any);

    expect(graph?.nodes[1]).toMatchObject({
      node_id: 'agent:researcher',
      kind: 'agent_task',
      team_id: 'team-1',
    });
    expect(graph?.edges).toEqual([
      expect.objectContaining({
        from: 'mission:mission-1',
        to: 'agent:researcher',
        kind: 'delegated_to',
      }),
    ]);
  });

  it('shows Session participation through canonical contribution edges without claiming ownership', () => {
    const graph = adaptMissionControlGraph({
      missions: [{
        mission_id: 'mission-1',
        objective: 'Ship the result',
        status: 'active',
        revision: 3,
      }],
      mission_graph: {
        schema_version: 5,
        mission_id: 'mission-1',
        nodes: [{
          node_id: 'mission:mission-1',
          kind: 'mission',
          label: 'Ship the result',
          status: 'active',
          mission_id: 'mission-1',
        }, {
          node_id: 'session:session-1',
          kind: 'session',
          label: 'Current conversation',
          status: 'active',
          mission_id: 'mission-1',
          session_id: 'session-1',
        }, {
          node_id: 'task:task-1',
          kind: 'task',
          label: 'Implement terminal route',
          status: 'running',
          mission_id: 'mission-1',
          task_id: 'task-1',
        }],
        edges: [{
          edge_id: 'mission-task',
          kind: 'contains',
          from_node_id: 'mission:mission-1',
          to_node_id: 'task:task-1',
        }, {
          edge_id: 'session-task',
          kind: 'contributes',
          from_node_id: 'session:session-1',
          to_node_id: 'task:task-1',
        }],
      },
    } as any);

    expect(graph?.nodes.map((node) => node.node_id)).toEqual([
      'mission:mission-1',
      'session:session-1',
      'task:task-1',
    ]);
    expect(graph?.edges).toContainEqual(expect.objectContaining({
      from: 'session:session-1',
      to: 'task:task-1',
      kind: 'contributes',
    }));
  });

  it('keeps the Mission graph strategic and rolls Tool execution into Agent metrics', () => {
    const graph = adaptMissionControlGraph({
      missions: [{
        mission_id: 'mission-1',
        objective: 'Investigate and report',
        status: 'active',
        revision: 4,
      }],
      mission_graph: {
        schema_version: 1,
        mission_id: 'mission-1',
        nodes: [
          {
            node_id: 'mission:mission-1',
            kind: 'mission',
            label: 'Investigate and report',
            status: 'active',
            mission_id: 'mission-1',
          },
          {
            node_id: 'session:session-1',
            kind: 'session',
            label: 'technical transport',
            status: 'active',
            mission_id: 'mission-1',
          },
          {
            node_id: 'agent:researcher',
            kind: 'agent',
            label: 'researcher',
            status: 'running',
            mission_id: 'mission-1',
            agent_id: 'agent-run-1',
          },
          {
            node_id: 'tool:search',
            kind: 'tool',
            label: 'search',
            status: 'completed',
            mission_id: 'mission-1',
            agent_id: 'agent-run-1',
          },
        ],
        edges: [{
          edge_id: 'delegated',
          kind: 'delegated_to',
          from_node_id: 'mission:mission-1',
          to_node_id: 'agent:researcher',
        }],
      },
    } as any, [{
      activities: [{
        activity_id: 'tool:search',
        kind: 'tool',
        status: 'completed',
        agent_run_id: 'agent-run-1',
      }],
      activity_relations: [],
    } as any]);

    expect(graph?.nodes.map((node) => node.node_id)).toEqual([
      'mission:mission-1',
      'agent:researcher',
    ]);
    expect(graph?.nodes.find((node) => node.node_id === 'agent:researcher'))
      .toMatchObject({
        tool_summary: {
          total: 1,
          completed: 1,
          failed: 0,
          running: 0,
        },
      });
  });

  it('folds one-to-one Execution and Outcome nodes into Task without orphan branches', () => {
    const graph = adaptMissionControlGraph({
      missions: [{
        mission_id: 'mission-1',
        objective: '完成调查',
        status: 'active',
        revision: 5,
      }],
      mission_graph: {
        schema_version: 1,
        mission_id: 'mission-1',
        nodes: [{
          node_id: 'mission:mission-1',
          kind: 'mission',
          label: '完成调查',
          status: 'active',
          mission_id: 'mission-1',
        }, {
          node_id: 'task:task-1',
          kind: 'task',
          label: '调查并汇总',
          status: 'running',
          mission_id: 'mission-1',
          task_id: 'task-1',
        }, {
          node_id: 'execution:execution-1',
          kind: 'execution',
          label: 'technical execution',
          status: 'running',
          mission_id: 'mission-1',
          task_id: 'task-1',
          execution_id: 'execution-1',
        }, {
          node_id: 'team:team-1',
          kind: 'team',
          label: '调查团队',
          status: 'running',
          mission_id: 'mission-1',
          task_id: 'task-1',
          execution_id: 'execution-1',
          team_id: 'team-1',
        }, {
          node_id: 'agent:researcher',
          kind: 'agent',
          label: '研究员',
          status: 'running',
          mission_id: 'mission-1',
          task_id: 'task-1',
          execution_id: 'execution-1',
          team_id: 'team-1',
          agent_id: 'researcher',
        }, {
          node_id: 'outcome:result',
          kind: 'outcome',
          label: '阶段产出',
          status: 'completed',
          mission_id: 'mission-1',
          task_id: 'task-1',
          execution_id: 'execution-1',
        }, {
          node_id: 'agent:orphan',
          kind: 'agent',
          label: '无来源智能体',
          status: 'unknown',
          mission_id: 'mission-1',
          agent_id: 'orphan',
        }],
        edges: [{
          edge_id: 'mission-task',
          kind: 'contains',
          from_node_id: 'mission:mission-1',
          to_node_id: 'task:task-1',
        }, {
          edge_id: 'task-execution',
          kind: 'contains',
          from_node_id: 'task:task-1',
          to_node_id: 'execution:execution-1',
        }, {
          edge_id: 'execution-team',
          kind: 'contains',
          from_node_id: 'execution:execution-1',
          to_node_id: 'team:team-1',
        }, {
          edge_id: 'team-agent',
          kind: 'delegated_to',
          from_node_id: 'team:team-1',
          to_node_id: 'agent:researcher',
        }, {
          edge_id: 'execution-outcome',
          kind: 'produced',
          from_node_id: 'execution:execution-1',
          to_node_id: 'outcome:result',
        }],
      },
    } as any);

    expect(graph?.nodes.map((node) => node.node_id)).toEqual([
      'mission:mission-1',
      'task:task-1',
      'team:team-1',
      'agent:researcher',
    ]);
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'mission:mission-1', to: 'task:task-1' }),
      expect.objectContaining({ from: 'task:task-1', to: 'team:team-1' }),
      expect.objectContaining({ from: 'team:team-1', to: 'agent:researcher' }),
    ]));
    expect(graph?.diagnostics).toEqual({
      omitted_orphan_nodes: 1,
      folded_execution_nodes: 1,
      folded_internal_task_nodes: 0,
    });
  });

  it('folds Team role Tasks and their technical Execution into Mission -> Team -> Agent', () => {
    const teamId = 'runtime-team:run-1';
    const taskA = `${teamId}:task:researcher:1`;
    const taskB = `${teamId}:task:synthesizer:1`;
    const executionId = 'team-graph:run-1';
    const graph = adaptMissionControlGraph({
      missions: [{
        mission_id: 'mission-1',
        objective: 'Workspace mission for workspace',
        status: 'active',
        revision: 1,
      }],
      mission_graph: {
        schema_version: 1,
        mission_id: 'mission-1',
        nodes: [{
          node_id: 'mission:mission-1',
          kind: 'mission',
          label: 'Workspace mission for workspace',
          status: 'active',
          mission_id: 'mission-1',
        }, {
          node_id: `task:${taskA}`,
          kind: 'task',
          label: '## Parent objective (context only)',
          status: 'completed',
          mission_id: 'mission-1',
          task_id: taskA,
        }, {
          node_id: `task:${taskB}`,
          kind: 'task',
          label: '## Parent objective (context only)',
          status: 'running',
          mission_id: 'mission-1',
          task_id: taskB,
        }, {
          node_id: `execution:${executionId}`,
          kind: 'execution',
          label: '完成跨角色调查并汇总证据',
          status: 'running',
          mission_id: 'mission-1',
          task_id: taskB,
          execution_id: executionId,
        }, {
          node_id: `team:${teamId}`,
          kind: 'team',
          label: teamId,
          status: 'running',
          mission_id: 'mission-1',
          task_id: taskB,
          execution_id: executionId,
          team_id: teamId,
        }, {
          node_id: 'agent:researcher',
          kind: 'agent',
          label: 'instance:run-1:run:researcher:1',
          status: 'completed',
          mission_id: 'mission-1',
          task_id: taskA,
          execution_id: executionId,
          team_id: teamId,
          agent_id: 'instance:run-1:run:researcher:1',
        }],
        edges: [{
          edge_id: 'mission-task-a',
          kind: 'contains',
          from_node_id: 'mission:mission-1',
          to_node_id: `task:${taskA}`,
        }, {
          edge_id: 'mission-task-b',
          kind: 'contains',
          from_node_id: 'mission:mission-1',
          to_node_id: `task:${taskB}`,
        }, {
          edge_id: 'task-execution',
          kind: 'contains',
          from_node_id: `task:${taskB}`,
          to_node_id: `execution:${executionId}`,
        }, {
          edge_id: 'execution-team',
          kind: 'contains',
          from_node_id: `execution:${executionId}`,
          to_node_id: `team:${teamId}`,
        }, {
          edge_id: 'team-agent',
          kind: 'delegated_to',
          from_node_id: `team:${teamId}`,
          to_node_id: 'agent:researcher',
        }],
      },
    } as any);

    expect(graph?.nodes.map((node) => node.node_id)).toEqual([
      'mission:mission-1',
      `team:${teamId}`,
      'agent:researcher',
    ]);
    expect(graph?.nodes.map((node) => node.summary)).toEqual([
      '任务目标',
      '协作团队',
      '研究智能体 1',
    ]);
    expect(graph?.objective).toContain('完成跨角色调查');
    expect(graph?.nodes[0]?.description).toContain('完成跨角色调查');
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'mission:mission-1',
        to: `team:${teamId}`,
      }),
      expect.objectContaining({
        from: `team:${teamId}`,
        to: 'agent:researcher',
      }),
    ]));
    expect(graph?.diagnostics).toMatchObject({
      folded_execution_nodes: 1,
      folded_internal_task_nodes: 2,
    });
  });

  it('projects a proven tool output handoff as an Agent relationship', () => {
    const graph = adaptMissionControlGraph({
      missions: [{
        mission_id: 'mission-1',
        objective: '完成研究并交由审查智能体复核',
        status: 'active',
        revision: 2,
      }],
      mission_graph: {
        schema_version: 1,
        mission_id: 'mission-1',
        nodes: [{
          node_id: 'mission:mission-1',
          kind: 'mission',
          label: '完成研究并交由审查智能体复核',
          status: 'active',
          mission_id: 'mission-1',
        }, {
          node_id: 'agent:researcher',
          kind: 'agent',
          label: 'researcher',
          status: 'completed',
          mission_id: 'mission-1',
          agent_id: 'agent-run-researcher',
        }, {
          node_id: 'agent:reviewer',
          kind: 'agent',
          label: 'reviewer',
          status: 'running',
          mission_id: 'mission-1',
          agent_id: 'agent-run-reviewer',
        }],
        edges: [{
          edge_id: 'mission-researcher',
          kind: 'delegated_to',
          from_node_id: 'mission:mission-1',
          to_node_id: 'agent:researcher',
        }, {
          edge_id: 'mission-reviewer',
          kind: 'delegated_to',
          from_node_id: 'mission:mission-1',
          to_node_id: 'agent:reviewer',
        }],
      },
    } as any, [{
      activities: [{
        activity_id: 'tool:research',
        kind: 'tool',
        status: 'completed',
        agent_run_id: 'agent-run-researcher',
      }, {
        activity_id: 'artifact:research',
        kind: 'artifact',
        status: 'completed',
        parent_activity_id: 'tool:research',
      }, {
        activity_id: 'tool:review',
        kind: 'tool',
        status: 'running',
        agent_run_id: 'agent-run-reviewer',
      }],
      activity_relations: [{
        relation_id: 'produced',
        kind: 'produced',
        from_activity_id: 'tool:research',
        to_activity_id: 'artifact:research',
      }, {
        relation_id: 'consumed',
        kind: 'consumed',
        from_activity_id: 'artifact:research',
        to_activity_id: 'tool:review',
        evidence_ref: 'evidence:handoff',
      }],
    } as any]);

    expect(graph?.edges).toContainEqual(expect.objectContaining({
      from: 'agent:researcher',
      to: 'agent:reviewer',
      kind: 'consumed',
      evidence_refs: ['evidence:handoff'],
    }));
  });

  it('uses the frozen agent display identity instead of role heuristics', () => {
    const graph = adaptMissionControlGraph({
      missions: [{
        mission_id: 'mission-1',
        objective: 'target',
        status: 'active',
        revision: 2,
      }],
      mission_graph: {
        schema_version: 1,
        mission_id: 'mission-1',
        nodes: [{
          node_id: 'mission:mission-1',
          kind: 'mission',
          label: 'target',
          status: 'active',
          mission_id: 'mission-1',
        }, {
          node_id: 'agent:explore-1',
          kind: 'agent',
          label: 'agent-id',
          status: 'completed',
          mission_id: 'mission-1',
          agent_id: 'instance:agent:1',
          display_label: 'Explore',
          display_role_label: '供应链专家',
          display_focus_label: 'surfaces-webui',
          display_provenance: 'runtime.agent-binding:digest',
          display_digest: 'abc',
        }],
        edges: [{
          edge_id: 'mission-agent',
          kind: 'delegated_to',
          from_node_id: 'mission:mission-1',
          to_node_id: 'agent:explore-1',
        }],
      },
    } as any);

    expect(graph?.nodes.find((node) => node.kind === 'agent_task')).toMatchObject({
      summary: '供应链专家',
      display_label: 'Explore',
      display_role_label: '供应链专家',
      display_focus_label: 'surfaces-webui',
      display_digest: 'abc',
    });
  });
});
