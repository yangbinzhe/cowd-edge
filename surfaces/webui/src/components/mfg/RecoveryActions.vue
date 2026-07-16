<script setup lang="ts">
import type { MfgApiErrorV1, MfgRecoveryAction } from '../../types/mfg';

defineProps<{
  error: MfgApiErrorV1 | null;
}>();

const emit = defineEmits<{
  action: [action: MfgRecoveryAction];
}>();
</script>

<template>
  <aside v-if="error" class="mfg-recovery" role="alert">
    <div>
      <strong>{{ error.message }}</strong>
      <span>{{ error.code }}<template v-if="error.request_id"> · {{ error.request_id }}</template></span>
    </div>
    <div v-if="error.recovery_actions?.length" class="mfg-recovery__actions">
      <button
        v-for="action in error.recovery_actions"
        :key="`${action.kind}:${action.target || ''}`"
        class="ghost-action"
        type="button"
        :disabled="!action.enabled"
        @click="emit('action', action)"
      >
        {{ action.label }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.mfg-recovery { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border)); border-radius: 9px; background: color-mix(in srgb, var(--danger) 8%, var(--surface)); }
.mfg-recovery strong, .mfg-recovery span { display: block; overflow-wrap: anywhere; }
.mfg-recovery strong { color: var(--text); font-size: 13px; }
.mfg-recovery span { margin-top: 3px; color: var(--text-muted); font: 11px var(--font-mono); }
.mfg-recovery__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
@media (max-width: 620px) { .mfg-recovery { align-items: stretch; flex-direction: column; }.mfg-recovery__actions { justify-content: flex-start; } }
@media (pointer: coarse) { .mfg-recovery__actions button { min-width: 44px; min-height: 44px; } }
</style>
