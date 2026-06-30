<script setup lang="ts">
import { computed, ref } from 'vue';
import { translateText } from '../../i18n';

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
  const normalized = column.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  return translateText(normalized);
}
</script>

<template>
  <div class="data-table-shell" :data-compact="compact">
    <div v-if="searchable" class="data-table-toolbar">
      <label class="search-field">
        <span>Search</span>
        <input v-model="query" type="search" placeholder="Filter rows" />
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
          <td v-for="column in visibleColumns" :key="column">{{ row[column] }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
