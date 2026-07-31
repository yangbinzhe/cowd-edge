<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import { displayStatus } from '../../i18n/domain/status';
import { executionNodeKindLabel } from '../../utils/executionNode';

defineOptions({ name: 'StructuredValue' });

const props = withDefaults(defineProps<{
  value: unknown;
  depth?: number;
  fieldKey?: string;
}>(), {
  depth: 0,
  fieldKey: '',
});

const objectValue = computed(() => (
  props.value && typeof props.value === 'object' && !Array.isArray(props.value)
    ? props.value as Record<string, unknown>
    : null
));
const entries = computed(() => Object.entries(objectValue.value || {}));
const arrayValue = computed(() => Array.isArray(props.value) ? props.value : null);
const isScalar = computed(() => !objectValue.value && !arrayValue.value);

const fieldLabels: Record<string, string> = {
  action: 'structured.field.action',
  agent_id: 'structured.field.agentId',
  acceptance: 'structured.field.acceptance',
  command: 'structured.field.command',
  criteria: 'structured.field.criteria',
  depends_on: 'structured.field.dependsOn',
  description: 'structured.field.description',
  error: 'structured.field.error',
  evidence: 'structured.field.evidence',
  evidence_refs: 'structured.field.evidenceRefs',
  failure: 'structured.field.failure',
  graph_id: 'structured.field.graphId',
  id: 'structured.field.id',
  input: 'structured.field.input',
  intent: 'structured.field.intent',
  kind: 'structured.field.kind',
  minimum_score_basis_points: 'structured.field.minimumScore',
  model: 'structured.field.model',
  node_id: 'structured.field.nodeId',
  objective: 'structured.field.objective',
  output: 'structured.field.output',
  path: 'structured.field.path',
  payload_ref: 'structured.field.payloadRef',
  profile: 'structured.field.profile',
  prompt: 'structured.field.prompt',
  query: 'structured.field.query',
  required_evidence: 'structured.field.requiredEvidence',
  resource_scopes: 'structured.field.resourceScopes',
  result_ref: 'structured.field.resultRef',
  session_id: 'structured.field.sessionId',
  status: 'structured.field.status',
  summary: 'structured.field.summary',
  task_id: 'structured.field.taskId',
  tool: 'structured.field.tool',
  tool_name: 'structured.field.tool',
  turn_id: 'structured.field.turnId',
  url: 'structured.field.url',
  usage: 'structured.field.usage',
};

function fieldLabel(key: string) {
  const translation = fieldLabels[key];
  if (translation) return t(translation);
  return key.replace(/_/g, ' ');
}

function scalar(value: unknown) {
  if (value === null || value === undefined || value === '') return t('structured.empty');
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no');
  if (props.fieldKey === 'status') return displayStatus(String(value));
  if (props.fieldKey === 'kind' || props.fieldKey === 'executor_kind') {
    return executionNodeKindLabel(value);
  }
  return String(value);
}
</script>

<template>
  <span v-if="isScalar" class="structured-scalar">{{ scalar(value) }}</span>
  <ol v-else-if="arrayValue" class="structured-array">
    <li v-for="(item, index) in arrayValue" :key="index">
      <StructuredValue :value="item" :depth="depth + 1" :field-key="fieldKey" />
    </li>
  </ol>
  <dl v-else-if="entries.length" class="structured-object" :data-depth="depth">
    <template v-for="[key, item] in entries" :key="key">
      <dt :title="key">{{ fieldLabel(key) }}</dt>
      <dd><StructuredValue :value="item" :depth="depth + 1" :field-key="key" /></dd>
    </template>
  </dl>
  <span v-else class="structured-scalar">{{ t('structured.empty') }}</span>
</template>
