<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';
import type { ExecutionProjection } from '../../types';
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
    </div>

    <div v-if="evidenceRows.length" class="execution-truth-evidence">
      <article v-for="evidence in evidenceRows.slice(0, 6)" :key="evidence.id">
        <strong>{{ displayStatus(evidence.support) }}</strong>
        <span>{{ displayStatus(evidence.boundary) }}</span>
        <small>{{ displayStatus(evidence.completeness) }} · {{ evidence.freshness }}</small>
      </article>
    </div>
    <RawPayload :title="t('runtime.truth.raw')" :data="{ admission, outcome, evidence: projection.evidence }" />
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
