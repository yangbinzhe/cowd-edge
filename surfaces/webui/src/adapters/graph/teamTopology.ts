import type { GraphViewModel } from '../../types/graph';

export function adaptTeamTopology(template: Record<string, any> | null, workingState: Record<string, any> | null): GraphViewModel {
  const roles = Array.isArray(template?.roles) ? template.roles : [];
  const dependencies = Array.isArray(template?.dependencies) ? template.dependencies : [];
  const entries = Array.isArray(workingState?.working_state?.entries) ? workingState.working_state.entries : [];
  const entryByNode = new Map(entries.map((entry: any) => [String(entry.node_id || entry.role_id || ''), entry]));
  return {
    id: String(template?.revision_ref?.template_id || 'team-topology'),
    title: String(template?.name || template?.topology?.protocol_ref || ''),
    revision: Number(template?.revision_ref?.revision || 0),
    status: entries.length ? 'live' : 'ready',
    nodes: roles.map((role: any) => {
      const working = entryByNode.get(String(role.role_id));
      return {
        id: String(role.role_id),
        type: 'team-role',
        label: String(role.role_id),
        status: String(working?.status || (working ? 'running' : 'ready')),
        group: String(role.agent_definition_id || ''),
        summary: String(working?.summary || role.responsibility || role.task_contract?.contract_ref || ''),
        evidenceRefs: Array.isArray(working?.refs) ? working.refs.map(String) : [],
        badges: [role.cardinality?.kind, role.partition?.kind, role.task_contract?.contract_ref].filter(Boolean).map(String),
        raw: { ...role, working_state: working || null },
      };
    }),
    edges: dependencies.map((dependency: any, index: number) => ({
      id: `${dependency.from_role_id}:${dependency.to_role_id}:${index}`,
      source: String(dependency.from_role_id),
      target: String(dependency.to_role_id),
      type: 'role-dependency',
      label: 'depends on',
      raw: dependency,
    })),
  };
}
