<script setup lang="ts">
defineProps<{
  rows: Array<Record<string, unknown>>;
}>();
</script>

<template>
  <section class="surface-diagnostic-playbook" aria-label="Surface diagnostic playbook">
    <header>
      <h3>Surface diagnostic playbook</h3>
      <span>{{ rows.length }} lanes</span>
    </header>
    <article v-for="row in rows" :key="String(row.lane)" :data-severity="row.severity || 'ready'">
      <strong>{{ row.lane }}</strong>
      <dl class="detail-list">
        <dt>Status</dt>
        <dd>{{ row.status }}</dd>
        <dt>Evidence</dt>
        <dd>{{ row.evidence }}</dd>
        <dt>Next</dt>
        <dd>{{ row.next_action }}</dd>
      </dl>
    </article>
  </section>
</template>
