<script setup lang="ts">
import { ref, watch } from 'vue';
import { StreamingMarkdownRenderer } from './streamingMarkdown';

const props = withDefaults(defineProps<{ content: string; streaming?: boolean }>(), {
  streaming: false,
});
const renderer = new StreamingMarkdownRenderer();
const html = ref('');

watch(
  () => [props.content, props.streaming] as const,
  ([content, streaming]) => {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    html.value = renderer.render(normalized, streaming).html;
  },
  { immediate: true },
);
</script>

<template>
  <div class="markdown-body" v-html="html" />
</template>
