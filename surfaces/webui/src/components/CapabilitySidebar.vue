<script setup lang="ts">
import { t } from '../i18n';
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { capabilityPageEndpointsFromContract } from '../api/client';
import { buildCapabilitySpecs } from '../data/capabilities';
import { useAppStore } from '../stores/app';
import type { NavId } from '../types';
import EndpointHealthList from './workbench/EndpointHealthList.vue';

const route = useRoute();
const router = useRouter();
const store = useAppStore();

function capabilityPageId(path: string): Exclude<NavId, 'chat' | 'settings'> {
  if (path.startsWith('/apps/mfg')) return 'mfg';
  return path.replace(/^\/+/, '').split('/')[0] as Exclude<NavId, 'chat' | 'settings'>;
}

const pageId = computed(() => capabilityPageId(route.path));
const spec = computed(() => buildCapabilitySpecs()[pageId.value]);
const snapshots = computed(() => store.capabilitySnapshots[pageId.value] || []);
const contract = computed(() => store.gatewayCapabilityContract);
const openAiTools = computed(() => store.gatewayOpenAiTools);
const pageContractEndpoints = computed(() => capabilityPageEndpointsFromContract(contract.value, pageId.value, store.activeSessionId));
const contractCoverage = computed(() => contract.value?.coverage);
const contractRows = computed(() => {
  const coverage = contractCoverage.value;
  if (!coverage) return [];
  return [
    [t('component.capability.sidebar.contract.routes'), String(coverage.route_count || contract.value?.route_count || 0)],
    [t('component.capability.sidebar.contract.capabilities'), String(coverage.capability_count || contract.value?.capability_count || 0)],
    [t('component.capability.sidebar.contract.p1'), String(coverage.p1_count || 0)],
    [t('component.capability.sidebar.contract.ai'), String(coverage.ai_visible_count || 0)],
    [t('component.capability.sidebar.contract.openapi'), String(coverage.openapi_path_count || 0)],
    [t('component.capability.sidebar.contract.tools'), String(openAiTools.value?.tool_count || coverage.openai_tool_count || openAiTools.value?.tools?.length || 0)],
    [t('component.capability.sidebar.contract.page'), String(pageContractEndpoints.value.length)],
    [t('component.capability.sidebar.contract.parity'), coverage.route_contract_parity ? 'yes' : 'no'],
  ];
});
type CapabilitySection = NonNullable<(typeof spec.value)>['sections'][number];

const activeSection = computed(() => store.activeSectionByPage[pageId.value] || String(route.query.section || ''));

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function focusSection(section: CapabilitySection) {
  const direct = document.querySelector<HTMLElement>(`[data-section="${section.id}"], #section-${section.id}`);
  const sectionText = normalizeText(section.label);
  const sectionTokens = normalizeText(`${section.id} ${section.label}`).split(' ').filter((token) => token.length > 2);
  const byHeading = Array.from(document.querySelectorAll<HTMLElement>('main h1, main h2, main h3')).find((heading) => {
    const headingText = normalizeText(heading.textContent || '');
    return headingText.includes(sectionText) || sectionTokens.some((token) => headingText.includes(token));
  });
  const target = direct || byHeading;

  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}

async function selectSection(section: CapabilitySection) {
  store.selectSection(pageId.value, section.id);
  await router.replace({ query: { ...route.query, section: section.id } });
  focusSection(section);
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

    <section v-if="spec" class="sidebar-inspector">
      <EndpointHealthList :endpoints="snapshots" />
    </section>

    <section v-if="spec" class="sidebar-inspector contract-summary">
      <h2>{{ t('component.capability.sidebar.text.10e5b6dbd3') }}</h2>
      <p v-if="store.gatewayContractError" class="sidebar-warning">
        {{ t('component.capability.sidebar.contract.degraded') }}: {{ store.gatewayContractError }}
      </p>
      <dl>
        <template v-for="row in contractRows" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[1] }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="spec" class="sidebar-inspector">
      <dl>
        <template v-for="item in spec.inspector" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </template>
      </dl>
    </section>
  </aside>
</template>
