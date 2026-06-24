<script setup lang="ts">
import ApiStateBanner from '../workbench/ApiStateBanner.vue';
import PrimaryContextBar from './PrimaryContextBar.vue';
import WorkflowStrip from './WorkflowStrip.vue';

type WorkflowStep = {
  id: string;
  label: string;
  status?: 'idle' | 'ready' | 'active' | 'blocked' | 'done' | 'degraded' | 'error';
  count?: number | string;
  description?: string;
};

defineProps<{
  title: string;
  subtitle: string;
  endpoint?: string;
  status?: 'ready' | 'empty' | 'offline' | 'error' | 'degraded' | 'unsupported' | 'loading';
  statusDetail?: string;
  context?: Array<{ label: string; value: string | number | boolean | null | undefined; tone?: string }>;
  workflow?: WorkflowStep[];
}>();
</script>

<template>
  <section class="capability-page kernel-workbench">
    <header class="page-header">
      <div>
        <h1>{{ title }}</h1>
        <p>{{ subtitle }}</p>
      </div>
      <slot name="actions" />
    </header>
    <ApiStateBanner
      v-if="status && status !== 'ready'"
      :status="status"
      :endpoint="endpoint"
      :detail="statusDetail"
    />
    <PrimaryContextBar v-if="context?.length" :items="context" />
    <WorkflowStrip v-if="workflow?.length" :steps="workflow" />
    <slot />
  </section>
</template>
