<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { BarChart, FunnelChart, GaugeChart, LineChart, PieChart, RadarChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartPoint } from '../types';

use([CanvasRenderer, BarChart, FunnelChart, GaugeChart, LineChart, PieChart, RadarChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, RadarComponent]);

const props = defineProps<{
  title: string;
  // Keep this contract aligned with the ECharts series registered above.
  // Execution topology belongs to Mission's Vue Flow canvas, not a chart.
  kind: 'bar' | 'stacked-bar' | 'line' | 'area' | 'scatter' | 'pie' | 'gauge' | 'funnel' | 'radar';
  data: ChartPoint[];
  unit?: string;
  freshness?: string;
}>();

const option = computed(() => {
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ecebe4';
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#a7a79d';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d7d6ce';
  if (props.kind === 'radar') {
    return { tooltip: {}, radar: { indicator: props.data.map((d) => ({ name: d.name, max: 100 })), axisName: { color: muted } }, series: [{ type: 'radar', areaStyle: { opacity: 0.18 }, data: [{ value: props.data.map((d) => d.value), name: props.title }] }] };
  }
  if (props.kind === 'gauge') {
    return { tooltip: {}, series: [{ type: 'gauge', progress: { show: true }, detail: { formatter: `{value}${props.unit || ''}`, color: textColor }, data: [{ value: props.data[0]?.value || 0, name: props.data[0]?.name || props.title }] }] };
  }
  if (props.kind === 'pie') {
    return { tooltip: { trigger: 'item' }, legend: { textStyle: { color: muted } }, series: [{ type: 'pie', radius: ['42%', '72%'], data: props.data }] };
  }
  if (props.kind === 'funnel') {
    return { tooltip: { trigger: 'item' }, series: [{ type: 'funnel', data: props.data, label: { color: textColor } }] };
  }
  if (props.kind === 'line' || props.kind === 'area' || props.kind === 'scatter') {
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 42, right: 18, top: 24, bottom: 34 },
      xAxis: { type: 'category', data: props.data.map((d) => d.name), axisLabel: { color: muted } },
      yAxis: { type: 'value', name: props.unit, axisLabel: { color: muted }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.16)' } } },
      series: [{ type: props.kind === 'scatter' ? 'scatter' : 'line', smooth: props.kind !== 'scatter', areaStyle: props.kind === 'area' ? { opacity: 0.2 } : undefined, data: props.data.map((d) => d.value), itemStyle: { color: accent } }],
    };
  }
  if (props.kind === 'stacked-bar') {
    const groups = Array.from(new Set(props.data.map((point) => point.series || props.title)));
    return {
      tooltip: { trigger: 'axis' }, legend: { textStyle: { color: muted } },
      grid: { left: 42, right: 18, top: 30, bottom: 34 },
      xAxis: { type: 'category', data: Array.from(new Set(props.data.map((point) => point.name))), axisLabel: { color: muted } },
      yAxis: { type: 'value', name: props.unit, axisLabel: { color: muted } },
      series: groups.map((group) => ({ name: group, type: 'bar', stack: 'total', data: props.data.filter((point) => (point.series || props.title) === group).map((point) => point.value) })),
    };
  }
  return { tooltip: { trigger: 'axis' }, grid: { left: 32, right: 18, top: 24, bottom: 28 }, xAxis: { type: 'category', data: props.data.map((d) => d.name), axisLabel: { color: muted } }, yAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.16)' } } }, series: [{ type: 'bar', data: props.data.map((d) => d.value), itemStyle: { color: accent } }] };
});
</script>

<template>
  <section class="chart-panel">
    <header>
      <h2>{{ title }}</h2>
      <span v-if="freshness">{{ freshness }}</span>
    </header>
    <VChart class="chart" :option="option" autoresize />
  </section>
</template>
