<script setup lang="ts">
defineProps<{
  title: string;
  action: string;
  target?: string;
  affected?: Array<string | number>;
  risk?: string;
  expected?: Array<string | number>;
  approval?: string;
  source?: string;
}>();
</script>

<template>
  <article class="mission-action-preview">
    <header>
      <div>
        <h3>{{ title }}</h3>
        <p>{{ action }}</p>
      </div>
      <span :data-risk="risk || 'medium'">{{ risk || 'medium' }}</span>
    </header>
    <dl class="detail-list">
      <dt>Target</dt>
      <dd>{{ target || '-' }}</dd>
      <dt>Affected</dt>
      <dd>{{ affected?.length ? affected.join(', ') : '-' }}</dd>
      <dt>Expected events</dt>
      <dd>{{ expected?.length ? expected.join(', ') : '-' }}</dd>
      <dt>Approval</dt>
      <dd>{{ approval || 'policy dependent' }}</dd>
      <dt>Source</dt>
      <dd>{{ source || 'frontend projection preview' }}</dd>
    </dl>
  </article>
</template>
