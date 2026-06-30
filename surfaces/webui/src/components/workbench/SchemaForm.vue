<script setup lang="ts">
import { t } from '../../i18n';
type Field = {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: string[];
};

const props = defineProps<{
  fields?: Field[];
  modelValue: Record<string, unknown>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>];
}>();

function updateField(name: string, value: string) {
  emit('update:modelValue', { ...(props.modelValue || {}), [name]: value });
}
</script>

<template>
  <div class="schema-form">
    <label v-for="field in fields || []" :key="field.name" class="field-line">
      {{ field.label || field.name }}
      <select
        v-if="field.type === 'select'"
        :value="String(modelValue?.[field.name] || '')"
        @change="updateField(field.name, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('component.workbench.schema.form.text.53490b5eb1') }}</option>
        <option v-for="option in field.options || []" :key="option" :value="option">{{ option }}</option>
      </select>
      <input
        v-else
        :value="String(modelValue?.[field.name] || '')"
        :required="field.required"
        type="text"
        @input="updateField(field.name, ($event.target as HTMLInputElement).value)"
      />
    </label>
    <p v-if="!(fields || []).length" class="panel-note">{{ t('component.workbench.schema.form.text.312dc6b9c4') }}</p>
  </div>
</template>
