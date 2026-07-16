<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';

const props = withDefaults(defineProps<{ status?: string }>(), {
  status: 'unknown',
});
const label = computed(() => displayStatus(props.status));
</script>

<template>
  <span class="status-badge" role="status" :aria-label="t('status.aria', { status: label })" :data-status="status">{{ label }}</span>
</template>
