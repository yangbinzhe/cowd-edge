<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RefreshCw, Workflow, X } from 'lucide-vue-next';
import { api } from '../../api/client';
import { adaptMissionControlGraph } from '../../adapters/missionControlGraph';
import { applyMissionProjectionDelta } from '../../adapters/missionProjection';
import { useEscapeKey } from '../../composables/useEscapeKey';
import { t } from '../../i18n';
import { openLiveSource, type LiveSourceLease } from '../../stores/liveTransport';
import type {
  MissionControlProjection,
  MissionMaterializedSnapshot,
  MissionProjectionDelta,
} from '../../types';
import ExecutionGraphCanvas from './ExecutionGraphCanvas.vue';

const emit = defineEmits<{ close: [] }>();
const snapshot = ref<MissionMaterializedSnapshot | null>(null);
const loading = ref(true);
const error = ref('');
let liveSource: LiveSourceLease | null = null;

const projection = computed(() => snapshot.value?.projection || null);
const graph = computed(() => adaptMissionControlGraph(
  projection.value as MissionControlProjection | null,
));
const missionId = computed(() => String(
  projection.value?.mission_graph?.mission_id
  || projection.value?.selected_mission_id
  || projection.value?.mission?.mission_id
  || '',
).trim());

function close() {
  emit('close');
}

function applyDelta(delta: MissionProjectionDelta) {
  const next = applyMissionProjectionDelta(snapshot.value, delta);
  if (!next) return false;
  snapshot.value = next;
  return true;
}

function attachLiveSource() {
  liveSource?.close();
  liveSource = null;
  if (!missionId.value) return;
  liveSource = openLiveSource(
    {
      kind: 'mission',
      id: missionId.value,
      cursor: Number(snapshot.value?.cursor || 0),
      detail_scope: 'summary',
    },
    {
      error: (reason) => { error.value = reason; },
      envelope: (envelope) => {
        if (envelope.source_health === 'resync_required') {
          void load();
          return;
        }
        if (envelope.event === 'mission_snapshot') {
          snapshot.value = envelope.payload as MissionMaterializedSnapshot;
          return;
        }
        if (
          envelope.event === 'mission_delta'
          && !applyDelta(envelope.payload as MissionProjectionDelta)
        ) {
          void load();
        }
      },
    },
  );
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await api.missionControlSummary(missionId.value);
    snapshot.value = {
      schema_version: 1,
      kind: 'mission_control.materialized_snapshot',
      cursor: Number(response.summary.cursor || 0),
      revision: Number(response.summary.revision || 1),
      needs_resync: false,
      projection: response.summary.projection as MissionControlProjection,
    };
    attachLiveSource();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    loading.value = false;
  }
}

useEscapeKey(close, () => true);
onMounted(load);
onBeforeUnmount(() => {
  liveSource?.close();
  liveSource = null;
});
</script>

<template>
  <div class="chat-execution-modal-scrim" @click.self="close">
    <section
      class="chat-execution-overlay global-mission-graph-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('chat.execution.globalMissionGraph')"
    >
      <header>
        <div>
          <Workflow :size="16" />
          <strong>{{ t('chat.execution.globalMissionGraph') }}</strong>
          <span v-if="graph?.objective">{{ graph.objective }}</span>
        </div>
        <div class="button-row">
          <button
            class="icon-action"
            type="button"
            :title="t('chat.execution.refreshGlobalMission')"
            :aria-label="t('chat.execution.refreshGlobalMission')"
            :disabled="loading"
            @click="load"
          >
            <RefreshCw :size="16" :class="{ spinning: loading }" />
          </button>
          <button
            class="icon-action"
            type="button"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <X :size="16" />
          </button>
        </div>
      </header>
      <div v-if="error && !graph" class="global-mission-graph-state file-error">
        <span>{{ error }}</span>
      </div>
      <div v-else-if="!loading && !graph" class="global-mission-graph-state empty-note">
        {{ t('chat.execution.globalMissionEmpty') }}
      </div>
      <ExecutionGraphCanvas
        v-else
        :graph="graph"
        :loading="loading"
        :connection-state="loading ? 'connecting' : (error ? 'degraded' : 'live')"
      />
    </section>
  </div>
</template>
