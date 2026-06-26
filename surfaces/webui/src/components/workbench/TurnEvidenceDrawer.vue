<script setup lang="ts">
import DataTable from './DataTable.vue';
import RawPayload from './RawPayload.vue';
import RequestReceipt from './RequestReceipt.vue';

defineProps<{
  evidence: Record<string, any> | null;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <aside class="turn-evidence-drawer" aria-label="Turn evidence drawer">
    <header>
      <div>
        <h2>Turn evidence</h2>
        <p>{{ evidence?.source_note || 'Select a turn to inspect session evidence.' }}</p>
      </div>
      <button class="ghost-action" type="button" @click="emit('close')">Close</button>
    </header>

    <div v-if="!evidence" class="empty-note">No turn evidence selected.</div>
    <template v-else>
      <section class="turn-evidence-summary">
        <article v-for="item in evidence.summary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </section>

      <section class="turn-evidence-section">
        <h3>Tools</h3>
        <DataTable v-if="evidence.tools.length" compact :rows="evidence.tools" :columns="['kind', 'status', 'summary']" />
        <p v-else class="empty-note">No tool activity linked to this session projection.</p>
      </section>

      <section class="turn-evidence-section">
        <h3>Memory and Reality</h3>
        <DataTable v-if="evidence.memory.length" compact :rows="evidence.memory" :columns="['kind', 'status', 'summary']" />
        <p v-else class="empty-note">No memory or Reality evidence linked to this session projection.</p>
      </section>

      <section class="turn-evidence-section">
        <h3>Files</h3>
        <DataTable v-if="evidence.files.length" compact :rows="evidence.files" :columns="['path', 'kind', 'status']" />
        <p v-else class="empty-note">No attached or runtime-referenced files.</p>
      </section>

      <section class="turn-evidence-section">
        <h3>Approvals and policy</h3>
        <DataTable v-if="evidence.approvals.length" compact :rows="evidence.approvals" :columns="['kind', 'status', 'summary']" />
        <p v-else class="empty-note">No approval or policy blocker found in this session projection.</p>
      </section>

      <section class="turn-evidence-section">
        <h3>Runtime events</h3>
        <DataTable v-if="evidence.events.length" compact :rows="evidence.events" :columns="['kind', 'status', 'summary']" />
        <p v-else class="empty-note">No runtime events returned for the active session.</p>
      </section>

      <RequestReceipt v-if="evidence.runtime_turn" :receipt="evidence.runtime_turn" title="Runtime turn detail" />
      <RawPayload title="Turn evidence projection" :data="evidence" />
    </template>
  </aside>
</template>
