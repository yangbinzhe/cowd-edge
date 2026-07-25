<script setup lang="ts">
import { formatCount, t } from '../../i18n';
import { computed, ref } from 'vue';
import { Download } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  data: unknown;
  title?: string;
  maxChars?: number;
}>(), {
  title: t('script.components.workbench.rawpayload.title.1c51272120'),
  maxChars: 2400,
});

const expanded = ref(false);
const copied = ref(false);
const opened = ref(false);

const json = computed(() => {
  if (!opened.value) return '';
  try {
    return JSON.stringify(props.data ?? {}, null, 2);
  } catch {
    return String(props.data ?? '');
  }
});

const clipped = computed(() => json.value.length > props.maxChars);
const visibleJson = computed(() => expanded.value ? json.value : json.value.slice(0, props.maxChars));
const summary = computed(() => {
  if (!opened.value) return t('rawPayload.debugView');
  return clipped.value ? formatCount('chars', json.value.length) : t('rawPayload.debugView');
});

async function copyPayload() {
  await navigator.clipboard?.writeText(json.value);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1200);
}

function downloadPayload() {
  const blob = new Blob([json.value], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cowd-inspector-payload.json';
  link.click();
  URL.revokeObjectURL(url);
}

function handleToggle(event: Event) {
  opened.value = Boolean((event.currentTarget as HTMLDetailsElement | null)?.open);
  if (!opened.value) expanded.value = false;
}
</script>

<template>
  <details class="raw-payload" @toggle="handleToggle">
    <summary>
      <span>{{ title || t('rawPayload.title') }}</span>
      <small>{{ summary }}</small>
    </summary>
    <div class="raw-payload-toolbar">
      <button class="ghost-action" type="button" @click="expanded = !expanded">
        {{ expanded ? t('common.collapse') : t('rawPayload.showFull') }}
      </button>
      <button class="ghost-action" type="button" @click="copyPayload">
        {{ copied ? t('common.copied') : t('rawPayload.copyJson') }}
      </button>
      <button class="icon-action" type="button" :aria-label="t('rawPayload.download')" :title="t('rawPayload.download')" @click="downloadPayload">
        <Download :size="15" />
      </button>
    </div>
    <pre class="raw-payload-body">{{ visibleJson }}{{ clipped && !expanded ? '\n...' : '' }}</pre>
  </details>
</template>
