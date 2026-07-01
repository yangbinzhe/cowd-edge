<script setup lang="ts">
import { t } from '../../i18n';
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  items: Array<{ label: string; value: string | number | boolean | null | undefined; tone?: string }>;
  density?: 'default' | 'compact';
  maxVisible?: number;
}>(), {
  density: 'default',
  maxVisible: 0,
});

const visibleItems = computed(() => props.maxVisible > 0 ? props.items.slice(0, props.maxVisible) : props.items);
const hiddenCount = computed(() => Math.max(0, props.items.length - visibleItems.value.length));
</script>

<template>
  <section class="primary-context-bar" :data-density="density" :aria-label="t('component.layout.primary.context.bar.aria-label.49d90b622a')">
    <article v-for="item in visibleItems" :key="item.label" :data-tone="item.tone || 'default'">
      <span>{{ item.label }}</span>
      <strong>{{ item.value === undefined || item.value === null || item.value === '' ? '-' : item.value }}</strong>
    </article>
    <article v-if="hiddenCount" data-tone="default">
      <span>{{ t('component.layout.primary.context.bar.more') }}</span>
      <strong>{{ hiddenCount }}</strong>
    </article>
  </section>
</template>
