<script setup lang="ts">
import { t } from '../../i18n';
defineProps<{ items: Array<Record<string, unknown>> }>();
</script>

<template>
  <ol class="timeline-list">
    <li v-for="(item, index) in items" :key="String(item.id || index)">
      <strong>{{ item.title || item.kind || item.type || `Event ${index + 1}` }}</strong>
      <span>{{ item.status || item.phase || t('component.workbench.timeline.list.inline.535429b457') }}</span>
      <p>{{ item.detail || item.summary || item.message }}</p>
    </li>
  </ol>
</template>
