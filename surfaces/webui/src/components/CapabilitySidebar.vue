<script setup lang="ts">
import { t } from '../i18n';
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { buildCapabilitySpecs } from '../data/capabilities';
import { appPluginForRoute, pluginCapabilitySpecs } from '../plugins/registry';
import { useAppStore } from '../stores/app';
import type { NavId } from '../types';

const route = useRoute();
const router = useRouter();
const store = useAppStore();

function capabilityPageId(path: string): Exclude<NavId, 'chat' | 'settings'> {
  const plugin = appPluginForRoute(path);
  if (plugin) return plugin.appId;
  return path.replace(/^\/+/, '').split('/')[0] as Exclude<NavId, 'chat' | 'settings'>;
}

const pageId = computed(() => capabilityPageId(route.path));
const spec = computed(() => ({ ...buildCapabilitySpecs(), ...pluginCapabilitySpecs })[pageId.value]);
type CapabilitySection = NonNullable<(typeof spec.value)>['sections'][number];

const activeSection = computed(() => store.activeSectionByPage[pageId.value] || String(route.query.section || ''));

async function selectSection(section: CapabilitySection) {
  store.selectSection(pageId.value, section.id);
  await router.replace({ query: { ...route.query, section: section.id } });
}

watch(() => route.query.section, async (sectionId) => {
  if (!sectionId || typeof sectionId !== 'string') return;
  store.selectSection(pageId.value, sectionId);
});

onMounted(() => {
  const sectionId = route.query.section;
  if (sectionId && typeof sectionId === 'string') {
    store.selectSection(pageId.value, sectionId);
  }
});
</script>

<template>
  <aside class="capability-sidebar">
    <header class="sidebar-head capability-head">
      <strong>{{ spec?.title || t('component.capability.sidebar.inline.9e94b86e99') }}</strong>
      <span>{{ spec?.subtitle || t('component.capability.sidebar.inline.417a632c70') }}</span>
    </header>

    <nav v-if="spec?.sections?.length" class="secondary-sections" :aria-label="t('component.capability.sidebar.aria.sections', { title: spec.title })">
      <h2>{{ t('component.capability.sidebar.text.f576aad3f1') }}</h2>
      <button
        v-for="section in spec.sections"
        :key="section.id"
        class="section-row"
        :class="{ active: activeSection === section.id }"
        :data-section-id="section.id"
        type="button"
        @click="selectSection(section)"
      >
        <strong>{{ section.label }}</strong>
        <span>{{ section.description }}</span>
      </button>
    </nav>
  </aside>
</template>
