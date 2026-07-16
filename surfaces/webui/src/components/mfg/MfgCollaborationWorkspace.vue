<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowRightLeft, ClipboardCheck, Eye, Send, UserPlus, UsersRound } from 'lucide-vue-next';
import { api } from '../../api/client';
import { t } from '../../i18n';
import { useMfgCockpitStore } from '../../stores/mfgCockpit';
import type { GraphViewModel } from '../../types/graph';
import DataTable from '../workbench/DataTable.vue';
import EmptyState from '../workbench/EmptyState.vue';
import GraphSurface from '../graph/GraphSurface.vue';
import ObjectInspectorDrawer from '../workbench/ObjectInspectorDrawer.vue';
import RequestReceipt from '../workbench/RequestReceipt.vue';

const cockpit = useMfgCockpitStore();
const incidents = ref<any[]>([]);
const selectedIncidentId = ref('');
const room = ref<any>(null);
const taskRef = ref('');
const assigneeRef = ref('');
const targetRef = ref('');
const surface = ref('');
const recipient = ref('');
const busy = ref(false);
const receipt = ref<any>(null);
const error = ref('');
const selectedAssignment = ref<any>(null);

const workflowGraph = computed<GraphViewModel>(() => {
  const graph = room.value?.workflow_graph || room.value?.workflowGraph || {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  return {
    id: String(graph.workflow_id || selectedIncidentId.value || 'mfg-workflow'), title: String(graph.title || t('mfg.collaboration.workflow')), revision: Number(graph.revision || 0), status: String(graph.status || 'ready'),
    nodes: nodes.map((node: any) => ({ id: String(node.node_id || node.id), type: String(node.kind || 'workflow'), label: String(node.label || node.node_id || node.id), status: String(node.status || 'ready'), summary: String(node.summary || node.description || ''), evidenceRefs: Array.isArray(node.evidence_refs) ? node.evidence_refs : [], raw: node })),
    edges: edges.map((edge: any, index: number) => ({ id: String(edge.edge_id || `${edge.from_node_id || edge.source}:${edge.to_node_id || edge.target}:${index}`), source: String(edge.from_node_id || edge.source), target: String(edge.to_node_id || edge.target), type: String(edge.kind || 'workflow'), label: String(edge.label || ''), raw: edge })),
  };
});

const assignmentRows = computed(() => cockpit.assignments.map((assignment) => ({ assignment_id: assignment.assignment_id, task_ref: assignment.task_ref, assignee_ref: assignment.assignee_ref, priority: assignment.priority, status: assignment.status, incident_id: assignment.incident_id || '', revision: assignment.revision })));

async function loadIncidents() {
  try {
    const result = await api.mfgIncidents();
    incidents.value = Array.isArray(result?.items) ? result.items : Array.isArray(result?.incidents) ? result.incidents : [];
    if (!selectedIncidentId.value && incidents.value[0]) selectedIncidentId.value = incidents.value[0].incident_id;
    if (selectedIncidentId.value) await openRoom();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}

async function openRoom() {
  if (!selectedIncidentId.value) return;
  try {
    room.value = await api.mfgIncidentRoom(selectedIncidentId.value);
    const canonicalTaskRef = room.value?.canonical_task_ref;
    const taskId = room.value?.incident?.task_id;
    taskRef.value = String(canonicalTaskRef || (taskId ? `task:${taskId}` : taskRef.value));
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}

async function createAssignment() {
  if (!taskRef.value.trim() || !assigneeRef.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    receipt.value = await api.mfgUpsertAssignment({
      task_ref: taskRef.value.trim(), incident_id: selectedIncidentId.value || undefined, workflow_id: room.value?.workflow_graph?.workflow_id,
      assignee_ref: assigneeRef.value.trim(), assignee_kind: 'user', watcher_refs: [], priority: 'normal', visibility: 'team',
      notification_targets: surface.value && recipient.value ? [{ surface: surface.value, recipient: recipient.value }] : [],
    });
    await cockpit.refresh();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; }
}

async function command(assignment: any, action: string) {
  busy.value = true;
  error.value = '';
  try { receipt.value = await cockpit.commandAssignment(assignment, action, targetRef.value || undefined); } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; }
}

async function inspectAssignment(assignmentId: string) {
  try { selectedAssignment.value = await api.mfgAssignment(assignmentId); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}

onMounted(() => { void loadIncidents(); });
</script>

<template>
  <section class="mfg-collaboration" :aria-label="t('mfg.collaboration.aria')">
    <header class="mfg-workspace-header"><div><h2>{{ t('mfg.collaboration.title') }}</h2><p>{{ t('mfg.collaboration.summary') }}</p></div><div class="mfg-collaboration__count"><UsersRound :size="16" /><strong>{{ cockpit.activeAssignments.length }}</strong><span>{{ t('mfg.collaboration.activeAssignments') }}</span></div></header>
    <p v-if="error" class="settings-alert">{{ error }}</p>
    <div class="mfg-collaboration__grid">
      <article class="mfg-collaboration__panel">
        <header><ClipboardCheck :size="16" /><h3>{{ t('mfg.collaboration.assignment') }}</h3></header>
        <form class="mfg-collaboration__form" @submit.prevent="createAssignment">
          <label><span>{{ t('mfg.collaboration.taskRef') }}</span><input v-model="taskRef" required /></label>
          <label><span>{{ t('mfg.collaboration.assignee') }}</span><input v-model="assigneeRef" required /></label>
          <label><span>{{ t('mfg.collaboration.surface') }}</span><input v-model="surface" /></label>
          <label><span>{{ t('mfg.collaboration.recipient') }}</span><input v-model="recipient" /></label>
          <button class="primary-action" type="submit" :disabled="busy"><UserPlus :size="15" />{{ t('mfg.collaboration.assign') }}</button>
        </form>
        <RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" />
      </article>
      <article class="mfg-collaboration__panel">
        <header><ArrowRightLeft :size="16" /><h3>{{ t('mfg.collaboration.commands') }}</h3></header>
        <label class="mfg-collaboration__target"><span>{{ t('mfg.collaboration.target') }}</span><input v-model="targetRef" /></label>
        <p class="mfg-collaboration__hint">{{ t('mfg.collaboration.commandHint') }}</p>
      </article>
      <article class="mfg-collaboration__panel mfg-collaboration__panel--wide">
        <header><UsersRound :size="16" /><h3>{{ t('mfg.collaboration.assignments') }}</h3></header>
        <DataTable v-if="assignmentRows.length" :rows="assignmentRows" :columns="['assignment_id', 'task_ref', 'assignee_ref', 'priority', 'status', 'incident_id', 'revision']" row-key="assignment_id" @row-click="inspectAssignment($event.assignment_id || '')" />
        <EmptyState v-else :title="t('mfg.collaboration.noAssignments')" :detail="t('mfg.collaboration.noAssignmentsDetail')" />
        <div v-if="cockpit.assignments.length" class="mfg-collaboration__assignment-actions"><article v-for="assignment in cockpit.assignments" :key="assignment.assignment_id"><strong>{{ assignment.task_ref }}</strong><span>{{ assignment.assignee_ref }} · {{ assignment.status }}</span><div><button class="ghost-action" type="button" :disabled="busy" @click="command(assignment, 'claim')">{{ t('mfg.collaboration.claim') }}</button><button class="ghost-action" type="button" :disabled="busy" @click="command(assignment, 'watch')"><Eye :size="14" />{{ t('mfg.collaboration.watch') }}</button><button class="ghost-action" type="button" :disabled="busy" @click="command(assignment, 'request_update')"><Send :size="14" />{{ t('mfg.collaboration.requestUpdate') }}</button><button class="ghost-action" type="button" :disabled="busy" @click="command(assignment, 'transfer')">{{ t('mfg.collaboration.transfer') }}</button></div></article></div>
        <ObjectInspectorDrawer v-if="selectedAssignment" :title="t('mfg.collaboration.assignmentDetail')" :data="selectedAssignment" />
      </article>
      <article class="mfg-collaboration__panel mfg-collaboration__panel--wide">
        <header><ClipboardCheck :size="16" /><h3>{{ t('mfg.collaboration.incidentRoom') }}</h3><select v-model="selectedIncidentId" @change="openRoom"><option value="">{{ t('mfg.collaboration.selectIncident') }}</option><option v-for="incident in incidents" :key="incident.incident_id" :value="incident.incident_id">{{ incident.title || incident.incident_id }}</option></select></header>
        <GraphSurface v-if="workflowGraph.nodes.length" :model="workflowGraph" />
        <EmptyState v-else :title="t('mfg.collaboration.noWorkflow')" :detail="t('mfg.collaboration.noWorkflowDetail')" />
        <ObjectInspectorDrawer :title="t('mfg.collaboration.roomDetail')" :data="room || {}" />
      </article>
    </div>
  </section>
</template>

<style scoped>
.mfg-collaboration { display: grid; gap: 14px; }.mfg-workspace-header { display: flex; justify-content: space-between; align-items: start; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }.mfg-workspace-header h2, .mfg-collaboration__panel h3 { margin: 0; color: var(--text); }.mfg-workspace-header h2 { font-size: 18px; }.mfg-workspace-header p, .mfg-collaboration__hint { margin: 5px 0 0; color: var(--text-muted); font-size: 13px; }.mfg-collaboration__count { display: inline-flex; align-items: center; gap: 7px; color: var(--info); border: 1px solid color-mix(in srgb, var(--info) 35%, var(--border)); border-radius: 8px; padding: 7px 9px; }.mfg-collaboration__count strong { color: var(--text); }.mfg-collaboration__count span { color: var(--text-muted); font-size: 12px; }.mfg-collaboration__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.mfg-collaboration__panel { min-width: 0; display: grid; align-content: start; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }.mfg-collaboration__panel > header { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }.mfg-collaboration__panel h3 { font-size: 14px; }.mfg-collaboration__panel header select { min-width: 0; margin-left: auto; min-height: 32px; max-width: 48%; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 0 7px; }.mfg-collaboration__panel--wide { grid-column: 1 / -1; }.mfg-collaboration__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }.mfg-collaboration__form label, .mfg-collaboration__target { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }.mfg-collaboration__form input, .mfg-collaboration__target input { min-width: 0; min-height: 34px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 0 9px; }.mfg-collaboration__form button { grid-column: 1 / -1; justify-self: start; }.mfg-collaboration__assignment-actions { display: grid; gap: 8px; }.mfg-collaboration__assignment-actions article { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); padding: 9px; }.mfg-collaboration__assignment-actions strong { overflow: hidden; color: var(--text); font: 12px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }.mfg-collaboration__assignment-actions span { color: var(--text-muted); font-size: 12px; }.mfg-collaboration__assignment-actions article > div { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }@media (max-width: 820px) { .mfg-collaboration__grid, .mfg-collaboration__form { grid-template-columns: 1fr; }.mfg-collaboration__assignment-actions article { grid-template-columns: 1fr; }.mfg-collaboration__panel header { flex-wrap: wrap; }.mfg-collaboration__panel header select { margin-left: 0; max-width: 100%; width: 100%; } }
</style>
