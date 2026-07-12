<script setup lang="ts">
import { computed, ref } from 'vue';
import { Eye, X } from 'lucide-vue-next';
import { t } from '../../i18n';
import { useEscapeKey } from '../../composables/useEscapeKey';
import RawPayload from './RawPayload.vue';

const props = defineProps<{
  data: unknown;
  title?: string;
}>();

const open = ref(false);
const activeTab = ref<'overview' | 'relations' | 'receipt' | 'raw'>('overview');

const entries = computed(() => {
  if (!props.data || typeof props.data !== 'object' || Array.isArray(props.data)) return [];
  return Object.entries(props.data as Record<string, unknown>);
});

const overviewEntries = computed(() => entries.value.filter(([key]) => !/(evidence|session|agent|team|resource|ref|parent|child|receipt|request|response|payload)/i.test(key)));
const relationEntries = computed(() => entries.value.filter(([key]) => /(evidence|session|agent|team|resource|ref|parent|child)/i.test(key)));
const receiptEntries = computed(() => entries.value.filter(([key]) => /(receipt|request|response|endpoint|method|status|retry|error|payload)/i.test(key)));

const activeEntries = computed(() => {
  if (activeTab.value === 'relations') return relationEntries.value;
  if (activeTab.value === 'receipt') return receiptEntries.value;
  return overviewEntries.value;
});

function preview(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return t('objectInspector.array', { count: value.length });
  if (typeof value === 'object') return t('objectInspector.object', { count: Object.keys(value as Record<string, unknown>).length });
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

useEscapeKey(() => { open.value = false; }, () => open.value);

function openInspector() {
  activeTab.value = 'overview';
  open.value = true;
}
</script>

<template>
  <section class="object-inspector">
    <header>
      <div>
        <h3>{{ title || t('objectInspector.title') }}</h3>
        <p v-if="entries.length">{{ t('objectInspector.summary', { count: entries.length }) }}</p>
        <p v-else>{{ t('objectInspector.scalar') }} {{ preview(data) }}</p>
      </div>
      <button class="icon-action" type="button" :aria-label="t('objectInspector.open')" :title="t('objectInspector.open')" @click="openInspector">
        <Eye :size="16" />
      </button>
    </header>
    <dl v-if="entries.length" class="detail-list object-inspector-summary">
      <template v-for="[key, value] in entries.slice(0, 5)" :key="key">
        <dt>{{ key }}</dt>
        <dd>{{ preview(value) }}</dd>
      </template>
    </dl>
  </section>

  <div v-if="open" class="modal-backdrop object-inspector-backdrop" role="presentation" @click.self="open = false">
    <section class="command-modal object-inspector-modal" role="dialog" aria-modal="true" :aria-label="title || t('objectInspector.title')">
      <header>
        <div>
          <h2>{{ title || t('objectInspector.title') }}</h2>
          <p>{{ t('objectInspector.detail') }}</p>
        </div>
        <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" :title="t('common.close')" @click="open = false"><X :size="16" /></button>
      </header>
      <nav class="object-inspector-tabs" :aria-label="t('objectInspector.tabs')">
        <button type="button" :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">{{ t('objectInspector.tab.overview') }}</button>
        <button type="button" :class="{ active: activeTab === 'relations' }" @click="activeTab = 'relations'">{{ t('objectInspector.tab.relations', { count: relationEntries.length }) }}</button>
        <button type="button" :class="{ active: activeTab === 'receipt' }" @click="activeTab = 'receipt'">{{ t('objectInspector.tab.receipt', { count: receiptEntries.length }) }}</button>
        <button type="button" :class="{ active: activeTab === 'raw' }" @click="activeTab = 'raw'">{{ t('objectInspector.tab.raw') }}</button>
      </nav>
      <dl v-if="activeTab !== 'raw' && activeEntries.length" class="detail-list object-inspector-detail">
        <template v-for="[key, value] in activeEntries" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ preview(value) }}</dd>
        </template>
      </dl>
      <p v-else-if="activeTab !== 'raw'" class="empty-note">{{ t('objectInspector.empty') }}</p>
      <RawPayload v-else :title="t('objectInspector.raw')" :data="data" />
    </section>
  </div>
</template>
