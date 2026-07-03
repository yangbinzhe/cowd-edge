<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { GitBranch, Play, RefreshCw, Search, Trash2, Users } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import StatusPill from '../components/workbench/StatusPill.vue';
import DetailDrawer from '../components/workbench/DetailDrawer.vue';
import EvidenceTrace from '../components/workbench/EvidenceTrace.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import { displayStatus } from '../i18n/domain/status';

const loading = ref(false);
const error = ref('');
const catalog = ref<any>({});
const directory = ref<any>({});
const discovery = ref<any>({});
const reputation = ref<any>({});
const runs = ref<any>({});
const tasks = ref<any>({});
const graph = ref<any>({});
const teamProfiles = ref<any>({});
const actionResult = ref<any>(null);
const profileResult = ref<any>(null);
const selectedTaskId = ref('');
const selectedProfileId = ref('');
const objective = ref('');
const discoverQuery = ref('');
const profileName = ref('WebUI Review Team');
const profileLeader = ref('');
const profileMembers = ref('planner,executor,reviewer');
const profilePolicy = ref('{"max_parallel_agents":3,"requires_review":true}');
const profileEvaluation = ref('{"success_metric":"accepted_phase_review","quality_gate":"all_tests_pass"}');
const phaseName = ref('');
const phaseObjective = ref('');
const artifactLabel = ref('');
const artifactValue = ref('');
const reviewResult = ref('');
const failureReason = ref('');
const selectedDetail = ref<Record<string, unknown> | null>(null);

const agentRows = computed(() => (Array.isArray(directory.value?.agents) ? directory.value.agents : Array.isArray(catalog.value?.agents) ? catalog.value.agents : []).map((agent: any) => ({
  name: agent.name,
  active: agent.active,
  source: agent.source?.id || agent.source || '-',
  model: agent.model || '-',
  description: agent.description || '-',
})));
const discoveredRows = computed(() => (Array.isArray(discovery.value?.agents) ? discovery.value.agents : []).map((agent: any) => ({
  agent_id: agent.agent_id,
  role: agent.role,
  reputation: agent.reputation ?? '-',
  status: agent.status,
})));
const taskItems = computed(() => Array.isArray(tasks.value?.tasks) ? tasks.value.tasks : []);
const selectedTask = computed(() => taskItems.value.find((task: any) => task.id === selectedTaskId.value) || tasks.value?.current || taskItems.value[0] || null);
const phaseItems = computed(() => Array.isArray(selectedTask.value?.phases) ? selectedTask.value.phases : []);
const currentPhase = computed(() => phaseItems.value.find((phase: any) => phase.id === selectedTask.value?.current_phase) || phaseItems.value[0] || null);
const graphNodes = computed(() => Array.isArray(graph.value?.nodes) ? graph.value.nodes : []);
const runItems = computed(() => Array.isArray(runs.value?.runs) ? runs.value.runs : []);
const teamProfileItems = computed(() => Array.isArray(teamProfiles.value?.profiles) ? teamProfiles.value.profiles : []);
const reputationRows = computed(() => (Array.isArray(reputation.value?.items) ? reputation.value.items : []).map((item: any) => ({
  agent_id: item.agent_id || item.name || '-',
  reputation: item.reputation ?? '-',
  status: item.status ?? '-',
})));
const openTasks = computed(() => taskItems.value.filter((task: any) => !['completed', 'cancelled'].includes(String(task.status))).length);
const agentsContext = computed(() => [
  { label: t('script.pages.agentspage.label.64acf7e2a7'), value: agentRows.value.length, tone: agentRows.value.length ? 'success' : 'warn' },
  { label: t('script.pages.agentspage.label.0c2a930099'), value: teamProfileItems.value.length },
  { label: t('script.pages.agentspage.label.ef2960c6f7'), value: openTasks.value, tone: openTasks.value ? 'warn' : 'success' },
  { label: t('script.pages.agentspage.label.91a4801bd6'), value: graphNodes.value.length },
]);
const agentsWorkflow = computed(() => [
  { id: 'catalog', label: t('script.pages.agentspage.label.4827ea2271'), status: agentRows.value.length ? 'ready' : 'idle', count: agentRows.value.length },
  { id: 'discovery', label: t('script.pages.agentspage.label.ff4fc0276e'), status: teamProfileItems.value.length ? 'ready' : 'idle', count: teamProfileItems.value.length },
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

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [nextCatalog, nextDirectory, nextReputation, nextRuns, nextTasks, nextProfiles] = await Promise.all([
      api.agentCatalog(),
      api.agentDirectory(),
      api.agentReputation(),
      api.agentRuns(),
      api.tasks(),
      api.agentTeamProfiles(),
    ]);
    catalog.value = nextCatalog;
    directory.value = nextDirectory;
    reputation.value = nextReputation;
    runs.value = nextRuns;
    tasks.value = nextTasks;
    teamProfiles.value = nextProfiles;
    if (!selectedTaskId.value) {
      selectedTaskId.value = nextTasks?.current?.id || nextTasks?.tasks?.[0]?.id || '';
    }
    if (!selectedProfileId.value) selectedProfileId.value = nextProfiles?.profiles?.[0]?.id || '';
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
}

async function startTask() {
  if (!objective.value.trim()) {
    error.value = 'Objective is required before starting a task.';
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
    error.value = 'Phase name and objective are required.';
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
    error.value = 'Artifact label and value are required.';
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
    error.value = 'Review result is required.';
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
      error.value = 'Failure reason is required.';
      return;
    }
    actionResult.value = await api.recordTaskFailure(taskId, failureReason.value);
  }
  await refresh();
}

async function discoverAgents() {
  if (!discoverQuery.value.trim()) {
    error.value = 'Task description is required before discovering agents.';
    return;
  }
  discovery.value = await api.agentAssemble(discoverQuery.value);
}

function teamProfilePayload() {
  let policy = {};
  let evaluation = {};
  try {
    policy = JSON.parse(profilePolicy.value || '{}');
  } catch {
    error.value = 'Team profile policy must be valid JSON.';
    throw new Error(error.value);
  }
  try {
    evaluation = JSON.parse(profileEvaluation.value || '{}');
  } catch {
    error.value = 'Team profile evaluation must be valid JSON.';
    throw new Error(error.value);
  }
  return {
    id: selectedProfileId.value || undefined,
    name: profileName.value,
    objective: objective.value || discoverQuery.value,
    leader: profileLeader.value || undefined,
    members: profileMembers.value.split(',').map((item) => item.trim()).filter(Boolean),
    policy,
    evaluation,
  };
}

function loadProfileIntoForm(profile: any) {
  selectedProfileId.value = profile.id || '';
  profileName.value = profile.name || '';
  objective.value = profile.objective || objective.value;
  discoverQuery.value = profile.objective || discoverQuery.value;
  profileLeader.value = profile.leader || '';
  profileMembers.value = Array.isArray(profile.members) ? profile.members.join(',') : '';
  profilePolicy.value = JSON.stringify(profile.policy || {}, null, 2);
  profileEvaluation.value = JSON.stringify(profile.evaluation || {}, null, 2);
}

async function selectTeamProfile(id: string) {
  selectedProfileId.value = id;
  const detail = await api.agentTeamProfile(id);
  profileResult.value = detail;
  if (detail?.profile) loadProfileIntoForm(detail.profile);
}

async function saveTeamProfile() {
  const payload = teamProfilePayload();
  profileResult.value = selectedProfileId.value
    ? await api.updateAgentTeamProfile(selectedProfileId.value, payload)
    : await api.createAgentTeamProfile(payload);
  selectedProfileId.value = profileResult.value?.profile?.id || selectedProfileId.value;
  await refresh();
}

async function createTeamProfile() {
  selectedProfileId.value = '';
  profileResult.value = await api.createAgentTeamProfile(teamProfilePayload());
  selectedProfileId.value = profileResult.value?.profile?.id || '';
  await refresh();
}

async function deleteTeamProfile() {
  if (!selectedProfileId.value) return;
  profileResult.value = await api.deleteAgentTeamProfile(selectedProfileId.value);
  selectedProfileId.value = '';
  await refresh();
}

function reuseTeamProfile() {
  const profile = teamProfileItems.value.find((item: any) => item.id === selectedProfileId.value);
  if (profile) loadProfileIntoForm(profile);
}

async function upsertGraphTemplate() {
  const taskId = selectedTaskId.value || selectedTask.value?.id;
  if (!taskId) return;
  if (!objective.value.trim() || !phaseObjective.value.trim()) {
    error.value = 'Objective and phase objective are required before generating an agent graph.';
    return;
  }
  const now = Date.now();
  const nodes = [
    {
      id: 'planner',
      role: 'planner',
      title: t('script.pages.agentspage.title.ae2f98a099'),
      objective: objective.value,
      depends_on: [],
      status: 'ready',
      assigned_agent: discovery.value?.team?.leader?.agent_id || null,
      result: null,
      error: null,
      created_at_ms: now,
      updated_at_ms: now,
    },
    {
      id: 'executor',
      role: 'executor',
      title: t('script.pages.agentspage.title.6ea36ce8d4'),
      objective: phaseObjective.value,
      depends_on: ['planner'],
      status: 'pending',
      assigned_agent: discovery.value?.team?.workers?.[0]?.agent_id || null,
      result: null,
      error: null,
      created_at_ms: now,
      updated_at_ms: now,
    },
    {
      id: 'reviewer',
      role: 'reviewer',
      title: t('script.pages.agentspage.title.e29a79fe0c'),
      objective: reviewResult.value || 'Review the selected task phase and attached artifacts.',
      depends_on: ['executor'],
      status: 'pending',
      assigned_agent: discovery.value?.team?.workers?.[1]?.agent_id || null,
      result: null,
      error: null,
      created_at_ms: now,
      updated_at_ms: now,
    },
  ];
  actionResult.value = await api.upsertTaskAgentGraph(taskId, { objective: objective.value, nodes });
  await loadGraph();
}

function selectTask(id: string) {
  selectedTaskId.value = id;
  loadGraph();
}

onMounted(refresh);
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
    <PrimaryContextBar :items="agentsContext" density="compact" :max-visible="4" />
    <WorkflowStrip :steps="agentsWorkflow" :title="t('page.agents.page.title.01566a0372')" density="compact" />

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
        <strong>{{ teamProfileItems.length }}</strong>
        <small>{{ t('page.agents.page.text.4c8da9a12e') }}</small>
      </article>
    </section>

    <section class="agents-workbench-grid">
      <section class="management-panel agents-panel" data-section="catalog">
        <header>
          <h2>{{ t('page.agents.page.text.c1a824a193') }}</h2>
          <span>{{ agentRows.length }} definitions</span>
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
        <DataTable v-if="discoveredRows.length" searchable copyable row-key="agent_id" :rows="discoveredRows" :columns="['agent_id', 'role', 'reputation', 'status']" @row-click="selectedDetail = $event" />
        <EmptyState v-else :title="t('page.agents.page.title.1f579ef765')" :detail="t('page.agents.page.detail.eb533ab1ab')" />
        <RawPayload :title="t('page.agents.page.title.425652af9a')" :data="discovery.team || {}" />
        <DataTable v-if="reputationRows.length" searchable copyable row-key="agent_id" :rows="reputationRows" :columns="['agent_id', 'reputation', 'status']" @row-click="selectedDetail = $event" />
      </section>

      <section class="management-panel agents-panel wide" data-section="discovery">
        <header>
          <h2>{{ t('page.agents.page.text.a761521099') }}</h2>
          <span>{{ teamProfileItems.length }} saved</span>
        </header>
        <div class="agents-task-layout">
          <aside class="task-list">
            <button
              v-for="profile in teamProfileItems"
              :key="profile.id"
              class="memory-entry-row"
              :class="{ active: selectedProfileId === profile.id }"
              type="button"
              @click="selectTeamProfile(profile.id); selectedDetail = profile"
            >
              <strong>{{ profile.name }}</strong>
              <span>{{ profile.id }}</span>
              <small>{{ profile.members?.length || 0 }} members · {{ profile.leader || t('page.agents.page.inline.70ae325e31') }}</small>
            </button>
            <EmptyState v-if="!teamProfileItems.length" :title="t('page.agents.page.title.c0c6c88754')" :detail="t('page.agents.page.detail.59a04d34a0')" />
          </aside>
          <main>
            <label class="field-line">
              {{ t('template.pages.agentspage.77574766df') }}
              <input v-model="profileName" type="text" />
            </label>
            <label class="field-line">
              {{ t('template.pages.agentspage.e26c936bbe') }}
              <input v-model="profileLeader" type="text" />
            </label>
            <label class="field-line">
              {{ t('template.pages.agentspage.1cb449c112') }}
              <input v-model="profileMembers" type="text" />
            </label>
            <label class="field-line">
              {{ t('template.pages.agentspage.b9d4efc7fe') }}
              <textarea v-model="profilePolicy" rows="4" />
            </label>
            <label class="field-line">
              {{ t('template.pages.agentspage.bf8f3da5f4') }}
              <textarea v-model="profileEvaluation" rows="4" />
            </label>
            <div class="button-row">
              <button class="primary-action" type="button" @click="saveTeamProfile">{{ t('page.agents.page.text.b11b5f17f2') }}</button>
              <button class="ghost-action" type="button" @click="createTeamProfile">{{ t('page.agents.page.text.7e475bc73b') }}</button>
              <button class="ghost-action" type="button" :disabled="!selectedProfileId" @click="reuseTeamProfile">{{ t('page.agents.page.text.a5ddc17dbc') }}</button>
              <button class="icon-action danger" type="button" :disabled="!selectedProfileId" :aria-label="t('page.agents.page.aria-label.b2b895468a')" @click="deleteTeamProfile"><Trash2 :size="14" /></button>
            </div>
            <RequestReceipt :receipt="profileResult?.receipt || profileResult" :title="t('page.agents.page.title.697919b9e4')" />
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
          <button class="primary-action" type="button" :disabled="!selectedTask" @click="upsertGraphTemplate">
            <GitBranch :size="15" />
            {{ t('template.pages.agentspage.4cd7279f3b') }}
          </button>
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
        <EvidenceTrace :items="agentEvidence" :title="t('page.agents.page.title.bb922d3236')" />
        <RequestReceipt :receipt="actionResult || graph" :title="t('page.agents.page.title.4056356344')" />
      </section>

      <section class="management-panel agents-panel wide" data-section="runs">
        <header>
          <h2>{{ t('page.agents.page.text.e8aa236684') }}</h2>
          <span>{{ formatCount('graphs', runItems.length) }}</span>
        </header>
        <RawPayload :title="t('page.agents.page.title.3606e135fe')" :data="runs" />
        <DetailDrawer :title="t('page.agents.page.title.c74579aea5')" :row="selectedDetail" @close="selectedDetail = null" />
        <RequestReceipt :receipt="actionResult || profileResult" :title="t('page.agents.page.title.6cf3650bd1')" />
        <RawPayload :title="t('page.agents.page.title.fe453c49db')" :data="actionResult || graph" />
      </section>
    </section>
  </section>
</template>
