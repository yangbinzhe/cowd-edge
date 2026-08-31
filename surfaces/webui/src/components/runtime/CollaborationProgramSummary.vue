<script setup lang="ts">
import { computed } from 'vue';
import type { GatewayComponents } from '../../generated/gateway-api';
import type { ExecutionActivityProjection, ExecutionProjection } from '../../types';
import { t } from '../../i18n';
import DataTable from '../workbench/DataTable.vue';
import StatusPill from '../workbench/StatusPill.vue';

type CollaborationProgram = GatewayComponents['schemas']['CollaborationProgram'];
type CollaborationEscalationReceipt = GatewayComponents['schemas']['CollaborationEscalationReceipt'];

const props = defineProps<{
  program: CollaborationProgram;
  appliedMutationIds: string[];
  escalations: CollaborationEscalationReceipt[];
  workPrioritiesBySemantic: Record<string, number | null>;
  activities?: ExecutionActivityProjection[];
  concurrency?: ExecutionProjection['concurrency'];
}>();

const resource = computed(() => props.program.control.resource_ledger);
const obligationByInstance = computed(() => new Map(
  props.program.control.obligations.map((obligation) => [obligation.instance_id, obligation]),
));
const activityByTeam = computed(() => new Map(
  (props.activities || [])
    .filter((activity) => activity.kind === 'team' && activity.team_run_id)
    .map((activity) => [activity.team_run_id!, activity]),
));
const teamRows = computed<Record<string, unknown>[]>(() => props.program.team_instances.map((team) => {
  const obligation = obligationByInstance.value.get(team.instance_id);
  const activity = activityByTeam.value.get(team.instance_id);
  return {
    instance: team.instance_id,
    semantic: team.semantic_node_id,
    required: team.required,
    state: activity?.status || obligation?.state || 'unknown',
    reason: activity?.status_reason || obligation?.reason_kind || '-',
    blocked_by: activity?.blocked_by_activity_ids?.join(', ') || '-',
    work: activity?.work_status || '-',
    child_graph: obligation?.child_graph_ref || '-',
    revision: obligation?.revision ?? '-',
    soft_priority: props.workPrioritiesBySemantic[team.semantic_node_id] ?? '-',
  };
}));
const rootConcurrency = computed(() => props.concurrency?.root);
const inclusiveConcurrency = computed(() => props.concurrency?.inclusive);
const capacityRows = computed(() => (props.concurrency?.resources || []).map((resource) => ({
  resource: resource.kind,
  active: resource.active_leases,
  limit: resource.effective_limit,
  queued: resource.queued_waiters,
  utilization: `${(Number(resource.utilization_basis_points || 0) / 100).toFixed(1)}%`,
  scope: resource.scope,
})));
const edgeRows = computed<Record<string, unknown>[]>(() => props.program.edges.map((edge) => ({
  edge: edge.edge_id,
  from: edge.from,
  to: edge.to,
  kind: edge.kind,
  state: edge.state,
  delivery_receipt: edge.delivery_receipt?.receipt_ref || '-',
  claim_receipt: edge.claim_receipt?.claim_ref || '-',
})));
const escalationRows = computed<Record<string, unknown>[]>(() => props.escalations.map((escalation) => ({
  escalation: escalation.escalation_id,
  source_attempt: escalation.source_attempt,
  base_revision: escalation.base_program_revision,
  applied_revision: escalation.applied_graph_revision,
  request_kind: escalation.request_kind,
  reason: escalation.reason,
  evidence: escalation.evidence_refs.length,
})));
const deadlineLabel = computed(() => resource.value.deadline_at_ms
  ? `${resource.value.deadline_at_ms} ms`
  : '-');
</script>

<template>
  <section class="collaboration-program-summary" :aria-label="t('runtime.collaboration.title')">
    <header>
      <div>
        <h3>{{ t('runtime.collaboration.title') }}</h3>
        <p>{{ t('runtime.collaboration.summary') }}</p>
      </div>
      <StatusPill :status="program.control.lifecycle" />
    </header>

    <div class="collaboration-program-facts">
      <dl>
        <dt>{{ t('runtime.collaboration.program') }}</dt>
        <dd><code>{{ program.program_id }}</code></dd>
        <dt>{{ t('runtime.collaboration.revision') }}</dt>
        <dd>{{ program.revision }}</dd>
        <dt>{{ t('runtime.collaboration.requiredTeams') }}</dt>
        <dd>{{ program.required_team_count }}</dd>
        <dt>{{ t('runtime.collaboration.appliedMutations') }}</dt>
        <dd>{{ appliedMutationIds.length || '-' }}</dd>
      </dl>
      <dl>
        <dt>{{ t('runtime.collaboration.waitingRelation') }}</dt>
        <dd>{{ program.control.waiting_relation || '-' }}</dd>
        <dt>{{ t('runtime.collaboration.blocker') }}</dt>
        <dd>{{ program.control.blocker_ref || '-' }}</dd>
        <dt>{{ t('runtime.collaboration.nextAction') }}</dt>
        <dd>{{ program.control.next_action || '-' }}</dd>
        <dt>{{ t('runtime.collaboration.controlRevision') }}</dt>
        <dd>{{ resource.revision }}</dd>
      </dl>
      <dl>
        <dt>{{ t('runtime.collaboration.parallelDemand') }}</dt>
        <dd>{{ resource.parallel_demand }}</dd>
        <dt>{{ t('runtime.collaboration.contextReservation') }}</dt>
        <dd>{{ resource.context_reservation_tokens }}</dd>
        <dt>{{ t('runtime.collaboration.outputReservation') }}</dt>
        <dd>{{ resource.output_reservation_tokens }}</dd>
        <dt>{{ t('runtime.collaboration.deadline') }}</dt>
        <dd>{{ deadlineLabel }}</dd>
        <dt>{{ t('runtime.collaboration.confidence') }}</dt>
        <dd>{{ `${(resource.confidence_basis_points / 100).toFixed(2)}%` }}</dd>
      </dl>
    </div>

    <div class="collaboration-program-table">
      <h4>{{ t('runtime.collaboration.concurrency') }}</h4>
      <div class="collaboration-concurrency" role="group" :aria-label="t('runtime.collaboration.concurrency')">
        <dl>
          <dt>{{ t('runtime.collaboration.rootScope') }}</dt>
          <dd>{{ t('runtime.collaboration.concurrencySummary', { ready: rootConcurrency?.ready || 0, running: rootConcurrency?.running || 0, total: rootConcurrency?.total || 0 }) }}</dd>
        </dl>
        <dl>
          <dt>{{ t('runtime.collaboration.inclusiveScope') }}</dt>
          <dd>{{ t('runtime.collaboration.concurrencySummary', { ready: inclusiveConcurrency?.ready || 0, running: inclusiveConcurrency?.running || 0, total: inclusiveConcurrency?.total || 0 }) }}</dd>
        </dl>
      </div>
      <DataTable
        v-if="capacityRows.length"
        compact
        row-key="resource"
        :rows="capacityRows"
        :columns="['resource', 'active', 'limit', 'queued', 'utilization', 'scope']"
      />
    </div>
    <div class="collaboration-program-table">
      <h4>{{ t('runtime.collaboration.teams') }}</h4>
      <DataTable
        compact
        copyable
        row-key="instance"
        :rows="teamRows"
        :columns="['instance', 'semantic', 'required', 'state', 'work', 'reason', 'blocked_by', 'soft_priority', 'child_graph', 'revision']"
      />
    </div>
    <div class="collaboration-program-table">
      <h4>{{ t('runtime.collaboration.edges') }}</h4>
      <DataTable
        compact
        copyable
        row-key="edge"
        :rows="edgeRows"
        :columns="['edge', 'from', 'to', 'kind', 'state', 'delivery_receipt', 'claim_receipt']"
      />
    </div>
    <div v-if="escalationRows.length" class="collaboration-program-table">
      <h4>{{ t('runtime.collaboration.escalations') }}</h4>
      <DataTable
        compact
        copyable
        row-key="escalation"
        :rows="escalationRows"
        :columns="['escalation', 'source_attempt', 'base_revision', 'applied_revision', 'request_kind', 'reason', 'evidence']"
      />
    </div>
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
