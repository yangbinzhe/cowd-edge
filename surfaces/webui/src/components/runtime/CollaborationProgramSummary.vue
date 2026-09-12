<script setup lang="ts">
import { computed } from 'vue';
import type { components as GatewayComponents } from '../../generated/gateway-api';
import type { ExecutionProjection } from '../../types';
import { t } from '../../i18n';
import DataTable from '../workbench/DataTable.vue';
import StatusPill from '../workbench/StatusPill.vue';

type CollaborationProgram = GatewayComponents['schemas']['AgenticCollaborationProgramProjectionV1'];
const props = defineProps<{ program: CollaborationProgram; concurrency?: ExecutionProjection['concurrency'] }>();
const teamRows = computed(() => props.program.teams.map(team => {
  const tasks = props.program.tasks.filter(task => task.team_id === team.team_id);
  return { id: team.team_id, name: team.name, summary: team.mission, status: team.lifecycle,
    total: tasks.length, accepted: tasks.filter(task => task.status === 'accepted').length,
    blocked: tasks.filter(task => task.status === 'blocked').length, topic: team.topic_ref };
}));
const taskRows = computed(() => props.program.tasks.map(task => ({
  id: task.task_id, title: task.title, status: task.status, team: task.team_id,
  summary: task.review_reason || task.last_failure || task.objective,
  depends_on: task.depends_on.join(', '), artifacts: task.artifact_refs.length,
})));
const capacityRows = computed(() => (props.concurrency?.resources || []).map(resource => ({
  resource: resource.kind, active: resource.active_leases, limit: resource.effective_limit,
  queued: resource.queued_waiters, scope: resource.scope,
})));
</script>

<template>
  <section class="collaboration-program-summary" :aria-label="t('runtime.collaboration.title')">
    <header><div><h3>{{ t('runtime.collaboration.title') }}</h3><p>{{ program.objective_summary }}</p></div><StatusPill :status="program.status" /></header>
    <div class="collaboration-program-facts">
      <dl><dt>{{ t('runtime.collaboration.program') }}</dt><dd><code>{{ program.program_id }}</code></dd>
        <dt>{{ t('runtime.collaboration.revision') }}</dt><dd>{{ program.revision }}</dd></dl>
      <dl><dt>{{ t('runtime.collaboration.requiredTeams') }}</dt><dd>{{ program.required_team_count }}</dd>
        <dt>{{ t('runtime.truth.unresolved') }}</dt><dd>{{ program.unresolved.length }}</dd></dl>
    </div>
    <p>{{ t('runtime.collaboration.acceptanceBoundary') }}</p>
    <ul v-if="program.unresolved.length"><li v-for="item in program.unresolved" :key="item">{{ item }}</li></ul>
    <div class="collaboration-program-table"><h4>{{ t('runtime.collaboration.teams') }}</h4>
      <DataTable compact row-key="id" :rows="teamRows" :columns="['name', 'status', 'total', 'accepted', 'blocked', 'summary', 'topic']" /></div>
    <div class="collaboration-program-table"><h4>{{ t('runtime.collaboration.tasks') }}</h4>
      <DataTable compact row-key="id" :rows="taskRows" :columns="['title', 'status', 'team', 'summary', 'depends_on', 'artifacts']" /></div>
    <div v-if="capacityRows.length" class="collaboration-program-table"><h4>{{ t('runtime.collaboration.concurrency') }}</h4>
      <DataTable compact row-key="resource" :rows="capacityRows" :columns="['resource', 'active', 'limit', 'queued', 'scope']" /></div>
  </section>
</template>

<style scoped>
.collaboration-program-summary {
  display: grid;
  gap: 12px;
  padding-top: 2px;
}

.collaboration-program-summary > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.collaboration-program-summary h3,
.collaboration-program-summary h4,
.collaboration-program-summary p {
  margin: 0;
}

.collaboration-program-summary p,
.collaboration-program-facts dt {
  color: var(--text-muted);
}

.collaboration-program-summary p {
  margin-top: 4px;
}

.collaboration-program-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
}

.collaboration-program-facts dl {
  display: grid;
  grid-template-columns: minmax(92px, auto) minmax(0, 1fr);
  gap: 8px 12px;
  margin: 0;
  padding: 12px;
  background: var(--surface);
}

.collaboration-program-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.collaboration-program-table {
  display: grid;
  gap: 8px;
}

.collaboration-concurrency {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.collaboration-concurrency dl {
  min-width: 240px;
  flex: 1 1 240px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  margin: 0;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.collaboration-concurrency dt {
  color: var(--text-muted);
}

.collaboration-concurrency dd {
  margin: 0;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1100px) {
  .collaboration-program-facts {
    grid-template-columns: 1fr;
  }
}
</style>
