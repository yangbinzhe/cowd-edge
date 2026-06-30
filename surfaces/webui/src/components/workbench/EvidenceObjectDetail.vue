<script setup lang="ts">
import { t } from '../../i18n';
import { computed } from 'vue';
import RawPayload from './RawPayload.vue';
import EvidenceRefLink from './EvidenceRefLink.vue';
import type { EvidenceObject } from '../../types/evidence';

const props = withDefaults(defineProps<{
  title?: string;
  evidence?: EvidenceObject | null;
}>(), {
  title: t('component.workbench.evidence.object.detail.title.default'),
});

const emit = defineEmits<{ close: [] }>();

const fields = computed(() => {
  const evidence = props.evidence || {};
  return [
    ['component.workbench.evidence.object.detail.field.ref', evidence.ref, 'ref'],
    ['component.workbench.evidence.object.detail.field.kind', evidence.kind, 'kind'],
    ['component.workbench.evidence.object.detail.field.source', evidence.source, 'source'],
    ['component.workbench.evidence.object.detail.field.status', evidence.status, 'status'],
    ['component.workbench.evidence.object.detail.field.session', evidence.session_id, 'session'],
    ['component.workbench.evidence.object.detail.field.turn', evidence.turn_id, 'turn'],
    ['component.workbench.evidence.object.detail.field.memory', evidence.memory_id, 'memory'],
    ['component.workbench.evidence.object.detail.field.matrix', evidence.matrix_ref, 'matrix'],
    ['component.workbench.evidence.object.detail.field.audit', evidence.audit_ref, 'audit'],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
});
</script>

<template>
  <aside class="evidence-object-detail" :aria-label="t('component.workbench.evidence.object.detail.aria-label.0b6dd16470')">
    <header>
      <div>
        <h2>{{ title }}</h2>
        <p>{{ evidence?.summary || t('component.workbench.evidence.object.detail.inline.30cc727569') }}</p>
      </div>
      <button class="ghost-action" type="button" :disabled="!evidence" @click="emit('close')">{{ t('component.workbench.evidence.object.detail.text.d5659580ec') }}</button>
    </header>

    <p v-if="!evidence" class="empty-note">{{ t('component.workbench.evidence.object.detail.text.b64a514951') }}</p>
    <template v-else>
      <dl class="detail-list evidence-object-fields">
        <template v-for="[label, value, kind] in fields" :key="label">
          <dt>{{ t(String(label)) }}</dt>
          <dd v-if="kind === 'ref'">
            <EvidenceRefLink :ref-id="String(value)" :route="evidence.route" />
          </dd>
          <dd v-else>{{ value }}</dd>
        </template>
      </dl>
      <RawPayload :title="t('component.workbench.evidence.object.detail.title.payload')" :data="evidence.raw || evidence" />
    </template>
  </aside>
</template>
