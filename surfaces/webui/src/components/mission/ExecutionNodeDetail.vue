<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowDownToLine, ArrowUpFromLine, CircleDot, Wrench, X } from 'lucide-vue-next';
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';
import type { ActivityEvent } from '../../types';
import { executionNodeDetail, executionNodeKindLabel } from '../../utils/executionNode';
import RawPayload from '../workbench/RawPayload.vue';
import StructuredValue from '../workbench/StructuredValue.vue';

const props = withDefaults(defineProps<{
  node: Record<string, any> | null;
  objective?: string;
  activityEvents?: ActivityEvent[];
}>(), {
  objective: '',
  activityEvents: () => [],
});
const emit = defineEmits<{
  close: [];
}>();

const detail = computed(() => executionNodeDetail(
  props.node,
  props.objective,
  props.activityEvents,
));
const activePayload = ref<'input' | 'output' | null>(null);
const activeValue = computed(() => (
  activePayload.value === 'input' ? detail.value?.input : detail.value?.output
));
const activeTitle = computed(() => (
  activePayload.value === 'input'
    ? t('chat.execution.node.fullInput')
    : t('chat.execution.node.fullOutput')
));
const toolExecution = computed(() => {
  const output = detail.value?.output;
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const tools = (output as Record<string, any>).tool_execution;
  return tools && typeof tools === 'object' && !Array.isArray(tools)
    ? tools as Record<string, any>
    : null;
});
const toolBatches = computed(() => {
  if (!toolExecution.value) return [];
  const calls = Array.isArray(toolExecution.value.calls) ? toolExecution.value.calls : [];
  const batches = Array.isArray(toolExecution.value.batches) ? toolExecution.value.batches : [];
  return batches.map((batch: Record<string, any>) => ({
    ...batch,
    calls: calls.filter((call: Record<string, any>) => (
      String(call.batch_node_id || '') === String(batch.node_id || '')
    )),
  }));
});

watch(() => detail.value?.id, () => {
  activePayload.value = null;
}, { immediate: true });

function togglePayload(target: 'input' | 'output') {
  activePayload.value = activePayload.value === target ? null : target;
}
</script>

<template>
  <aside v-if="detail" class="execution-node-detail">
    <header>
      <div>
        <strong>{{ executionNodeKindLabel(detail.title) }}</strong>
        <span>{{ executionNodeKindLabel(detail.kind) }} · {{ detail.id }}</span>
      </div>
      <div class="execution-node-actions">
        <span class="execution-node-status" :data-status="detail.status">
          <CircleDot :size="12" />{{ displayStatus(detail.status) }}
        </span>
        <button
          class="graph-icon-action"
          :class="{ active: activePayload === 'input' }"
          type="button"
          :disabled="detail.input === null"
          :title="t('chat.execution.node.fullInput')"
          :aria-label="t('chat.execution.node.fullInput')"
          :aria-pressed="activePayload === 'input'"
          @click="togglePayload('input')"
        >
          <ArrowDownToLine :size="15" />
        </button>
        <button
          class="graph-icon-action"
          :class="{ active: activePayload === 'output' }"
          type="button"
          :disabled="detail.output === null"
          :title="t('chat.execution.node.fullOutput')"
          :aria-label="t('chat.execution.node.fullOutput')"
          :aria-pressed="activePayload === 'output'"
          @click="togglePayload('output')"
        >
          <ArrowUpFromLine :size="15" />
        </button>
        <button
          class="graph-icon-action"
          type="button"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X :size="15" />
        </button>
      </div>
    </header>

    <section class="execution-node-description">
      <strong>{{ t('chat.execution.node.description') }}</strong>
      <p>{{ detail.description || t('chat.execution.node.noDescription') }}</p>
      <p v-if="detail.summary && detail.summary !== detail.description" class="execution-node-summary">{{ detail.summary }}</p>
    </section>

    <details v-if="toolExecution" class="execution-node-tool-schedule">
      <summary>
        <Wrench :size="14" />
        <strong>{{ t('chat.execution.node.toolSchedule') }}</strong>
        <span>{{ t('chat.execution.node.toolScheduleSummary', {
          calls: Number(toolExecution.call_count || 0),
          batches: Number(toolExecution.batch_count || 0),
          parallel: Number(toolExecution.max_parallel_width || 0),
        }) }}</span>
      </summary>
      <div class="execution-tool-batches">
        <article v-for="(batch, index) in toolBatches" :key="String(batch.node_id || index)">
          <header>
            <strong>{{ t('chat.execution.node.batchNumber', { number: index + 1 }) }}</strong>
            <span>{{ displayStatus(batch.status || 'unknown') }}</span>
          </header>
          <div class="execution-tool-call-list">
            <div v-for="call in batch.calls" :key="String(call.id || call.name)">
              <code>{{ call.name }}</code>
              <span v-if="call.depends_on?.length">
                {{ t('chat.execution.node.dependsOn', { count: call.depends_on.length }) }}
              </span>
              <span v-else>{{ t('chat.execution.node.parallelReady') }}</span>
            </div>
          </div>
        </article>
      </div>
    </details>

    <section v-if="activePayload" class="execution-node-payload">
      <header>
        <component :is="activePayload === 'input' ? ArrowDownToLine : ArrowUpFromLine" :size="14" />
        <strong>{{ activeTitle }}</strong>
      </header>
      <StructuredValue v-if="activeValue !== null && activeValue !== undefined" :value="activeValue" />
      <p v-else class="empty-note">{{ t('chat.execution.node.unavailable') }}</p>
      <RawPayload
        v-if="activeValue !== null && activeValue !== undefined"
        :title="t('chat.execution.node.rawJson')"
        :data="activeValue"
        :max-chars="6000"
      />
    </section>
  </aside>
</template>
