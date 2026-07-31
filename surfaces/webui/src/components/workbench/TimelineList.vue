<script setup lang="ts">
import { t } from '../../i18n';
import { computed, ref } from 'vue';
import { displayStatus } from '../../i18n/domain/status';

const props = withDefaults(defineProps<{
  items: Array<Record<string, unknown>>;
  title?: string;
  filterable?: boolean;
  live?: boolean;
  selectedId?: string;
}>(), {
  title: '',
  filterable: true,
  live: false,
  selectedId: '',
});

const emit = defineEmits<{ select: [item: Record<string, unknown>] }>();

const statusFilter = ref('all');
const statuses = computed(() => Array.from(new Set(props.items.map((item) => itemStatus(item)))).filter(Boolean));
const filteredItems = computed(() => (
  statusFilter.value === 'all'
    ? props.items
    : props.items.filter((item) => itemStatus(item) === statusFilter.value)
));

function itemStatus(item: Record<string, unknown>) {
  return String(item.status || item.phase || 'unknown');
}

function itemTitle(item: Record<string, unknown>, index: number) {
  return item.title || item.kind || item.type || t('component.workbench.timeline.event', { index: index + 1 });
}

function itemTime(item: Record<string, unknown>) {
  const value = item.at || item.created_at || item.updated_at || item.timestamp;
  if (!value) return '';
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) return String(value);
  return new Date(parsed).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function compactStructuredDetail(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^(?:\{|\[)/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return t('component.workbench.timeline.items', { count: parsed.length });
      for (const key of ['summary', 'message', 'error', 'status', 'result', 'decision']) {
        if (typeof parsed?.[key] === 'string' && parsed[key].trim()) return parsed[key].trim();
      }
      return t('component.workbench.timeline.fields', { count: Object.keys(parsed || {}).length });
    } catch {
      return t('component.workbench.timeline.structuredDetail');
    }
  }
  const starts = [text.indexOf(' {'), text.indexOf(' [')].filter((index) => index >= 0);
  const jsonStart = starts.length ? Math.min(...starts) : -1;
  const summary = jsonStart >= 0 ? text.slice(0, jsonStart) : text;
  return summary;
}

function itemDetail(item: Record<string, unknown>) {
  return compactStructuredDetail(String(item.detail || item.summary || item.message || ''));
}

function itemDetailPreview(item: Record<string, unknown>) {
  const detail = itemDetail(item);
  return detail.length > 120 ? `${detail.slice(0, 117)}...` : detail;
}

function itemLane(item: Record<string, unknown>) {
  if (!['tool', 'error'].includes(String(item.kind || ''))) return '';
  const wave = Number(item.wave || 0) + 1;
  const lane = Number(item.lane || 0) + 1;
  const count = Number(item.lane_count || 0);
  if (count <= 1 && wave <= 1) return '';
  return count > 1
    ? t('chat.timeline.parallelLane', { wave, lane, count })
    : t('chat.timeline.dependencyWave', { wave });
}
</script>

<template>
  <section class="timeline-shell">
    <header v-if="title || (filterable && statuses.length > 1)" class="timeline-toolbar">
      <strong v-if="title">{{ title }}</strong>
      <span v-if="live" class="timeline-live">{{ t('component.workbench.timeline.live') }}</span>
      <label v-if="filterable && statuses.length > 1">
        <span>{{ t('component.workbench.timeline.statusFilter') }}</span>
        <select v-model="statusFilter">
          <option value="all">{{ t('component.workbench.timeline.allStatuses') }}</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ displayStatus(status) }}</option>
        </select>
      </label>
    </header>
    <p v-if="!filteredItems.length" class="empty-note">{{ t('component.workbench.timeline.empty') }}</p>
    <ol v-else class="timeline-list">
    <li
      v-for="(item, index) in filteredItems"
      :key="String(item.id || index)"
      :data-selected="String(item.id || index) === selectedId"
      role="button"
      tabindex="0"
      @click="emit('select', item)"
      @keydown.enter.prevent="emit('select', item)"
    >
      <strong>{{ itemTitle(item, index) }}</strong>
      <span>{{ displayStatus(itemStatus(item)) }}</span>
      <time v-if="itemTime(item)">{{ itemTime(item) }}</time>
      <small v-if="itemLane(item)" class="timeline-lane">{{ itemLane(item) }}</small>
      <details v-if="itemDetail(item).length > 120" class="timeline-detail" @click.stop>
        <summary>{{ itemDetailPreview(item) }}</summary>
        <p>{{ itemDetail(item) }}</p>
      </details>
      <p v-else-if="itemDetail(item)">{{ itemDetail(item) }}</p>
    </li>
  </ol>
  </section>
</template>
