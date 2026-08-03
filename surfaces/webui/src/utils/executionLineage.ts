import type { ExecutionProjection } from '../types';
import { t } from '../i18n';

// Team graphs admit up to 32 Agent nodes, with Mission and per-Agent child
// graphs around them. The canonical projections remain available for evidence
// drill-down; this module produces the compact business collaboration view.
const MAX_LINEAGE_PROJECTIONS = 64;

function text(value: unknown) {
  return String(value || '').trim();
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function decodedJson(value: unknown) {
  let decoded = value;
  for (let depth = 0; depth < 3 && typeof decoded === 'string'; depth += 1) {
    const trimmed = decoded.trim();
    if (!trimmed || !['{', '[', '"'].includes(trimmed[0])) return decoded;
    try {
      const next = JSON.parse(trimmed);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return decoded;
    }
  }
  return decoded;
}

function completedStatus(value: unknown) {
  const status = text(value).toLowerCase();
  if (['complete', 'completed', 'terminal', 'succeeded', 'success'].includes(status)) {
    return 'completed';
  }
  return status || 'planned';
}

function semanticNodeId(kind: string, executionId: string, suffix = '') {
  return `semantic::${kind}::${executionId}${suffix ? `::${suffix}` : ''}`;
}

function agentRole(nodeId: unknown) {
  const parts = text(nodeId).split(':').filter(Boolean);
  const slot = parts.at(-1) || '';
  const role = parts.at(-2) || 'agent';
  return { role, slot };
}

function conciseResult(value: unknown) {
  const decoded = decodedJson(value);
  if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
    const result = record(decoded);
    const summary = text(result.summary || result.conclusion || result.result || result.title);
    if (summary) return summary;
    const findings = Array.isArray(result.findings) ? result.findings : [];
    if (findings.length) return t('execution.findingCount', { count: findings.length });
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
    if (evidence.length) return t('execution.evidenceCount', { count: evidence.length });
    const claims = Array.isArray(result.claims) ? result.claims : [];
    if (claims.length) return t('execution.claimCount', { count: claims.length });
  }
  const raw = text(value);
  if (!raw) return '';
  if (raw.startsWith('{"findings":[')) {
    const count = Math.max(1, (raw.match(/"description"\s*:/g) || []).length);
    return t('execution.findingCount', { count });
  }
  if (raw.startsWith('{"evidence":[')) {
    const count = (raw.match(/"claims"\s*:/g) || []).length;
    return count
      ? t('execution.evidenceCount', { count })
      : t('execution.structuredEvidenceReady');
  }
  if (raw.startsWith('{') || raw.startsWith('[')) {
    return t('execution.structuredOutputReady');
  }
  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
}

function objectiveFocus(value: unknown) {
  const objective = text(value);
  const focus = objective.match(/^Focus:\s*(.+)$/mi)?.[1]?.trim();
  const responsibility = objective.match(/^Responsibility:\s*(.+)$/mi)?.[1]?.trim();
  return focus || responsibility || objective;
}

function toolBatchCalls(node: Record<string, any>) {
  const payload = record(decodedJson(node.payload_ref));
  if (!Array.isArray(payload.calls)) return [];
  return payload.calls.flatMap((value: unknown) => {
    const call = record(value);
    const id = text(call.id);
    const name = text(call.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      input: decodedJson(call.input),
      depends_on: Array.isArray(call.depends_on)
        ? call.depends_on.map(String).filter(Boolean)
        : [],
    }];
  });
}

function aggregateTools(projections: ExecutionProjection[]) {
  const batches = projections.flatMap((projection) => (
    (Array.isArray(projection.graph?.nodes) ? projection.graph.nodes : [])
      .filter((node: any) => text(node?.kind).toLowerCase() === 'tool_batch')
      .map((node: any) => ({
        execution_id: projection.execution_id,
        node_id: text(node.node_id),
        status: completedStatus(node.status),
        usage: record(node.usage),
        calls: toolBatchCalls(node),
        summary: text(node.summary),
        result_ref: text(node.result_ref),
        evidence_refs: Array.isArray(node.evidence_refs) ? node.evidence_refs : [],
      }))
  ));
  const calls = batches.flatMap((batch) => batch.calls.map((call) => ({
    ...call,
    execution_id: batch.execution_id,
    batch_node_id: batch.node_id,
    status: batch.status,
  })));
  const tools = [...new Set(calls.map((call) => call.name))];
  const failedBatches = batches.filter((batch) => ['failed', 'error', 'blocked'].includes(batch.status));
  const maxParallelWidth = Math.max(
    0,
    ...batches.map((batch) => batch.calls.filter((call) => !call.depends_on.length).length),
  );
  return {
    batches,
    calls,
    tools,
    failed_batches: failedBatches.length,
    max_parallel_width: maxParallelWidth,
    duration_ms: batches.reduce((sum, batch) => sum + Number(batch.usage.duration_ms || 0), 0),
    evidence_refs: [...new Set(batches.flatMap((batch) => batch.evidence_refs).map(String))],
  };
}

export function executionProjectionLinks(projection: ExecutionProjection | null) {
  if (!projection) return [];
  const links = new Set<string>();
  const rootId = text(projection.execution_id);
  const strategyId = text((projection.strategy as any)?.team_execution_id);
  if (strategyId && strategyId !== rootId) links.add(strategyId);
  for (const team of Array.isArray(projection.teams) ? projection.teams : []) {
    const graphId = text((team as any)?.detail?.graph_id);
    if (graphId && graphId !== rootId) links.add(graphId);
  }
  for (const child of Array.isArray(projection.child_executions) ? projection.child_executions : []) {
    const executionId = text(child?.execution_id);
    if (executionId && executionId !== rootId) links.add(executionId);
  }
  return [...links].slice(0, MAX_LINEAGE_PROJECTIONS);
}

function childBindings(projections: ExecutionProjection[]) {
  const bindings = new Map<string, { parent: string; parentNode: string; status: string }>();
  for (const projection of projections) {
    for (const child of Array.isArray(projection.child_executions) ? projection.child_executions : []) {
      const childId = text(child?.execution_id);
      if (!childId || bindings.has(childId)) continue;
      bindings.set(childId, {
        parent: text(child?.parent_execution_id) || text(projection.execution_id),
        parentNode: text(child?.parent_node_id),
        status: completedStatus(child?.status),
      });
    }
  }
  return bindings;
}

function teamExecutionIds(root: ExecutionProjection, available: ExecutionProjection[]) {
  const ids = new Set<string>();
  for (const team of Array.isArray(root.teams) ? root.teams : []) {
    const graphId = text((team as any)?.detail?.graph_id);
    if (graphId) ids.add(graphId);
  }
  for (const projection of available) {
    const executionId = text(projection.execution_id);
    if (executionId.startsWith('team-graph:')) ids.add(executionId);
  }
  return [...ids];
}

function rootNode(root: ExecutionProjection, rootId: string) {
  const metrics = record(root.live?.metrics);
  return {
    node_id: semanticNodeId('goal', rootId),
    kind: 'execution',
    executor_kind: 'execution',
    status: completedStatus(root.live?.status || (root.graph as any)?.status),
    summary: objectiveFocus(root.graph?.objective) || rootId,
    description: text(root.graph?.objective),
    output: root.live?.output_preview || root.graph?.terminal_result_ref || null,
    usage: {
      input_tokens: Number(metrics.input_tokens || 0),
      output_tokens: Number(metrics.output_tokens || 0),
      total_tokens: Number(metrics.total_tokens || 0),
      tool_calls: Number(metrics.tool_calls || 0),
      duration_ms: Number(root.live?.latency?.total_elapsed_ms || 0),
    },
    evidence_refs: [],
    execution_id: rootId,
    semantic_view: true,
  };
}

function teamAgentNodes(
  teamId: string,
  teamIndex: number,
  projection: ExecutionProjection,
  available: ExecutionProjection[],
  bindings: Map<string, { parent: string; parentNode: string; status: string }>,
) {
  const graphNodes = Array.isArray(projection.graph?.nodes) ? projection.graph.nodes : [];
  const graphEdges = Array.isArray(projection.graph?.edges) ? projection.graph.edges : [];
  const agents = graphNodes.filter((node: any) => text(node?.kind).toLowerCase() === 'agent_task');
  const agentIds = new Set(agents.map((node: any) => text(node.node_id)));
  const nodes: Record<string, any>[] = [];
  const edges: Record<string, any>[] = [];

  for (const agent of agents) {
    const originalNodeId = text(agent.node_id);
    const nodeId = semanticNodeId('agent', teamId, originalNodeId);
    const identity = agentRole(originalNodeId);
    const childProjection = available.find((candidate) => {
      const binding = bindings.get(text(candidate.execution_id));
      return binding?.parent === teamId && binding.parentNode === originalNodeId;
    });
    const agentOutput = decodedJson(agent.summary);
    const focus = objectiveFocus(childProjection?.graph?.objective);
    const tools = childProjection ? aggregateTools([childProjection]) : aggregateTools([]);
    const toolExecution = {
      tools: tools.tools,
      calls: tools.calls,
      batches: tools.batches.map((batch) => ({
        node_id: batch.node_id,
        status: batch.status,
        summary: batch.summary,
        result_ref: batch.result_ref,
      })),
      call_count: tools.calls.length,
      batch_count: tools.batches.length,
      max_parallel_width: tools.max_parallel_width,
      failed_batches: tools.failed_batches,
      duration_ms: tools.duration_ms,
    };
    nodes.push({
      ...agent,
      node_id: nodeId,
      original_node_id: originalNodeId,
      execution_id: teamId,
      child_execution_id: childProjection?.execution_id || null,
      kind: 'agent_task',
      executor_kind: identity.role,
      semantic_role: identity.role,
      semantic_slot: identity.slot,
      semantic_team_index: teamIndex,
      status: completedStatus(agent.status || childProjection?.live?.status),
      summary: focus || `${identity.role} ${identity.slot}`,
      description: focus || text(projection.graph?.objective),
      output_summary: conciseResult(agent.summary),
      input: {
        role: identity.role,
        slot: identity.slot,
        objective: text(childProjection?.graph?.objective || projection.graph?.objective),
      },
      output: {
        result: agentOutput || agent.result_ref || null,
        tool_execution: toolExecution,
      },
      usage: {
        ...record(agent.usage),
        tool_calls: tools.calls.length || Number(agent.usage?.tool_calls || 0),
        duration_ms: tools.duration_ms || Number(agent.usage?.duration_ms || 0),
      },
      evidence_refs: [
        ...new Set([
          ...(Array.isArray(agent.evidence_refs) ? agent.evidence_refs : []),
          ...tools.evidence_refs,
        ].map(String)),
      ],
      canonical_node_ids: tools.batches.map((batch) => batch.node_id),
      semantic_metrics: {
        tool_calls: tools.calls.length || Number(agent.usage?.tool_calls || 0),
        batches: tools.batches.length,
        max_parallel_width: tools.max_parallel_width,
        failed_batches: tools.failed_batches,
      },
      semantic_view: true,
    });
  }

  const semanticAgentId = (originalNodeId: unknown) => (
    semanticNodeId('agent', teamId, text(originalNodeId))
  );
  for (const edge of graphEdges) {
    const source = text(edge?.from);
    const target = text(edge?.to);
    if (!agentIds.has(source) || !agentIds.has(target)) continue;
    edges.push({
      ...edge,
      from: semanticAgentId(source),
      to: semanticAgentId(target),
    });
  }

  return { nodes, edges, agentIds, semanticAgentId };
}

function addDirectExecution(
  root: ExecutionProjection,
  available: ExecutionProjection[],
  nodes: Record<string, any>[],
  edges: Record<string, any>[],
  rootNodeId: string,
) {
  const rootId = text(root.execution_id);
  const agentNodeId = semanticNodeId('agent', rootId, 'primary');
  const metrics = record(root.live?.metrics);
  const tools = aggregateTools(available);
  const result = root.live?.output_preview || root.graph?.terminal_result_ref || null;
  nodes.push({
    node_id: agentNodeId,
    kind: 'agent_task',
    executor_kind: 'primary',
    semantic_role: 'primary',
    semantic_slot: '1',
    status: completedStatus(root.live?.status || (root.graph as any)?.status),
    summary: objectiveFocus(root.graph?.objective),
    description: text(root.graph?.objective),
    output_summary: conciseResult(result),
    input: { objective: text(root.graph?.objective) },
    output: {
      result,
      tool_execution: {
        tools: tools.tools,
        calls: tools.calls,
        batches: tools.batches,
        call_count: tools.calls.length,
        batch_count: tools.batches.length,
        max_parallel_width: tools.max_parallel_width,
        failed_batches: tools.failed_batches,
        duration_ms: tools.duration_ms,
      },
    },
    usage: {
      input_tokens: Number(metrics.input_tokens || 0),
      output_tokens: Number(metrics.output_tokens || 0),
      total_tokens: Number(metrics.total_tokens || 0),
      tool_calls: tools.calls.length || Number(metrics.tool_calls || 0),
    },
    evidence_refs: tools.evidence_refs,
    canonical_node_ids: tools.batches.map((batch) => batch.node_id),
    semantic_metrics: {
      tool_calls: tools.calls.length || Number(metrics.tool_calls || 0),
      batches: tools.batches.length,
      max_parallel_width: tools.max_parallel_width,
      failed_batches: tools.failed_batches,
    },
    execution_id: rootId,
    semantic_view: true,
  });
  edges.push({ from: rootNodeId, to: agentNodeId, kind: 'produces' });
}

export function combineExecutionLineage(
  rootExecutionId: string,
  projections: Array<ExecutionProjection | null>,
) {
  const requestedRootId = text(rootExecutionId);
  const available = projections
    .filter((projection): projection is ExecutionProjection => !!projection?.execution_id)
    .filter((projection, index, rows) => (
      rows.findIndex((candidate) => candidate.execution_id === projection.execution_id) === index
    ))
    .slice(0, MAX_LINEAGE_PROJECTIONS);
  if (!available.length) return null;

  const byId = new Map(available.map((projection) => [text(projection.execution_id), projection]));
  const root = byId.get(requestedRootId) || available[0];
  const rootId = text(root.execution_id);
  const bindings = childBindings(available);
  const nodes: Record<string, any>[] = [];
  const edges: Record<string, any>[] = [];
  const semanticRoot = rootNode(root, rootId);
  nodes.push(semanticRoot);

  const teamIds = teamExecutionIds(root, available);
  for (const [index, teamId] of teamIds.entries()) {
    const teamProjection = byId.get(teamId);
    const binding = bindings.get(teamId);
    const graphAgents = Array.isArray(teamProjection?.graph?.nodes)
      ? teamProjection!.graph.nodes.filter((node: any) => text(node?.kind).toLowerCase() === 'agent_task')
      : [];
    const teamStatus = completedStatus(
      teamProjection?.live?.status
      || (teamProjection?.graph as any)?.status
      || binding?.status,
    );
    const completedAgents = graphAgents.filter((node: any) => completedStatus(node.status) === 'completed').length;
    const toolCalls = graphAgents.reduce((sum: number, node: any) => (
      sum + Number(node?.usage?.tool_calls || 0)
    ), 0);
    const synthesis = [...graphAgents].reverse().find((node: any) => (
      agentRole(node?.node_id).role === 'synthesizer'
    ));
    const teamNodeId = semanticNodeId('team', teamId);
    nodes.push({
      node_id: teamNodeId,
      kind: 'team',
      executor_kind: 'team',
      semantic_index: index + 1,
      status: teamStatus,
      summary: t('execution.teamProgress', {
        completed: completedAgents,
        total: graphAgents.length,
        tools: toolCalls,
      }),
      description: text(teamProjection?.graph?.objective || binding?.parent),
      output_summary: conciseResult(synthesis?.summary || teamProjection?.live?.output_preview),
      input: {
        objective: text(teamProjection?.graph?.objective),
        agent_count: graphAgents.length,
      },
      output: decodedJson(synthesis?.summary)
        || teamProjection?.live?.output_preview
        || teamProjection?.graph?.terminal_result_ref
        || null,
      usage: {
        tool_calls: toolCalls,
        input_tokens: graphAgents.reduce((sum: number, node: any) => sum + Number(node?.usage?.input_tokens || 0), 0),
        output_tokens: graphAgents.reduce((sum: number, node: any) => sum + Number(node?.usage?.output_tokens || 0), 0),
        total_tokens: graphAgents.reduce((sum: number, node: any) => (
          sum + Number(node?.usage?.input_tokens || 0) + Number(node?.usage?.output_tokens || 0)
        ), 0),
      },
      semantic_metrics: {
        agents_completed: completedAgents,
        agents_total: graphAgents.length,
        tool_calls: toolCalls,
      },
      execution_id: teamId,
      evidence_refs: Array.isArray(synthesis?.evidence_refs) ? synthesis.evidence_refs : [],
      semantic_view: true,
    });
    edges.push({
      from: semanticRoot.node_id,
      to: teamNodeId,
      kind: 'delegates',
    });

    if (!teamProjection) continue;
    const teamAgents = teamAgentNodes(teamId, index + 1, teamProjection, available, bindings);
    nodes.push(...teamAgents.nodes);
    edges.push(...teamAgents.edges);

    const incomingAgents = new Set(
      teamAgents.edges
        .map((edge) => text(edge.to)),
    );
    for (const originalAgentId of teamAgents.agentIds) {
      const agentNodeId = teamAgents.semanticAgentId(originalAgentId);
      if (incomingAgents.has(agentNodeId)) continue;
      edges.push({
        from: teamNodeId,
        to: agentNodeId,
        kind: 'delegates',
      });
    }
  }

  if (!teamIds.length) {
    addDirectExecution(root, available, nodes, edges, semanticRoot.node_id);
  }

  const semanticAgents = nodes.filter((node) => node.kind === 'agent_task');
  const semanticTeams = nodes.filter((node) => node.kind === 'team');
  const agentToolCalls = semanticAgents.reduce(
    (sum, node) => sum + Number(node.semantic_metrics?.tool_calls || 0),
    0,
  );
  const reportedToolCalls = Number(semanticRoot.usage?.tool_calls || 0);
  semanticRoot.semantic_metrics = {
    teams: semanticTeams.length,
    agents: semanticAgents.length,
    agents_completed: semanticAgents.filter((node) => completedStatus(node.status) === 'completed').length,
    tool_calls: Math.max(agentToolCalls, reportedToolCalls),
    orchestration_calls: Math.max(0, reportedToolCalls - agentToolCalls),
  };
  semanticRoot.output_summary = conciseResult(semanticRoot.output);

  return {
    graph_id: `semantic-lineage:${rootId}`,
    objective: text(root.graph?.objective) || rootId,
    status: completedStatus(root.live?.status || (root.graph as any)?.status),
    revision: Math.max(...available.map((projection) => Number(projection.revision || 0))),
    nodes,
    edges,
    semantic_view: true,
    canonical_graph_id: text(root.graph?.graph_id || rootId),
    lineage_execution_ids: available.map((projection) => projection.execution_id),
  };
}
