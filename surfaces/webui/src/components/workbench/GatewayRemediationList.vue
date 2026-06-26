<script setup lang="ts">
defineProps<{
  rows: Array<Record<string, unknown>>;
}>();
</script>

<template>
  <section class="remediation-list" aria-label="Gateway remediation list">
    <header>
      <h3>Gateway remediation</h3>
      <span>{{ rows.length }} checks</span>
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
