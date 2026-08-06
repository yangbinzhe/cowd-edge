import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type {
  ExecutionActivityProjection,
  ExecutionProjection,
} from '../../types';
import { canonicalActivityEvents } from '../../adapters/executionActivity';
import ExecutionActivityTree from './ExecutionActivityTree.vue';

function activity(
  id: string,
  kind: ExecutionActivityProjection['kind'],
  parent?: string,
): ExecutionActivityProjection {
  return {
    schema_version: 1,
    activity_id: id,
    scope: {
      workspace_id: 'workspace',
      session_id: 'session',
      turn_id: 'turn',
      execution_id: kind === 'agent' ? 'agent-run' : 'execution',
    },
    kind,
    visibility: ['narrative', 'operational', 'audit'],
    parent_activity_id: parent,
    causal_parent_ids: [],
    dependency_ids: [],
    agent_run_id: kind === 'agent' ? 'agent-run' : undefined,
    status: 'running',
    sequence: kind === 'agent' ? 2 : 1,
    commit_cursor: 1,
    public_summary: id,
    artifact_refs: [],
    evidence_refs: [],
  };
}

describe('ExecutionActivityTree', () => {
  it('renders an Agent reasoning projection without adding a business activity node', () => {
    const root = activity('execution', 'execution');
    const agent = activity('agent:researcher', 'agent', root.activity_id);
    const activities = canonicalActivityEvents([{
      execution_id: 'execution',
      activities: [root, agent],
    } as unknown as ExecutionProjection]);
    const wrapper = mount(ExecutionActivityTree, {
      props: {
        activities,
        relations: [],
        reasoningGroups: {
          [agent.activity_id]: {
            ownerActivityId: agent.activity_id,
            scope: 'agent',
            items: [{
              id: 'reasoning:1',
              text: '核对代码调用链。',
              status: 'running',
              sequence: 1,
            }],
            latest: {
              id: 'reasoning:1',
              text: '核对代码调用链。',
              status: 'running',
              sequence: 1,
            },
            running: true,
            count: 1,
          },
        },
      },
    });

    const agentNode = wrapper.get('.execution-activity-node[data-kind="agent"]');
    expect(agentNode.get('.reasoning-group.is-agent').text()).toContain('核对代码调用链');
    expect(wrapper.findAll('.execution-activity-node')).toHaveLength(2);
  });
});
