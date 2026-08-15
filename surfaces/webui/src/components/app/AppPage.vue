<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { projectAppState, type AppCatalogEntryV1 } from '../../apps/catalog';
import { IframeBridgeHost } from '../../apps/iframeBridge';
import AppCapability from './AppCapability.vue';
import AppStatus from './AppStatus.vue';
import { t } from '../../i18n';

const props = withDefaults(defineProps<{
  entry: AppCatalogEntryV1;
  protocolDigest: string;
  catalogGeneration: string;
  theme?: string;
  locale?: string;
  visible?: boolean;
  fetchImpl?: typeof fetch;
}>(), { theme: 'system', locale: 'en-US', visible: true });

const emit = defineEmits<{
  ready: [];
  navigate: [route: string];
  resize: [heightCssPx: number];
  coreNavigation: [objectKind: string, objectId: string];
}>();

const iframe = ref<HTMLIFrameElement | null>(null);
const state = computed(() => projectAppState(props.entry));
const frameNonce = globalThis.crypto?.randomUUID?.() || `frame-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let bridge: IframeBridgeHost | null = null;

function createBridge() {
  bridge?.dispose();
  bridge = new IframeBridgeHost({
    entry: props.entry,
    frameNonce,
    protocolDigest: props.protocolDigest,
    catalogGeneration: props.catalogGeneration,
    fetchImpl: props.fetchImpl,
    onReady: () => emit('ready'),
    onNavigate: (route) => emit('navigate', route),
    onResize: (height) => {
      if (iframe.value) iframe.value.style.height = `${height}px`;
      emit('resize', height);
    },
    onCoreNavigation: (kind, id) => emit('coreNavigation', kind, id),
  });
  bridge.attach();
}

function connectFrame() {
  if (iframe.value?.contentWindow && bridge) {
    bridge.connect(iframe.value.contentWindow);
    bridge.sendTheme(props.theme);
    bridge.sendLocale(props.locale);
    bridge.sendVisibility(props.visible);
  }
}

onMounted(createBridge);
onBeforeUnmount(() => bridge?.dispose());
watch(() => props.theme, (value) => bridge?.sendTheme(value));
watch(() => props.locale, (value) => bridge?.sendLocale(value));
watch(() => props.visible, (value) => bridge?.sendVisibility(value));
</script>

<template>
  <article class="app-page" :data-app-id="entry.app_id">
    <header class="app-page__header">
      <div>
        <p class="app-page__eyebrow">{{ t('app.surface.application') }}</p>
        <h1>{{ entry.display_name }}</h1>
        <p class="app-page__version">{{ entry.artifact_version }} · {{ entry.activation }}</p>
      </div>
      <AppStatus :entry="entry" />
    </header>

    <AppCapability
      :capabilities="entry.effective_capabilities"
      :authorization-profile="entry.effective_authorization_profile"
    />

    <iframe
      v-if="state.webSurfaceLoadable"
      ref="iframe"
      class="app-page__surface"
      :title="`${entry.display_name} application`"
      :src="entry.web_surface.entry_path || undefined"
      sandbox="allow-scripts allow-forms allow-downloads"
      referrerpolicy="no-referrer"
      @load="connectFrame"
    />
    <section v-else class="app-page__unavailable" role="status">
      <strong>{{ t('app.surface.unavailable') }}</strong>
      <p>{{ t('app.surface.unavailableDetail') }}</p>
    </section>
  </article>
</template>

<style scoped>
.app-page { display: grid; gap: 18px; min-width: 0; }
.app-page__header { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 360px); gap: 20px; align-items: start; }
.app-page__eyebrow { margin: 0 0 4px; color: var(--color-text-muted, #667085); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(24px, 3vw, 38px); letter-spacing: -.035em; }
.app-page__version { margin: 6px 0 0; color: var(--color-text-muted, #667085); font: 12px/1.4 ui-monospace, monospace; }
.app-page__surface { width: 100%; min-height: 560px; border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 14px; background: white; }
.app-page__unavailable { border: 1px dashed color-mix(in srgb, currentColor 20%, transparent); border-radius: 14px; padding: 28px; text-align: center; }
.app-page__unavailable p { color: var(--color-text-muted, #667085); }
@media (max-width: 720px) { .app-page__header { grid-template-columns: 1fr; } }
</style>
