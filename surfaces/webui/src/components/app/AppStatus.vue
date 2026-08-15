<script setup lang="ts">
import { computed } from 'vue';
import { projectAppState, type AppCatalogEntryV1 } from '../../apps/catalog';

const props = defineProps<{ entry: AppCatalogEntryV1 }>();
const state = computed(() => projectAppState(props.entry));
</script>

<template>
  <section class="app-status" :data-tone="state.tone" :data-state="state.state" aria-live="polite">
    <div class="app-status__heading">
      <span class="app-status__signal" aria-hidden="true" />
      <strong>{{ state.label }}</strong>
    </div>
    <p>{{ entry.lifecycle.reason_code || state.detail }}</p>
    <p v-if="state.retryable" class="app-status__recovery">
      Recovery is available<span v-if="state.retryAfterMs !== null"> in {{ state.retryAfterMs }} ms</span>.
    </p>
  </section>
</template>

<style scoped>
.app-status { border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 12px; padding: 12px 14px; }
.app-status__heading { display: flex; align-items: center; gap: 8px; }
.app-status__signal { width: 8px; height: 8px; border-radius: 50%; background: #718096; }
[data-tone="success"] .app-status__signal { background: #22c55e; }
[data-tone="info"] .app-status__signal { background: #38bdf8; }
[data-tone="warn"] .app-status__signal { background: #f59e0b; }
[data-tone="danger"] .app-status__signal { background: #ef4444; }
p { margin: 5px 0 0; color: var(--color-text-muted, #667085); font-size: 13px; }
.app-status__recovery { font-size: 12px; }
</style>
