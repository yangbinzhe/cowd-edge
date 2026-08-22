<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';
import type { AnswerOrigin, DeliveryStatus, ExecutionProjection } from '../../types';
import CollaborationProgramSummary from './CollaborationProgramSummary.vue';
import RawPayload from '../workbench/RawPayload.vue';
import StatusPill from '../workbench/StatusPill.vue';

const props = defineProps<{
  projection: ExecutionProjection;
  connectionState?: string;
}>();

function latestPayload(type: 'admission' | 'outcome') {
  const collection = type === 'admission'
    ? props.projection.admissions
    : props.projection.outcomes;
  return [...collection]
    .filter((entity) => entity.payload?.type === type)
    .sort((left, right) => Number(right.revision) - Number(left.revision))[0]?.payload?.value;
}

const admission = computed(() => latestPayload('admission') as any);
const outcome = computed(() => latestPayload('outcome') as any);
const delivery = computed(() => props.projection.delivery_envelope || null);
const presentation = computed(() => props.projection.terminal_presentation || null);
const collaborationProgram = computed(() => props.projection.graph.orchestration?.collaboration_program || null);
const coverage = computed(() => delivery.value?.coverage || null);
const DELIVERY_STATUS_KEYS: Record<DeliveryStatus, string> = {
  satisfied: 'runtime.truth.deliveryStatus.satisfied',
  partial: 'runtime.truth.deliveryStatus.partial',
  denied: 'runtime.truth.deliveryStatus.denied',
  unavailable: 'runtime.truth.deliveryStatus.unavailable',
};
const ANSWER_ORIGIN_KEYS: Record<AnswerOrigin, string> = {
  model_direct: 'runtime.truth.answerOriginValue.model_direct',
  terminal_delegate: 'runtime.truth.answerOriginValue.terminal_delegate',
  team_synthesizer: 'runtime.truth.answerOriginValue.team_synthesizer',
  terminal_narrator: 'runtime.truth.answerOriginValue.terminal_narrator',
  fallback_model: 'runtime.truth.answerOriginValue.fallback_model',
  programmatic_fallback: 'runtime.truth.answerOriginValue.programmatic_fallback',
  cancellation_receipt: 'runtime.truth.answerOriginValue.cancellation_receipt',
};
const coverageLabel = computed(() => {
  if (!coverage.value) return '-';
  const required = coverage.value.required_obligation_ids?.length || 0;
  const satisfied = coverage.value.satisfied_obligation_ids?.length || 0;
  const percent = Math.min(100, Math.max(0, Number(coverage.value.coverage_basis_points || 0) / 100));
  return `${satisfied}/${required} (${percent.toFixed(percent % 1 ? 1 : 0)}%)`;
});
function deliveryStatusLabel(value?: DeliveryStatus) {
  return value ? t(DELIVERY_STATUS_KEYS[value]) : '-';
}

function answerOriginLabel(value?: AnswerOrigin) {
  return value ? t(ANSWER_ORIGIN_KEYS[value]) : '-';
}
const evidenceRows = computed(() => props.projection.evidence.map((entity) => {
  const evidence = entity.payload?.type === 'evidence' ? entity.payload.value : null;
  return {
    id: entity.id,
    support: evidence?.support || entity.status || 'unknown',
    boundary: evidence?.evidence_ref?.boundary || 'unknown',
    completeness: evidence?.completeness || 'none',
    freshness: evidence?.freshness_ms == null ? '-' : `${evidence.freshness_ms} ms`,
  };
}));
const lifecycleStatus = computed(() => (
  outcome.value?.terminal_class
  || admission.value?.status
  || props.projection.live?.status
  || props.connectionState
  || 'unknown'
));
</script>

<template>
  <section class="execution-truth-summary">
    <header>
      <div>
        <h2>{{ t('runtime.truth.title') }}</h2>
        <p>{{ t('runtime.truth.summary') }}</p>
      </div>
      <StatusPill :status="lifecycleStatus" />
    </header>

    <div class="execution-truth-grid">
      <dl>
        <dt>{{ t('runtime.truth.admission') }}</dt>
        <dd>{{ displayStatus(admission?.status || 'unknown') }}</dd>
        <dt>{{ t('runtime.truth.queueAge') }}</dt>
        <dd>{{ admission ? `${Number(admission.queue_age_ms || 0)} ms` : '-' }}</dd>
        <dt>{{ t('runtime.truth.waitReason') }}</dt>
        <dd>{{ admission?.wait_reason || admission?.blocker || '-' }}</dd>
      </dl>
      <dl>
        <dt>{{ t('runtime.truth.outcome') }}</dt>
        <dd>{{ displayStatus(outcome?.terminal_class || 'pending') }}</dd>
        <dt>{{ t('runtime.truth.duration') }}</dt>
        <dd>{{ outcome ? `${Number(outcome.duration_ms || 0)} ms` : '-' }}</dd>
        <dt>{{ t('runtime.truth.quality') }}</dt>
        <dd>{{ displayStatus(outcome?.quality || 'unknown') }}</dd>
        <dt>{{ t('runtime.truth.provider') }}</dt>
        <dd>{{ outcome ? [outcome.provider, outcome.model].filter(Boolean).join(' / ') || '-' : '-' }}</dd>
        <dt>{{ t('runtime.truth.tokens') }}</dt>
        <dd>{{ outcome ? `${Number(outcome.input_tokens || 0)} / ${Number(outcome.output_tokens || 0)}` : '-' }}</dd>
        <dt>{{ t('runtime.truth.tools') }}</dt>
        <dd>{{ outcome ? Number(outcome.tool_calls || 0) : '-' }}</dd>
      </dl>
      <dl>
        <dt>{{ t('runtime.truth.evidence') }}</dt>
        <dd>{{ evidenceRows.length }}</dd>
        <dt>{{ t('runtime.truth.completeness') }}</dt>
        <dd>{{ displayStatus(outcome?.evidence_completeness || 'none') }}</dd>
        <dt>{{ t('runtime.truth.freshness') }}</dt>
        <dd>{{ outcome ? `${Number(outcome.freshness_ms || 0)} ms` : '-' }}</dd>
      </dl>
      <dl>
        <dt>{{ t('runtime.truth.pipeline') }}</dt>
        <dd>{{ displayStatus(delivery?.pipeline_status || 'unknown') }}</dd>
        <dt>{{ t('runtime.truth.delivery') }}</dt>
        <dd>{{ deliveryStatusLabel(delivery?.delivery_status) }}</dd>
        <dt>{{ t('runtime.truth.coverage') }}</dt>
        <dd>{{ coverageLabel }}</dd>
        <dt>{{ t('runtime.truth.effects') }}</dt>
        <dd>{{ delivery ? `${delivery.verified_effects.filter((effect) => effect.status === 'applied').length}/${delivery.verified_effects.length}` : '-' }}</dd>
        <dt>{{ t('runtime.truth.unresolved') }}</dt>
        <dd>{{ delivery?.unresolved.length ?? '-' }}</dd>
        <dt>{{ t('runtime.truth.answerOrigin') }}</dt>
        <dd>{{ answerOriginLabel(presentation?.answer_origin) }}</dd>
      </dl>
    </div>

    <div v-if="evidenceRows.length" class="execution-truth-evidence">
      <article v-for="evidence in evidenceRows.slice(0, 6)" :key="evidence.id">
        <strong>{{ displayStatus(evidence.support) }}</strong>
        <span>{{ displayStatus(evidence.boundary) }}</span>
        <small>{{ displayStatus(evidence.completeness) }} · {{ evidence.freshness }}</small>
      </article>
    </div>
    <CollaborationProgramSummary
      v-if="collaborationProgram"
      :program="collaborationProgram"
      :applied-mutation-ids="projection.graph.orchestration?.applied_mutation_ids || []"
      :escalations="projection.graph.orchestration?.collaboration_escalations || []"
    />
    <RawPayload :title="t('runtime.truth.raw')" :data="{ admission, outcome, delivery, presentation, collaboration: collaborationProgram, cancellation: projection.cancellation_receipt, evidence: projection.evidence }" />
  </section>
</template>

<style scoped>
.execution-truth-summary {
  display: grid;
  gap: 14px;
  padding: 16px 0;
  border-block: 1px solid var(--border);
}

.execution-truth-summary > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.execution-truth-summary h2,
.execution-truth-summary p {
  margin: 0;
}

.execution-truth-summary p {
  margin-top: 4px;
  color: var(--text-muted);
}

.execution-truth-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
}

.execution-truth-grid dl {
  display: grid;
  grid-template-columns: minmax(90px, auto) minmax(0, 1fr);
  gap: 8px 12px;
  margin: 0;
  padding: 12px;
  background: var(--surface);
}

.execution-truth-grid dt,
.execution-truth-evidence small {
  color: var(--text-muted);
}

.execution-truth-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.execution-truth-evidence {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.execution-truth-evidence article {
  display: grid;
  gap: 2px;
  min-width: 150px;
}

@media (max-width: 900px) {
  .execution-truth-grid {
    grid-template-columns: 1fr;
  }
}
</style>
