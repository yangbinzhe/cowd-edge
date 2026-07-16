<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Play, RefreshCw, Search, Users } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import ObjectInspectorDrawer from '../components/workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import { displayStatus } from '../i18n/domain/status';
import { useAppStore } from '../stores/app';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';

const store = useAppStore();
const projections = useProjectionRegistryStore();
const selectedExecutionId = ref('');
const loading = ref(false);
const error = ref('');
const catalog = ref<any>({});
const directory = ref<any>({});
const discovery = ref<any>({});
const selfModels = ref<any>({});
const runs = ref<any>({});
const tasks = ref<any>({});
const graph = ref<any>({});
const teamTemplates = ref<any>({});
const managedAgents = ref<any>({});
const actionResult = ref<any>(null);
const managedActionResult = ref<any>(null);
const teamResult = ref<any>(null);
const teamWorkingState = ref<any>(null);
const selectedTaskId = ref('');
const selectedTemplateId = ref('');
const objective = ref('');
const discoverQuery = ref('');
const phaseName = ref('');
const phaseObjective = ref('');
const artifactLabel = ref('');
const artifactValue = ref('');
const reviewResult = ref('');
const failureReason = ref('');
const selectedDetail = ref<Record<string, unknown> | null>(null);
const managedDefinitionId = ref('workspace/cowd/managed-agent');
const managedTargetDefinition = ref('');
const managedTargetKind = ref<'agent' | 'team'>('agent');
const managedTriggerKind = ref<'manual' | 'at' | 'interval' | 'cron' | 'event'>('manual');
const managedObjective = ref('');
const managedCapabilities = ref('read');
const managedAcceptance = ref('evidence-backed result');
const managedEnabled = ref(true);
const managedAtMs = ref('');
const managedIntervalMs = ref('3600000');
const managedCronExpression = ref('0 * * * *');
const managedCronTimezone = ref('UTC');
const managedEventSourceId = ref('');
const managedEventSourceKind = ref('connector_source');
const managedEventType = ref('');
const managedEventCapabilities = ref('connector.source.event.receive');
const managedEventAttributes = ref('');
const managedEventMaximumAgeMs = ref('');
const managedEventOrderPolicy = ref<'accept_any' | 'reject_older_sequence'>('accept_any');
const selectedManagedDefinitionId = ref('');
const selectedManagedHealthId = ref('');

const agentRows = computed(() => (Array.isArray(directory.value?.agents) ? directory.value.agents : Array.isArray(catalog.value?.agents) ? catalog.value.agents : []).map((agent: any) => ({
  name: agent.name,
  active: agent.active,
  source: agent.source?.id || agent.source || '-',
  model: agent.model || '-',
  description: agent.description || '-',
})));
const discoveredRows = computed(() => (Array.isArray(discovery.value?.agents) ? discovery.value.agents : []).map((agent: any) => ({
  agent_id: agent.agent_id,
  definition: `${agent.definition_ref?.definition_id || '-'}@${agent.definition_ref?.revision ?? '-'}`,
  capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.join(', ') : '-',
  status: agent.scope || '-',
})));
const taskItems = computed(() => Array.isArray(tasks.value?.tasks) ? tasks.value.tasks : []);
const selectedTask = computed(() => taskItems.value.find((task: any) => task.id === selectedTaskId.value) || tasks.value?.current || taskItems.value[0] || null);
const phaseItems = computed(() => Array.isArray(selectedTask.value?.phases) ? selectedTask.value.phases : []);
const currentPhase = computed(() => phaseItems.value.find((phase: any) => phase.id === selectedTask.value?.current_phase) || phaseItems.value[0] || null);
const graphNodes = computed(() => Array.isArray(graph.value?.nodes) ? graph.value.nodes : []);
const runItems = computed(() => Array.isArray(runs.value?.runs) ? runs.value.runs : []);
const teamTemplateItems = computed(() => Array.isArray(teamTemplates.value?.templates) ? teamTemplates.value.templates : []);
const managedDefinitionItems = computed(() => Array.isArray(managedAgents.value?.definitions) ? managedAgents.value.definitions : []);
const managedInvocations = computed(() => Array.isArray(managedAgents.value?.invocations) ? managedAgents.value.invocations : []);
const managedEffects = computed(() => Array.isArray(managedAgents.value?.effects) ? managedAgents.value.effects : []);
const managedHealth = computed(() => Array.isArray(managedAgents.value?.health) ? managedAgents.value.health : []);
const managedDefinitionRows = computed(() => managedDefinitionItems.value.map((definition: any) => ({
  id: definition.managed_agent_id,
  revision: definition.revision,
  target: definition.target?.definition_id || definition.target?.template_id || '-',
  target_kind: managedTargetLabel(definition.target?.kind),
  trigger: managedTriggerLabel(definition.trigger),
  enabled: definition.enabled !== false,
  objective: definition.objective,
})));
const managedInvocationRows = computed(() => managedInvocations.value.slice(0, 20).map((invocation: any) => ({
  id: invocation.invocation_id,
  definition: `${invocation.definition_id}@${invocation.definition_revision}`,
  status: invocation.status,
  attempt: invocation.attempt_no,
  trigger: invocation.trigger?.kind || '-',
  execution: invocation.execution_ref || '-',
  error: invocation.error || '-',
})));
const managedHealthRows = computed(() => managedHealth.value.map((health: any) => ({
  id: health.managed_agent_id,
  revision: health.revision,
  status: health.status,
  failures: `${health.consecutive_failures}/${health.max_consecutive_failures}`,
  active: Array.isArray(health.active_invocation_ids) ? health.active_invocation_ids.length : 0,
})));
const managedEffectRows = computed(() => managedEffects.value.slice(0, 20).map((effect: any) => ({
  id: effect.effect_id,
  invocation: effect.invocation_id,
  kind: effect.effect_kind,
  status: effect.status,
  receipt: effect.receipt_ref || '-',
  error: effect.error || '-',
})));
const selectedManagedDefinition = computed(() => managedDefinitionRows.value.find((definition: any) => definition.id === selectedManagedDefinitionId.value) || null);
const selectedManagedHealth = computed(() => managedHealthRows.value.find((health: any) => health.id === selectedManagedHealthId.value) || null);
const managedTargetOptions = computed(() => {
  const agents = Array.isArray(directory.value?.agents) ? directory.value.agents : [];
  const agentOptions = agents
    .map((agent: any) => agent.definition_ref?.definition_id || agent.source?.id || agent.id)
    .filter(Boolean)
    .map((id: string) => ({ id, kind: 'agent' as const }));
  const teamOptions = teamTemplateItems.value
    .map((template: any) => template.revision_ref?.template_id)
    .filter(Boolean)
    .map((id: string) => ({ id, kind: 'team' as const }));
  return [...agentOptions, ...teamOptions];
});
const selectedTeamTemplate = computed(() => teamTemplateItems.value.find((template: any) => template?.revision_ref?.template_id === selectedTemplateId.value) || teamTemplateItems.value[0] || null);
const selfModelRows = computed(() => (Array.isArray(selfModels.value?.items) ? selfModels.value.items : []).map((item: any) => ({
  definition: `${item.definition_id || '-'}@${item.definition_revision ?? '-'}`,
  environment: item.environment_fingerprint || '-',
  runs: item.run_count ?? 0,
  successful: item.success_count ?? 0,
  failed: item.failure_count ?? 0,
  success_rate: item.run_count ? `${Math.round((Number(item.success_count || 0) / Number(item.run_count)) * 100)}%` : '-',
  tools: item.total_tool_calls ?? 0,
  evidence: (item.successful_evidence_refs?.length || 0) + (item.failed_evidence_refs?.length || 0),
})));
const openTasks = computed(() => taskItems.value.filter((task: any) => !['completed', 'cancelled'].includes(String(task.status))).length);
const agentsContext = computed(() => [
  { label: t('script.pages.agentspage.label.64acf7e2a7'), value: agentRows.value.length, tone: agentRows.value.length ? 'success' : 'warn' },
  { label: t('page.agents.teamTemplates.metric'), value: teamTemplateItems.value.length },
  { label: t('script.pages.agentspage.label.ef2960c6f7'), value: openTasks.value, tone: openTasks.value ? 'warn' : 'success' },
  { label: t('script.pages.agentspage.label.91a4801bd6'), value: graphNodes.value.length },
]);
const agentsWorkflow = computed(() => [
  { id: 'catalog', label: t('script.pages.agentspage.label.4827ea2271'), status: agentRows.value.length ? 'ready' : 'idle', count: agentRows.value.length },
  { id: 'team_templates', label: t('page.agents.teamTemplates.metric'), status: teamTemplateItems.value.length ? 'ready' : 'idle', count: teamTemplateItems.value.length },
  { id: 'tasks', label: t('script.pages.agentspage.label.7bb0ddf922'), status: selectedTask.value ? 'active' : 'idle', description: selectedTask.value?.status || 'none' },
  { id: 'tasks', label: t('script.pages.agentspage.label.f6371a4980'), status: currentPhase.value ? 'active' : 'idle', description: currentPhase.value?.status || 'pending' },
  { id: 'graph', label: t('script.pages.agentspage.label.9a7405ebce'), status: graphNodes.value.length ? 'ready' : 'idle', count: graphNodes.value.length },
  { id: 'reviews', label: t('script.pages.agentspage.label.e29a79fe0c'), status: reviewResult.value ? 'done' : 'idle' },
  { id: 'runs', label: t('script.pages.agentspage.label.b1b392607d'), status: runItems.value.length ? 'ready' : 'idle', count: runItems.value.length },
]);
const agentEvidence = computed(() => [
  ...graphNodes.value.slice(0, 4).map((node: any) => ({
    id: node.id,
    kind: node.role || 'agent graph node',
    status: node.status || 'ready',
    summary: node.objective || node.title || node.id,
    source: node.assigned_agent || 'agent.graph',
  })),
  ...runItems.value.slice(0, 3).map((run: any) => ({
    id: run.graph_id || run.run_id || run.id,
    kind: 'agent run',
    status: run.status || 'recorded',
    summary: run.objective || run.graph_id || run.run_id || 'agent run',
    source: 'gateway.agents.runs',
  })),
]);
const executionProjection = computed(() => selectedExecutionId.value ? projections.projectionFor(selectedExecutionId.value) : null);
const executionNodeRows = computed(() => (executionProjection.value?.graph?.nodes || []).map((node: any) => ({
  id: node.node_id || '-',
  kind: node.kind || '-',
  status: node.status || '-',
  executor: node.executor_kind || '-',
  evidence: Array.isArray(node.evidence_refs) ? node.evidence_refs.length : 0,
})));
const executionAgentRows = computed(() => (executionProjection.value?.agents || []).map((agent: any) => ({
  id: agent.id || '-',
  status: agent.status || '-',
  summary: agent.summary || '-',
  evidence: Array.isArray(agent.evidence_refs) ? agent.evidence_refs.length : 0,
})));
const executionTeamRows = computed(() => (executionProjection.value?.teams || []).map((team: any) => ({
  id: team.id || '-',
  status: team.status || '-',
  summary: team.summary || '-',
  evidence: Array.isArray(team.evidence_refs) ? team.evidence_refs.length : 0,
})));

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextCatalog, nextDirectory, nextSelfModels, nextRuns, nextTasks, nextTemplates, nextManagedAgents] = await Promise.all([
      api.agentCatalog(),
      api.agentDirectory(),
      api.agentSelfModels(),
      api.agentRuns(),
      api.tasks(),
      api.teamTemplates(),
      api.managedAgents(),
    ]);
    catalog.value = nextCatalog;
    directory.value = nextDirectory;
    selfModels.value = nextSelfModels;
    runs.value = nextRuns;
    tasks.value = nextTasks;
    teamTemplates.value = nextTemplates;
    managedAgents.value = nextManagedAgents;
    if (!managedTargetDefinition.value) {
      managedTargetDefinition.value = nextDirectory?.agents?.[0]?.definition_ref?.definition_id
        || nextDirectory?.agents?.[0]?.source?.id
        || '';
    }
    const executionId = nextRuns?.runs?.find((run: any) => run.graph_id)?.graph_id;
    if (executionId) {
      selectedExecutionId.value = String(executionId);
      projections.acquire(selectedExecutionId.value, 'agents', 'full');
    }
    if (!selectedTaskId.value) {
      selectedTaskId.value = nextTasks?.current?.id || nextTasks?.tasks?.[0]?.id || '';
    }
    if (!selectedTemplateId.value) selectedTemplateId.value = nextTemplates?.templates?.[0]?.revision_ref?.template_id || '';
    await loadGraph();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function loadGraph() {
  if (!selectedTaskId.value) {
    graph.value = {};
    return;
  }
  graph.value = await api.taskAgentGraph(selectedTaskId.value);
  const executionId = graph.value?.execution_graph_id || graph.value?.graph_id || graph.value?.id;
  if (executionId) {
    selectedExecutionId.value = String(executionId);
    projections.acquire(selectedExecutionId.value, 'agents', 'full');
  }
}

async function startTask() {
  if (!objective.value.trim()) {
    error.value = t('page.agents.error.objectiveRequired');
    return;
  }
  actionResult.value = await api.startTask(objective.value, false);
  selectedTaskId.value = actionResult.value?.id || selectedTaskId.value;
  await refresh();
}

async function addPhase() {
  const taskId = selectedTaskId.value || selectedTask.value?.id;
  if (!taskId) return;
  if (!phaseName.value.trim() || !phaseObjective.value.trim()) {
    error.value = t('page.agents.error.phaseRequired');
    return;
  }
  actionResult.value = await api.startTaskPhase(taskId, {
    name: phaseName.value,
    objective: phaseObjective.value,
    plan: [],
    acceptance: [],
    test_commands: [],
  });
  await refresh();
}

async function recordArtifact() {
  const taskId = selectedTaskId.value || selectedTask.value?.id;
  const phaseId = currentPhase.value?.id;
  if (!taskId || !phaseId) return;
  if (!artifactLabel.value.trim() || !artifactValue.value.trim()) {
    error.value = t('page.agents.error.artifactRequired');
    return;
  }
  actionResult.value = await api.recordTaskArtifact(taskId, phaseId, {
    kind: 'validation',
    label: artifactLabel.value,
    value: artifactValue.value,
  });
  await refresh();
}

async function reviewPhase(completed = true) {
  const taskId = selectedTaskId.value || selectedTask.value?.id;
  const phaseId = currentPhase.value?.id;
  if (!taskId || !phaseId) return;
  if (!reviewResult.value.trim()) {
    error.value = t('page.agents.error.reviewRequired');
    return;
  }
  actionResult.value = await api.reviewTaskPhase(taskId, phaseId, reviewResult.value, completed);
  await refresh();
}

async function transitionTask(action: 'complete' | 'cancel' | 'failure') {
  const taskId = selectedTaskId.value || selectedTask.value?.id;
  if (!taskId) return;
  if (action === 'complete') actionResult.value = await api.completeTask(taskId);
  if (action === 'cancel') actionResult.value = await api.cancelTask(taskId);
  if (action === 'failure') {
    if (!failureReason.value.trim()) {
      error.value = t('page.agents.error.failureReasonRequired');
      return;
    }
    actionResult.value = await api.recordTaskFailure(taskId, failureReason.value);
  }
  await refresh();
}

async function discoverAgents() {
  if (!discoverQuery.value.trim()) {
    error.value = t('page.agents.error.discoveryRequired');
    return;
  }
  discovery.value = await api.agentAssemble(discoverQuery.value);
}

function selectTeamTemplate(template: any) {
  selectedTemplateId.value = template?.revision_ref?.template_id || '';
  selectedDetail.value = template || null;
}

async function instantiateSelectedTeam() {
  const template = selectedTeamTemplate.value;
  const sessionId = store.activeSessionId;
  if (!template?.revision_ref?.template_id) {
    error.value = t('page.agents.teamTemplates.error.select');
    return;
  }
  if (!objective.value.trim()) {
    error.value = t('page.agents.teamTemplates.error.objective');
    return;
  }
  if (!sessionId) {
    error.value = t('page.agents.teamTemplates.error.session');
    return;
  }
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  teamResult.value = await api.instantiateTeamTemplate({
    request_id: `webui-team-${nonce}`,
    team_id: `webui-team-${nonce}`,
    session_id: sessionId,
    selection_mode: 'explicit',
    template_selector: {
      kind: 'latest_stable',
      template_id: template.revision_ref.template_id,
    },
    objective: objective.value.trim(),
    acceptance: Array.isArray(template.result_fields) ? template.result_fields : [],
    role_binding_overrides: [],
    cardinality_overrides: [],
    focus_partition_plans: [],
    permission_lease: 'read_only',
    model_lease: store.activeSession?.model || 'default',
    resource_scopes: [`session:${sessionId}`],
  });
  const teamId = teamResult.value?.team?.team_id;
  if (teamId) teamWorkingState.value = await api.teamWorkingState(teamId);
  await refresh();
}

async function refreshTeamWorkingState() {
  const teamId = teamResult.value?.team?.team_id;
  if (!teamId) return;
  teamWorkingState.value = await api.teamWorkingState(teamId);
}

function managedRequestId(id: string) {
  return `webui-managed:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAttributes(value: string) {
  const attributes: Record<string, string> = {};
  for (const item of splitList(value)) {
    const separator = item.indexOf('=');
    if (separator <= 0 || separator === item.length - 1) return null;
    const key = item.slice(0, separator).trim();
    const attributeValue = item.slice(separator + 1).trim();
    if (!key || !attributeValue || attributes[key]) return null;
    attributes[key] = attributeValue;
  }
  return attributes;
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function managedTargetLabel(kind: unknown) {
  return kind === 'team'
    ? t('page.agents.managed.targetTeam')
    : t('page.agents.managed.targetAgent');
}

function managedTriggerLabel(trigger: any) {
  switch (trigger?.kind) {
    case 'schedule':
      return trigger.trigger?.at
        ? t('page.agents.managed.triggerAt')
        : trigger.trigger?.cron
        ? t('page.agents.managed.triggerCron')
        : t('page.agents.managed.triggerInterval');
    case 'event':
      return t('page.agents.managed.triggerEvent');
    default:
      return t('page.agents.managed.triggerManual');
  }
}

function buildManagedTrigger() {
  if (managedTriggerKind.value === 'manual') return { kind: 'manual' };
  if (managedTriggerKind.value === 'at') {
    const atMs = positiveInteger(managedAtMs.value);
    if (!atMs) {
      error.value = t('page.agents.managed.error.at');
      return null;
    }
    return { kind: 'schedule', trigger: { at: { at_ms: atMs } } };
  }
  if (managedTriggerKind.value === 'interval') {
    const everyMs = positiveInteger(managedIntervalMs.value);
    if (!everyMs) {
      error.value = t('page.agents.managed.error.interval');
      return null;
    }
    return { kind: 'schedule', trigger: { interval: { every_ms: everyMs } } };
  }
  if (managedTriggerKind.value === 'cron') {
    if (!managedCronExpression.value.trim() || !managedCronTimezone.value.trim()) {
      error.value = t('page.agents.managed.error.cron');
      return null;
    }
    return {
      kind: 'schedule',
      trigger: {
        cron: {
          expression: managedCronExpression.value.trim(),
          timezone: managedCronTimezone.value.trim(),
        },
      },
    };
  }
  const attributes = parseAttributes(managedEventAttributes.value);
  const maximumAgeMs = managedEventMaximumAgeMs.value.trim()
    ? positiveInteger(managedEventMaximumAgeMs.value)
    : null;
  if (!managedEventSourceId.value.trim() || !managedEventSourceKind.value.trim() || !managedEventType.value.trim() || attributes === null || (managedEventMaximumAgeMs.value.trim() && !maximumAgeMs)) {
    error.value = t('page.agents.managed.error.event');
    return null;
  }
  return {
    kind: 'event',
    source_id: managedEventSourceId.value.trim(),
    source_kind: managedEventSourceKind.value.trim(),
    event_type: managedEventType.value.trim(),
    required_source_capabilities: splitList(managedEventCapabilities.value),
    required_attributes: attributes,
    maximum_age_ms: maximumAgeMs,
    out_of_order_policy: managedEventOrderPolicy.value,
  };
}

function selectManagedDefinition(definition: any) {
  if (!definition) return;
  selectedManagedDefinitionId.value = definition.managed_agent_id || '';
  managedDefinitionId.value = definition.managed_agent_id || managedDefinitionId.value;
  managedTargetKind.value = definition.target?.kind === 'team' ? 'team' : 'agent';
  managedTargetDefinition.value = definition.target?.definition_id || definition.target?.template_id || '';
  managedObjective.value = definition.objective || '';
  managedAcceptance.value = Array.isArray(definition.acceptance) ? definition.acceptance.join(', ') : '';
  managedCapabilities.value = Array.isArray(definition.granted_capabilities) ? definition.granted_capabilities.join(', ') : '';
  managedEnabled.value = definition.enabled !== false;
  const trigger = definition.trigger || { kind: 'manual' };
  if (trigger.kind === 'schedule' && trigger.trigger?.at) {
    managedTriggerKind.value = 'at';
    managedAtMs.value = String(trigger.trigger.at.at_ms || '');
  } else if (trigger.kind === 'schedule' && trigger.trigger?.cron) {
    managedTriggerKind.value = 'cron';
    managedCronExpression.value = trigger.trigger.cron.expression || '';
    managedCronTimezone.value = trigger.trigger.cron.timezone || '';
  } else if (trigger.kind === 'schedule') {
    managedTriggerKind.value = 'interval';
    managedIntervalMs.value = String(trigger.trigger?.interval?.every_ms || '');
  } else if (trigger.kind === 'event') {
    managedTriggerKind.value = 'event';
    managedEventSourceId.value = trigger.source_id || '';
    managedEventSourceKind.value = trigger.source_kind || '';
    managedEventType.value = trigger.event_type || '';
    managedEventCapabilities.value = Array.isArray(trigger.required_source_capabilities)
      ? trigger.required_source_capabilities.join(', ')
      : '';
    managedEventAttributes.value = Object.entries(trigger.required_attributes || {})
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    managedEventMaximumAgeMs.value = trigger.maximum_age_ms ? String(trigger.maximum_age_ms) : '';
    managedEventOrderPolicy.value = trigger.out_of_order_policy === 'reject_older_sequence'
      ? 'reject_older_sequence'
      : 'accept_any';
  } else {
    managedTriggerKind.value = 'manual';
  }
  selectedDetail.value = null;
}

function selectManagedHealth(health: Record<string, unknown>) {
  selectedManagedHealthId.value = String(health.id || '');
  selectedDetail.value = {
    ...health,
    source: 'runtime.managed_agent.health',
    evidence: health.id,
    status: health.status,
  };
}

async function createManagedAgent() {
  const target = managedTargetDefinition.value.trim();
  const objectiveValue = managedObjective.value.trim();
  const id = managedDefinitionId.value.trim();
  if (!id || !target || !objectiveValue) {
    error.value = t('page.agents.managed.error.required');
    return;
  }
  const trigger = buildManagedTrigger();
  if (!trigger) return;
  const capabilities = splitList(managedCapabilities.value);
  if (managedTargetKind.value === 'agent' && !capabilities.length) {
    error.value = t('page.agents.managed.error.capabilities');
    return;
  }
  const existing = managedDefinitionItems.value.find((definition: any) => definition.managed_agent_id === id);
    managedActionResult.value = await api.createManagedAgentDefinition({
    managed_agent_id: id,
    revision: Number(existing?.revision || 0) + 1,
    target: managedTargetKind.value === 'team'
      ? { kind: 'team', template_id: target, selector: { kind: 'latest_stable', template_id: target } }
      : { kind: 'agent', definition_id: target, selector: { kind: 'latest_approved_stable' } },
    trigger,
    session_id: store.activeSessionId || `managed:${id}`,
    objective: objectiveValue,
    acceptance: splitList(managedAcceptance.value),
    permission_lease: 'read_only',
    model_lease: store.activeSession?.model || 'default',
    granted_capabilities: managedTargetKind.value === 'agent' ? capabilities : [],
    allowed_tool_contract_refs: [],
    allowed_skill_refs: [],
    resource_scopes: [],
    overlap_policy: { kind: 'forbid' },
    retry_policy: { max_attempts: 1, initial_backoff_ms: 1000, max_backoff_ms: 60000 },
    health_policy: { max_consecutive_failures: 3, max_run_age_ms: null },
    enabled: managedEnabled.value,
    });
    selectedManagedDefinitionId.value = id;
    await refresh();
}

async function triggerManagedAgent(id: string) {
  managedActionResult.value = await api.triggerManagedAgent(id, managedRequestId(id));
  await refresh();
}

async function dispatchManagedAgents() {
  managedActionResult.value = await api.dispatchManagedAgents('webui-managed-dispatcher', 16);
  await refresh();
}

async function resetManagedAgentHealth(id: string) {
  managedActionResult.value = await api.resetManagedAgentHealth(id);
  await refresh();
}

async function resetSelectedManagedHealth() {
  if (!selectedManagedHealth.value) return;
  await resetManagedAgentHealth(String(selectedManagedHealth.value.id));
}

function selectTask(id: string) {
  selectedTaskId.value = id;
  loadGraph();
}

onMounted(refresh);
onUnmounted(() => projections.release('agents'));
</script>

<template>
  <section class="capability-page agents-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.agents.page.text.7622e980ff') }}</h1>
        <p>{{ t('page.agents.page.text.4cd26e67e0') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? t('page.agents.page.inline.0126927eaa') : t('page.agents.page.inline.ede8921360') }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>

    <section class="metric-row">
      <article class="metric-card">
        <span>{{ t('page.agents.page.text.276b102ba5') }}</span>
        <strong>{{ catalog.summary?.active || 0 }}/{{ catalog.summary?.total || 0 }}</strong>
        <small>{{ t('page.agents.page.text.b0c6112396') }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.agents.page.text.3490b53bf0') }}</span>
        <strong>{{ openTasks }}</strong>
        <small>{{ t('page.agents.summary.totalTaskRecords', { count: taskItems.length }) }}</small>
      </article>
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.agents.page.text.9f2088c779') }}</span>
        <strong>{{ runItems.length }}</strong>
        <small>{{ t('page.agents.summary.selectedGraphNodes', { count: graphNodes.length }) }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.agents.page.text.a5f816919b') }}</span>
        <strong>{{ teamTemplateItems.length }}</strong>
        <small>{{ t('page.agents.page.text.4c8da9a12e') }}</small>
      </article>
    </section>

    <section class="agents-workbench-grid">
      <section class="management-panel agents-panel" data-section="catalog">
        <header>
          <h2>{{ t('page.agents.page.text.c1a824a193') }}</h2>
          <span>{{ t('page.agents.summary.definitionCount', { count: agentRows.length }) }}</span>
        </header>
        <DataTable v-if="agentRows.length" searchable copyable row-key="name" :rows="agentRows" :columns="['name', 'active', 'source', 'model', 'description']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.agents.page.title.5eba27eab7')" :detail="t('page.agents.page.detail.c7ca371a29')" />
      </section>

      <section class="management-panel agents-panel" data-section="discovery">
        <header>
          <h2>{{ t('page.agents.page.text.74f4319c57') }}</h2>
          <span>{{ formatCount('matches', discovery.count || 0) }}</span>
        </header>
        <label class="search-field">
          <Search :size="15" />
          <input v-model="discoverQuery" type="search" :placeholder="t('page.agents.page.placeholder.703309ce06')" @keyup.enter="discoverAgents" />
        </label>
        <button class="primary-action" type="button" @click="discoverAgents">{{ t('page.agents.page.text.961a6c8625') }}</button>
        <DataTable v-if="discoveredRows.length" searchable copyable row-key="agent_id" :rows="discoveredRows" :columns="['agent_id', 'definition', 'capabilities', 'status']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.agents.page.title.1f579ef765')" :detail="t('page.agents.page.detail.eb533ab1ab')" />
        <ObjectInspectorDrawer :title="t('page.agents.page.title.425652af9a')" :data="discovery.team || {}" />
        <DataTable v-if="selfModelRows.length" searchable copyable row-key="definition" :rows="selfModelRows" :columns="['definition', 'environment', 'runs', 'successful', 'failed', 'success_rate', 'tools', 'evidence']" @row-click="selectedDetail = $event" />
      </section>

      <section class="management-panel agents-panel wide" data-section="discovery">
        <header>
          <h2>{{ t('page.agents.teamTemplates.title') }}</h2>
          <span>{{ t('page.agents.summary.runnableTemplateCount', { count: teamTemplateItems.length }) }}</span>
        </header>
        <div class="agents-task-layout">
          <aside class="task-list">
            <button
              v-for="template in teamTemplateItems"
              :key="template.revision_ref?.template_id"
              class="memory-entry-row"
              :class="{ active: selectedTemplateId === template.revision_ref?.template_id }"
              type="button"
              @click="selectTeamTemplate(template)"
            >
              <strong>{{ template.name }}</strong>
              <span>{{ template.revision_ref?.template_id }}@{{ template.revision_ref?.revision }}</span>
              <small>{{ t('page.agents.summary.roleCount', { count: template.role_count || 0 }) }} · {{ template.topology?.protocol_ref || t('page.agents.summary.runtimeTopology') }}</small>
            </button>
            <EmptyState v-if="!teamTemplateItems.length" :title="t('page.agents.teamTemplates.emptyTitle')" :detail="t('page.agents.teamTemplates.emptyDetail')" />
          </aside>
          <main>
            <label class="field-line">
              {{ t('page.agents.teamTemplates.objective') }}
              <textarea v-model="objective" rows="4" :placeholder="t('page.agents.teamTemplates.objectivePlaceholder')" />
            </label>
            <div class="button-row">
              <button class="primary-action" type="button" :disabled="!selectedTeamTemplate" @click="instantiateSelectedTeam"><Play :size="15" />{{ t('page.agents.teamTemplates.start') }}</button>
              <button class="ghost-action" type="button" :disabled="!teamResult?.team?.team_id" @click="refreshTeamWorkingState">{{ t('page.agents.teamTemplates.refreshWorkingState') }}</button>
            </div>
            <DataTable
              v-if="teamWorkingState?.working_state?.entries?.length"
              searchable
              copyable
              row-key="entry_id"
              :rows="teamWorkingState.working_state.entries"
              :columns="['kind', 'node_id', 'summary', 'confidence_milli', 'refs']"
              @row-click="selectedDetail = $event"
            />
            <RequestReceipt :receipt="teamResult || teamWorkingState" :title="t('page.agents.teamTemplates.receipt')" />
          </main>
        </div>
      </section>

      <section class="management-panel agents-panel wide" data-section="tasks">
        <header>
          <h2>{{ t('page.agents.page.text.9574008891') }}</h2>
          <span>{{ selectedTask?.status ? displayStatus(selectedTask.status) : t('page.agents.page.inline.5adf7ffa15') }}</span>
        </header>
        <div class="agents-task-layout">
          <aside class="task-list">
            <button
              v-for="task in taskItems"
              :key="task.id"
              class="memory-entry-row"
              :class="{ active: selectedTaskId === task.id }"
              type="button"
              @click="selectTask(task.id); selectedDetail = task"
            >
              <strong>{{ task.objective || task.id }}</strong>
              <span>{{ task.id }}</span>
              <small>{{ displayStatus(task.status) }} · failures {{ task.failure_count || 0 }}</small>
            </button>
            <EmptyState v-if="!taskItems.length" :title="t('page.agents.page.title.6c2217048b')" :detail="t('page.agents.page.detail.f95c3d582c')" />
          </aside>
          <main>
            <label class="field-line">
              {{ t('template.pages.agentspage.50c8920b8d') }}
              <textarea v-model="objective" rows="3" />
            </label>
            <div class="button-row">
              <button class="primary-action" type="button" @click="startTask"><Play :size="15" />{{ t('page.agents.page.text.f0cc25acab') }}</button>
              <button class="ghost-action" type="button" :disabled="!selectedTask" @click="transitionTask('complete')">{{ t('page.agents.page.text.fa9bc47968') }}</button>
              <button class="ghost-action" type="button" :disabled="!selectedTask" @click="transitionTask('cancel')">{{ t('page.agents.page.text.284bcc5dff') }}</button>
              <button class="ghost-action" type="button" :disabled="!selectedTask" @click="transitionTask('failure')">{{ t('page.agents.page.text.fbe7b2c6bc') }}</button>
            </div>
            <label class="field-line">
              {{ t('template.pages.agentspage.44b4767a52') }}
              <input v-model="failureReason" type="text" />
            </label>
            <RequestReceipt :receipt="actionResult" :title="t('page.agents.page.title.e02c33214a')" />
          </main>
        </div>
      </section>

      <section class="management-panel agents-panel wide" data-section="managed-agents">
        <header>
          <h2>{{ t('page.agents.managed.title') }}</h2>
          <span>{{ managedDefinitionRows.length }}</span>
        </header>
        <p class="section-note">{{ t('page.agents.managed.detail') }}</p>
        <div class="agents-task-layout">
          <main>
            <label class="field-line">
              {{ t('page.agents.managed.definition') }}
              <input v-model="managedDefinitionId" type="text" />
            </label>
            <label class="field-line">
              {{ t('page.agents.managed.target') }}
              <select v-model="managedTargetKind">
                <option value="agent">{{ t('page.agents.managed.targetAgent') }}</option>
                <option value="team">{{ t('page.agents.managed.targetTeam') }}</option>
              </select>
              <input v-model="managedTargetDefinition" list="managed-target-options" type="text" :placeholder="t('page.agents.managed.targetPlaceholder')" />
              <datalist id="managed-target-options">
                <option v-for="option in managedTargetOptions.filter((item) => item.kind === managedTargetKind)" :key="`${option.kind}:${option.id}`" :value="option.id" />
              </datalist>
            </label>
            <label class="field-line">
              {{ t('page.agents.managed.objective') }}
              <textarea v-model="managedObjective" rows="3" />
            </label>
            <label class="field-line">
              {{ t('page.agents.managed.acceptance') }}
              <input v-model="managedAcceptance" type="text" :placeholder="t('page.agents.managed.listPlaceholder')" />
            </label>
            <label v-if="managedTargetKind === 'agent'" class="field-line">
              {{ t('page.agents.managed.capabilities') }}
              <input v-model="managedCapabilities" type="text" :placeholder="t('page.agents.managed.listPlaceholder')" />
            </label>
            <label class="field-line">
              {{ t('page.agents.managed.triggerKind') }}
              <select v-model="managedTriggerKind">
                <option value="manual">{{ t('page.agents.managed.triggerManual') }}</option>
                <option value="at">{{ t('page.agents.managed.triggerAt') }}</option>
                <option value="interval">{{ t('page.agents.managed.triggerInterval') }}</option>
                <option value="cron">{{ t('page.agents.managed.triggerCron') }}</option>
                <option value="event">{{ t('page.agents.managed.triggerEvent') }}</option>
              </select>
            </label>
            <label v-if="managedTriggerKind === 'at'" class="field-line">
              {{ t('page.agents.managed.atMs') }}
              <input v-model="managedAtMs" type="number" min="1" inputmode="numeric" />
            </label>
            <label v-if="managedTriggerKind === 'interval'" class="field-line">
              {{ t('page.agents.managed.intervalMs') }}
              <input v-model="managedIntervalMs" type="number" min="1" inputmode="numeric" />
            </label>
            <template v-if="managedTriggerKind === 'cron'">
              <label class="field-line">
                {{ t('page.agents.managed.cronExpression') }}
                <input v-model="managedCronExpression" type="text" />
              </label>
              <label class="field-line">
                {{ t('page.agents.managed.cronTimezone') }}
                <input v-model="managedCronTimezone" type="text" />
              </label>
            </template>
            <template v-if="managedTriggerKind === 'event'">
              <label class="field-line">
                {{ t('page.agents.managed.eventSourceId') }}
                <input v-model="managedEventSourceId" type="text" />
              </label>
              <label class="field-line">
                {{ t('page.agents.managed.eventSourceKind') }}
                <input v-model="managedEventSourceKind" type="text" />
              </label>
              <label class="field-line">
                {{ t('page.agents.managed.eventType') }}
                <input v-model="managedEventType" type="text" />
              </label>
              <label class="field-line">
                {{ t('page.agents.managed.eventCapabilities') }}
                <input v-model="managedEventCapabilities" type="text" :placeholder="t('page.agents.managed.listPlaceholder')" />
              </label>
              <label class="field-line">
                {{ t('page.agents.managed.eventAttributes') }}
                <input v-model="managedEventAttributes" type="text" :placeholder="t('page.agents.managed.attributePlaceholder')" />
              </label>
              <label class="field-line">
                {{ t('page.agents.managed.eventMaximumAge') }}
                <input v-model="managedEventMaximumAgeMs" type="number" min="1" inputmode="numeric" :placeholder="t('page.agents.managed.optionalNumberPlaceholder')" />
              </label>
              <label class="field-line">
                {{ t('page.agents.managed.eventOrder') }}
                <select v-model="managedEventOrderPolicy">
                  <option value="accept_any">{{ t('page.agents.managed.orderAcceptAny') }}</option>
                  <option value="reject_older_sequence">{{ t('page.agents.managed.orderRejectOlder') }}</option>
                </select>
              </label>
            </template>
            <label class="field-line inline-check">
              <input v-model="managedEnabled" type="checkbox" />
              {{ t('page.agents.managed.enabled') }}
            </label>
            <div class="button-row">
              <button class="primary-action" type="button" @click="createManagedAgent">{{ managedDefinitionItems.some((definition: any) => definition.managed_agent_id === managedDefinitionId.trim()) ? t('page.agents.managed.saveRevision') : t('page.agents.managed.create') }}</button>
              <button class="ghost-action" type="button" :disabled="!managedDefinitionRows.length" @click="dispatchManagedAgents">{{ t('page.agents.managed.dispatch') }}</button>
            </div>
            <RequestReceipt :receipt="managedActionResult" :title="t('page.agents.managed.title')" />
          </main>
          <aside class="task-list">
            <button
              v-for="definition in managedDefinitionRows"
              :key="definition.id"
              class="memory-entry-row"
              :class="{ active: selectedManagedDefinitionId === definition.id }"
              type="button"
              @click="selectManagedDefinition(managedDefinitionItems.find((item: any) => item.managed_agent_id === definition.id))"
            >
              <strong>{{ definition.id }}@{{ definition.revision }}</strong>
              <span>{{ definition.target_kind }} · {{ definition.target }}</span>
              <small>{{ definition.trigger }} · {{ displayStatus(definition.enabled ? 'active' : 'disabled') }}</small>
            </button>
            <EmptyState v-if="!managedDefinitionRows.length" :title="t('page.agents.managed.empty')" :detail="t('page.agents.managed.detail')" />
          </aside>
        </div>
        <h3>{{ t('page.agents.managed.invocations') }}</h3>
        <DataTable v-if="managedInvocationRows.length" searchable copyable row-key="id" :rows="managedInvocationRows" :columns="['id', 'definition', 'status', 'attempt', 'trigger', 'execution', 'error']" @row-click="selectedDetail = $event" />
        <div v-if="managedDefinitionRows.length" class="button-row">
          <button
            v-for="definition in managedDefinitionRows"
            :key="`${definition.id}-trigger`"
            class="ghost-action"
            type="button"
            @click="triggerManagedAgent(definition.id)"
          >{{ t('page.agents.managed.trigger') }} · {{ definition.id }}</button>
        </div>
        <h3>{{ t('page.agents.managed.health') }}</h3>
        <DataTable v-if="managedHealthRows.length" searchable copyable row-key="id" :rows="managedHealthRows" :columns="['id', 'revision', 'status', 'failures', 'active']" @row-click="selectManagedHealth" />
        <div v-if="managedHealthRows.length" class="button-row">
          <button
            class="ghost-action"
            type="button"
            :disabled="!selectedManagedHealth || selectedManagedHealth.status === 'healthy'"
            @click="resetSelectedManagedHealth"
          >{{ t('page.agents.managed.reset') }}<template v-if="selectedManagedHealth"> · {{ selectedManagedHealth.id }}</template></button>
        </div>
        <h3>{{ t('page.agents.managed.effects') }}</h3>
        <DataTable v-if="managedEffectRows.length" searchable copyable row-key="id" :rows="managedEffectRows" :columns="['id', 'invocation', 'kind', 'status', 'receipt', 'error']" @row-click="selectedDetail = $event" />
      </section>

      <section class="management-panel agents-panel" data-section="tasks">
        <header>
          <h2>{{ t('page.agents.page.text.278a33d389') }}</h2>
          <span>{{ formatCount('phases', phaseItems.length) }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.agentspage.5270361e54') }}
          <input v-model="phaseName" type="text" />
        </label>
        <label class="field-line">
          {{ t('template.pages.agentspage.ed9fa66b43') }}
          <textarea v-model="phaseObjective" rows="3" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" :disabled="!selectedTask" @click="addPhase">{{ t('page.agents.page.text.986c5bb8ad') }}</button>
          <button class="ghost-action" type="button" :disabled="!currentPhase" @click="reviewPhase(true)">{{ t('page.agents.page.text.b98caebe44') }}</button>
        </div>
        <RequestReceipt :receipt="actionResult" :title="t('page.agents.page.title.7122dde1ab')" />
        <DataTable v-if="phaseItems.length" searchable copyable :rows="phaseItems" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.agents.page.title.e026c4dcdc')" :detail="t('page.agents.page.detail.113c5f31fe')" />
      </section>

      <section class="management-panel agents-panel" data-section="reviews">
        <header>
          <h2>{{ t('page.agents.page.text.1b944ea5ee') }}</h2>
          <span>{{ currentPhase?.id || t('page.agents.page.inline.5e18e610e8') }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.agentspage.1fdd152bf4') }}
          <input v-model="artifactLabel" type="text" />
        </label>
        <label class="field-line">
          {{ t('template.pages.agentspage.06c0f54fbc') }}
          <textarea v-model="artifactValue" rows="3" />
        </label>
        <label class="field-line">
          {{ t('template.pages.agentspage.58db53d2a4') }}
          <textarea v-model="reviewResult" rows="3" />
        </label>
        <div class="button-row">
          <button class="primary-action" type="button" :disabled="!currentPhase" @click="recordArtifact">{{ t('page.agents.page.text.d37b877fe0') }}</button>
          <button class="ghost-action" type="button" :disabled="!currentPhase" @click="reviewPhase(false)">{{ t('page.agents.page.text.bcf4c49ed5') }}</button>
        </div>
        <RequestReceipt :receipt="actionResult" :title="t('page.agents.page.title.e74434a723')" />
      </section>

      <section class="management-panel agents-panel wide" data-section="graph">
        <header>
          <h2>{{ t('page.agents.page.text.74c44a4258') }}</h2>
          <span><StatusPill :status="graph.status || 'offline'" /></span>
        </header>
        <div class="button-row">
          <button class="ghost-action" type="button" :disabled="!selectedTask" @click="loadGraph">
            <Users :size="15" />
            {{ t('template.pages.agentspage.b991bd4651') }}
          </button>
        </div>
        <div class="agent-graph-lanes">
          <article v-for="node in graphNodes" :key="node.id" role="button" tabindex="0" @click="selectedDetail = node" @keydown.enter.prevent="selectedDetail = node">
            <strong>{{ node.title }}</strong>
            <StatusPill :status="node.status" />
            <p>{{ node.objective }}</p>
            <small>{{ node.role }} · {{ node.assigned_agent || 'unassigned' }} · depends {{ (node.depends_on || []).join(', ') || '-' }}</small>
          </article>
        </div>
        <EmptyState v-if="!graphNodes.length" :title="t('page.agents.page.title.731f196b87')" :detail="t('page.agents.page.detail.5722274f98')" />
        <DataTable
          v-if="executionNodeRows.length"
          searchable
          copyable
          row-key="id"
          :rows="executionNodeRows"
          :columns="['id', 'kind', 'status', 'executor', 'evidence']"
          @row-click="selectedDetail = $event"
        />
        <DataTable
          v-if="executionAgentRows.length || executionTeamRows.length"
          searchable
          copyable
          row-key="id"
          :rows="[...executionAgentRows, ...executionTeamRows]"
          :columns="['id', 'status', 'summary', 'evidence']"
          @row-click="selectedDetail = $event"
        />
        <EvidenceTrace :items="agentEvidence" :title="t('page.agents.page.title.bb922d3236')" />
        <RequestReceipt :receipt="actionResult || executionProjection || graph" :title="t('page.agents.page.title.4056356344')" />
      </section>

      <section class="management-panel agents-panel wide" data-section="runs">
        <header>
          <h2>{{ t('page.agents.page.text.e8aa236684') }}</h2>
          <span>{{ formatCount('graphs', runItems.length) }}</span>
        </header>
        <ObjectInspectorDrawer :title="t('page.agents.page.title.3606e135fe')" :data="runs" />
        <DetailDrawer :title="t('page.agents.page.title.c74579aea5')" :row="selectedDetail" @close="selectedDetail = null" />
        <RequestReceipt :receipt="actionResult || teamResult" :title="t('page.agents.page.title.6cf3650bd1')" />
        <ObjectInspectorDrawer :title="t('page.agents.page.title.fe453c49db')" :data="actionResult || graph" />
      </section>
    </section>
  </section>
</template>
