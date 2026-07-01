<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import { GitBranch, Play, RefreshCw, ShieldCheck } from 'lucide-vue-next';
import { api } from '../api/client';
import DataTable from '../components/workbench/DataTable.vue';
import EmptyState from '../components/workbench/EmptyState.vue';
import RawPayload from '../components/workbench/RawPayload.vue';
import RequestReceipt from '../components/workbench/RequestReceipt.vue';
import GovernedActionPanel from '../components/workbench/GovernedActionPanel.vue';
import WorkflowStrip from '../components/layout/WorkflowStrip.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const loading = ref(false);
const error = ref('');
const state = ref<any>({});
const result = ref<any>(null);
const selectedTool = ref('tool_cache_stats');
const selectedCommand = ref('/status');
const selectedCapability = ref('service.read');
const actor = ref('webui-operator');
const plannerPrompt = ref('review current workspace and route safe read-only context collection');
const fanoutPrompt = ref('inspect workspace README, package files, and recent runtime evidence');
const batchConcurrency = ref(4);
const batchCallsText = ref(JSON.stringify([
  { name: 'workspace_snapshot', input: {} },
  { name: 'tool_cache_stats', input: {} },
], null, 2));
const mutationEditsText = ref(JSON.stringify([
  { path: 'README.md', old_string: 'Cowd', new_string: 'Cowd' },
], null, 2));
const checkpointLabel = ref('webui-tool-ops');
const selectedCheckpointId = ref('');
const restoreArmedId = ref('');
const expectedHashes = ref<Record<string, string>>({});

const tools = computed(() => Array.isArray(state.value.tools?.tools) ? state.value.tools.tools : []);
const commands = computed(() => Array.isArray(state.value.commands?.commands) ? state.value.commands.commands : []);
const history = computed(() => Array.isArray(state.value.history?.history) ? state.value.history.history : []);
const checkpoints = computed(() => {
  const payload = state.value.checkpoints?.data || state.value.checkpoints || {};
  return Array.isArray(payload.checkpoints) ? payload.checkpoints : [];
});
const cacheStats = computed(() => state.value.cache?.data || state.value.cache || {});
const timelineEvents = computed(() => Array.isArray(state.value.timeline?.events) ? state.value.timeline.events : []);
const toolLedger = computed(() => timelineEvents.value.filter((event: any) => String(event.kind || '').includes('tool')));

const toolRows = computed(() => tools.value.map((tool: any) => ({
  name: tool.name,
  enabled: tool.enabled === false ? 'no' : 'yes',
  safety: tool.safety_category || '-',
  cache: tool.cache_policy || '-',
  readonly: tool.prepared_readonly_supported ? 'yes' : 'no',
  concurrency: tool.max_concurrency || '-',
  tags: Array.isArray(tool.managed_tags) ? tool.managed_tags.join(', ') : '-',
})));
const commandRows = computed(() => commands.value.map((command: any) => ({
  name: command.name,
  action: formatActionKind(command.action),
  target: formatActionTarget(command.action),
  description: command.description || '-',
})));
const historyRows = computed(() => history.value.slice(0, 12).map((item: any) => ({
  command: item.command || item.name || '-',
  action: formatActionKind(item.action),
  target: formatActionTarget(item.action),
  at: item.executed_at_ms || item.timestamp || '-',
})));
const checkpointRows = computed(() => checkpoints.value.map((checkpoint: any) => ({
  id: checkpoint.id || checkpoint.checkpoint_id || '-',
  label: checkpoint.label || '-',
  files: checkpoint.file_count || checkpoint.files || 0,
  created: checkpoint.created_at || checkpoint.created_at_ms || '-',
})));

function formatActionKind(action: any) {
  if (!action) return '-';
  return typeof action === 'string' ? action : action.kind || '-';
}

function formatActionTarget(action: any) {
  if (!action || typeof action === 'string') return '-';
  return action.path || action.operation || action.action || '-';
}
const cacheRows = computed(() => Object.entries(cacheStats.value)
  .filter(([key]) => !key.startsWith('__'))
  .map(([key, value]) => ({
    metric: key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
  })));
const fanoutRows = computed(() => {
  const plan = result.value?.data?.data || result.value?.data || result.value || {};
  const calls = Array.isArray(plan.tool_calls) ? plan.tool_calls : Array.isArray(plan.calls) ? plan.calls : [];
  return calls.map((call: any) => ({
    tool: call.name || call.tool_name || '-',
    purpose: call.purpose || call.reason || '-',
    cache: call.cache_policy || '-',
    risk: call.safety_category || call.risk || '-',
  }));
});
const mutationPreviewRows = computed(() => {
  const payload = result.value?.data?.data || result.value?.data || result.value || {};
  const files = Array.isArray(payload.files) ? payload.files : Array.isArray(payload.preview) ? payload.preview : [];
  return files.map((file: any) => ({
    path: file.path || '-',
    status: file.status || file.action || '-',
    expected_hash: file.expected_hash || file.expectedHash || '-',
    changed: file.changed === false ? 'no' : 'yes',
  }));
});
const ledgerRows = computed(() => toolLedger.value.slice(0, 16).map((event: any) => ({
  seq: event.sequence || event.seq || '-',
  kind: event.kind || '-',
  status: event.status || event.level || '-',
  tool: event.tool || event.tool_name || event.name || '-',
  at: event.timestamp || event.created_at || '-',
})));
const activeSessionId = computed(() => store.currentSessionId || 'api-context');
const toolContext = computed(() => [
  { label: t('script.pages.toolspage.label.f7f1997c6c'), value: activeSessionId.value },
  { label: t('script.pages.toolspage.label.4fa8cc860c'), value: tools.value.length, tone: tools.value.length ? 'success' : 'warn' },
  { label: t('script.pages.toolspage.label.a2b3a59adb'), value: checkpointRows.value.length },
  { label: t('script.pages.toolspage.label.7d005f6934'), value: ledgerRows.value.length },
]);
const toolsWorkflow = computed(() => [
  { id: 'registry', label: t('script.pages.toolspage.label.1fd6a805da'), status: tools.value.length ? 'ready' : 'idle', count: tools.value.length },
  { id: 'operations', label: t('script.pages.toolspage.label.ae2f98a099'), status: fanoutRows.value.length ? 'done' : 'idle', count: fanoutRows.value.length },
  { id: 'operations', label: t('script.pages.toolspage.label.6ea36ce8d4'), status: result.value ? 'active' : 'idle', description: selectedTool.value },
  { id: 'mutations', label: t('script.pages.toolspage.label.13bcc5c25b'), status: mutationPreviewRows.value.length ? 'blocked' : 'idle', count: mutationPreviewRows.value.length },
  { id: 'checkpoints', label: t('script.pages.toolspage.label.5cb9afc059'), status: checkpointRows.value.length ? 'ready' : 'idle', count: checkpointRows.value.length },
  { id: 'ledger', label: t('script.pages.toolspage.label.1aa2f31ee7'), status: ledgerRows.value.length ? 'ready' : 'idle', count: ledgerRows.value.length },
  { id: 'risk', label: t('script.pages.toolspage.label.5a8f23f567'), status: state.value.crossPlane?.status === 'blocked' ? 'blocked' : 'ready', description: selectedCapability.value },
]);

function parseJsonArray(text: string, label: string) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
  return parsed;
}

function actionPayload() {
  return {
    actor_principal: actor.value,
    actor_identity_ref: `user:${actor.value}`,
    source_channel: 'channel://webui/tools',
    session_id: 'webui-tools',
    requested_capability: selectedCapability.value,
    provider_account: null,
    target_ref: null,
    resource_ref: null,
    risk: 'medium',
    data_classification: 'internal',
    identity_trust: 'unknown',
  };
}

function extractExpectedHashes(receipt: any) {
  const files = receipt?.data?.data?.files || receipt?.data?.files || receipt?.files || [];
  const hashes: Record<string, string> = {};
  if (Array.isArray(files)) {
    for (const file of files) {
      const path = file.path;
      const hash = file.expected_hash || file.expectedHash;
      if (path && hash) hashes[path] = hash;
    }
  }
  expectedHashes.value = hashes;
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const [toolsData, commandsData, historyData, capabilities, crossPlane, cache, checkpointsData, timeline] = await Promise.all([
      api.toolRegistry(),
      api.commands(),
      api.commandHistory(),
      api.cowdCapabilities(),
      api.crossPlaneSummary(),
      api.toolCacheStats(),
      api.toolCheckpoints(),
      api.runtimeTimeline(activeSessionId.value),
    ]);
    state.value = { tools: toolsData, commands: commandsData, history: historyData, capabilities, crossPlane, cache, checkpoints: checkpointsData, timeline };
    selectedTool.value = selectedTool.value || tools.value[0]?.name || 'tool_cache_stats';
    selectedCommand.value = selectedCommand.value || commands.value[0]?.name || '/status';
    selectedCheckpointId.value = selectedCheckpointId.value || checkpointRows.value[0]?.id || '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function runSafeTool() {
  result.value = await api.writeReceipt('/api/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ name: selectedTool.value, input: {}, mode: 'read_only' }),
  });
  await refresh();
}

async function executeCommand() {
  const resolution: any = await api.resolveCommand(selectedCommand.value, 'webui', { source: 'tools-page' });
  const resolvedCommand = resolution?.resolution?.command?.name || selectedCommand.value;
  result.value = await api.executeCommand(resolvedCommand, {});
  await refresh();
}

async function planIntent() {
  result.value = await api.writeReceipt('/api/tools/intent-plan', {
    method: 'POST',
    body: JSON.stringify({ prompt: plannerPrompt.value, selected_tools: tools.value.map((tool: any) => tool.name).slice(0, 8) }),
  });
}

async function planFanout() {
  result.value = await api.writeReceipt('/api/tools/context-fanout/plan', {
    method: 'POST',
    body: JSON.stringify({ prompt: fanoutPrompt.value }),
  });
}

async function runBatchReadonly() {
  try {
    const calls = parseJsonArray(batchCallsText.value, 'Batch calls');
    result.value = await api.writeReceipt('/api/tools/batch-readonly', {
      method: 'POST',
      body: JSON.stringify({ calls, max_concurrency: Number(batchConcurrency.value) || 4 }),
    });
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function previewMutation() {
  try {
    const edits = parseJsonArray(mutationEditsText.value, 'Mutation edits');
    result.value = await api.writeReceipt('/api/tools/mutations/preview', {
      method: 'POST',
      body: JSON.stringify({ edits }),
    });
    extractExpectedHashes(result.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function applyMutation() {
  try {
    const edits = parseJsonArray(mutationEditsText.value, 'Mutation edits');
    result.value = await api.writeReceipt('/api/tools/mutations/apply', {
      method: 'POST',
      body: JSON.stringify({ edits, expected_hashes: expectedHashes.value }),
    });
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function createCheckpoint() {
  result.value = await api.writeReceipt('/api/tools/checkpoints', {
    method: 'POST',
    body: JSON.stringify({ label: checkpointLabel.value || undefined }),
  });
  await refresh();
}

async function diffCheckpoint(id = selectedCheckpointId.value) {
  if (!id) return;
  result.value = await api.toolCheckpointDiff(id);
}

async function restoreCheckpoint(id = selectedCheckpointId.value) {
  if (!id) return;
  if (restoreArmedId.value !== id) {
    restoreArmedId.value = id;
    return;
  }
  result.value = await api.writeReceipt(`/api/tools/checkpoints/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  restoreArmedId.value = '';
  await refresh();
}

async function runPreflight() {
  result.value = await api.crossPlanePreflight(actionPayload());
}

async function simulatePolicy() {
  result.value = await api.crossPlanePolicySimulate(actionPayload());
}

onMounted(refresh);
</script>

<template>
  <section class="capability-page tools-page">
    <header class="page-header">
      <div>
        <h1>{{ t('page.tools.page.text.8e747cbf1c') }}</h1>
        <p>{{ t('page.tools.page.text.f798b2fb8d') }}</p>
      </div>
      <button class="primary-action" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="15" />
        {{ loading ? t('page.tools.page.inline.09a1cbd2c1') : t('page.tools.page.inline.caa54dd49a') }}
      </button>
    </header>

    <p v-if="error" class="settings-alert">{{ error }}</p>
    <PrimaryContextBar :items="toolContext" density="compact" :max-visible="4" />
    <WorkflowStrip :steps="toolsWorkflow" :title="t('page.tools.page.title.94f33c18ea')" density="compact" />

    <section class="metric-row tools-metrics">
      <article class="metric-card" data-tone="success">
        <span>{{ t('page.tools.page.text.e8caaa5188') }}</span>
        <strong>{{ tools.length }}</strong>
        <small>{{ toolRows.filter((row) => row.readonly === 'yes').length }} {{ t('page.tools.readonlyPrepared') }}</small>
      </article>
      <article class="metric-card" data-tone="info">
        <span>{{ t('page.tools.page.text.111e726ea3') }}</span>
        <strong>{{ checkpoints.length }}</strong>
        <small>{{ t('page.tools.page.text.de48a667de') }}</small>
      </article>
      <article class="metric-card" data-tone="warn">
        <span>{{ t('page.tools.page.text.b85b1088be') }}</span>
        <strong>{{ cacheRows.length }}</strong>
        <small>{{ t('page.tools.page.text.06c43804eb') }}</small>
      </article>
      <article class="metric-card" data-tone="neutral">
        <span>{{ t('page.tools.page.text.5590e877e1') }}</span>
        <strong>{{ toolLedger.length }}</strong>
        <small>{{ t('page.tools.page.text.89c18bdbe1') }}</small>
      </article>
    </section>

    <section class="gateway-grid">
      <section class="management-panel gateway-panel wide" data-section="registry">
        <header>
          <h2>{{ t('page.tools.page.text.a4819572ae') }}</h2>
          <span>{{ formatCount('tools', tools.length) }}</span>
        </header>
        <DataTable v-if="toolRows.length" searchable :rows="toolRows" :columns="['name', 'enabled', 'safety', 'cache', 'readonly', 'concurrency', 'tags']" />
        <EmptyState v-else :title="t('page.tools.page.title.3b32f8db00')" :detail="t('page.tools.page.detail.23ef32f1f0')" />
        <div class="button-row">
          <label class="field-line compact-field">
            {{ t('template.pages.toolspage.201fed4a91') }}
            <select v-model="selectedTool">
              <option v-for="tool in tools" :key="tool.name" :value="tool.name">{{ tool.name }}</option>
              <option value="tool_cache_stats">tool_cache_stats</option>
            </select>
          </label>
          <button class="primary-action" type="button" @click="runSafeTool">
            <Play :size="15" />
            {{ t('template.pages.toolspage.7fcfe24327') }}
          </button>
        </div>
      </section>

      <section class="management-panel gateway-panel wide" data-section="operations">
        <header>
          <h2>{{ t('page.tools.page.text.86c5ed2cc8') }}</h2>
          <span>{{ t('page.tools.page.text.6a1ed0bece') }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.toolspage.f41a6f7d28') }}
          <textarea v-model="plannerPrompt" rows="3" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="planIntent">{{ t('page.tools.page.text.2bf90d044e') }}</button>
          <button class="ghost-action" type="button" @click="planFanout">
            <GitBranch :size="15" />
            {{ t('template.pages.toolspage.6a81f91ac3') }}
          </button>
        </div>
        <label class="field-line">
          {{ t('template.pages.toolspage.d1dcd42299') }}
          <textarea v-model="fanoutPrompt" rows="3" />
        </label>
        <DataTable v-if="fanoutRows.length" :rows="fanoutRows" :columns="['tool', 'purpose', 'cache', 'risk']" />
        <label class="field-line">
          {{ t('template.pages.toolspage.92049fab60') }}
          <textarea v-model="batchCallsText" rows="6" />
        </label>
        <div class="button-row">
          <label class="field-line compact-field">
            {{ t('template.pages.toolspage.2ec390bfae') }}
            <input v-model.number="batchConcurrency" min="1" max="12" type="number" />
          </label>
          <button class="primary-action" type="button" @click="runBatchReadonly">{{ t('page.tools.page.text.99af3c0a4d') }}</button>
        </div>
      </section>

      <section class="management-panel gateway-panel wide" data-section="mutations">
        <header>
          <h2>{{ t('page.tools.page.text.e716d4ff02') }}</h2>
          <span>{{ t('page.tools.page.text.c38a665303') }}</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.toolspage.64f50f4fdb') }}
          <textarea v-model="mutationEditsText" rows="7" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="previewMutation">{{ t('page.tools.page.text.cbecb3651a') }}</button>
          <button class="primary-action" type="button" @click="applyMutation">{{ t('page.tools.page.text.fcb47752c9') }}</button>
        </div>
        <GovernedActionPanel
          :contract="{
            id: 'tool.mutation.apply',
            domain: 'tools',
            title: t('script.pages.toolspage.title.96baada078'),
            endpoint: '/api/tools/mutations/apply',
            method: 'POST',
            summary: t('script.pages.toolspage.summary.8eafd27ea0'),
            current_return: t('script.pages.toolspage.current_return.48db297b5f'),
            validate: t('script.pages.toolspage.validate.5b8800f5b7'),
            plan: '/api/tools/mutations/preview',
            dry_run: '/api/tools/mutations/preview',
            live: true,
            live_policy: t('script.pages.toolspage.live_policy.7258170816'),
            receipt: true,
            audit_ref: true,
            changed_refs: true,
            approval_required: false,
            kernel_boundary: t('script.pages.toolspage.kernel_boundary.83fb64e2c5')
          }"
          :payload="{ expected_hashes: expectedHashes, preview_rows: mutationPreviewRows.length }"
          :receipt="result"
          @plan="previewMutation"
          @dry-run="previewMutation"
          @live="applyMutation"
        />
        <DataTable v-if="mutationPreviewRows.length" :rows="mutationPreviewRows" :columns="['path', 'status', 'expected_hash', 'changed']" />
        <RawPayload :title="t('page.tools.page.title.141f116987')" :data="expectedHashes" />
      </section>

      <section class="management-panel gateway-panel" data-section="checkpoints">
        <header>
          <h2>{{ t('page.tools.page.text.111e726ea3') }}</h2>
          <span>{{ checkpointRows.length }} available</span>
        </header>
        <label class="field-line">
          {{ t('template.pages.toolspage.74341e3c27') }}
          <input v-model="checkpointLabel" type="text" />
        </label>
        <button class="primary-action" type="button" @click="createCheckpoint">{{ t('page.tools.page.text.e871201662') }}</button>
        <label class="field-line">
          {{ t('template.pages.toolspage.5cb9afc059') }}
          <select v-model="selectedCheckpointId">
            <option value="">{{ t('page.tools.page.text.1d8890ad2e') }}</option>
            <option v-for="checkpoint in checkpointRows" :key="checkpoint.id" :value="checkpoint.id">{{ checkpoint.label }} · {{ checkpoint.id }}</option>
          </select>
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="diffCheckpoint()">{{ t('page.tools.page.text.0dcacdc522') }}</button>
          <button class="danger-action" type="button" @click="restoreCheckpoint()">
            {{ restoreArmedId === selectedCheckpointId ? t('page.tools.page.inline.53cce63ca5') : t('page.tools.page.inline.1ac6ff6064') }}
          </button>
        </div>
        <GovernedActionPanel
          :contract="{
            id: 'tool.checkpoint.restore',
            domain: 'tools',
            title: t('script.pages.toolspage.title.b450d9b11c'),
            endpoint: '/api/tools/checkpoints/:id/restore',
            method: 'POST',
            summary: t('script.pages.toolspage.summary.a29f4acf62'),
            current_return: t('script.pages.toolspage.current_return.af53a529da'),
            validate: t('script.pages.toolspage.validate.305516ac6c'),
            plan: '/api/tools/checkpoints/:id/diff',
            dry_run: '/api/tools/checkpoints/:id/diff',
            live: true,
            live_policy: t('script.pages.toolspage.live_policy.b9ec5c9a41'),
            receipt: true,
            audit_ref: true,
            changed_refs: true,
            approval_required: false,
            kernel_boundary: t('script.pages.toolspage.kernel_boundary.83fb64e2c5')
          }"
          :payload="{ checkpoint_id: selectedCheckpointId, armed: restoreArmedId === selectedCheckpointId }"
          :receipt="result"
          @plan="diffCheckpoint()"
          @dry-run="diffCheckpoint()"
          @live="restoreCheckpoint()"
        />
        <DataTable v-if="checkpointRows.length" :rows="checkpointRows" :columns="['id', 'label', 'files', 'created']" />
        <EmptyState v-else :title="t('page.tools.page.title.a19a3515e0')" :detail="t('page.tools.page.detail.f539f4ce24')" />
      </section>

      <section class="management-panel gateway-panel" data-section="cache">
        <header>
          <h2>{{ t('page.tools.page.text.54a5a2e2a7') }}</h2>
          <span>{{ formatCount('metrics', cacheRows.length) }}</span>
        </header>
        <DataTable v-if="cacheRows.length" :rows="cacheRows" :columns="['metric', 'value']" />
        <EmptyState v-else :title="t('page.tools.page.title.d30324b46e')" :detail="t('page.tools.page.detail.5ad74f74b7')" />
      </section>

      <section class="management-panel gateway-panel wide" data-section="ledger">
        <header>
          <h2>{{ t('page.tools.page.text.237dfb0a3b') }}</h2>
          <span>{{ ledgerRows.length }} recent events</span>
        </header>
        <DataTable v-if="ledgerRows.length" searchable :rows="ledgerRows" :columns="['seq', 'kind', 'status', 'tool', 'at']" />
        <EmptyState v-else :title="t('page.tools.page.title.31c128d6c2')" :detail="t('page.tools.page.detail.ad2723c87a')" />
        <RequestReceipt :receipt="result" :title="t('page.tools.page.title.184f1d349a')" />
        <RawPayload :title="t('page.tools.page.title.d1d15f8e25')" :data="result || state.cache || {}" />
      </section>

      <section class="management-panel gateway-panel" data-section="risk">
        <header>
          <h2>{{ t('page.tools.page.text.6bd451cf41') }}</h2>
          <span>{{ selectedCapability }}</span>
        </header>
        <label class="field-line">
          {{ t('page.tools.field.actor') }}
          <input v-model="actor" type="text" />
        </label>
        <label class="field-line">
          {{ t('page.tools.field.capability') }}
          <input v-model="selectedCapability" type="text" />
        </label>
        <div class="button-row">
          <button class="ghost-action" type="button" @click="simulatePolicy">{{ t('page.tools.page.text.a57755021d') }}</button>
          <button class="primary-action" type="button" @click="runPreflight">
            <ShieldCheck :size="15" />
            {{ t('page.tools.action.runPreflight') }}
          </button>
        </div>
        <DataTable v-if="commandRows.length" :rows="commandRows" :columns="['name', 'action', 'target', 'description']" />
      </section>

      <section class="management-panel gateway-panel" data-section="risk">
        <header>
          <h2>{{ t('page.tools.page.text.8994b17557') }}</h2>
          <span>{{ t('common.shownCount', { count: historyRows.length, unit: t('unit.records') }) }}</span>
        </header>
        <label class="field-line">
          {{ t('page.tools.field.command') }}
          <select v-model="selectedCommand">
            <option v-for="command in commands" :key="command.name" :value="command.name">{{ command.name }}</option>
            <option value="/status">/status</option>
          </select>
        </label>
        <button class="ghost-action" type="button" @click="executeCommand">
          <Play :size="15" />
          {{ t('template.pages.toolspage.91f6f78d5d') }}
        </button>
        <DataTable v-if="historyRows.length" :rows="historyRows" :columns="['command', 'action', 'target', 'at']" />
        <EmptyState v-else :title="t('page.tools.page.title.4390982ec3')" :detail="t('page.tools.page.detail.8ee3ea19f0')" />
      </section>
    </section>
  </section>
</template>
