<script setup lang="ts">
import { computed } from 'vue';
import RawPayload from './RawPayload.vue';
import EvidenceRefLink from './EvidenceRefLink.vue';
import type { EvidenceObject } from '../../types/evidence';

const props = withDefaults(defineProps<{
  title?: string;
  evidence?: EvidenceObject | null;
}>(), {
  title: 'Evidence object detail',
});

const emit = defineEmits<{ close: [] }>();

const fields = computed(() => {
  const evidence = props.evidence || {};
  return [
    ['Ref', evidence.ref],
    ['Kind', evidence.kind],
    ['Source', evidence.source],
    ['Status', evidence.status],
    ['Session', evidence.session_id],
    ['Turn', evidence.turn_id],
    ['Memory', evidence.memory_id],
    ['Matrix', evidence.matrix_ref],
    ['Audit', evidence.audit_ref],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
});
</script>

<template>
  <aside class="evidence-object-detail" aria-label="Evidence object detail">
    <header>
      <div>
        <h2>{{ title }}</h2>
        <p>{{ evidence?.summary || 'Select a Runtime, Reality, or Memory evidence object to inspect its ownership and source.' }}</p>
      </div>
      <button class="ghost-action" type="button" :disabled="!evidence" @click="emit('close')">Close</button>
    </header>

    <p v-if="!evidence" class="empty-note">No evidence object selected.</p>
    <template v-else>
      <dl class="detail-list evidence-object-fields">
        <template v-for="[label, value] in fields" :key="label">
          <dt>{{ label }}</dt>
          <dd v-if="label === 'Ref'">
            <EvidenceRefLink :ref-id="String(value)" :route="evidence.route" />
          </dd>
          <dd v-else>{{ value }}</dd>
        </template>
      </dl>
      <RawPayload title="Evidence drill-down payload" :data="evidence.raw || evidence" />
    </template>
  </aside>
</template>
