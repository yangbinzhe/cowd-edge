<script setup lang="ts">
import { t } from '../../i18n';
import { computed, ref } from 'vue';
import { FileCheck2 } from 'lucide-vue-next';
import { displayStatus } from '../../i18n/domain/status';

const props = withDefaults(defineProps<{
  items: Array<Record<string, unknown>>;
  title?: string;
  filterable?: boolean;
  live?: boolean;
  causal?: boolean;
  selectedId?: string;
}>(), {
  title: '',
  filterable: true,
  live: false,
  causal: false,
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
  const title = String(
    item.title
    || item.kind
    || item.type
    || t('component.workbench.timeline.event', { index: index + 1 }),
  );
  if (item.kind === 'agent' && item.phase) {
    return `${title} · ${displayStatus(item.phase)}`;
  }
  return title;
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

function itemDuration(item: Record<string, unknown>) {
  const duration = Number(item.duration_ms);
  if (!Number.isFinite(duration) || duration < 0) return '';
  return duration < 1_000
    ? `${Math.round(duration)} ms`
    : `${(duration / 1_000).toFixed(duration >= 10_000 ? 0 : 1).replace(/\.0$/, '')} s`;
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
  const agent = String(item.agent_lane_label || item.role || item.agent_id || '')
    .trim()
    .replace(/[_-]+/g, ' ');
  const agentLane = Number(item.agent_lane || 0) + 1;
  const agentCount = Number(item.agent_lane_count || 0);
  const agentLabel = agent
    ? (
        agentCount > 1
          ? t('chat.timeline.agentParallelLane', {
              agent,
              lane: agentLane,
              count: agentCount,
            })
          : t('chat.timeline.agentLane', { agent })
      )
    : '';
  if (!['tool', 'error'].includes(String(item.kind || ''))) return agentLabel;
  const wave = Number(item.wave || 0) + 1;
  const lane = Number(item.lane || 0) + 1;
  const count = Number(item.lane_count || 0);
  const toolLabel = count > 1
    ? t('chat.timeline.parallelLane', { wave, lane, count })
    : wave > 1
      ? t('chat.timeline.dependencyWave', { wave })
      : '';
  return [agentLabel, toolLabel].filter(Boolean).join(' · ');
}

function itemEvidenceCount(item: Record<string, unknown>) {
  const raw = (item.raw || {}) as Record<string, unknown>;
  const direct = [
    ...(Array.isArray((item as any).evidence_refs) ? (item as any).evidence_refs : []),
    ...(Array.isArray(raw.evidence_refs) ? raw.evidence_refs : []),
    raw.full_output_ref,
    raw.output_ref,
  ];
  const typed = [
    ...(Array.isArray(item.refs) ? item.refs : []),
    ...(Array.isArray(raw.refs) ? raw.refs : []),
  ].flatMap((reference: any) => {
    if (typeof reference === 'string') {
      return /^(?:evidence|tool|memory|matrix|audit):\/\//.test(reference) ? [reference] : [];
    }
    const kind = String(reference?.type || reference?.kind || '').toLowerCase();
    return kind.includes('evidence') || ['tool_output', 'memory', 'matrix', 'audit'].includes(kind)
      ? [reference?.ref || reference?.id]
      : [];
  });
  return new Set([...direct, ...typed].map(String).filter(Boolean)).size;
}

function itemDepth(item: Record<string, unknown>) {
  if (!props.causal) return 0;
  const kind = String(item.kind || '');
  if (kind === 'tool' || kind === 'tool_batch') return 2;
  if (kind === 'agent' || kind === 'approval' || kind === 'verify') return 1;
  return 0;
}
</script>

<template>
  <section class="timeline-shell" :data-causal="causal">
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
      :data-kind="String(item.kind || 'event')"
      :data-selected="String(item.id || index) === selectedId"
      :style="{ '--timeline-depth': String(itemDepth(item)) }"
      role="button"
      tabindex="0"
      @click="emit('select', item)"
      @keydown.enter.prevent="emit('select', item)"
    >
      <header class="timeline-item-head">
        <time v-if="itemTime(item)" class="timeline-item-time">{{ itemTime(item) }}</time>
        <strong>{{ itemTitle(item, index) }}</strong>
        <span class="timeline-item-status" :data-status="itemStatus(item)">{{ displayStatus(itemStatus(item)) }}</span>
        <small v-if="itemEvidenceCount(item)" class="timeline-evidence-count"><FileCheck2 :size="11" />{{ itemEvidenceCount(item) }}</small>
        <time v-if="itemDuration(item)" class="timeline-item-duration">{{ itemDuration(item) }}</time>
      </header>
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
