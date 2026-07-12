<script setup lang="ts">
import { displayStatus } from '../../i18n/domain/status';

withDefaults(defineProps<{ status?: string }>(), {
  status: 'unknown',
});
</script>

<template>
  <span class="status-badge" :data-status="status">{{ displayStatus(status) }}</span>
</template>
