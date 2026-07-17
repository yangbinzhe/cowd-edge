<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { Activity, ArrowRight, GitBranch, ShieldAlert } from 'lucide-vue-next';
import { adaptStrategyDecision } from '../../adapters/strategyDecision';
import { formatCount, t } from '../../i18n';
import type { ExecutionProjectionEntity, StrategyDecisionProjection } from '../../types';
import GraphSurface from '../graph/GraphSurface.vue';
import StatusPill from '../workbench/StatusPill.vue';
import TimelineList from '../workbench/TimelineList.vue';

const props = withDefaults(defineProps<{
  strategy: StrategyDecisionProjection | null | undefined;
  agents?: ExecutionProjectionEntity[];
  executionId?: string;
  connectionState?: string;
  surface?: 'runtime' | 'mission' | 'mfg';
}>(), {
  executionId: '',
  agents: () => [],
  connectionState: 'ready',
  surface: 'runtime',
});

const router = useRouter();
const visualsOpen = ref(false);
const view = computed(() => adaptStrategyDecision(props.strategy, props.executionId, props.agents));
const estimatedTokens = computed(() => Number(view.value?.estimated?.context_duplication_tokens || 0));
const actualTokens = computed(() => {
  const actual = view.value?.actual;
  return actual
    ? Number(actual.input_tokens || 0) + Number(actual.output_tokens || 0) + Number(actual.cached_tokens || 0)
    : null;
});
const firstEvidenceRef = computed(() => view.value?.evidenceScopes
  .flatMap((scope) => scope.capability_cropped_refs)[0] || '');
const actualUnavailableLabel = computed(() => {
  if (view.value?.actualMode === 'running') return t('strategy.state.runningUnknown');
  if (view.value?.actualStatus === 'observed') return t('strategy.state.observedUnavailable');
  if (view.value?.actualMode === 'not_observed') return t('strategy.state.notObserved');
  return t('strategy.state.unknown');
});
const actualUnavailableDetail = computed(() => view.value?.actualMode === 'running'
  ? t('strategy.state.actualPending')
  : t('strategy.state.actualUnavailable'));
const estimateModeLabel = computed(() => {
  const key = {
    assumed: 'strategy.state.assumed',
    calibrated: 'strategy.state.calibrated',
    unknown: 'strategy.state.unknown',
  }[view.value?.estimateMode || 'unknown'];
  return t(key);
});

function formatDuration(milliseconds: number | null | undefined) {
  if (milliseconds == null || !Number.isFinite(Number(milliseconds))) return t('strategy.value.unknown');
  const value = Number(milliseconds);
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s` : `${value}ms`;
}

function formatBasisPointRatio(value: number | null | undefined) {
  return value == null ? t('strategy.value.unknown') : `${(Number(value) / 10_000).toFixed(2)}×`;
}

function formatBasisPointPercent(value: number | null | undefined) {
  return value == null ? t('strategy.value.unknown') : `${(Number(value) / 100).toFixed(1)}%`;
}

function openTimelineItem(item: Record<string, unknown>) {
  if (typeof item.href === 'string' && item.href) void router.push(item.href);
}

function trackVisualState(event: Event) {
  visualsOpen.value = Boolean((event.currentTarget as HTMLDetailsElement | null)?.open);
}
</script>

<template>
  <section
    v-if="view"
    class="strategy-summary"
    :data-surface="surface"
    :data-status="view.degraded ? 'degraded' : view.status"
    aria-labelledby="strategy-summary-title"
  >
    <header class="strategy-summary__header">
      <div>
        <span class="strategy-summary__eyebrow"><GitBranch :size="14" />{{ t('strategy.label.decision') }}</span>
        <h3 id="strategy-summary-title">{{ view.selectedCandidate }} <span>/ {{ view.pattern }}</span></h3>
        <p>{{ view.summary || t('strategy.summary.fallback') }}</p>
      </div>
      <div class="strategy-summary__status" aria-live="polite">
        <StatusPill :status="view.running ? 'running' : view.status" />
        <StatusPill v-if="view.degraded" status="degraded" />
        <StatusPill v-if="view.proofMode === 'not_proven'" status="not_proven" />
      </div>
    </header>

    <p v-if="view.legacy" class="strategy-summary__notice">
      <ShieldAlert :size="15" />
      {{ t('strategy.state.legacy') }}
    </p>

    <dl class="strategy-summary__identity">
      <div><dt>{{ t('strategy.field.source') }}</dt><dd>{{ view.source }}</dd></div>
      <div><dt>{{ t('strategy.field.confidence') }}</dt><dd>{{ view.confidence == null ? t('strategy.value.unknown') : `${view.confidence}%` }}</dd></div>
      <div><dt>{{ t('strategy.field.estimateMode') }}</dt><dd>{{ estimateModeLabel }}</dd></div>
      <div>
        <dt>{{ t('strategy.field.proof') }}</dt>
        <dd>
          {{ view.proofMode === 'calibrated'
            ? t('strategy.state.calibrated')
            : view.proofMode === 'not_proven'
              ? t('strategy.state.notProven')
              : t('strategy.state.unknown') }}
        </dd>
      </div>
      <div><dt>{{ t('strategy.field.policy') }}</dt><dd>{{ view.policyVersion }}</dd></div>
      <div><dt>{{ t('strategy.field.revision') }}</dt><dd>r{{ view.revision }}</dd></div>
    </dl>

    <div class="strategy-summary__comparison">
      <section>
        <span>{{ t('strategy.label.estimated') }}</span>
        <strong>{{ view.estimated ? formatDuration(view.estimated.estimated_critical_path_ms) : t('strategy.value.unknown') }}</strong>
        <small v-if="view.estimated">
          {{ t('strategy.metric.merge') }} {{ formatDuration(view.estimated.merge_cost_ms) }}
          · {{ t('strategy.metric.score') }} {{ view.estimated.net_benefit_score }}
          · {{ formatCount('tokens', estimatedTokens) }}
        </small>
      </section>
      <ArrowRight :size="18" aria-hidden="true" />
      <section :data-state="view.actualStatus">
        <span>{{ t('strategy.label.actual') }}</span>
        <strong>{{ view.actual ? formatDuration(view.actual.duration_ms) : actualUnavailableLabel }}</strong>
        <small v-if="view.actual">
          {{ view.actual.tool_calls }} {{ t('strategy.metric.tools') }}
          · {{ formatCount('tokens', actualTokens || 0) }}
          · {{ t('strategy.metric.merge') }} {{ formatDuration(view.actual.merge_cost_ms) }}
          · {{ t('strategy.metric.speedup') }} {{ formatBasisPointRatio(view.actual.actual_speedup_ratio_bp) }}
          · {{ t('strategy.metric.quality') }} {{ formatBasisPointPercent(view.actual.quality_score_bp) }}
        </small>
        <small v-else>{{ actualUnavailableDetail }}</small>
      </section>
    </div>

    <div v-if="view.why.length || view.whyNot.length" class="strategy-summary__reasons">
      <section v-if="view.why.length">
        <h4>{{ t('strategy.label.why') }}</h4>
        <ul><li v-for="reason in view.why" :key="reason">{{ reason }}</li></ul>
      </section>
      <section v-if="view.whyNot.length">
        <h4>{{ t('strategy.label.cost') }}</h4>
        <ul><li v-for="reason in view.whyNot" :key="reason">{{ reason }}</li></ul>
      </section>
    </div>

    <div v-if="view.evidenceScopes.length" class="strategy-summary__scopes">
      <article v-for="scope in view.evidenceScopes" :key="`${scope.role_id}:${scope.focus_id}`">
        <span>{{ scope.role_id }} · {{ scope.focus_id }}</span>
        <strong>{{ scope.responsibility_summary }}</strong>
        <small>
          {{ scope.capability_cropped_refs.length }} {{ t('strategy.metric.evidenceRefs') }}
          · {{ t('strategy.metric.overlap') }} ≤ {{ scope.overlap_budget_bp / 100 }}%
        </small>
      </article>
    </div>

    <nav v-if="view.executionId || view.teamId || view.evidenceScopes.some((scope) => scope.capability_cropped_refs.length)" class="strategy-summary__links" :aria-label="t('strategy.label.backlinks')">
      <RouterLink v-if="view.executionId" :to="`/runtime?section=runs&execution_id=${encodeURIComponent(view.executionId)}&decision_id=${encodeURIComponent(view.id)}`">
        {{ t('strategy.link.execution') }}
      </RouterLink>
      <RouterLink v-if="view.teamId" :to="`/mission?section=teams&team_id=${encodeURIComponent(view.teamId)}&execution_id=${encodeURIComponent(view.teamExecutionId || view.executionId)}`">
        {{ t('strategy.link.team') }}
      </RouterLink>
      <RouterLink v-if="firstEvidenceRef" :to="`/reality?section=evidence&focus=${encodeURIComponent(firstEvidenceRef)}`">
        {{ t('strategy.link.evidence') }}
      </RouterLink>
    </nav>

    <details class="strategy-summary__visuals" @toggle="trackVisualState">
      <summary><Activity :size="15" />{{ t('strategy.label.trace') }}</summary>
      <template v-if="visualsOpen">
        <GraphSurface :model="view.graph" :connection-state="connectionState" />
        <TimelineList :items="view.timeline" :title="t('strategy.label.timeline')" :live="view.running" @select="openTimelineItem" />
      </template>
    </details>
  </section>
</template>

<style scoped>
.strategy-summary {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--info);
  border-radius: 10px;
  background: var(--surface);
}
.strategy-summary[data-status="degraded"] { border-left-color: var(--warn); }
.strategy-summary__header { display: flex; align-items: start; justify-content: space-between; gap: 18px; }
.strategy-summary__header h3 { margin: 3px 0 0; font-size: 17px; color: var(--text); }
.strategy-summary__header h3 span { color: var(--text-muted); font-weight: 500; }
.strategy-summary__header p { max-width: 76ch; margin: 4px 0 0; color: var(--text-muted); font-size: 12px; }
.strategy-summary__eyebrow { display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.strategy-summary__status { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.strategy-summary__notice { display: flex; align-items: center; gap: 7px; margin: 0; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border)); border-radius: 7px; color: var(--warn); font-size: 12px; }
.strategy-summary__identity { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin: 0; }
.strategy-summary__identity div { min-width: 0; padding-left: 8px; border-left: 1px solid var(--border); }
.strategy-summary__identity dt { color: var(--text-faint); font-size: 10px; text-transform: uppercase; }
.strategy-summary__identity dd { overflow: hidden; margin: 3px 0 0; color: var(--text); font: 11px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.strategy-summary__comparison { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px; }
.strategy-summary__comparison section { display: grid; gap: 3px; min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
.strategy-summary__comparison section[data-state="unknown"] { border-style: dashed; }
.strategy-summary__comparison span, .strategy-summary__comparison small { color: var(--text-muted); font-size: 11px; }
.strategy-summary__comparison strong { color: var(--text); font: 18px var(--font-mono); }
.strategy-summary__comparison > svg { color: var(--text-faint); }
.strategy-summary__reasons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.strategy-summary__reasons h4 { margin: 0 0 5px; color: var(--text-muted); font-size: 11px; text-transform: uppercase; }
.strategy-summary__reasons ul { display: grid; gap: 4px; margin: 0; padding-left: 17px; color: var(--text); font-size: 12px; }
.strategy-summary__scopes { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; }
.strategy-summary__scopes article { display: grid; gap: 3px; min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 7px; }
.strategy-summary__scopes span, .strategy-summary__scopes small { color: var(--text-muted); font-size: 10px; }
.strategy-summary__scopes strong { color: var(--text); font-size: 12px; }
.strategy-summary__links { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.strategy-summary__links a { color: var(--info); font-size: 12px; text-decoration: none; }
.strategy-summary__links a:hover, .strategy-summary__links a:focus-visible { text-decoration: underline; }
.strategy-summary__visuals { border-top: 1px solid var(--border); padding-top: 10px; }
.strategy-summary__visuals summary { display: flex; align-items: center; gap: 7px; width: fit-content; min-height: 32px; color: var(--text-muted); cursor: pointer; font-size: 12px; font-weight: 650; }
.strategy-summary__visuals summary:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 2px; border-radius: 4px; }
.strategy-summary__visuals[open] { display: grid; gap: 12px; }
@media (pointer: coarse) {
  .strategy-summary__visuals summary, .strategy-summary__links a { min-height: 44px; display: inline-flex; align-items: center; }
}
@media (max-width: 980px) {
  .strategy-summary__identity { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .strategy-summary__header { align-items: stretch; flex-direction: column; }
  .strategy-summary__status { justify-content: flex-start; }
  .strategy-summary__identity { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .strategy-summary__comparison { grid-template-columns: 1fr; }
  .strategy-summary__comparison > svg { transform: rotate(90deg); justify-self: center; }
  .strategy-summary__reasons { grid-template-columns: 1fr; }
}
</style>
