<script setup lang="ts">
import { t } from '../../i18n';
import { computed } from 'vue';
import type { ApiReceipt, ApiWriteError } from '../../api/client';
import { displayBoolean, displayStatus } from '../../i18n/domain/status';
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

function outcome() {
  return value('dispatch_status')
    || value('cross_plane_dispatch_status')
    || value('cross_plane_status')
    || value('outcome')
    || value('result');
}

function receiptStatus() {
  return value('status')
    || outcome()
    || value('status_text')
    || value('mode')
    || 'ready';
}
</script>

<template>
  <section v-if="receipt" class="request-receipt" :data-ok="value('ok') !== false">
    <header>
      <h2>{{ title || t('requestReceipt.title') }}</h2>
      <StatusPill :status="value('ok') === false ? 'error' : receiptStatus()" />
    </header>
    <dl class="detail-list">
      <dt>{{ t('requestReceipt.endpoint') }}</dt>
      <dd>{{ value('endpoint') || value('path') || '-' }}</dd>
      <dt>{{ t('requestReceipt.method') }}</dt>
      <dd>{{ value('method') || '-' }}</dd>
      <dt>{{ t('requestReceipt.status') }}</dt>
      <dd>{{ value('status') || value('status_text') ? displayStatus(value('status') || value('status_text')) : '-' }}</dd>
      <template v-if="outcome()">
        <dt>{{ t('requestReceipt.outcome') }}</dt>
        <dd>{{ displayStatus(outcome()) }}</dd>
      </template>
      <template v-if="value('mode')">
        <dt>{{ t('requestReceipt.mode') }}</dt>
        <dd>{{ displayStatus(value('mode')) }}</dd>
      </template>
      <dt>{{ t('requestReceipt.retryable') }}</dt>
      <dd>{{ value('retryable') === undefined ? '-' : displayBoolean(value('retryable')) }}</dd>
      <dt>{{ t('requestReceipt.error') }}</dt>
      <dd>{{ value('error') || value('message') || '-' }}</dd>
      <dt>{{ t('requestReceipt.payload') }}</dt>
      <dd>{{ value('payload_summary') || '-' }}</dd>
      <dt>{{ t('requestReceipt.command') }}</dt>
      <dd>{{ value('command') || '-' }}</dd>
      <dt>{{ t('requestReceipt.revision') }}</dt>
      <dd>{{ value('current_revision') === undefined ? '-' : `${value('previous_revision') ?? 0} → ${value('current_revision')}` }}</dd>
      <dt>{{ t('requestReceipt.idempotencyKey') }}</dt>
      <dd>{{ value('idempotency_key') || '-' }}</dd>
      <dt>{{ t('requestReceipt.auditRef') }}</dt>
      <dd>{{ value('audit_ref') || '-' }}</dd>
    </dl>
  </section>
</template>
