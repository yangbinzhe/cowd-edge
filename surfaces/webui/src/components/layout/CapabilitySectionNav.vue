<script setup lang="ts">
import type { CapabilitySection } from '../../types';

const props = defineProps<{
  title: string;
  sections: CapabilitySection[];
  activeSection: string;
}>();

const emit = defineEmits<{ select: [sectionId: string] }>();

function selectFromControl(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value) emit('select', value);
}
</script>

<template>
  <nav v-if="props.sections.length" class="capability-section-nav" :aria-label="props.title">
    <label class="capability-section-select">
      <span class="sr-only">{{ props.title }}</span>
      <select :value="props.activeSection" @change="selectFromControl">
        <option v-for="section in props.sections" :key="section.id" :value="section.id">
          {{ section.label }}
        </option>
      </select>
    </label>
    <div class="capability-section-tabs" role="list">
      <button
        v-for="section in props.sections"
        :key="section.id"
        class="capability-section-tab"
        :class="{ active: props.activeSection === section.id }"
        :aria-current="props.activeSection === section.id ? 'page' : undefined"
        :title="section.description"
        type="button"
        role="listitem"
        @click="emit('select', section.id)"
      >
        {{ section.label }}
      </button>
    </div>
  </nav>
</template>
