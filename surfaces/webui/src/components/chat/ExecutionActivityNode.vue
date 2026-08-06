<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Bot,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CircleX,
  FileCheck2,
  PackageCheck,
  Sparkles,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-vue-next';
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';
import {
  activityAutoCollapsed,
  activityNeedsAttention,
  type ActivityTreeNode,
  type ActivityView,
} from '../../adapters/executionActivity';
import type { ReasoningGroupView } from '../../adapters/reasoningPresentation';
import ReasoningGroup from './ReasoningGroup.vue';

const props = defineProps<{
  node: ActivityTreeNode;
  depth?: number;
  reasoningGroups?: Record<string, ReasoningGroupView>;
}>();
const emit = defineEmits<{
  select: [activity: ActivityView];
}>();

const manualCollapsed = ref<boolean | null>(null);
const activity = computed(() => props.node.activity);
const collapsed = computed(() => manualCollapsed.value ?? activityAutoCollapsed(activity.value));
const activityReasoning = computed(() => props.reasoningGroups?.[activity.value.id]);

watch(
  () => `${activity.value.status}:${activity.value.commit_cursor}`,
  () => {
    if (activityNeedsAttention(activity.value)) {
      manualCollapsed.value = false;
    }
  },
);

function activityIcon(kind: string) {
  if (kind === 'team') return Users;
  if (kind === 'agent') return Bot;
  if (kind === 'skill') return Sparkles;
  if (kind === 'think' || kind === 'model') return Brain;
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
      <button
        class="execution-activity-main"
        type="button"
        @click="emit('select', activity)"
      >
        <span class="execution-activity-icon">
          <component :is="activityIcon(activity.kind)" :size="13" />
        </span>
        <span
          class="execution-activity-copy"
          :class="{ 'has-tool-summary': activity.tool_summary }"
        >
          <strong>{{ activity.title }}</strong>
          <span v-if="activity.tool_summary" class="execution-tool-summary">
            <small>{{ t('chat.activity.tools.executed') }} {{ activity.tool_summary.executed }}/{{ activity.tool_summary.total }}</small>
            <small class="success"><CheckCircle2 :size="11" />{{ activity.tool_summary.succeeded }}</small>
            <small v-if="activity.tool_summary.failed" class="failed"><CircleX :size="11" />{{ activity.tool_summary.failed }}</small>
            <small v-if="activity.tool_summary.running" class="running"><CircleDot :size="11" />{{ activity.tool_summary.running }}</small>
          </span>
          <small
            v-if="!collapsed && activity.detail && activity.detail !== activity.title"
          >
            {{ activity.detail }}
          </small>
          <small
            v-if="!collapsed && activity.result_summary && activity.result_summary !== activity.detail"
            class="execution-activity-result"
          >
            {{ activity.result_summary }}
          </small>
          <small
            v-if="activity.status_reason && activityNeedsAttention(activity)"
            class="execution-activity-reason"
          >
            {{ activity.status_reason }}
          </small>
        </span>
        <span v-if="!activity.tool_summary" class="execution-activity-meta">
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
    <ReasoningGroup
      v-if="activity.kind === 'agent' && activityReasoning"
      :group="activityReasoning"
      variant="agent"
    />
    <ol v-if="node.children.length && !collapsed" class="execution-activity-children">
      <ExecutionActivityNode
        v-for="child in node.children"
        :key="child.activity.id"
        :node="child"
        :depth="(depth || 0) + 1"
        :reasoning-groups="reasoningGroups || {}"
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
.execution-activity-copy.has-tool-summary { display: flex; align-items: center; gap: 8px; overflow: hidden; }
.execution-activity-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.execution-activity-copy small {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-muted);
  line-height: 1.45;
  white-space: normal;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.execution-activity-copy .execution-activity-result { color: var(--text); }
.execution-activity-copy .execution-activity-reason { color: var(--danger); }
.execution-tool-summary { min-width: 0; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.execution-tool-summary small { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; }
.execution-tool-summary .success { color: var(--success); }
.execution-tool-summary .failed { color: var(--danger); }
.execution-tool-summary .running { color: var(--info); }
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
  .execution-activity-copy.has-tool-summary { gap: 6px; }
  .execution-tool-summary { flex: 0 0 auto; gap: 5px; overflow: hidden; }
}
</style>
