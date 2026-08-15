<script setup lang="ts">
import { t } from '../i18n';
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { buildCapabilitySpecs } from '../data/capabilities';
import { appPluginForRoute } from '../plugins/registry';
import { useAppStore } from '../stores/app';
import type { NavId } from '../types';

const route = useRoute();
const router = useRouter();
const store = useAppStore();

function capabilityPageId(path: string): Exclude<NavId, 'chat' | 'settings'> {
  return path.replace(/^\/+/, '').split('/')[0] as Exclude<NavId, 'chat' | 'settings'>;
}

const app = computed(() => appPluginForRoute(route.path));
const pageId = computed(() => capabilityPageId(route.path));
const spec = computed(() => app.value ? undefined : buildCapabilitySpecs()[pageId.value]);
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
    <template v-if="app">
      <header class="sidebar-head capability-head">
        <strong>{{ app.entry.display_name }}</strong>
        <span>{{ app.entry.effective_authorization_profile || t('app.capabilities.noProfile') }}</span>
      </header>
      <nav class="secondary-sections" :aria-label="t('app.capabilities.title')">
        <h2>{{ t('app.capabilities.title') }}</h2>
        <div
          v-for="capability in app.entry.effective_capabilities"
          :key="capability"
          class="section-row"
        >
          <strong>{{ capability }}</strong>
        </div>
        <p v-if="!app.entry.effective_capabilities.length">{{ t('app.capabilities.empty') }}</p>
      </nav>
    </template>
    <template v-else>
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
    </template>
  </aside>
</template>
