<script setup lang="ts">
import { t } from '../../i18n';
import RawPayload from './RawPayload.vue';

defineProps<{
  title: string;
  row?: Record<string, unknown> | null;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <aside class="detail-drawer" :aria-label="t('component.workbench.detail.drawer.aria-label.2d54934e46')">
    <header>
      <h2>{{ title }}</h2>
      <button class="ghost-action" type="button" :disabled="!row" @click="emit('close')">{{ t('component.workbench.detail.drawer.text.e4edb43cad') }}</button>
    </header>
    <p v-if="!row" class="empty-note">{{ t('component.workbench.detail.drawer.text.0b9f27e4c1') }}</p>
    <dl v-else class="detail-list">
      <template v-for="(value, key) in row" :key="String(key)">
        <dt>{{ key }}</dt>
        <dd>{{ typeof value === 'object' ? JSON.stringify(value) : value }}</dd>
      </template>
    </dl>
    <RawPayload v-if="row" :title="t('component.workbench.detail.drawer.title.selectedPayload')" :data="row" />
  </aside>
</template>
