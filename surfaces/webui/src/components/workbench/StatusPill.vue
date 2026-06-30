<script setup lang="ts">
import { displayStatus } from '../../i18n/domain/status';

defineProps<{ status: string }>();
</script>

<template>
  <span class="status-badge" :data-status="status">{{ displayStatus(status) }}</span>
</template>
