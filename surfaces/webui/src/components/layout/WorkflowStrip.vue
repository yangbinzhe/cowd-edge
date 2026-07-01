<script setup lang="ts">
import { t } from '../../i18n';
import { formatCount } from '../../i18n';
import StatusPill from '../workbench/StatusPill.vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAppStore } from '../../stores/app';

interface WorkflowStep {
  id: string;
  label: string;
  status?: 'idle' | 'ready' | 'active' | 'blocked' | 'done' | 'degraded' | 'error';
  count?: number | string;
  description?: string;
}

const props = withDefaults(defineProps<{
  steps: WorkflowStep[];
  title?: string;
  density?: 'default' | 'compact';
  maxVisible?: number;
}>(), {
  title: t('script.components.layout.workflowstrip.title.d7a484140f'),
  density: 'default',
  maxVisible: 0,
});
const route = useRoute();
const store = useAppStore();
const visibleSteps = computed(() => props.maxVisible > 0 ? props.steps.slice(0, props.maxVisible) : props.steps);
const hiddenStepCount = computed(() => Math.max(0, props.steps.length - visibleSteps.value.length));

function pageFromRoute(path: string) {
  if (path === '/' || path === '/chat') return 'chat';
  if (path.startsWith('/apps/mfg')) return 'mfg';
  return path.replace(/^\/+/, '').split('/')[0] || 'chat';
}

function go(step: WorkflowStep) {
  store.selectSection(pageFromRoute(route.path), step.id);
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-section="${step.id}"], #${step.id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
</script>

<template>
  <nav class="workflow-strip" :data-density="density" :aria-label="title">
    <header>
      <strong>{{ title }}</strong>
      <span>{{ formatCount('stages', steps.length) }}</span>
    </header>
    <button
      v-for="step in visibleSteps"
      :key="step.id"
      class="workflow-step"
      :data-status="step.status || 'idle'"
      type="button"
      @click="go(step)"
    >
      <span class="workflow-step-label">{{ step.label }}</span>
      <small v-if="step.count !== undefined">{{ step.count }}</small>
      <StatusPill v-else :status="step.status === 'done' ? 'ready' : step.status || 'empty'" />
      <em v-if="density !== 'compact' && step.description">{{ step.description }}</em>
    </button>
    <span v-if="hiddenStepCount" class="workflow-step workflow-step-more" data-status="idle">
      <span class="workflow-step-label">{{ t('component.layout.workflow.more', { count: hiddenStepCount }) }}</span>
      <StatusPill status="idle" />
    </span>
  </nav>
</template>
