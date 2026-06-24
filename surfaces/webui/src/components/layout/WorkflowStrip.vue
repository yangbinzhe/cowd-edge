<script setup lang="ts">
import StatusPill from '../workbench/StatusPill.vue';

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
}>(), {
  title: 'Workflow',
});

function go(step: WorkflowStep) {
  const target = document.querySelector(`[data-section="${step.id}"], #${step.id}`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <nav class="workflow-strip" :aria-label="title">
    <header>
      <strong>{{ title }}</strong>
      <span>{{ steps.length }} stages</span>
    </header>
    <button
      v-for="step in props.steps"
      :key="step.id"
      class="workflow-step"
      :data-status="step.status || 'idle'"
      type="button"
      @click="go(step)"
    >
      <span class="workflow-step-label">{{ step.label }}</span>
      <StatusPill :status="step.status === 'done' ? 'ready' : step.status || 'empty'" />
      <small v-if="step.count !== undefined">{{ step.count }}</small>
      <em v-if="step.description">{{ step.description }}</em>
    </button>
  </nav>
</template>
