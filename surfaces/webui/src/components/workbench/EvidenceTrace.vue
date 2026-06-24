<script setup lang="ts">
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
      <h2>{{ title || 'Evidence trace' }}</h2>
      <span>{{ items.length }} refs</span>
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
