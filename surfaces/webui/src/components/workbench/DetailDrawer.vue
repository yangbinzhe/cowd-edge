<script setup lang="ts">
import RawPayload from './RawPayload.vue';

defineProps<{
  title: string;
  row?: Record<string, unknown> | null;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <aside class="detail-drawer" aria-label="Selected row detail">
    <header>
      <h2>{{ title }}</h2>
      <button class="ghost-action" type="button" :disabled="!row" @click="emit('close')">Close</button>
    </header>
    <p v-if="!row" class="empty-note">Select a table row or graph node to inspect the structured payload.</p>
    <dl v-else class="detail-list">
      <template v-for="(value, key) in row" :key="String(key)">
        <dt>{{ key }}</dt>
        <dd>{{ typeof value === 'object' ? JSON.stringify(value) : value }}</dd>
      </template>
    </dl>
    <RawPayload v-if="row" title="Selected row payload" :data="row" />
  </aside>
</template>
