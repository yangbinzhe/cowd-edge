<script setup lang="ts">
defineProps<{
  label?: string;
  route?: string;
  refId?: string;
}>();
</script>

<template>
  <RouterLink v-if="route" class="evidence-ref-link" :to="route">
    {{ label || refId || route }}
  </RouterLink>
  <span v-else class="evidence-ref-link muted">{{ label || refId || '-' }}</span>
</template>
