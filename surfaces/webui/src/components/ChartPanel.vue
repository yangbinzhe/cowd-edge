<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { BarChart, RadarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartPoint } from '../types';

use([CanvasRenderer, BarChart, RadarChart, GridComponent, TooltipComponent, LegendComponent, RadarComponent]);

const props = defineProps<{
  title: string;
  // Keep this contract aligned with the ECharts series registered above.
  // Execution topology belongs to Mission's Vue Flow canvas, not a chart.
  kind: 'bar' | 'radar';
  data: ChartPoint[];
}>();

const option = computed(() => {
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ecebe4';
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#a7a79d';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d7d6ce';
  if (props.kind === 'radar') {
    return { tooltip: {}, radar: { indicator: props.data.map((d) => ({ name: d.name, max: 100 })), axisName: { color: muted } }, series: [{ type: 'radar', areaStyle: { opacity: 0.18 }, data: [{ value: props.data.map((d) => d.value), name: props.title }] }] };
  }
  return { tooltip: { trigger: 'axis' }, grid: { left: 32, right: 18, top: 24, bottom: 28 }, xAxis: { type: 'category', data: props.data.map((d) => d.name), axisLabel: { color: muted } }, yAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.16)' } } }, series: [{ type: 'bar', data: props.data.map((d) => d.value), itemStyle: { color: accent } }] };
});
</script>

<template>
  <section class="chart-panel">
    <header>
      <h2>{{ title }}</h2>
    </header>
    <VChart class="chart" :option="option" autoresize />
  </section>
</template>
