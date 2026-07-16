<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Pin, RotateCcw, X } from 'lucide-vue-next';
import { api } from '../../api/client';
import { t } from '../../i18n';
import StatusPill from '../workbench/StatusPill.vue';
import RawPayload from '../workbench/RawPayload.vue';

const props = withDefaults(defineProps<{
  refs?: string[];
  subject?: Record<string, unknown> | null;
  title?: string;
}>(), { refs: () => [], subject: null, title: '' });

const emit = defineEmits<{ close: [] }>();
const loading = ref(false);
const error = ref('');
const items = ref<any[]>([]);
const pinnedRefs = ref<string[]>([]);
const normalizedRefs = computed(() => Array.from(new Set(props.refs.map((item) => String(item).trim()).filter(Boolean))).slice(0, 100));

async function resolveAll() {
  if (!normalizedRefs.value.length) {
    items.value = [];
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const response = await api.resolveEvidenceBatch(normalizedRefs.value);
    items.value = Array.isArray(response?.items) ? response.items : [];
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

function togglePin(reference: string) {
  pinnedRefs.value = pinnedRefs.value.includes(reference)
    ? pinnedRefs.value.filter((item) => item !== reference)
    : [...pinnedRefs.value, reference];
}

watch(normalizedRefs, resolveAll, { immediate: true });
</script>

<template>
  <aside class="evidence-inspector" :aria-label="title || t('graph.evidence.title')">
    <header>
      <div>
        <h3>{{ title || t('graph.evidence.title') }}</h3>
        <small>{{ t('graph.evidence.summary', { count: normalizedRefs.length }) }}</small>
      </div>
      <div class="button-row">
        <button class="ghost-action" type="button" :disabled="loading || !normalizedRefs.length" @click="resolveAll"><RotateCcw :size="14" />{{ t('graph.action.retry') }}</button>
        <button class="ghost-action" type="button" @click="emit('close')"><X :size="14" />{{ t('graph.action.close') }}</button>
      </div>
    </header>
    <p v-if="loading" class="empty-note">{{ t('graph.state.loadingEvidence') }}</p>
    <p v-else-if="error" class="field-error">{{ error }}</p>
    <p v-else-if="!items.length" class="empty-note">{{ t('graph.state.noEvidence') }}</p>
    <div v-else class="evidence-inspector-list">
      <article v-for="item in items" :key="item.ref" :data-pinned="pinnedRefs.includes(item.ref)">
        <div>
          <strong>{{ item.evidence?.kind || item.ref }}</strong>
          <p>{{ item.evidence?.summary || item.evidence?.reason || item.error || item.ref }}</p>
          <small>{{ item.evidence?.source || item.ref }}</small>
        </div>
        <StatusPill :status="item.status || 'unknown'" />
        <button class="icon-action" type="button" :aria-pressed="pinnedRefs.includes(item.ref)" @click="togglePin(item.ref)"><Pin :size="14" /></button>
      </article>
    </div>
    <RawPayload v-if="subject" :title="t('graph.inspector.raw')" :data="subject" />
  </aside>
</template>
