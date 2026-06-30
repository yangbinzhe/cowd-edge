<script setup lang="ts">
import { formatCount, t } from '../../i18n';
defineProps<{
  rows: Array<Record<string, unknown>>;
}>();
</script>

<template>
  <section class="remediation-list" :aria-label="t('component.workbench.gateway.remediation.list.aria-label.42faf72557')">
    <header>
      <h3>{{ t('component.workbench.gateway.remediation.list.text.7ade7a6661') }}</h3>
      <span>{{ formatCount('checks', rows.length) }}</span>
    </header>
    <article v-for="row in rows" :key="String(row.id || row.lane)" :data-severity="row.severity || 'info'">
      <div>
        <strong>{{ row.lane || row.id }}</strong>
        <p>{{ row.problem }}</p>
        <small>{{ row.evidence }}</small>
      </div>
      <span>{{ row.next_action }}</span>
    </article>
  </section>
</template>
