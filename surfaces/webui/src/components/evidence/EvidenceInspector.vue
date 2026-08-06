<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { GitCompare, Link, Pin, RotateCcw, X } from 'lucide-vue-next';
import { api } from '../../api/client';
import { t } from '../../i18n';
import StatusPill from '../workbench/StatusPill.vue';
import { evidenceBacklinks, evidenceComparison, evidenceDisplayState, evidenceSourceRoute } from './evidenceRuntime';

const props = withDefaults(defineProps<{
  refs?: string[];
  sessionId?: string;
  subject?: Record<string, unknown> | null;
  title?: string;
}>(), { refs: () => [], sessionId: '', subject: null, title: '' });

const emit = defineEmits<{ close: [] }>();
const loading = ref(false);
const error = ref('');
const items = ref<any[]>([]);
const pinnedRefs = ref<string[]>([]);
const normalizedRefs = computed(() => Array.from(new Set(props.refs.map((item) => String(item).trim()).filter(Boolean))).slice(0, 100));
const pinnedItems = computed(() => pinnedRefs.value.map((reference) => items.value.find((item) => item.ref === reference)).filter(Boolean));
const compareRows = computed(() => evidenceComparison(pinnedItems.value));

async function resolveAll() {
  if (!normalizedRefs.value.length) {
    items.value = [];
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const response = await api.resolveEvidenceBatch(normalizedRefs.value, props.sessionId);
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

watch([normalizedRefs, () => props.sessionId], resolveAll, { immediate: true });
</script>

<template>
  <aside class="evidence-inspector" :aria-label="title || t('graph.evidence.title')">
    <header>
      <div>
        <h3>{{ title || t('graph.evidence.title') }}</h3>
        <small>{{ t('graph.evidence.summary', { count: normalizedRefs.length }) }}</small>
      </div>
      <div class="button-row">
        <button class="icon-action" type="button" :disabled="loading || !normalizedRefs.length" :aria-label="t('graph.action.retry')" :title="t('graph.action.retry')" @click="resolveAll"><RotateCcw :size="14" /></button>
        <button class="icon-action" type="button" :aria-label="t('graph.action.close')" :title="t('graph.action.close')" @click="emit('close')"><X :size="14" /></button>
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
        <StatusPill :status="evidenceDisplayState(item)" />
        <RouterLink v-if="evidenceSourceRoute(item)" class="icon-action" :to="evidenceSourceRoute(item)" :aria-label="t('graph.evidence.openSource')"><Link :size="14" /></RouterLink>
        <button class="icon-action" type="button" :aria-pressed="pinnedRefs.includes(item.ref)" @click="togglePin(item.ref)"><Pin :size="14" /></button>
        <ul v-if="evidenceBacklinks(item).length" class="evidence-backlinks">
          <li v-for="backlink in evidenceBacklinks(item)" :key="`${backlink.kind}:${backlink.label}`">
            <RouterLink v-if="backlink.route" :to="backlink.route">{{ backlink.kind }} · {{ backlink.label }}</RouterLink>
            <span v-else>{{ backlink.kind }} · {{ backlink.label }}</span>
          </li>
        </ul>
      </article>
    </div>
    <section v-if="pinnedItems.length >= 2" class="evidence-compare" aria-live="polite">
      <header><GitCompare :size="15" /><strong>{{ t('graph.evidence.compare') }}</strong></header>
      <div class="data-table-shell">
        <table class="data-table">
          <thead><tr><th>{{ t('graph.evidence.field') }}</th><th v-for="item in pinnedItems" :key="item.ref">{{ item.ref }}</th></tr></thead>
          <tbody><tr v-for="row in compareRows" :key="row.field"><th>{{ row.field }}</th><td v-for="(value, index) in row.values" :key="`${row.field}:${index}`">{{ value }}</td></tr></tbody>
        </table>
      </div>
    </section>
  </aside>
</template>
