<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { t } from '../i18n';
import { useAppStore } from '../stores/app';
import { useMfgCockpitStore } from '../stores/mfgCockpit';
import ApiStateBanner from '../components/workbench/ApiStateBanner.vue';
import MfgCockpitWorkspace from '../components/mfg/MfgCockpitWorkspace.vue';
import MfgCollaborationWorkspace from '../components/mfg/MfgCollaborationWorkspace.vue';
import MfgDomainWorkspace from '../components/mfg/MfgDomainWorkspace.vue';
import MfgFocusWorkspace from '../components/mfg/MfgFocusWorkspace.vue';
import { publicErrorSummary } from '../utils/publicError';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const cockpit = useMfgCockpitStore();
const publicError = computed(() => publicErrorSummary(cockpit.error));
const mfgSections = new Set(['dashboard', 'focus', 'collaboration', 'data', 'reality', 'evidence', 'operations', 'skills', 'reports']);
const activeSection = computed(() => {
  const requested = typeof route.query.section === 'string' ? route.query.section : app.activeSectionByPage.mfg;
  return requested && mfgSections.has(requested) ? requested : 'dashboard';
});
const contractVersion = computed(() => {
  const version = cockpit.contract?.contract_version;
  if (!version) return 'contract unavailable';
  if (typeof version === 'string') return version;
  return `${version.major ?? 0}.${version.minor ?? 0}`;
});
const profileSummary = computed(() => [
  cockpit.entitlement?.core_profile_id,
  cockpit.entitlement?.mfg_profile_id,
].filter(Boolean).join(' / ') || 'profile unavailable');
const capabilitySummary = computed(() => `${cockpit.entitlement?.granted?.length || 0} granted · ${cockpit.entitlement?.denied?.length || 0} denied`);
const deliveryReceiptCount = computed(() => cockpit.reports.reduce(
  (count, report) => count + (Array.isArray(report?.delivery_receipts) ? report.delivery_receipts.length : 0),
  0,
));
const liveSummary = computed(() => [
  cockpit.liveStatus,
  `${cockpit.assignments.length} assignments`,
  `${cockpit.reports.length} reports`,
  `${cockpit.reviews.length} reviews`,
  `${cockpit.receipts.length} receipts`,
  `${deliveryReceiptCount.value} deliveries`,
].join(' · '));
const reportLiveState = computed(() => JSON.stringify(cockpit.reports.map((report) => ({
  id: report?.report_id,
  revision: report?.revision,
  status: report?.status,
  delivery_receipt_ids: (report?.delivery_receipts || [])
    .map((receipt: any) => receipt?.delivery_id)
    .filter(Boolean),
}))));
const reviewLiveState = computed(() => JSON.stringify(cockpit.reviews.map((review) => ({
  id: review?.review_id,
  report_id: review?.report_id,
  revision: review?.revision,
  status: review?.status,
}))));
const receiptLiveState = computed(() => JSON.stringify(cockpit.receipts.map((receipt) => ({
  id: receipt?.receipt_id,
  revision: receipt?.result_revision,
  status: receipt?.status,
}))));

function projectionFiltersFromRoute() {
  const filters: Record<string, string> = {};
  for (const key of ['entity', 'metric', 'severity', 'status', 'from', 'to']) {
    const value = route.query[key];
    if (typeof value === 'string' && value) filters[key] = value;
  }
  return filters;
}

function openGatewayAuthentication() {
  void router.push({
    path: '/settings',
    query: {
      section: 'gateway',
      replaceCredential: '1',
      reason: cockpit.liveRecoveryReason || 'authentication',
    },
  });
}

async function restoreProfileFromRoute() {
  const profileId = typeof route.query.profile === 'string' ? route.query.profile : '';
  if (!profileId) return;
  if (!cockpit.profiles.some((profile) => profile.profile_id === profileId)) return;
  await cockpit.loadProfile(profileId, undefined, projectionFiltersFromRoute());
}

async function refresh() {
  await cockpit.refresh(projectionFiltersFromRoute());
  await restoreProfileFromRoute();
  if (cockpit.liveAccessGranted) cockpit.startLive();
}

onMounted(() => { void refresh(); });
watch(
  () => [route.query.profile, route.query.entity, route.query.metric, route.query.severity, route.query.status, route.query.from, route.query.to],
  () => { void restoreProfileFromRoute(); },
);
</script>

<template>
  <div class="mfg-page" :aria-label="t('mfg.shell.aria')">
    <header class="mfg-page__header">
      <div>
        <h1>{{ t('mfg.shell.title') }}</h1>
        <p>{{ t('mfg.shell.summary') }}</p>
        <dl class="mfg-page__diagnostics" :aria-label="t('mfg.shell.diagnostics.aria')">
          <div><dt>{{ t('mfg.shell.diagnostics.contract') }}</dt><dd>{{ contractVersion }}</dd></div>
          <div><dt>{{ t('mfg.shell.diagnostics.profile') }}</dt><dd>{{ profileSummary }}</dd></div>
          <div><dt>{{ t('mfg.shell.diagnostics.permissions') }}</dt><dd>{{ capabilitySummary }}</dd></div>
          <div><dt>{{ t('mfg.shell.diagnostics.freshness') }}</dt><dd>{{ cockpit.lastUpdatedAt || cockpit.liveStatus }}</dd></div>
          <div
            data-mfg-live-diagnostics
            :data-live-status="cockpit.liveStatus"
            :data-assignment-count="cockpit.assignments.length"
            :data-report-count="cockpit.reports.length"
            :data-review-count="cockpit.reviews.length"
            :data-receipt-count="cockpit.receipts.length"
            :data-delivery-receipt-count="deliveryReceiptCount"
            :data-live-consumer-generation="cockpit.liveConsumerGeneration"
            :data-report-state="reportLiveState"
            :data-review-state="reviewLiveState"
            :data-receipt-state="receiptLiveState"
          ><dt>{{ t('mfg.shell.diagnostics.live') }}</dt><dd>{{ liveSummary }}</dd></div>
        </dl>
      </div>
      <div class="mfg-page__header-actions">
        <button
          v-if="cockpit.liveStatus === 'stopped' && cockpit.liveRecoveryReason"
          class="primary-action"
          data-mfg-auth-recovery
          :data-recovery-reason="cockpit.liveRecoveryReason"
          type="button"
          @click="openGatewayAuthentication"
        >{{ cockpit.liveRecoveryReason === 'forbidden' ? t('settings.gateway.replaceCredential') : t('settings.gateway.login') }}</button>
        <button
          class="ghost-action"
          data-mfg-workspace-refresh
          type="button"
          :disabled="cockpit.loading"
          @click="refresh"
        ><RefreshCw :size="15" />{{ t('mfg.shell.refresh') }}</button>
      </div>
    </header>

    <ApiStateBanner
      v-if="cockpit.error"
      status="degraded"
      :title="t('mfg.shell.degraded')"
      :detail="publicError"
      endpoint="/api/apps/mfg/live"
    />

    <section v-if="activeSection === 'dashboard'" class="mfg-page__workspace" data-section="dashboard"><MfgCockpitWorkspace /></section>
    <section v-else-if="activeSection === 'focus'" class="mfg-page__workspace" data-section="focus"><MfgFocusWorkspace /></section>
    <section v-else-if="activeSection === 'collaboration'" class="mfg-page__workspace" data-section="collaboration"><MfgCollaborationWorkspace /></section>
    <section v-else-if="activeSection === 'data'" class="mfg-page__workspace" data-section="data"><MfgDomainWorkspace section="data" /></section>
    <section v-else-if="activeSection === 'reality'" class="mfg-page__workspace" data-section="reality"><MfgDomainWorkspace section="reality" /></section>
    <section v-else-if="activeSection === 'evidence'" class="mfg-page__workspace" data-section="evidence"><MfgDomainWorkspace section="evidence" /></section>
    <section v-else-if="activeSection === 'operations'" class="mfg-page__workspace" data-section="operations"><MfgDomainWorkspace section="operations" /></section>
    <section v-else-if="activeSection === 'skills'" class="mfg-page__workspace" data-section="skills"><MfgDomainWorkspace section="skills" /></section>
    <section v-else-if="activeSection === 'reports'" class="mfg-page__workspace" data-section="reports"><MfgDomainWorkspace section="reports" /></section>
  </div>
</template>

<style scoped>
.mfg-page { display: grid; min-width: 0; min-height: 0; height: 100%; align-content: start; gap: 16px; overflow: auto; padding: 18px 24px 28px; }
.mfg-page__header { display: flex; align-items: start; justify-content: space-between; gap: 16px; padding: 0 126px 14px 0; border-bottom: 1px solid var(--border); }
.mfg-page__header h1 { margin: 0; color: var(--text); font-size: clamp(20px, 2vw, 27px); letter-spacing: -0.025em; }
.mfg-page__header p { max-width: 76ch; margin: 6px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
.mfg-page__diagnostics { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 10px 0 0; }
.mfg-page__diagnostics div { display: inline-flex; min-width: 0; gap: 5px; font: 11px var(--font-mono); }
.mfg-page__diagnostics dt { color: var(--text-faint); }
.mfg-page__diagnostics dd { min-width: 0; margin: 0; color: var(--text-muted); overflow-wrap: anywhere; }
.mfg-page__header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.mfg-page__header-actions .ghost-action { white-space: nowrap; }
.mfg-page__workspace { min-width: 0; }
@media (max-width: 820px) { .mfg-page { padding: 12px 14px 20px; } .mfg-page__header { align-items: stretch; flex-direction: column; padding-right: 0; } .mfg-page__header-actions { justify-content: flex-start; } }
@media (pointer: coarse) { .mfg-page__header .ghost-action { min-width: 44px; min-height: 44px; } }
</style>
