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
  return String(item.at || item.created_at || item.updated_at || item.timestamp || '');
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
      <p>{{ item.detail || item.summary || item.message }}</p>
    </li>
  </ol>
  </section>
</template>
