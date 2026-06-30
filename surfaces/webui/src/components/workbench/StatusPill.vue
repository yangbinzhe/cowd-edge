<script setup lang="ts">
import { translateStatus } from '../../i18n';

defineProps<{ status: string }>();
</script>

<template>
  <span class="status-badge" :data-status="status">{{ translateStatus(status) }}</span>
</template>
