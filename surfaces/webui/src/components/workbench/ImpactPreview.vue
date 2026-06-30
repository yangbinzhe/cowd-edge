<script setup lang="ts">
import { t } from '../../i18n';
defineProps<{
  refs?: string[];
  boundary?: string;
  approvalRequired?: boolean;
}>();
</script>

<template>
  <section class="impact-preview">
    <header>
      <h3>{{ t('component.workbench.impact.preview.text.9a5c13efef') }}</h3>
      <span>{{ approvalRequired ? t('component.workbench.impact.preview.inline.0a2526be92') : t('component.workbench.impact.preview.inline.7855c4d63a') }}</span>
    </header>
    <ul>
      <li v-for="ref in refs || []" :key="ref">{{ ref }}</li>
      <li v-if="!(refs || []).length">{{ t('component.workbench.impact.preview.text.89878cb628') }}</li>
    </ul>
    <p>{{ boundary || t('component.workbench.impact.preview.inline.b03c8cea10') }}</p>
  </section>
</template>
