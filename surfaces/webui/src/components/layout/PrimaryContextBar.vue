<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: string | number | boolean | null | undefined; tone?: string }>;
}>();
</script>

<template>
  <section class="primary-context-bar" aria-label="Current context">
    <article v-for="item in items" :key="item.label" :data-tone="item.tone || 'default'">
      <span>{{ item.label }}</span>
      <strong>{{ item.value === undefined || item.value === null || item.value === '' ? '-' : item.value }}</strong>
    </article>
  </section>
</template>
