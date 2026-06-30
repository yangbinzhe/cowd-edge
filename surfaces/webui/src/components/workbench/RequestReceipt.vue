<script setup lang="ts">
import { t } from '../../i18n';
import { computed } from 'vue';
import type { ApiReceipt, ApiWriteError } from '../../api/client';
import { displayBoolean } from '../../i18n/domain/status';
import StatusPill from './StatusPill.vue';

const props = withDefaults(defineProps<{
  receipt?: ApiReceipt | ApiWriteError | Record<string, unknown> | null;
  title?: string;
}>(), {
  receipt: null,
  title: t('script.components.workbench.requestreceipt.title.d7472533cf'),
});

const normalized = computed(() => {
  const receipt = props.receipt as any;
  if (!receipt || typeof receipt !== 'object') return null;
  if (receipt.receipt && typeof receipt.receipt === 'object') return { ...receipt, ...receipt.receipt };
  if (receipt.data?.receipt && typeof receipt.data.receipt === 'object') return { ...receipt, ...receipt.data.receipt };
  return receipt;
});

function value(key: string) {
  return normalized.value && typeof normalized.value === 'object' ? (normalized.value as any)[key] : undefined;
}
</script>

<template>
  <section v-if="receipt" class="request-receipt" :data-ok="value('ok') !== false">
    <header>
      <h2>{{ title || t('requestReceipt.title') }}</h2>
      <StatusPill :status="value('ok') === false ? 'error' : (value('mode') || value('status') || 'ready')" />
    </header>
    <dl class="detail-list">
      <dt>{{ t('requestReceipt.endpoint') }}</dt>
      <dd>{{ value('endpoint') || value('path') || '-' }}</dd>
      <dt>{{ t('requestReceipt.method') }}</dt>
      <dd>{{ value('method') || '-' }}</dd>
      <dt>{{ t('requestReceipt.status') }}</dt>
      <dd>{{ value('status') || value('status_text') || '-' }}</dd>
      <dt>{{ t('requestReceipt.retryable') }}</dt>
      <dd>{{ value('retryable') === undefined ? '-' : displayBoolean(value('retryable')) }}</dd>
      <dt>{{ t('requestReceipt.error') }}</dt>
      <dd>{{ value('error') || value('message') || '-' }}</dd>
      <dt>{{ t('requestReceipt.payload') }}</dt>
      <dd>{{ value('payload_summary') || '-' }}</dd>
    </dl>
  </section>
</template>
