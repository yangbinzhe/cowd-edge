<script setup lang="ts">
import { formatCount, t } from '../../i18n';
defineProps<{
  rows: Array<Record<string, unknown>>;
}>();
</script>

<template>
  <section class="surface-diagnostic-playbook" :aria-label="t('component.workbench.surface.diagnostic.playbook.aria-label.cd886cf447')">
    <header>
      <h3>{{ t('component.workbench.surface.diagnostic.playbook.text.c9672a4628') }}</h3>
      <span>{{ formatCount('lanes', rows.length) }}</span>
    </header>
    <article v-for="row in rows" :key="String(row.lane)" :data-severity="row.severity || 'ready'">
      <strong>{{ row.lane }}</strong>
      <dl class="detail-list">
        <dt>{{ t('component.workbench.surface.diagnostic.playbook.text.09f6e21c9c') }}</dt>
        <dd>{{ row.status }}</dd>
        <dt>{{ t('component.workbench.surface.diagnostic.playbook.text.7c947f641c') }}</dt>
        <dd>{{ row.evidence }}</dd>
        <dt>{{ t('component.workbench.surface.diagnostic.playbook.text.23d6f3dce6') }}</dt>
        <dd>{{ row.next_action }}</dd>
      </dl>
    </article>
  </section>
</template>
