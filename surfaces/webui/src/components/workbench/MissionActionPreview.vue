<script setup lang="ts">
import { t } from '../../i18n';
defineProps<{
  title: string;
  action: string;
  target?: string;
  affected?: Array<string | number>;
  risk?: string;
  expected?: Array<string | number>;
  approval?: string;
  source?: string;
}>();
</script>

<template>
  <article class="mission-action-preview">
    <header>
      <div>
        <h3>{{ title }}</h3>
        <p>{{ action }}</p>
      </div>
      <span :data-risk="risk || 'medium'">{{ risk || 'medium' }}</span>
    </header>
    <dl class="detail-list">
      <dt>{{ t('component.workbench.mission.action.preview.text.e118e0db07') }}</dt>
      <dd>{{ target || '-' }}</dd>
      <dt>{{ t('component.workbench.mission.action.preview.text.05fbf1afda') }}</dt>
      <dd>{{ affected?.length ? affected.join(', ') : '-' }}</dd>
      <dt>{{ t('component.workbench.mission.action.preview.text.ef1fb8198e') }}</dt>
      <dd>{{ expected?.length ? expected.join(', ') : '-' }}</dd>
      <dt>{{ t('component.workbench.mission.action.preview.text.c3d7ad25d0') }}</dt>
      <dd>{{ approval || t('component.workbench.mission.action.preview.inline.050344816d') }}</dd>
      <dt>{{ t('component.workbench.mission.action.preview.text.1dbb20ff96') }}</dt>
      <dd>{{ source || t('component.workbench.mission.action.preview.inline.9ef5127d3a') }}</dd>
    </dl>
  </article>
</template>
