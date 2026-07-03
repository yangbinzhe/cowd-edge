<script setup lang="ts">
import { t } from '../../i18n';
import { X } from 'lucide-vue-next';
import { useEscapeKey } from '../../composables/useEscapeKey';
import DataTable from './DataTable.vue';
import RawPayload from './RawPayload.vue';
import RequestReceipt from './RequestReceipt.vue';

defineProps<{
  evidence: Record<string, any> | null;
}>();

const emit = defineEmits<{ close: [] }>();

useEscapeKey(() => emit('close'));
</script>

<template>
  <aside class="turn-evidence-drawer" :aria-label="t('component.workbench.turn.evidence.drawer.aria-label.70902f7e4e')">
    <header>
      <div>
        <h2>{{ t('component.workbench.turn.evidence.drawer.text.94cf533aa2') }}</h2>
        <p>{{ evidence?.source_note || t('component.workbench.turn.evidence.drawer.inline.584fcb1c46') }}</p>
      </div>
      <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="emit('close')"><X :size="16" /></button>
    </header>

    <div v-if="!evidence" class="empty-note">{{ t('component.workbench.turn.evidence.drawer.text.af19886bc3') }}</div>
    <template v-else>
      <section class="turn-evidence-summary">
        <article v-for="item in evidence.summary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </section>

      <section class="turn-evidence-section">
        <h3>{{ t('component.workbench.turn.evidence.drawer.text.6f2e750bf4') }}</h3>
        <DataTable v-if="evidence.tools.length" compact :rows="evidence.tools" :columns="['kind', 'status', 'summary']" />
        <p v-else class="empty-note">{{ t('component.workbench.turn.evidence.drawer.text.ea242c44f4') }}</p>
      </section>

      <section class="turn-evidence-section">
        <h3>{{ t('component.workbench.turn.evidence.drawer.text.aec7f16786') }}</h3>
        <DataTable v-if="evidence.memory.length" compact :rows="evidence.memory" :columns="['kind', 'status', 'summary']" />
        <p v-else class="empty-note">{{ t('component.workbench.turn.evidence.drawer.text.2c9e5a6c44') }}</p>
      </section>

      <section class="turn-evidence-section">
        <h3>{{ t('component.workbench.turn.evidence.drawer.text.dfd0f7e316') }}</h3>
        <DataTable v-if="evidence.files.length" compact :rows="evidence.files" :columns="['path', 'kind', 'status']" />
        <p v-else class="empty-note">{{ t('component.workbench.turn.evidence.drawer.text.9a5847c1f9') }}</p>
      </section>

      <section class="turn-evidence-section">
        <h3>{{ t('component.workbench.turn.evidence.drawer.text.89d8ac1efb') }}</h3>
        <DataTable v-if="evidence.approvals.length" compact :rows="evidence.approvals" :columns="['kind', 'status', 'summary']" />
        <p v-else class="empty-note">{{ t('component.workbench.turn.evidence.drawer.text.1783bd6e40') }}</p>
      </section>

      <section class="turn-evidence-section">
        <h3>{{ t('component.workbench.turn.evidence.drawer.text.263f847b54') }}</h3>
        <DataTable v-if="evidence.events.length" compact :rows="evidence.events" :columns="['kind', 'status', 'summary']" />
        <p v-else class="empty-note">{{ t('component.workbench.turn.evidence.drawer.text.c7f28098d3') }}</p>
      </section>

      <RequestReceipt v-if="evidence.runtime_turn" :receipt="evidence.runtime_turn" :title="t('component.workbench.turn.evidence.drawer.title.c54ce27d56')" />
      <RawPayload :title="t('component.workbench.turn.evidence.drawer.title.30b81e2670')" :data="evidence" />
    </template>
  </aside>
</template>
