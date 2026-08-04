<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileCheck2,
  PackageCheck,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-vue-next';
import { displayStatus } from '../../i18n/domain/status';
import {
  activityAutoCollapsed,
  activityNeedsAttention,
  type ActivityTreeNode,
  type ActivityView,
} from '../../adapters/executionActivity';

const props = defineProps<{
  node: ActivityTreeNode;
  depth?: number;
}>();
const emit = defineEmits<{
  select: [activity: ActivityView];
}>();

const manualCollapsed = ref<boolean | null>(null);
const activity = computed(() => props.node.activity);
const collapsed = computed(() => manualCollapsed.value ?? activityAutoCollapsed(activity.value));

watch(
  () => `${activity.value.status}:${activity.value.commit_cursor}`,
  () => {
    if (activityNeedsAttention(activity.value)) manualCollapsed.value = false;
  },
);

function activityIcon(kind: string) {
  if (kind === 'team') return Users;
  if (kind === 'agent') return Bot;
  if (kind === 'tool' || kind === 'tool_batch') return Wrench;
  if (kind === 'approval') return ShieldCheck;
  if (kind === 'artifact' || kind === 'outcome') return PackageCheck;
  if (kind === 'execution' || kind === 'goal') return Boxes;
  return CircleDot;
}

function formatDuration(value: unknown) {
  const duration = Number(value || 0);
  if (!Number.isFinite(duration) || duration <= 0) return '';
  if (duration < 1_000) return `${Math.round(duration)} ms`;
  if (duration < 60_000) return `${(duration / 1_000).toFixed(duration < 10_000 ? 1 : 0)} s`;
  return `${(duration / 60_000).toFixed(1)} min`;
}

function formatTime(value: unknown) {
  const timestamp = Number(value || 0);
  return timestamp > 0 ? new Date(timestamp).toLocaleTimeString() : '';
}
</script>

<template>
  <li
    class="execution-activity-node"
    :data-kind="activity.kind"
    :data-status="activity.status"
    :style="{ '--activity-depth': String(depth || 0) }"
  >
    <div class="execution-activity-row">
      <button
        v-if="node.children.length"
        class="execution-activity-toggle"
        type="button"
        :aria-expanded="!collapsed"
        @click="manualCollapsed = !collapsed"
      >
        <ChevronRight v-if="collapsed" :size="13" />
        <ChevronDown v-else :size="13" />
      </button>
      <span v-else class="execution-activity-rail" aria-hidden="true" />
      <button class="execution-activity-main" type="button" @click="emit('select', activity)">
        <span class="execution-activity-icon">
          <component :is="activityIcon(activity.kind)" :size="13" />
        </span>
        <span class="execution-activity-copy">
          <strong>{{ activity.title }}</strong>
          <small v-if="!collapsed && activity.detail && activity.detail !== activity.title">
            {{ activity.detail }}
          </small>
        </span>
        <span class="execution-activity-meta">
          <small v-if="activity.evidence_refs?.length" :title="`${activity.evidence_refs.length} evidence`">
            <FileCheck2 :size="11" />{{ activity.evidence_refs.length }}
          </small>
          <small v-if="activity.artifact_refs?.length" :title="`${activity.artifact_refs.length} artifacts`">
            <PackageCheck :size="11" />{{ activity.artifact_refs.length }}
          </small>
          <time v-if="formatTime(activity.at)">{{ formatTime(activity.at) }}</time>
          <time v-if="formatDuration(activity.duration_ms)">{{ formatDuration(activity.duration_ms) }}</time>
          <span class="execution-activity-status">{{ displayStatus(activity.status || 'planned') }}</span>
        </span>
      </button>
    </div>
    <ol v-if="node.children.length && !collapsed" class="execution-activity-children">
      <ExecutionActivityNode
        v-for="child in node.children"
        :key="child.activity.id"
        :node="child"
        :depth="(depth || 0) + 1"
        @select="emit('select', $event)"
      />
    </ol>
  </li>
</template>

<style scoped>
.execution-activity-node { position: relative; list-style: none; min-width: 0; }
.execution-activity-row { display: flex; align-items: stretch; min-width: 0; }
.execution-activity-toggle,
.execution-activity-rail {
  width: 24px;
  min-width: 24px;
  min-height: 32px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
.execution-activity-toggle { border: 0; background: transparent; cursor: pointer; }
.execution-activity-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 32px;
  display: grid;
  grid-template-columns: 22px minmax(120px, 1fr) auto;
  align-items: start;
  gap: 6px;
  padding: 5px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
}
.execution-activity-main:hover { background: var(--surface-3); }
.execution-activity-icon {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--accent);
  background: var(--surface-2);
}
.execution-activity-copy { min-width: 0; display: grid; gap: 2px; }
.execution-activity-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.execution-activity-copy small { color: var(--text-muted); line-height: 1.45; white-space: normal; overflow-wrap: anywhere; }
.execution-activity-meta { display: flex; align-items: center; justify-content: flex-end; gap: 7px; color: var(--text-muted); white-space: nowrap; font-size: 10px; }
.execution-activity-meta small { display: inline-flex; align-items: center; gap: 2px; }
.execution-activity-status { color: var(--text-muted); }
[data-status="running"] > .execution-activity-row .execution-activity-icon,
[data-status="started"] > .execution-activity-row .execution-activity-icon { color: var(--accent); }
[data-status="failed"] > .execution-activity-row .execution-activity-icon,
[data-status="error"] > .execution-activity-row .execution-activity-icon,
[data-status="blocked"] > .execution-activity-row .execution-activity-icon { color: var(--danger); }
.execution-activity-children {
  position: relative;
  margin: 0 0 0 12px;
  padding: 0 0 0 12px;
  border-left: 1px solid var(--border);
}
@media (max-width: 720px) {
  .execution-activity-main { grid-template-columns: 20px minmax(80px, 1fr); }
  .execution-activity-meta { grid-column: 2; justify-content: flex-start; flex-wrap: wrap; }
  .execution-activity-meta time:first-of-type { display: none; }
}
</style>
