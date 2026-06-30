<script setup lang="ts">
import { formatCount, t } from '../../i18n';
import StatusPill from './StatusPill.vue';

defineProps<{
  items: Array<{
    id?: string;
    kind?: string;
    source?: string;
    confidence?: number;
    authority?: string;
    status?: string;
    summary?: string;
    ref?: string;
  }>;
  title?: string;
}>();
</script>

<template>
  <section class="evidence-trace">
    <header>
      <h2>{{ title || t('component.workbench.evidence.trace.inline.85b6a1911d') }}</h2>
      <span>{{ formatCount('refs', items.length) }}</span>
    </header>
    <article v-for="item in items" :key="item.id || item.ref || item.summary">
      <div>
        <strong>{{ item.kind || item.source || 'evidence' }}</strong>
        <p>{{ item.summary || item.ref || item.id || '-' }}</p>
        <small>{{ item.source || item.authority || '-' }}</small>
      </div>
      <StatusPill :status="item.status || (item.confidence !== undefined ? 'ready' : 'empty')" />
    </article>
  </section>
</template>
