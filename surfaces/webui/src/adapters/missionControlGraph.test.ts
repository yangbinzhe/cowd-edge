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
});
