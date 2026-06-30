<script setup lang="ts">
import { t } from '../../i18n';
defineProps<{
  items: Array<{ label: string; value: string | number | boolean | null | undefined; tone?: string }>;
}>();
</script>

<template>
  <section class="primary-context-bar" :aria-label="t('component.layout.primary.context.bar.aria-label.49d90b622a')">
    <article v-for="item in items" :key="item.label" :data-tone="item.tone || 'default'">
      <span>{{ item.label }}</span>
      <strong>{{ item.value === undefined || item.value === null || item.value === '' ? '-' : item.value }}</strong>
    </article>
  </section>
</template>
