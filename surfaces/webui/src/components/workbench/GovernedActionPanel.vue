<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '../../i18n';
import ExecutionModeSwitch from './ExecutionModeSwitch.vue';
import ImpactPreview from './ImpactPreview.vue';
import PayloadEditor from './PayloadEditor.vue';
import SchemaForm from './SchemaForm.vue';
import RequestReceipt from './RequestReceipt.vue';

type MfgWriteContract = {
  id: string;
  domain: string;
  title: string;
  endpoint: string;
  method: string;
  summary: string;
  current_return: string;
  validate?: string;
  plan?: string;
  dry_run?: string;
  live?: boolean;
  live_policy?: string;
  receipt?: boolean;
  audit_ref?: boolean;
  changed_refs?: boolean;
  approval_required?: boolean;
  kernel_boundary?: string;
  affected_refs?: string[];
  fields?: Array<{ name: string; label?: string; required?: boolean; type?: string; options?: string[] }>;
};

const props = defineProps<{
  contract: MfgWriteContract;
  payload?: Record<string, unknown>;
  receipt?: unknown;
}>();

const emit = defineEmits<{
  plan: [payload: Record<string, unknown>];
  dryRun: [payload: Record<string, unknown>];
  live: [payload: Record<string, unknown>];
}>();

const mode = ref('plan');
const payloadDraft = ref<Record<string, unknown>>({ ...(props.payload || {}) });

watch(() => props.payload, (value) => {
  payloadDraft.value = { ...(value || {}) };
}, { deep: true });

const capabilityRows = computed(() => [
  [t('component.workbench.governed.action.panel.field.validate'), props.contract.validate || t('status.notDeclared')],
  [t('component.workbench.governed.action.panel.field.plan'), props.contract.plan || t('status.notDeclared')],
  [t('component.workbench.governed.action.panel.field.dryRun'), props.contract.dry_run || t('status.notDeclared')],
  [t('component.workbench.governed.action.panel.field.live'), props.contract.live ? props.contract.live_policy || t('status.allowed') : t('status.unsupported')],
  [t('component.workbench.governed.action.panel.field.receipt'), props.contract.receipt ? t('status.required') : t('status.missing')],
  [t('component.workbench.governed.action.panel.field.audit'), props.contract.audit_ref ? t('status.required') : t('status.missing')],
  [t('component.workbench.governed.action.panel.field.changedRefs'), props.contract.changed_refs ? t('status.required') : t('status.missing')],
]);

const contractDomainKeys: Record<string, string> = {
  'Data Plane': 'mfg.contract.domain.dataPlane',
  Facts: 'mfg.contract.domain.facts',
  Entities: 'mfg.contract.domain.entities',
  Metrics: 'mfg.contract.domain.metrics',
  Evidence: 'mfg.contract.domain.evidence',
  Incidents: 'mfg.contract.domain.incidents',
  Cockpit: 'mfg.contract.domain.cockpit',
};

function displayContractDomain(domain: string) {
  return t(contractDomainKeys[domain] || 'mfg.contract.domain.unknown', { domain });
}

function run() {
  if (mode.value === 'dry_run') emit('dryRun', payloadDraft.value);
  else if (mode.value === 'live') emit('live', payloadDraft.value);
  else emit('plan', payloadDraft.value);
}
</script>

<template>
  <section class="governed-action-panel" :data-contract-id="contract.id" :data-domain="contract.domain">
    <header>
      <div>
        <span>{{ displayContractDomain(contract.domain) }}</span>
        <h3>{{ contract.title }}</h3>
      </div>
      <code>{{ contract.method }} {{ contract.endpoint }}</code>
    </header>
    <p>{{ contract.summary }}</p>
    <SchemaForm v-model="payloadDraft" :fields="contract.fields" />
    <PayloadEditor v-model="payloadDraft" />
    <ExecutionModeSwitch v-model="mode" :live-policy="contract.live_policy" />
    <ImpactPreview
      :refs="contract.affected_refs"
      :boundary="contract.kernel_boundary"
      :approval-required="contract.approval_required"
    />
    <dl class="contract-list">
      <template v-for="row in capabilityRows" :key="row[0]">
        <dt>{{ row[0] }}</dt>
        <dd>{{ row[1] }}</dd>
      </template>
      <dt>{{ t('component.workbench.governed.action.panel.field.return') }}</dt>
      <dd>{{ contract.current_return }}</dd>
    </dl>
    <div class="button-row">
      <button class="primary-action" type="button" @click="run">{{ t('component.workbench.governed.action.panel.action.run', { mode }) }}</button>
    </div>
    <RequestReceipt :receipt="receipt" :title="t('component.workbench.governed.action.panel.title.receipt', { title: contract.title })" />
  </section>
</template>
