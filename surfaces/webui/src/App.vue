<script setup lang="ts">
import { t, useI18n } from './i18n';
import { computed, defineAsyncComponent, onMounted, provide, readonly, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Activity, Brain, Boxes, CircleDot, ClipboardCheck, Crosshair, Layers, MessageSquare,
  Menu, Network, PanelsTopLeft, RadioTower, Settings, Wrench, X,
} from 'lucide-vue-next';
import { useAppStore } from './stores/app';
import { releaseAllLiveSubscriptions } from './stores/liveTransport';
import type { NavId, NavItem } from './types';
import { buildCapabilitySpecs } from './data/capabilities';
import { appPluginForRoute, pluginCapabilitySpecs, pluginNavItems } from './plugins/registry';
import ApprovalInbox from './components/ApprovalInbox.vue';
import CapabilitySidebar from './components/CapabilitySidebar.vue';
import SessionSidebar from './components/SessionSidebar.vue';
import CapabilitySectionNav from './components/layout/CapabilitySectionNav.vue';
import { activeCapabilitySectionKey } from './composables/useCapabilitySection';

const CompanionPanel = defineAsyncComponent(() => import('./components/CompanionPanel.vue'));
const store = useAppStore();
const { locale, setLocale } = useI18n();
const route = useRoute();
const router = useRouter();
const capabilitySpecs = { ...buildCapabilitySpecs(), ...pluginCapabilitySpecs };

const nav: NavItem[] = [
  { id: 'chat', label: 'Chat', route: '/chat', icon: MessageSquare, group: 'Core' },
  { id: 'mission', label: 'Mission Control', route: '/mission', icon: Crosshair, group: 'Core' },
  { id: 'runtime', label: 'Runtime', route: '/runtime', icon: Activity, group: 'Core' },
  { id: 'context', label: 'Context', route: '/context', icon: Layers, group: 'Core' },
  { id: 'reality', label: 'Reality Core', route: '/reality', icon: CircleDot, group: 'Core' },
  { id: 'memory', label: 'Memory', route: '/memory', icon: Brain, group: 'Reality' },
  { id: 'skills', label: 'Skills', route: '/skills', icon: Boxes, group: 'Automation' },
  { id: 'agents', label: 'Agents', route: '/agents', icon: Network, group: 'Automation' },
  { id: 'tools', label: 'Tools', route: '/tools', icon: Wrench, group: 'Automation' },
  { id: 'surfaces', label: 'Surfaces', route: '/surfaces', icon: PanelsTopLeft, group: 'Channels' },
  { id: 'gateway', label: 'Gateway', route: '/gateway', icon: RadioTower, group: 'Channels' },
  ...pluginNavItems,
  { id: 'audit', label: 'Audit', route: '/audit', icon: ClipboardCheck, group: 'System' },
  { id: 'settings', label: 'Settings', route: '/settings', icon: Settings, group: 'System' },
];
const mobilePrimaryIds = new Set<NavId>(['chat', 'mission', 'runtime', 'reality']);
const mobileNavOpen = ref(false);
const mobileSessionsOpen = ref(false);
const nextLocale = computed(() => locale.value === 'zh-CN' ? 'en-US' : 'zh-CN');
const localeSwitchLabel = computed(() => locale.value === 'zh-CN' ? t('locale.switchToEnglish') : t('locale.switchToChinese'));

function toggleLocale() {
  setLocale(nextLocale.value);
}

const navLabelKeys: Partial<Record<NavId, string>> = {
  chat: 'nav.chat',
  mission: 'nav.mission',
  runtime: 'nav.runtime',
  context: 'nav.context',
  reality: 'nav.reality',
  memory: 'nav.memory',
  skills: 'nav.skills',
  agents: 'nav.agents',
  tools: 'nav.tools',
  surfaces: 'nav.surfaces',
  gateway: 'nav.gateway',
  audit: 'nav.audit',
  settings: 'nav.settings',
};

function navLabel(item: NavItem) {
  const key = item.labelKey || navLabelKeys[item.id];
  return key ? t(key) : item.label;
}

function go(item: NavItem) {
  mobileNavOpen.value = false;
  mobileSessionsOpen.value = false;
  router.push(item.route);
}

function activateNav(item: NavItem) {
  if (item.id === 'chat' && isChatRoute.value) {
    mobileSessionsOpen.value = !mobileSessionsOpen.value;
    mobileNavOpen.value = false;
    return;
  }
  go(item);
}

function pageFromRoute(path: string): NavId {
  if (path === '/' || path === '/chat') return 'chat';
  const plugin = appPluginForRoute(path);
  if (plugin) return plugin.appId;
  const firstSegment = path.replace(/^\/+/, '').split('/')[0];
  return nav.some((item) => item.id === firstSegment) ? firstSegment as NavId : 'chat';
}

function defaultSectionFor(page: NavId) {
  if (page === 'chat') return '';
  if (page === 'settings') return 'ui';
  return capabilitySpecs[page]?.sections?.[0]?.id || '';
}

const currentPage = computed<NavId>(() => pageFromRoute(route.path));
function isMobilePrimary(item: NavItem) {
  return mobilePrimaryIds.has(item.id);
}
const isSecondaryMobileRoute = computed(() => !mobilePrimaryIds.has(currentPage.value));
const isChatRoute = computed(() => currentPage.value === 'chat');
const isSettingsRoute = computed(() => currentPage.value === 'settings');
const authorizationGateRequired = computed(() => (
  !isSettingsRoute.value
  && ['required', 'invalidated'].includes(store.authorizationState)
));
const currentCapabilitySpec = computed(() => {
  if (isChatRoute.value || isSettingsRoute.value) return null;
  return capabilitySpecs[currentPage.value] || null;
});
const currentSections = computed(() => currentCapabilitySpec.value?.sections || []);
const canToggleCompanion = computed(() => {
  if (isSettingsRoute.value) return false;
  if (isChatRoute.value) return true;
  return true;
});
const activeSection = computed(() => {
  const querySection = typeof route.query.section === 'string' ? route.query.section : '';
  const storedSection = store.activeSectionByPage[currentPage.value] || '';
  const available = new Set(currentSections.value.map((section) => section.id));
  if (querySection && available.has(querySection)) return querySection;
  if (storedSection && available.has(storedSection)) return storedSection;
  return defaultSectionFor(currentPage.value);
});
provide(activeCapabilitySectionKey, readonly(activeSection));
const showCompanion = computed(() => {
  if (isSettingsRoute.value) return false;
  if (isChatRoute.value) return !store.companionCollapsed;
  return canToggleCompanion.value && !store.companionCollapsed;
});
const shellMode = computed(() => {
  if (isChatRoute.value) return showCompanion.value ? 'chat-panorama' : 'chat-clean';
  if (isSettingsRoute.value) return 'settings';
  return 'workbench';
});
const companionState = computed(() => showCompanion.value ? 'open' : (canToggleCompanion.value ? 'collapsed' : 'hidden'));
const companionToggleLabel = computed(() => showCompanion.value ? t('app.companion.close') : t('app.companion.open'));

function toggleCompanionSurface() {
  if (!isChatRoute.value) {
    store.toggleCompanion();
    return;
  }
  if (showCompanion.value) {
    store.closeCompanion();
    return;
  }
  store.openCompanion('activity');
}
const configReloadStatus = computed(() => store.configReloadStatus || {});
const configReloadFields = computed(() => {
  const fields = configReloadStatus.value?.restart_required?.fields;
  return Array.isArray(fields) ? fields.filter(Boolean).join(', ') : '';
});
const configReloadNotice = computed(() => {
  if (store.configReloadInvalid) {
    const error = configReloadStatus.value?.last_error || configReloadStatus.value?.warnings?.[0] || t('config.reload.invalidFallback');
    return t('config.reload.invalidNotice', { error });
  }
  if (store.configReloadNeedsRestart) {
    return t('config.reload.restartNotice', { fields: configReloadFields.value || t('config.reload.noFields') });
  }
  return '';
});
const configReloadTone = computed(() => store.configReloadInvalid ? 'danger' : 'warn');

watch([currentPage, activeSection], () => {
  const section = activeSection.value;
  if (section && store.activeSectionByPage[currentPage.value] !== section) {
    store.selectSection(currentPage.value, section);
  }
}, { immediate: true });

watch(currentPage, (page) => {
  if (store.authorizationState === 'ready') {
    void store.loadManagementCapabilities(page);
  }
}, { immediate: true });

watch(() => store.authorizationState, (state) => {
  if (state === 'ready') void store.loadManagementCapabilities(currentPage.value);
});
watch(
  () => route.path,
  () => {
    void releaseAllLiveSubscriptions();
  },
);

async function selectCapabilitySection(sectionId: string) {
  if (!currentSections.value.some((section) => section.id === sectionId)) return;
  store.selectSection(currentPage.value, sectionId);
  await router.replace({ query: { ...route.query, section: sectionId } });
}

function openGatewayAuthentication() {
  router.push({
    path: '/settings',
    query: {
      section: 'gateway',
      replaceCredential: '1',
    },
  });
}

onMounted(() => {
  store.boot();
});
</script>

<template>
  <div class="app-shell" :data-shell="shellMode" :data-companion="companionState">
    <nav class="rail" :aria-label="t('app.aria-label.4afc7f101b')">
      <button
        v-for="item in nav"
        :key="item.id"
        class="rail-button"
        :class="{
          active: route.path === item.route || (item.id === 'chat' && route.path === '/'),
          'mobile-primary': isMobilePrimary(item),
        }"
        :title="navLabel(item)"
        :aria-label="navLabel(item)"
        :aria-expanded="item.id === 'chat' && isChatRoute ? mobileSessionsOpen : undefined"
        type="button"
        @click="activateNav(item)"
      >
        <component :is="item.icon" :size="19" stroke-width="1.8" />
      </button>
      <button
        class="rail-button mobile-more"
        :class="{ active: mobileNavOpen || isSecondaryMobileRoute }"
        type="button"
        :aria-label="t('nav.more')"
        :aria-expanded="mobileNavOpen"
        @click="mobileNavOpen = !mobileNavOpen"
      >
        <X v-if="mobileNavOpen" :size="19" />
        <Menu v-else :size="19" />
      </button>
      <section v-if="mobileNavOpen" class="mobile-nav-menu" :aria-label="t('nav.all')">
        <button
          v-for="item in nav"
          :key="`mobile-${item.id}`"
          type="button"
          :class="{ active: item.id === currentPage }"
          @click="go(item)"
        >
          <component :is="item.icon" :size="18" stroke-width="1.8" />
          <span>{{ navLabel(item) }}</span>
        </button>
        <button type="button" @click="toggleLocale">
          <span>{{ localeSwitchLabel }}</span>
        </button>
      </section>
    </nav>

    <ApprovalInbox />

    <button
      class="global-locale-switch"
      type="button"
      :title="localeSwitchLabel"
      :aria-label="localeSwitchLabel"
      @click="toggleLocale"
    >
      {{ locale === 'zh-CN' ? 'EN' : '中' }}
    </button>

    <button
      v-if="isChatRoute && mobileSessionsOpen"
      class="mobile-session-backdrop"
      type="button"
      :aria-label="t('common.close')"
      @click="mobileSessionsOpen = false"
    />
    <SessionSidebar
      v-if="isChatRoute"
      :class="{ 'mobile-open': mobileSessionsOpen }"
      @session-opened="mobileSessionsOpen = false"
    />
    <CapabilitySidebar v-else-if="!isSettingsRoute" />

    <main class="main-surface" :data-page="currentPage" :data-active-section="activeSection">
      <div v-if="configReloadNotice" class="config-reload-banner" :data-tone="configReloadTone">
        <strong>{{ store.configReloadInvalid ? t('config.reload.notApplied') : t('config.reload.needRestart') }}</strong>
        <span>{{ configReloadNotice }}</span>
      </div>
      <CapabilitySectionNav
        v-if="currentCapabilitySpec"
        :title="currentCapabilitySpec.title"
        :sections="currentSections"
        :active-section="activeSection"
        @select="selectCapabilitySection"
      />
      <section
        v-if="authorizationGateRequired"
        class="authorization-gate"
        role="alert"
        aria-live="assertive"
      >
        <div>
          <strong>{{ t('error.authenticationRequired') }}</strong>
          <p>{{ t('app.authorizationGate.detail') }}</p>
        </div>
        <button class="btn primary" type="button" @click="openGatewayAuthentication">
          {{ t('app.authorizationGate.action') }}
        </button>
      </section>
      <RouterView
        v-else
        :key="isSettingsRoute ? 'settings-auth-recovery' : store.authorizationViewGeneration"
      />
    </main>

    <button
      v-if="canToggleCompanion"
      class="companion-toggle"
      :class="{ active: showCompanion }"
      type="button"
      :aria-label="companionToggleLabel"
      :title="companionToggleLabel"
      :aria-pressed="showCompanion"
      @click="toggleCompanionSurface"
    >
      <PanelsTopLeft :size="17" />
    </button>

    <CompanionPanel v-if="showCompanion" />
  </div>
</template>
