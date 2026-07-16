<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ApiWriteError, api } from '../../api/client';
import { createMfgMutationIntent } from '../../stores/mutationIntents';
import type {
  MfgApiErrorV1,
  MfgRecoveryAction,
  MfgReportDeliveryReview,
  MfgReportDeliveryReviewDecision,
} from '../../types/mfg';
import RecoveryActions from './RecoveryActions.vue';

const props = defineProps<{
  reportId: string;
  reviewId?: string;
  reportRevision: number;
  deadLettered: boolean;
  canReview: boolean;
}>();

const emit = defineEmits<{
  updated: [review: MfgReportDeliveryReview];
  close: [];
}>();

const reviews = ref<MfgReportDeliveryReview[]>([]);
const selectedId = ref('');
const reason = ref('');
const evidence = ref('');
const decision = ref<MfgReportDeliveryReviewDecision>('force_retry');
const targetRef = ref('');
const providerAccount = ref('');
const channel = ref('');
const requestedCapability = ref('');
const busy = ref(false);
const apiError = ref<MfgApiErrorV1 | null>(null);
const drawer = ref<HTMLElement | null>(null);
let lastMutation: (() => Promise<void>) | null = null;

const selected = computed(() => reviews.value.find((review) => review.review_id === selectedId.value) || reviews.value[0] || null);
const canDecide = computed(() => selected.value?.status === 'pending_approval');
const effectPending = computed(() => ['decision_pending_effect', 'approved_pending_effect'].includes(selected.value?.status || ''));

function evidenceRefs() {
  return evidence.value.split(',').map((item) => item.trim()).filter(Boolean);
}

function captureError(error: unknown) {
  if (error instanceof ApiWriteError) {
    apiError.value = error.apiError || {
      code: error.code,
      message: error.message,
      http_status: error.status,
      details: error.details,
      retryable: error.retryable,
      recovery_actions: error.recoveryActions,
      request_id: error.requestId,
    };
  } else {
    apiError.value = {
      code: 'network_error',
      message: error instanceof Error ? error.message : String(error),
      http_status: 0,
      retryable: true,
      recovery_actions: [{ kind: 'retry_same_intent', label: 'Retry', enabled: true }],
    };
  }
}

async function load() {
  if (!props.reportId) return;
  try {
    const result = await api.mfgReportReviews(props.reportId);
    if (result.__state && !['ready', 'stale'].includes(result.__state)) {
      throw new Error(result.__error || result.__state);
    }
    reviews.value = result.items || [];
    if (props.reviewId && reviews.value.some((review) => review.review_id === props.reviewId)) {
      selectedId.value = props.reviewId;
    }
    if (!reviews.value.some((review) => review.review_id === selectedId.value)) {
      selectedId.value = reviews.value[0]?.review_id || '';
    }
  } catch (error) {
    captureError(error);
  }
}

async function submitReviewRequest(
  payload: { expected_report_revision: number; reason: string; evidence_refs: string[] },
  intent: ReturnType<typeof createMfgMutationIntent>,
) {
  busy.value = true;
  apiError.value = null;
  try {
    const result = await api.mfgRequestReportReview(props.reportId, payload, intent);
    emit('updated', result.review);
    await load();
  } catch (error) {
    captureError(error);
  } finally {
    busy.value = false;
  }
}

async function requestReview() {
  if (!props.reportId || !props.deadLettered || !reason.value.trim()) return;
  const payload = {
    expected_report_revision: props.reportRevision,
    reason: reason.value.trim(),
    evidence_refs: evidenceRefs(),
  };
  const intent = createMfgMutationIntent(
    'mfg.report.review.request',
    `mfg:report:${props.reportId}`,
    payload,
    { expectedRevision: props.reportRevision, risk: 'medium' },
  );
  lastMutation = async () => { await submitReviewRequest(payload, intent); };
  await lastMutation();
}

async function submitDecision(
  review: MfgReportDeliveryReview,
  payload: {
    decision: MfgReportDeliveryReviewDecision;
    expected_revision: number;
    reason: string;
    evidence_refs: string[];
    reroute?: {
      target_ref: string;
      provider_account: string;
      channel: string;
      requested_capability: string;
    };
  },
  intent: ReturnType<typeof createMfgMutationIntent>,
) {
  busy.value = true;
  apiError.value = null;
  try {
    const result = await api.mfgDecideReportReview(review.review_id, payload, intent);
    emit('updated', result.review);
    await load();
  } catch (error) {
    captureError(error);
  } finally {
    busy.value = false;
  }
}

async function decide() {
  const review = selected.value;
  if (!review || !canDecide.value || !props.canReview || !reason.value.trim()) return;
  if (['abandon', 'resolve'].includes(decision.value)
    && !window.confirm(`${decision.value}: ${props.reportId} @ revision ${review.revision}`)) return;
  if (decision.value === 'resolve' && !evidenceRefs().length) return;
  if (decision.value === 'reroute'
    && (!targetRef.value.trim() || !providerAccount.value.trim() || !channel.value.trim() || !requestedCapability.value.trim())) return;
  const payload = {
    decision: decision.value,
    expected_revision: review.revision,
    reason: reason.value.trim(),
    evidence_refs: evidenceRefs(),
    ...(decision.value === 'reroute' ? {
      reroute: {
        target_ref: targetRef.value.trim(),
        provider_account: providerAccount.value.trim(),
        channel: channel.value.trim(),
        requested_capability: requestedCapability.value.trim(),
      },
    } : {}),
  };
  const intent = createMfgMutationIntent(
    `mfg.report.review.${decision.value}`,
    `mfg:report-review:${review.review_id}`,
    payload,
    { expectedRevision: review.revision, risk: decision.value === 'reject' ? 'medium' : 'high' },
  );
  lastMutation = async () => { await submitDecision(review, payload, intent); };
  await lastMutation();
}

async function recover(action: MfgRecoveryAction) {
  if (action.kind === 'retry_same_intent' && lastMutation) {
    await lastMutation();
    return;
  }
  if (action.kind === 'reload') await load();
  if (['reauthenticate', 'request_access'].includes(action.kind) && action.target) {
    window.location.assign(action.target);
  }
}

watch(() => props.reportId, async () => {
  void load();
  await nextTick();
  drawer.value?.focus();
}, { immediate: true });
</script>

<template>
  <aside
    ref="drawer"
    class="mfg-review-drawer"
    aria-label="MFG report delivery review"
    tabindex="-1"
  >
    <header>
      <div><strong>Manual review</strong><span>{{ reportId }}</span></div>
      <button class="ghost-action" type="button" @click="emit('close')">Close</button>
    </header>

    <RecoveryActions :error="apiError" @action="recover" />

    <label><span>Reason / external disposition</span><textarea v-model="reason" data-testid="review-reason" rows="3" /></label>
    <label><span>Evidence refs, comma separated</span><input v-model="evidence" data-testid="review-evidence" /></label>

    <button
      class="primary-action"
      data-testid="review-request"
      type="button"
      :disabled="busy || !deadLettered || !reason.trim()"
      @click="requestReview"
    >
      Request review
    </button>

    <label v-if="reviews.length"><span>Review</span><select v-model="selectedId" data-testid="review-select"><option v-for="review in reviews" :key="review.review_id" :value="review.review_id">{{ review.review_id }} · {{ review.status }}</option></select></label>

    <section v-if="selected" class="mfg-review-drawer__status" aria-live="polite">
      <dl>
        <dt>Status</dt><dd>{{ selected.status }}</dd>
        <dt>Revision</dt><dd>{{ selected.revision }}</dd>
        <dt>Approval</dt><dd>{{ selected.approval_id || 'pending submission' }}</dd>
        <dt>Effect</dt><dd>{{ selected.effect_receipt_ref || selected.effect_error || 'not terminal' }}</dd>
      </dl>
    </section>

    <p v-if="effectPending" class="mfg-review-drawer__warning">
      The decision is committed. Effect reconciliation is still running; reload to observe retry or terminal receipt.
      <button class="ghost-action" type="button" @click="load">Reload effect state</button>
    </p>

    <template v-if="selected && canReview && canDecide">
      <label><span>Decision</span><select v-model="decision" data-testid="review-decision"><option value="force_retry">force retry</option><option value="reroute">reroute</option><option value="abandon">abandon</option><option value="resolve">resolve external</option><option value="reject">reject review</option></select></label>
      <template v-if="decision === 'reroute'">
        <label><span>Target</span><input v-model="targetRef" data-testid="review-reroute-target" placeholder="channel://..." /></label>
        <label><span>Provider account</span><input v-model="providerAccount" data-testid="review-reroute-provider" /></label>
        <label><span>Channel</span><input v-model="channel" data-testid="review-reroute-channel" /></label>
        <label><span>Requested capability</span><input v-model="requestedCapability" data-testid="review-reroute-capability" /></label>
      </template>
      <p v-if="decision === 'abandon' || decision === 'resolve'" class="mfg-review-drawer__warning">This decision is irreversible for the current dead-letter record.</p>
      <button class="danger-action" data-testid="review-submit" type="button" :disabled="busy || !reason.trim()" @click="decide">Submit typed decision</button>
    </template>
  </aside>
</template>

<style scoped>
.mfg-review-drawer { position: fixed; z-index: 40; inset: 12px 12px 12px auto; width: min(440px, calc(100vw - 24px)); display: grid; align-content: start; gap: 12px; overflow: auto; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: 0 18px 60px rgb(0 0 0 / 28%); }
.mfg-review-drawer > header { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.mfg-review-drawer > header strong, .mfg-review-drawer > header span { display: block; }
.mfg-review-drawer > header span { margin-top: 3px; color: var(--text-muted); font: 11px var(--font-mono); overflow-wrap: anywhere; }
.mfg-review-drawer label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }
.mfg-review-drawer input, .mfg-review-drawer select, .mfg-review-drawer textarea { min-width: 0; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); padding: 9px; }
.mfg-review-drawer__status { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
.mfg-review-drawer__status dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 10px; margin: 0; }
.mfg-review-drawer__status dt { color: var(--text-faint); }
.mfg-review-drawer__status dd { min-width: 0; margin: 0; color: var(--text); overflow-wrap: anywhere; }
.mfg-review-drawer__warning { margin: 0; color: var(--warn); font-size: 12px; line-height: 1.5; }
@media (max-width: 620px) { .mfg-review-drawer { inset: 8px; width: auto; } }
@media (pointer: coarse) { .mfg-review-drawer button, .mfg-review-drawer input, .mfg-review-drawer select { min-height: 44px; } }
</style>
