<script setup lang="ts">
import { t } from '../../i18n';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  modelValue: Record<string, unknown>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>];
}>();

const error = ref('');
const text = ref(JSON.stringify(props.modelValue || {}, null, 2));

watch(() => props.modelValue, (value) => {
  text.value = JSON.stringify(value || {}, null, 2);
}, { deep: true });

const valid = computed(() => !error.value);

function applyJson() {
  try {
    const parsed = JSON.parse(text.value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Payload must be a JSON object.');
    }
    error.value = '';
    emit('update:modelValue', parsed);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="payload-editor" :data-valid="valid">
    <label>
      {{ t('template.components.workbench.payloadeditor.5616b61bb7') }}
      <textarea v-model="text" rows="8" spellcheck="false" @blur="applyJson" />
    </label>
    <div class="button-row">
      <button class="ghost-action" type="button" @click="applyJson">{{ t('component.workbench.payload.editor.text.d033a65889') }}</button>
      <span v-if="error" class="field-error">{{ error }}</span>
      <span v-else class="field-ok">{{ t('component.workbench.payload.editor.text.c25195659b') }}</span>
    </div>
  </div>
</template>
