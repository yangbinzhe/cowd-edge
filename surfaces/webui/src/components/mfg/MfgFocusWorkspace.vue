<script setup lang="ts">
import { computed, ref } from 'vue';
import { Bell, BellRing, Check, Clock3, Plus, TrendingUp } from 'lucide-vue-next';
import { api } from '../../api/client';
import { t } from '../../i18n';
import { useMfgCockpitStore } from '../../stores/mfgCockpit';
import { createMfgMutationIntent } from '../../stores/mutationIntents';
import DataTable from '../workbench/DataTable.vue';
import EmptyState from '../workbench/EmptyState.vue';
import EvidenceTrace from '../workbench/EvidenceTrace.vue';
import RequestReceipt from '../workbench/RequestReceipt.vue';

const cockpit = useMfgCockpitStore();
const ruleName = ref('');
const metricRefs = ref('');
const entityRefs = ref('');
const severity = ref('warning');
const conditionField = ref('priority_score');
const conditionOperator = ref('gte');
const conditionThreshold = ref(0.7);
const conditionWindowMinutes = ref(60);
const forecastHorizon = ref('next_period');
const selectedForecast = ref<any>(null);
const subscriptionRuleId = ref('');
const subscriptionChannels = ref('webui');
const snoozeUntil = ref('');
const commandReason = ref('');
const busy = ref(false);
const receipt = ref<any>(null);
const error = ref('');

const alertEvidence = computed(() => cockpit.attentionAlerts.flatMap((alert) => (alert.evidence_refs || []).map((ref) => ({ id: ref, kind: 'mfg.alert.evidence', status: alert.status, summary: alert.summary, source: alert.occurrence_id }))));
const forecastRows = computed(() => cockpit.forecasts.map((forecast: any) => ({ metric_ref: forecast.metric_ref, status: forecast.status, confidence: forecast.confidence, horizon: forecast.horizon, interval: forecast.interval, method: forecast.method, expires_at: forecast.expires_at, unavailable_reason: forecast.unavailable_reason })));
const ruleRows = computed(() => cockpit.alertRules.map((rule: any) => ({ ...rule, condition_summary: rule.condition?.field ? `${rule.condition.field} ${rule.condition.operator} ${rule.condition.threshold}` : t('mfg.focus.allMatchingAttention') })));
const canManageAlerts = computed(() => cockpit.grantedCapabilities.has('mfg.alert.manage'));
const canRespondAlerts = computed(() => cockpit.grantedCapabilities.has('mfg.alert.respond'));

function list(value: string) { return value.split(',').map((item) => item.trim()).filter(Boolean); }

async function createRule() {
  if (!ruleName.value.trim() || !canManageAlerts.value) return;
  busy.value = true;
  error.value = '';
  try {
    const payload = {
      owner_ref: '',
      name: ruleName.value.trim(),
      metric_refs: list(metricRefs.value),
      entity_refs: list(entityRefs.value),
      condition: { field: conditionField.value, operator: conditionOperator.value, threshold: Number(conditionThreshold.value), window_minutes: Number(conditionWindowMinutes.value) },
      severity: severity.value,
      enabled: true,
    };
    const intent = createMfgMutationIntent(
      'mfg.alert_rule.create',
      `mfg:alert-rule:${ruleName.value.trim()}`,
      payload,
      { risk: 'medium' },
    );
    receipt.value = await api.mfgUpsertAlertRule(payload, intent);
    ruleName.value = '';
    await cockpit.refresh();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; }
}

async function subscribe() {
  if (!subscriptionRuleId.value || !canManageAlerts.value) return;
  busy.value = true;
  error.value = '';
  try {
    const payload = { rule_id: subscriptionRuleId.value, channels: list(subscriptionChannels.value), enabled: true };
    const intent = createMfgMutationIntent(
      'mfg.alert_subscription.create',
      `mfg:alert-subscription:${subscriptionRuleId.value}`,
      payload,
      { risk: 'medium' },
    );
    receipt.value = await api.mfgUpsertAlertSubscription(payload, intent);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; }
}

async function refreshForecasts() {
  busy.value = true;
  error.value = '';
  try { await cockpit.loadForecasts(list(metricRefs.value), forecastHorizon.value); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}

async function alertCommand(alert: any, command: string) {
  if (!canRespondAlerts.value) return;
  if (command === 'escalate' && !window.confirm(`${alert.occurrence_id} @ revision ${alert.revision}`)) return;
  busy.value = true;
  error.value = '';
  try {
    const until = command === 'snooze' && snoozeUntil.value ? new Date(snoozeUntil.value).toISOString() : undefined;
    receipt.value = await cockpit.commandAlert(alert, command, until, commandReason.value || undefined);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; }
}
</script>

<template>
  <section class="mfg-focus" :aria-label="t('mfg.focus.aria')">
    <header class="mfg-workspace-header">
      <div><h2>{{ t('mfg.focus.title') }}</h2><p>{{ t('mfg.focus.summary') }}</p></div>
      <div class="mfg-focus__signal"><BellRing :size="16" /><strong>{{ cockpit.attentionAlerts.length }}</strong><span role="status">{{ busy ? t('mfg.domain.operation.running') : t('mfg.focus.activeAlerts') }}</span></div>
    </header>
    <p v-if="error" class="settings-alert">{{ error }}</p>

    <div class="mfg-focus__grid">
      <article class="mfg-focus__panel">
        <header><Bell :size="16" /><h3>{{ t('mfg.focus.rules') }}</h3></header>
        <form class="mfg-focus__form" @submit.prevent="createRule">
          <label><span>{{ t('mfg.focus.ruleName') }}</span><input v-model="ruleName" required /></label>
          <label><span>{{ t('mfg.focus.metricRefs') }}</span><input v-model="metricRefs" /></label>
          <label><span>{{ t('mfg.focus.entityRefs') }}</span><input v-model="entityRefs" /></label>
          <label><span>{{ t('mfg.focus.severity') }}</span><select v-model="severity"><option value="warning">warning</option><option value="critical">critical</option></select></label>
          <label><span>{{ t('mfg.focus.conditionField') }}</span><select v-model="conditionField"><option value="priority_score">priority_score</option><option value="urgency">urgency</option><option value="confidence">confidence</option><option value="strategic_weight">strategic_weight</option></select></label>
          <label><span>{{ t('mfg.focus.conditionOperator') }}</span><select v-model="conditionOperator"><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="eq">=</option></select></label>
          <label><span>{{ t('mfg.focus.conditionThreshold') }}</span><input v-model.number="conditionThreshold" type="number" min="0" max="1" step="0.01" /></label>
          <label><span>{{ t('mfg.focus.conditionWindow') }}</span><input v-model.number="conditionWindowMinutes" type="number" min="1" max="10080" step="1" /></label>
          <button class="primary-action" type="submit" :disabled="busy || !canManageAlerts"><Plus :size="15" />{{ t('mfg.focus.createRule') }}</button>
        </form>
        <DataTable v-if="ruleRows.length" :rows="ruleRows" :columns="['rule_id', 'name', 'condition_summary', 'severity', 'enabled', 'revision']" row-key="rule_id" @row-click="subscriptionRuleId = $event.rule_id" />
        <EmptyState v-else :title="t('mfg.focus.noRules')" :detail="t('mfg.focus.noRulesDetail')" />
      </article>

      <article class="mfg-focus__panel">
        <header><TrendingUp :size="16" /><h3>{{ t('mfg.focus.forecast') }}</h3></header>
        <form class="mfg-focus__form" @submit.prevent="refreshForecasts"><label><span>{{ t('mfg.focus.horizon') }}</span><select v-model="forecastHorizon"><option value="next_period">next_period</option><option value="next_week">next_week</option><option value="next_month">next_month</option></select></label><button class="ghost-action" type="submit" :disabled="busy"><TrendingUp :size="15" />{{ t('mfg.focus.refreshForecast') }}</button></form>
        <DataTable v-if="forecastRows.length" :rows="forecastRows" :columns="['metric_ref', 'status', 'confidence', 'horizon', 'interval', 'method', 'expires_at', 'unavailable_reason']" row-key="metric_ref" @row-click="selectedForecast = cockpit.forecasts.find((item: any) => item.metric_ref === $event.metric_ref)" />
        <dl v-if="selectedForecast" class="mfg-forecast-detail"><dt>{{ t('mfg.focus.leadingSignals') }}</dt><dd>{{ JSON.stringify(selectedForecast.leading_signals || []) }}</dd><dt>{{ t('mfg.focus.evidence') }}</dt><dd>{{ (selectedForecast.evidence_refs || []).join(', ') || '—' }}</dd><dt>{{ t('mfg.focus.points') }}</dt><dd>{{ JSON.stringify(selectedForecast.points || []) }}</dd><dt>{{ t('mfg.focus.unavailableReason') }}</dt><dd>{{ selectedForecast.unavailable_reason || '—' }}</dd></dl>
        <EmptyState v-if="!forecastRows.length" :title="t('mfg.focus.noForecast')" :detail="t('mfg.focus.noForecastDetail')" />
      </article>

      <article class="mfg-focus__panel mfg-focus__panel--wide">
        <header><Clock3 :size="16" /><h3>{{ t('mfg.focus.alerts') }}</h3></header>
        <div class="mfg-alert-command-context"><label><span>{{ t('mfg.focus.snoozeUntil') }}</span><input v-model="snoozeUntil" type="datetime-local" /></label><label><span>{{ t('mfg.focus.commandReason') }}</span><input v-model="commandReason" /></label></div>
        <div v-if="cockpit.alerts.length" class="mfg-alert-list">
          <article v-for="alert in cockpit.alerts" :key="alert.occurrence_id" class="mfg-alert" :data-severity="alert.severity">
            <div><strong>{{ alert.summary }}</strong><span>{{ alert.status }} · {{ alert.rule_id }}</span></div>
            <div class="mfg-alert__actions"><button class="ghost-action" type="button" :disabled="busy || !canRespondAlerts" @click="alertCommand(alert, 'acknowledge')">{{ t('mfg.focus.acknowledge') }}</button><button class="ghost-action" type="button" :disabled="busy || !canRespondAlerts" @click="alertCommand(alert, 'snooze')">{{ t('mfg.focus.snooze') }}</button><button class="ghost-action" type="button" :disabled="busy || !canRespondAlerts" @click="alertCommand(alert, 'escalate')">{{ t('mfg.focus.escalate') }}</button><button class="primary-action" type="button" :disabled="busy || !canRespondAlerts" @click="alertCommand(alert, 'resolve')"><Check :size="15" />{{ t('mfg.focus.resolve') }}</button></div>
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
          <button class="ghost-action" type="submit" :disabled="busy || !subscriptionRuleId || !canManageAlerts"><Bell :size="15" />{{ t('mfg.focus.saveSubscription') }}</button>
        </form>
        <RequestReceipt :receipt="receipt" :title="t('mfg.domain.receipt')" />
        <DataTable v-if="cockpit.alertSubscriptions.length" :rows="cockpit.alertSubscriptions" :columns="['subscription_id', 'rule_id', 'channels', 'enabled', 'revision']" row-key="subscription_id" />
      </article>
    </div>
  </section>
</template>

<style scoped>
.mfg-focus { display: grid; gap: 14px; }.mfg-workspace-header { display: flex; justify-content: space-between; gap: 16px; align-items: start; padding-bottom: 12px; border-bottom: 1px solid var(--border); }.mfg-workspace-header h2, .mfg-focus__panel h3 { margin: 0; color: var(--text); }.mfg-workspace-header h2 { font-size: 18px; }.mfg-workspace-header p { margin: 5px 0 0; color: var(--text-muted); font-size: 13px; }.mfg-focus__signal { display: inline-flex; align-items: center; gap: 7px; color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border)); border-radius: 8px; padding: 7px 9px; }.mfg-focus__signal strong { color: var(--text); }.mfg-focus__signal span { color: var(--text-muted); font-size: 12px; }.mfg-focus__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.mfg-focus__panel { min-width: 0; display: grid; align-content: start; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }.mfg-focus__panel > header { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }.mfg-focus__panel h3 { font-size: 14px; }.mfg-focus__panel--wide { grid-column: 1 / -1; }.mfg-focus__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }.mfg-focus__form label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }.mfg-focus__form input, .mfg-focus__form select { min-width: 0; min-height: 34px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 0 9px; }.mfg-focus__form button { grid-column: 1 / -1; justify-self: start; }.mfg-alert-command-context { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.mfg-alert-command-context label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }.mfg-alert-command-context input { min-width: 0; min-height: 34px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 0 9px; }.mfg-forecast-detail { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 9px; margin: 0; padding: 9px; border: 1px solid var(--border); border-radius: 8px; font-size: 11px; }.mfg-forecast-detail dt { color: var(--text-muted); }.mfg-forecast-detail dd { min-width: 0; margin: 0; color: var(--text); overflow-wrap: anywhere; }.mfg-alert-list { display: grid; gap: 8px; }.mfg-alert { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }.mfg-alert[data-severity="critical"] { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }.mfg-alert strong, .mfg-alert span { display: block; }.mfg-alert strong { color: var(--text); font-size: 13px; }.mfg-alert span { margin-top: 3px; color: var(--text-faint); font: 11px var(--font-mono); }.mfg-alert__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }@media (max-width: 820px) { .mfg-focus__grid, .mfg-focus__form, .mfg-alert-command-context { grid-template-columns: 1fr; }.mfg-alert { align-items: start; flex-direction: column; }.mfg-alert__actions { justify-content: start; } }
</style>
