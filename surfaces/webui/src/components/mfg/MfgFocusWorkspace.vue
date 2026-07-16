<script setup lang="ts">
import { computed, ref } from 'vue';
import { Bell, BellRing, Check, Clock3, Plus, TrendingUp } from 'lucide-vue-next';
import { api } from '../../api/client';
import { t } from '../../i18n';
import { useMfgCockpitStore } from '../../stores/mfgCockpit';
import DataTable from '../workbench/DataTable.vue';
import EmptyState from '../workbench/EmptyState.vue';
import EvidenceTrace from '../workbench/EvidenceTrace.vue';
import RequestReceipt from '../workbench/RequestReceipt.vue';

const cockpit = useMfgCockpitStore();
const ruleName = ref('');
const metricRefs = ref('');
const severity = ref('warning');
const subscriptionRuleId = ref('');
const subscriptionChannels = ref('webui');
const busy = ref(false);
const receipt = ref<any>(null);
const error = ref('');

const alertEvidence = computed(() => cockpit.attentionAlerts.flatMap((alert) => (alert.evidence_refs || []).map((ref) => ({ id: ref, kind: 'mfg.alert.evidence', status: alert.status, summary: alert.summary, source: alert.occurrence_id }))));
const forecastRows = computed(() => cockpit.forecasts.map((forecast: any) => ({ metric_ref: forecast.metric_ref, status: forecast.status, confidence: forecast.confidence, horizon: forecast.horizon, method: forecast.method, expires_at: forecast.expires_at, unavailable_reason: forecast.unavailable_reason })));

function list(value: string) { return value.split(',').map((item) => item.trim()).filter(Boolean); }

async function createRule() {
  if (!ruleName.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    receipt.value = await api.mfgUpsertAlertRule({ owner_ref: 'webui', name: ruleName.value.trim(), metric_refs: list(metricRefs.value), entity_refs: [], condition: {}, severity: severity.value, enabled: true });
    ruleName.value = '';
    await cockpit.refresh();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; }
}

async function subscribe() {
  if (!subscriptionRuleId.value) return;
  busy.value = true;
  error.value = '';
  try {
    receipt.value = await api.mfgUpsertAlertSubscription({ rule_id: subscriptionRuleId.value, channels: list(subscriptionChannels.value), enabled: true });
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; }
}

async function alertCommand(alert: any, command: string) {
  busy.value = true;
  error.value = '';
  try { receipt.value = await cockpit.commandAlert(alert, command); } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; }
}
</script>

<template>
  <section class="mfg-focus" :aria-label="t('mfg.focus.aria')">
    <header class="mfg-workspace-header">
      <div><h2>{{ t('mfg.focus.title') }}</h2><p>{{ t('mfg.focus.summary') }}</p></div>
      <div class="mfg-focus__signal"><BellRing :size="16" /><strong>{{ cockpit.attentionAlerts.length }}</strong><span>{{ t('mfg.focus.activeAlerts') }}</span></div>
    </header>
    <p v-if="error" class="settings-alert">{{ error }}</p>

    <div class="mfg-focus__grid">
      <article class="mfg-focus__panel">
        <header><Bell :size="16" /><h3>{{ t('mfg.focus.rules') }}</h3></header>
        <form class="mfg-focus__form" @submit.prevent="createRule">
          <label><span>{{ t('mfg.focus.ruleName') }}</span><input v-model="ruleName" required /></label>
          <label><span>{{ t('mfg.focus.metricRefs') }}</span><input v-model="metricRefs" /></label>
          <label><span>{{ t('mfg.focus.severity') }}</span><select v-model="severity"><option value="warning">warning</option><option value="critical">critical</option></select></label>
          <button class="primary-action" type="submit" :disabled="busy"><Plus :size="15" />{{ t('mfg.focus.createRule') }}</button>
        </form>
        <DataTable v-if="cockpit.alertRules.length" :rows="cockpit.alertRules" :columns="['rule_id', 'name', 'severity', 'enabled', 'revision']" row-key="rule_id" @row-click="subscriptionRuleId = $event.rule_id" />
        <EmptyState v-else :title="t('mfg.focus.noRules')" :detail="t('mfg.focus.noRulesDetail')" />
      </article>

      <article class="mfg-focus__panel">
        <header><TrendingUp :size="16" /><h3>{{ t('mfg.focus.forecast') }}</h3></header>
        <DataTable v-if="forecastRows.length" :rows="forecastRows" :columns="['metric_ref', 'status', 'confidence', 'horizon', 'method', 'expires_at']" row-key="metric_ref" />
        <EmptyState v-else :title="t('mfg.focus.noForecast')" :detail="t('mfg.focus.noForecastDetail')" />
      </article>

      <article class="mfg-focus__panel mfg-focus__panel--wide">
        <header><Clock3 :size="16" /><h3>{{ t('mfg.focus.alerts') }}</h3></header>
        <div v-if="cockpit.alerts.length" class="mfg-alert-list">
          <article v-for="alert in cockpit.alerts" :key="alert.occurrence_id" class="mfg-alert" :data-severity="alert.severity">
            <div><strong>{{ alert.summary }}</strong><span>{{ alert.status }} · {{ alert.rule_id }}</span></div>
            <div class="mfg-alert__actions"><button class="ghost-action" type="button" :disabled="busy" @click="alertCommand(alert, 'acknowledge')">{{ t('mfg.focus.acknowledge') }}</button><button class="ghost-action" type="button" :disabled="busy" @click="alertCommand(alert, 'snooze')">{{ t('mfg.focus.snooze') }}</button><button class="ghost-action" type="button" :disabled="busy" @click="alertCommand(alert, 'escalate')">{{ t('mfg.focus.escalate') }}</button><button class="primary-action" type="button" :disabled="busy" @click="alertCommand(alert, 'resolve')"><Check :size="15" />{{ t('mfg.focus.resolve') }}</button></div>
          </article>
        </div>
        <EmptyState v-else :title="t('mfg.focus.noAlerts')" :detail="t('mfg.focus.noAlertsDetail')" />
        <EvidenceTrace :items="alertEvidence" :title="t('mfg.focus.evidence')" />
      </article>

      <article class="mfg-focus__panel">
        <header><Bell :size="16" /><h3>{{ t('mfg.focus.subscriptions') }}</h3></header>
        <form class="mfg-focus__form" @submit.prevent="subscribe">
          <label><span>{{ t('mfg.focus.rule') }}</span><select v-model="subscriptionRuleId"><option value="">{{ t('mfg.focus.selectRule') }}</option><option v-for="rule in cockpit.alertRules" :key="rule.rule_id" :value="rule.rule_id">{{ rule.name || rule.rule_id }}</option></select></label>
          <label><span>{{ t('mfg.focus.channels') }}</span><input v-model="subscriptionChannels" /></label>
          <button class="ghost-action" type="submit" :disabled="busy || !subscriptionRuleId"><Bell :size="15" />{{ t('mfg.focus.saveSubscription') }}</button>
        </form>
        <RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" />
        <DataTable v-if="cockpit.alertSubscriptions.length" :rows="cockpit.alertSubscriptions" :columns="['subscription_id', 'rule_id', 'channels', 'enabled', 'revision']" row-key="subscription_id" />
      </article>
    </div>
  </section>
</template>

<style scoped>
.mfg-focus { display: grid; gap: 14px; }.mfg-workspace-header { display: flex; justify-content: space-between; gap: 16px; align-items: start; padding-bottom: 12px; border-bottom: 1px solid var(--border); }.mfg-workspace-header h2, .mfg-focus__panel h3 { margin: 0; color: var(--text); }.mfg-workspace-header h2 { font-size: 18px; }.mfg-workspace-header p { margin: 5px 0 0; color: var(--text-muted); font-size: 13px; }.mfg-focus__signal { display: inline-flex; align-items: center; gap: 7px; color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border)); border-radius: 8px; padding: 7px 9px; }.mfg-focus__signal strong { color: var(--text); }.mfg-focus__signal span { color: var(--text-muted); font-size: 12px; }.mfg-focus__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.mfg-focus__panel { min-width: 0; display: grid; align-content: start; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }.mfg-focus__panel > header { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }.mfg-focus__panel h3 { font-size: 14px; }.mfg-focus__panel--wide { grid-column: 1 / -1; }.mfg-focus__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }.mfg-focus__form label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }.mfg-focus__form input, .mfg-focus__form select { min-width: 0; min-height: 34px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 0 9px; }.mfg-focus__form button { grid-column: 1 / -1; justify-self: start; }.mfg-alert-list { display: grid; gap: 8px; }.mfg-alert { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }.mfg-alert[data-severity="critical"] { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }.mfg-alert strong, .mfg-alert span { display: block; }.mfg-alert strong { color: var(--text); font-size: 13px; }.mfg-alert span { margin-top: 3px; color: var(--text-faint); font: 11px var(--font-mono); }.mfg-alert__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }@media (max-width: 820px) { .mfg-focus__grid, .mfg-focus__form { grid-template-columns: 1fr; }.mfg-alert { align-items: start; flex-direction: column; }.mfg-alert__actions { justify-content: start; } }
</style>
