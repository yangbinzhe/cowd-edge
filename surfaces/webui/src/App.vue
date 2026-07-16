<script setup lang="ts">
import { t } from './i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Activity, Brain, Boxes, CircleDot, ClipboardCheck, Crosshair, Layers, MessageSquare,
  Network, PanelsTopLeft, RadioTower, Settings, Wrench,
} from 'lucide-vue-next';
import { useAppStore } from './stores/app';
import type { NavId, NavItem } from './types';
import { buildCapabilitySpecs } from './data/capabilities';
import { pluginNavItems } from './plugins/registry';
import CompanionPanel from './components/CompanionPanel.vue';
import CapabilitySidebar from './components/CapabilitySidebar.vue';
import SessionSidebar from './components/SessionSidebar.vue';
import CapabilitySectionNav from './components/layout/CapabilitySectionNav.vue';

const store = useAppStore();
const route = useRoute();
const router = useRouter();
const capabilitySpecs = buildCapabilitySpecs();

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

function go(item: NavItem) {
  router.push(item.route);
}

function pageFromRoute(path: string): NavId {
  if (path === '/' || path === '/chat') return 'chat';
  if (path.startsWith('/apps/mfg')) return 'mfg';
  const firstSegment = path.replace(/^\/+/, '').split('/')[0];
  return nav.some((item) => item.id === firstSegment) ? firstSegment as NavId : 'chat';
}

function defaultSectionFor(page: NavId) {
  if (page === 'chat') return '';
  if (page === 'settings') return 'ui';
  return capabilitySpecs[page as Exclude<NavId, 'chat' | 'settings'>]?.sections?.[0]?.id || '';
}

const currentPage = computed<NavId>(() => pageFromRoute(route.path));
const isChatRoute = computed(() => currentPage.value === 'chat');
const isSettingsRoute = computed(() => currentPage.value === 'settings');
const currentCapabilitySpec = computed(() => {
  if (isChatRoute.value || isSettingsRoute.value) return null;
  return capabilitySpecs[currentPage.value as Exclude<NavId, 'chat' | 'settings'>] || null;
});
const currentSections = computed(() => currentCapabilitySpec.value?.sections || []);
const isCompactViewport = ref(false);
function updateViewportMode() {
  if (typeof window === 'undefined') return;
  isCompactViewport.value = window.matchMedia?.('(max-width: 820px)').matches ?? window.innerWidth < 820;
}
const canToggleCompanion = computed(() => {
  if (isSettingsRoute.value) return false;
  if (isChatRoute.value) return store.chatDisplayMode === 'clean' ? store.companionTab === 'workspace' : isCompactViewport.value;
  return true;
});
const shellMode = computed(() => {
  if (isChatRoute.value) return store.chatDisplayMode === 'clean' ? 'chat-clean' : 'chat-panorama';
  if (isSettingsRoute.value) return 'settings';
  return 'workbench';
});
const activeSection = computed(() => {
  const querySection = typeof route.query.section === 'string' ? route.query.section : '';
  const storedSection = store.activeSectionByPage[currentPage.value] || '';
  const available = new Set(currentSections.value.map((section) => section.id));
  if (querySection && available.has(querySection)) return querySection;
  if (storedSection && available.has(storedSection)) return storedSection;
  return defaultSectionFor(currentPage.value);
});
async function syncSectionVisibility() {
  await nextTick();
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLElement>('.main-surface [data-section]').forEach((panel) => {
    const hidden = Boolean(activeSection.value) && panel.dataset.section !== activeSection.value;
    panel.hidden = hidden;
  });
}
const showCompanion = computed(() => {
  if (isSettingsRoute.value) return false;
  if (isChatRoute.value) {
    if (store.chatDisplayMode === 'clean') return store.companionTab === 'workspace' && !store.companionCollapsed;
    return !isCompactViewport.value || !store.companionCollapsed;
  }
  return canToggleCompanion.value && !store.companionCollapsed;
});
const companionState = computed(() => showCompanion.value ? 'open' : (canToggleCompanion.value ? 'collapsed' : 'hidden'));
const companionToggleLabel = computed(() => store.companionCollapsed ? t('app.companion.open') : t('app.companion.close'));
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
  void syncSectionVisibility();
}, { immediate: true });

async function selectCapabilitySection(sectionId: string) {
  if (!currentSections.value.some((section) => section.id === sectionId)) return;
  store.selectSection(currentPage.value, sectionId);
  await router.replace({ query: { ...route.query, section: sectionId } });
}

onMounted(() => {
  updateViewportMode();
  if (typeof window !== 'undefined') window.addEventListener('resize', updateViewportMode);
  void syncSectionVisibility();
  store.boot();
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateViewportMode);
});
</script>

<template>
  <div class="app-shell" :data-shell="shellMode" :data-companion="companionState">
    <nav class="rail" :aria-label="t('app.aria-label.4afc7f101b')">
      <button
        v-for="item in nav"
        :key="item.id"
        class="rail-button"
        :class="{ active: route.path === item.route || (item.id === 'chat' && route.path === '/') }"
        :title="item.label"
        :aria-label="item.label"
        type="button"
        @click="go(item)"
      >
        <component :is="item.icon" :size="19" stroke-width="1.8" />
      </button>
    </nav>

    <SessionSidebar v-if="isChatRoute" />
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
      <RouterView />
    </main>

    <button
      v-if="canToggleCompanion"
      class="companion-toggle"
      :class="{ active: !store.companionCollapsed }"
      type="button"
      :aria-label="companionToggleLabel"
      :title="companionToggleLabel"
      :aria-pressed="!store.companionCollapsed"
      @click="store.toggleCompanion"
    >
      <PanelsTopLeft :size="17" />
    </button>

    <CompanionPanel v-if="showCompanion" />
  </div>
</template>
