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
});
