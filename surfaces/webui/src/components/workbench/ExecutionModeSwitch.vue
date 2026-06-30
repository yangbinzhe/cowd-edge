<script setup lang="ts">
import { t } from '../../i18n';
const model = defineModel<string>({ default: 'plan' });

defineProps<{
  livePolicy?: string;
}>();

const modes = [
  { id: 'plan', label: t('script.components.workbench.executionmodeswitch.label.ae2f98a099'), detail: t('script.components.workbench.executionmodeswitch.detail.b57cbc255e') },
  { id: 'dry_run', label: t('script.components.workbench.executionmodeswitch.label.485a3d15e7'), detail: t('script.components.workbench.executionmodeswitch.detail.cac6a7c4b6') },
  { id: 'live', label: t('script.components.workbench.executionmodeswitch.label.65c821a596'), detail: t('script.components.workbench.executionmodeswitch.detail.d3fa144958') },
];
</script>

<template>
  <div class="execution-mode-switch" role="radiogroup" :aria-label="t('component.workbench.execution.mode.switch.aria-label.cd6cc4251c')">
    <button
      v-for="mode in modes"
      :key="mode.id"
      type="button"
      :class="{ active: model === mode.id }"
      :aria-pressed="model === mode.id"
      @click="model = mode.id"
    >
      <strong>{{ mode.label }}</strong>
      <span>{{ mode.id === 'live' && livePolicy ? livePolicy : mode.detail }}</span>
    </button>
  </div>
</template>
