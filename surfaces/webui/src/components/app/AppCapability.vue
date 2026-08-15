<script setup lang="ts">
defineProps<{ capabilities: readonly string[]; authorizationProfile: string }>();
</script>

<template>
  <section class="app-capabilities" aria-label="Application capabilities">
    <header>
      <strong>Granted capabilities</strong>
      <span>{{ authorizationProfile || 'No authorization profile' }}</span>
    </header>
    <ul v-if="capabilities.length">
      <li v-for="capability in capabilities" :key="capability">{{ capability }}</li>
    </ul>
    <p v-else>No capabilities granted.</p>
  </section>
</template>

<style scoped>
.app-capabilities { display: grid; gap: 10px; }
header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
header span, p { color: var(--color-text-muted, #667085); font-size: 12px; }
ul { display: flex; flex-wrap: wrap; gap: 7px; margin: 0; padding: 0; list-style: none; }
li { border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 999px; padding: 5px 9px; font: 500 12px/1.2 ui-monospace, monospace; }
p { margin: 0; }
</style>
