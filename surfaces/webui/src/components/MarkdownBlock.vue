<script setup lang="ts">
import { ref, watch } from 'vue';
import { StreamingMarkdownRenderer } from './streamingMarkdown';

const props = withDefaults(defineProps<{ content: string; streaming?: boolean }>(), {
  streaming: false,
});
const renderer = new StreamingMarkdownRenderer();
const canonicalHtml = ref('');
const stableHtml = ref('');
const visibleTail = ref('');
const hiddenTailChars = ref(0);
const isStreaming = ref(false);

watch(
  () => [props.content, props.streaming] as const,
  ([content, streaming]) => {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    const rendered = renderer.render(normalized, streaming);
    isStreaming.value = !rendered.canonical;
    if (rendered.canonical) {
      canonicalHtml.value = rendered.html;
      stableHtml.value = '';
      visibleTail.value = '';
      hiddenTailChars.value = 0;
      return;
    }
    // Stable Markdown changes only when a complete block arrives. Keep it in
    // a separate DOM subtree so token deltas update one text node instead of
    // replacing the already-rendered answer through v-html on every frame.
    stableHtml.value = rendered.stableHtml;
    visibleTail.value = rendered.visibleTail;
    hiddenTailChars.value = rendered.hiddenTailChars;
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="isStreaming" class="markdown-body markdown-body-streaming">
    <div v-if="stableHtml" class="markdown-stable-blocks" v-html="stableHtml" />
    <div
      v-if="visibleTail"
      class="markdown-stream-tail"
      :data-hidden-chars="hiddenTailChars"
      v-text="visibleTail"
    />
  </div>
  <div v-else class="markdown-body" v-html="canonicalHtml" />
</template>
