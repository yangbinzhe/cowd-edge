<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CircleDot,
} from 'lucide-vue-next';
import { t } from '../../i18n';
import type {
  ReasoningGroupView,
  ReasoningSegmentView,
} from '../../adapters/reasoningPresentation';

const props = defineProps<{
  group: ReasoningGroupView;
  variant?: 'global' | 'agent';
}>();

const expanded = ref(false);
const expandedSegments = ref(new Set<string>());
const label = computed(() => (
  props.variant === 'global'
    ? t('chat.activity.globalThinkingCount', { count: props.group.count })
    : t('chat.activity.thinkingCount', { count: props.group.count })
));

function toggleSegment(segment: ReasoningSegmentView) {
  const next = new Set(expandedSegments.value);
  if (next.has(segment.id)) next.delete(segment.id);
  else next.add(segment.id);
  expandedSegments.value = next;
}

function formatTime(value: unknown) {
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toLocaleTimeString()
    : '';
}
</script>

<template>
  <section
    class="reasoning-group"
    :class="[`is-${variant || group.scope}`, { running: group.running }]"
    :data-scope="variant || group.scope"
  >
    <button
      class="reasoning-group-summary"
      type="button"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="reasoning-group-toggle">
        <ChevronDown v-if="expanded" :size="13" />
        <ChevronRight v-else :size="13" />
      </span>
      <span class="reasoning-group-icon"><Brain :size="13" /></span>
      <strong>{{ label }}</strong>
      <span class="reasoning-group-latest">{{ group.latest.text }}</span>
      <CircleDot v-if="group.running" class="reasoning-running" :size="11" />
    </button>
    <ol v-if="expanded" class="reasoning-segments">
      <li v-for="(segment, index) in group.items" :key="segment.id">
        <button
          type="button"
          :class="{ expanded: expandedSegments.has(segment.id) }"
          @click="toggleSegment(segment)"
        >
          <span class="reasoning-segment-index">{{ index + 1 }}</span>
          <span class="reasoning-segment-text">{{ segment.text }}</span>
          <time v-if="formatTime(segment.at)">{{ formatTime(segment.at) }}</time>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.reasoning-group {
  width: min(100%, 1280px);
  min-width: 0;
  margin: 3px 0 5px;
  border-left: 2px solid color-mix(in srgb, var(--accent) 42%, transparent);
}
.reasoning-group.is-agent {
  width: auto;
  margin-left: 24px;
}
.reasoning-group-summary {
  width: 100%;
  min-width: 0;
  min-height: 30px;
  display: grid;
  grid-template-columns: 18px 22px auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  border: 0;
  border-radius: 0 6px 6px 0;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.reasoning-group-summary:hover {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
}
.reasoning-group-toggle,
.reasoning-group-icon {
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
.reasoning-group-icon { color: var(--accent); }
.reasoning-group-summary strong {
  font-size: 11px;
  white-space: nowrap;
}
.reasoning-group-latest {
  min-width: 0;
  overflow: visible;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.45;
}
.reasoning-running {
  color: var(--info);
  animation: reasoning-pulse 1.3s ease-in-out infinite;
}
.reasoning-segments {
  margin: 0 0 3px 39px;
  padding: 2px 0 2px 10px;
  border-left: 1px solid var(--border);
  list-style: none;
}
.reasoning-segments li { min-width: 0; }
.reasoning-segments button {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: start;
  gap: 6px;
  padding: 4px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.reasoning-segments button:hover { background: var(--surface-3); }
.reasoning-segment-index,
.reasoning-segments time {
  color: var(--text-muted);
  font-size: 10px;
}
.reasoning-segment-text {
  min-width: 0;
  overflow: visible;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  text-overflow: clip;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
@keyframes reasoning-pulse {
  50% { opacity: .38; }
}
@media (max-width: 720px) {
  .reasoning-group-summary {
    grid-template-columns: 16px 20px auto minmax(0, 1fr);
  }
  .reasoning-running { display: none; }
  .reasoning-group.is-agent { margin-left: 12px; }
  .reasoning-segments { margin-left: 25px; }
  .reasoning-segments time { display: none; }
}
</style>
