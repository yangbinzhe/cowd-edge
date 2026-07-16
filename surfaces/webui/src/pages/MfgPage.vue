<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { useRoute } from 'vue-router';
import { t } from '../i18n';
import { useAppStore } from '../stores/app';
import { useMfgCockpitStore } from '../stores/mfgCockpit';
import ApiStateBanner from '../components/workbench/ApiStateBanner.vue';
import MfgCockpitWorkspace from '../components/mfg/MfgCockpitWorkspace.vue';
import MfgCollaborationWorkspace from '../components/mfg/MfgCollaborationWorkspace.vue';
import MfgDomainWorkspace from '../components/mfg/MfgDomainWorkspace.vue';
import MfgFocusWorkspace from '../components/mfg/MfgFocusWorkspace.vue';

const route = useRoute();
const app = useAppStore();
const cockpit = useMfgCockpitStore();
const mfgSections = new Set(['dashboard', 'focus', 'collaboration', 'data', 'reality', 'evidence', 'operations', 'skills', 'reports']);
const activeSection = computed(() => {
  const requested = typeof route.query.section === 'string' ? route.query.section : app.activeSectionByPage.mfg;
  return requested && mfgSections.has(requested) ? requested : 'dashboard';
});

function projectionFiltersFromRoute() {
  const filters: Record<string, string> = {};
  for (const key of ['entity', 'metric', 'severity', 'status', 'from', 'to']) {
    const value = route.query[key];
    if (typeof value === 'string' && value) filters[key] = value;
  }
  return filters;
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
  cockpit.startLive();
}

onMounted(() => { void refresh(); });
onBeforeUnmount(() => cockpit.stopLive());
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
      </div>
      <button class="ghost-action" type="button" :disabled="cockpit.loading" @click="refresh"><RefreshCw :size="15" />{{ t('mfg.shell.refresh') }}</button>
    </header>

    <ApiStateBanner
      v-if="cockpit.error"
      status="degraded"
      :title="t('mfg.shell.degraded')"
      :detail="cockpit.error"
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
.mfg-page { display: grid; min-width: 0; gap: 16px; padding: 2px 0 24px; }
.mfg-page__header { display: flex; align-items: start; justify-content: space-between; gap: 16px; padding: 0 0 14px; border-bottom: 1px solid var(--border); }
.mfg-page__header h1 { margin: 0; color: var(--text); font-size: clamp(20px, 2vw, 27px); letter-spacing: -0.025em; }
.mfg-page__header p { max-width: 76ch; margin: 6px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
.mfg-page__workspace { min-width: 0; }
@media (max-width: 820px) { .mfg-page__header { align-items: stretch; flex-direction: column; } .mfg-page__header .ghost-action { align-self: start; } }
</style>
