<script setup lang="ts">
import { t } from '../../i18n';
import { computed, ref } from 'vue';
import { displayColumn } from '../../i18n/domain/columns';
import StatusPill from './StatusPill.vue';

const props = withDefaults(defineProps<{
  rows: Record<string, unknown>[];
  columns?: string[];
  searchable?: boolean;
  rowKey?: string;
  compact?: boolean;
}>(), {
  searchable: false,
  rowKey: '',
  compact: false,
});

const emit = defineEmits<{ rowClick: [row: Record<string, unknown>] }>();
const query = ref('');
const sortColumn = ref('');
const sortDirection = ref<'asc' | 'desc'>('asc');

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
      <small>{{ filteredRows.length }} / {{ rows.length }}</small>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in visibleColumns" :key="column">
            <button type="button" @click="toggleSort(column)">
              {{ columnLabel(column) }}
              <span v-if="sortColumn === column">{{ sortDirection === 'asc' ? '↑' : '↓' }}</span>
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in filteredRows" :key="keyFor(row, index)" @click="emit('rowClick', row)">
          <td v-for="column in visibleColumns" :key="column" :data-kind="cellKind(column, row[column])" :title="fullCell(row[column])">
            <StatusPill v-if="cellKind(column, row[column]) === 'status'" :status="String(row[column] || 'empty')" />
            <code v-else-if="cellKind(column, row[column]) === 'code'">{{ formatCell(column, row[column]) }}</code>
            <span v-else>{{ formatCell(column, row[column]) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
