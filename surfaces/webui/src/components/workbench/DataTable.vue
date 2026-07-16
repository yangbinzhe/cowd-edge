<script setup lang="ts">
import { t } from '../../i18n';
import { computed, ref, watch } from 'vue';
import { Copy } from 'lucide-vue-next';
import { displayColumn } from '../../i18n/domain/columns';
import StatusPill from './StatusPill.vue';

interface RowAction {
  id: string;
  label: string;
  tone?: 'neutral' | 'danger';
}

const props = withDefaults(defineProps<{
  rows: Record<string, unknown>[];
  columns?: string[];
  searchable?: boolean;
  rowKey?: string;
  compact?: boolean;
  selectable?: boolean;
  copyable?: boolean;
  loading?: boolean;
  rowActions?: RowAction[];
  pageSize?: number;
}>(), {
  searchable: false,
  rowKey: '',
  compact: false,
  selectable: false,
  copyable: false,
  loading: false,
  rowActions: () => [],
  pageSize: 25,
});

const emit = defineEmits<{
  rowClick: [row: Record<string, unknown>];
  selectionChange: [rows: Record<string, unknown>[]];
  rowAction: [payload: { action: RowAction; row: Record<string, unknown> }];
  copyRow: [row: Record<string, unknown>];
}>();
const query = ref('');
const sortColumn = ref('');
const sortDirection = ref<'asc' | 'desc'>('asc');
const selectedKeys = ref<Set<string | number>>(new Set());
const page = ref(1);

const visibleColumns = computed(() => props.columns || Object.keys(props.rows[0] || {}));
const filteredRows = computed(() => {
  const needle = query.value.trim().toLowerCase();
  const base = needle
    ? props.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle))
    : props.rows;
  if (!sortColumn.value) return base;
  return [...base].sort((left, right) => {
    const a = String(left[sortColumn.value] ?? '');
    const b = String(right[sortColumn.value] ?? '');
    return sortDirection.value === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
  });
});
const hasActions = computed(() => props.copyable || props.rowActions.length > 0);
const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / Math.max(1, props.pageSize))));
const pageOffset = computed(() => (page.value - 1) * Math.max(1, props.pageSize));
const pagedRows = computed(() => filteredRows.value.slice(pageOffset.value, pageOffset.value + Math.max(1, props.pageSize)));
const selectedRows = computed(() => filteredRows.value.filter((row, index) => selectedKeys.value.has(keyFor(row, index))));
const allVisibleSelected = computed(() => filteredRows.value.length > 0 && selectedRows.value.length === filteredRows.value.length);

watch([query, sortColumn, sortDirection, () => props.rows.length, () => props.pageSize], () => {
  page.value = Math.min(page.value, totalPages.value);
  if (query.value || sortColumn.value) page.value = 1;
});

function toggleSort(column: string) {
  if (sortColumn.value === column) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
    return;
  }
  sortColumn.value = column;
  sortDirection.value = 'asc';
}

function keyFor(row: Record<string, unknown>, index: number) {
  return props.rowKey && row[props.rowKey] ? String(row[props.rowKey]) : index;
}

function emitSelection(next: Set<string | number>) {
  selectedKeys.value = next;
  emit('selectionChange', filteredRows.value.filter((row, index) => next.has(keyFor(row, index))));
}

function toggleRow(row: Record<string, unknown>, index: number) {
  if (!props.selectable) return;
  const key = keyFor(row, index);
  const next = new Set(selectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  emitSelection(next);
}

function toggleAll() {
  if (!props.selectable) return;
  if (allVisibleSelected.value) {
    emitSelection(new Set());
    return;
  }
  emitSelection(new Set(filteredRows.value.map((row, index) => keyFor(row, index))));
}

function handleRowKeydown(event: KeyboardEvent, row: Record<string, unknown>, index: number) {
  if (event.key === 'Enter') emit('rowClick', row);
  if (event.key === ' ' && props.selectable) {
    event.preventDefault();
    toggleRow(row, index);
  }
}

async function copyRow(row: Record<string, unknown>) {
  const text = JSON.stringify(row, null, 2);
  await navigator.clipboard?.writeText(text).catch(() => undefined);
  emit('copyRow', row);
}

function columnLabel(column: string) {
  return displayColumn(column);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cellKind(column: string, value: unknown) {
  const normalized = column.toLowerCase();
  if (['status', 'state', 'lifecycle', 'decision', 'result', 'approval', 'risk', 'severity', 'circuit'].some((part) => normalized.includes(part))) return 'status';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (isRecord(value)) return 'object';
  if (normalized.includes('path') || normalized.includes('uri') || normalized.includes('id') || normalized.includes('hash')) return 'code';
  if (String(value ?? '').length > 72) return 'long';
  return 'text';
}

function formatCell(column: string, value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'boolean') return value ? t('boolean.yes') : t('boolean.no');
  if (Array.isArray(value)) {
    if (!value.length) return '-';
    return value.map((item) => typeof item === 'string' || typeof item === 'number' ? item : JSON.stringify(item)).join(', ');
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return keys.slice(0, 3).map((key) => `${key}: ${String(value[key])}`).join(', ');
  }
  const text = String(value);
  if (cellKind(column, value) === 'long') return `${text.slice(0, 96)}${text.length > 96 ? '...' : ''}`;
  return text;
}

function fullCell(value: unknown) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
</script>

<template>
  <div class="data-table-shell" :data-compact="compact">
    <div v-if="searchable" class="data-table-toolbar">
      <label class="search-field">
        <span>{{ t('component.workbench.data.table.text.d79b22c9c0') }}</span>
        <input v-model="query" type="search" :placeholder="t('component.workbench.data.table.placeholder.cd98a7dd38')" />
      </label>
      <small>{{ selectable ? t('component.workbench.data.table.selected', { selected: selectedRows.length, total: filteredRows.length }) : `${filteredRows.length} / ${rows.length}` }}</small>
    </div>
    <div v-else-if="selectable" class="data-table-toolbar">
      <small>{{ t('component.workbench.data.table.selected', { selected: selectedRows.length, total: filteredRows.length }) }}</small>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th v-if="selectable" class="data-table-select">
            <label class="data-table-checkbox">
              <input
                type="checkbox"
                :aria-label="t('component.workbench.data.table.selectAll')"
                :checked="allVisibleSelected"
                @change="toggleAll"
              />
            </label>
          </th>
          <th v-for="column in visibleColumns" :key="column">
            <button type="button" @click="toggleSort(column)">
              {{ columnLabel(column) }}
              <span v-if="sortColumn === column">{{ sortDirection === 'asc' ? '↑' : '↓' }}</span>
            </button>
          </th>
          <th v-if="hasActions" class="data-table-actions">{{ t('component.workbench.data.table.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td class="data-table-empty" :colspan="visibleColumns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0)">
            {{ t('common.loading') }}
          </td>
        </tr>
        <tr v-else-if="!filteredRows.length">
          <td class="data-table-empty" :colspan="visibleColumns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0)">
            {{ t('component.workbench.data.table.empty') }}
          </td>
        </tr>
        <tr
          v-for="(row, index) in pagedRows"
          v-else
          :key="keyFor(row, pageOffset + index)"
          :data-selected="selectedKeys.has(keyFor(row, pageOffset + index))"
          tabindex="0"
          @click="emit('rowClick', row)"
          @keydown="handleRowKeydown($event, row, pageOffset + index)"
        >
          <td v-if="selectable" class="data-table-select" @click.stop>
            <label class="data-table-checkbox">
              <input
                type="checkbox"
                :aria-label="t('component.workbench.data.table.selectRow')"
                :checked="selectedKeys.has(keyFor(row, pageOffset + index))"
                @change="toggleRow(row, pageOffset + index)"
              />
            </label>
          </td>
          <td v-for="column in visibleColumns" :key="column" :data-kind="cellKind(column, row[column])" :title="fullCell(row[column])">
            <StatusPill v-if="cellKind(column, row[column]) === 'status'" :status="String(row[column] || 'empty')" />
            <code v-else-if="cellKind(column, row[column]) === 'code'">{{ formatCell(column, row[column]) }}</code>
            <span v-else>{{ formatCell(column, row[column]) }}</span>
          </td>
          <td v-if="hasActions" class="data-table-actions">
            <div class="data-table-actions-cell">
              <button v-if="copyable" class="icon-action" type="button" :aria-label="t('component.workbench.data.table.copyRow')" @click.stop="copyRow(row)">
                <Copy :size="14" />
              </button>
              <button
                v-for="action in rowActions"
                :key="action.id"
                :class="action.tone === 'danger' ? 'danger-action' : 'ghost-action'"
                type="button"
                @click.stop="emit('rowAction', { action, row })"
              >
                {{ action.label }}
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <nav v-if="totalPages > 1" class="data-table-pagination" :aria-label="t('component.workbench.data.table.pagination')">
      <button class="ghost-action" type="button" :disabled="page <= 1" @click="page -= 1">{{ t('component.workbench.data.table.previous') }}</button>
      <span>{{ t('component.workbench.data.table.page', { page, total: totalPages }) }}</span>
      <button class="ghost-action" type="button" :disabled="page >= totalPages" @click="page += 1">{{ t('component.workbench.data.table.next') }}</button>
    </nav>
  </div>
</template>

<style scoped>
.data-table-pagination { display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 9px 0 0; color: var(--text-muted); font-size: 12px; }
</style>
