<script setup lang="ts">
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';

const props = withDefaults(defineProps<{
  status?: 'ready' | 'empty' | 'offline' | 'error' | 'degraded' | 'unsupported' | 'loading';
  title?: string;
  detail?: string;
  endpoint?: string;
}>(), {
  status: 'ready',
  title: '',
  detail: '',
  endpoint: '',
});

</script>

<template>
  <section class="api-state-banner" :data-status="props.status">
    <strong>{{ title || displayStatus(props.status) }}</strong>
    <p>{{ detail || (endpoint ? t('apiStateBanner.endpoint', { endpoint }) : displayStatus(props.status)) }}</p>
    <code v-if="endpoint">{{ endpoint }}</code>
  </section>
</template>
