<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, ShieldAlert, X } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { t } from '../i18n';
import { useEscapeKey } from '../composables/useEscapeKey';
import { appPluginForId } from '../plugins/registry';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const route = useRoute();
const router = useRouter();
const approvals = ref<Record<string, any>[]>([]);
const modalOpen = ref(false);
const selectedIndex = ref(0);
const busy = ref(false);
const error = ref('');
const approvalScope = ref('once');
const presentedInChat = new Set<string>();

const activeSessionId = computed(() => String(store.activeSessionId || ''));
const orderedApprovals = computed(() => {
  const sessionId = activeSessionId.value;
  return [...approvals.value].sort((left, right) => {
    const leftCurrent = approvalSessionId(left) === sessionId ? 1 : 0;
    const rightCurrent = approvalSessionId(right) === sessionId ? 1 : 0;
    if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;
    return Number(left?.created_at_ms || 0) - Number(right?.created_at_ms || 0);
  });
});
const activeApproval = computed(() => orderedApprovals.value[selectedIndex.value] || null);
const activeSourceKind = computed(() => String(activeApproval.value?.source?.kind || '').toLowerCase());
const typedOwnerRoute = computed(() => {
  if (activeSourceKind.value === 'evolution') return '/audit?section=evolution';
  if (activeSourceKind.value !== 'application') return '';
  const appId = String(activeApproval.value?.source?.application?.app_id || '');
  return appPluginForId(appId)?.route || '';
});
const activePosition = computed(() => orderedApprovals.value.length
  ? `${selectedIndex.value + 1} / ${orderedApprovals.value.length}`
  : '0 / 0');

function approvalSessionId(approval: Record<string, any>) {
  return String(approval?.source?.session_id || approval?.session_id || '');
}

function approvalRows(payload: any) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.pending || payload?.approvals?.requests || payload?.approvals?.pending || [];
  return Array.isArray(rows)
    ? rows.filter((item) => String(item?.status || 'pending') === 'pending')
    : [];
}

async function refresh() {
  try {
    approvals.value = approvalRows(await api.approvalPending());
    if (selectedIndex.value >= approvals.value.length) {
      selectedIndex.value = Math.max(0, approvals.value.length - 1);
    }
  } catch {
    // A transient read failure must not erase a previously visible approval.
  }
}

function openInbox() {
  const currentIndex = orderedApprovals.value.findIndex(
    (approval) => approvalSessionId(approval) === activeSessionId.value,
  );
  selectedIndex.value = currentIndex >= 0 ? currentIndex : 0;
  error.value = '';
  approvalScope.value = 'once';
  modalOpen.value = true;
}

function closeInbox() {
  modalOpen.value = false;
}

function selectOffset(offset: number) {
  const count = orderedApprovals.value.length;
  if (!count) return;
  selectedIndex.value = (selectedIndex.value + offset + count) % count;
  error.value = '';
}

async function openTypedOwner() {
  if (!typedOwnerRoute.value) return;
  modalOpen.value = false;
  await router.push(typedOwnerRoute.value);
}

async function decide(approved: boolean) {
  const approvalId = String(activeApproval.value?.approval_id || activeApproval.value?.id || '');
  if (!approvalId || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api.approvalRespond(
      approvalId,
      approved,
      approved ? approvalScope.value : 'once',
      approved ? 'approved from WebUI' : 'rejected from WebUI',
    );
    approvals.value = approvals.value.filter(
      (approval) => String(approval?.approval_id || approval?.id || '') !== approvalId,
    );
    await refresh();
    if (!approvals.value.length) modalOpen.value = false;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busy.value = false;
  }
}

function refreshFromRuntime() {
  refresh().catch(() => undefined);
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible') refreshFromRuntime();
}

watch(
  [() => route.path, activeSessionId, orderedApprovals],
  () => {
    if (route.path !== '/chat' || !activeSessionId.value) return;
    const approval = orderedApprovals.value.find(
      (item) => approvalSessionId(item) === activeSessionId.value,
    );
    const approvalId = String(approval?.approval_id || approval?.id || '');
    if (!approvalId || presentedInChat.has(approvalId)) return;
    presentedInChat.add(approvalId);
    selectedIndex.value = orderedApprovals.value.indexOf(approval);
    error.value = '';
    modalOpen.value = true;
  },
  { deep: true },
);

useEscapeKey(closeInbox, () => modalOpen.value);

onMounted(() => {
  refreshFromRuntime();
  window.addEventListener('focus', refreshFromRuntime);
  window.addEventListener('online', refreshFromRuntime);
  window.addEventListener('cowd:approval-changed', refreshFromRuntime);
  window.addEventListener('cowd:runtime-live-reconnected', refreshFromRuntime);
  document.addEventListener('visibilitychange', refreshWhenVisible);
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshFromRuntime);
  window.removeEventListener('online', refreshFromRuntime);
  window.removeEventListener('cowd:approval-changed', refreshFromRuntime);
  window.removeEventListener('cowd:runtime-live-reconnected', refreshFromRuntime);
  document.removeEventListener('visibilitychange', refreshWhenVisible);
});
</script>

<template>
  <button
    v-if="orderedApprovals.length"
    type="button"
    class="global-approval-button"
    :title="t('chat.approval.pending')"
    :aria-label="t('chat.approval.pending')"
    @click="openInbox"
  >
    <ShieldAlert :size="16" />
    <strong>{{ orderedApprovals.length }}</strong>
  </button>

  <div v-if="modalOpen && activeApproval" class="modal-scrim chat-approval-scrim" @click.self="closeInbox">
    <section class="chat-approval-modal" role="dialog" aria-modal="true" :aria-label="t('chat.approval.title')">
      <header>
        <div>
          <ShieldAlert :size="18" />
          <span>
            <strong>{{ t('chat.approval.title') }}</strong>
            <small>{{ activeApproval.action || activeApproval.risk || t('chat.approval.pending') }}</small>
          </span>
        </div>
        <div class="approval-modal-actions">
          <button
            v-if="orderedApprovals.length > 1"
            class="icon-action"
            type="button"
            :aria-label="t('chat.approval.previous')"
            @click="selectOffset(-1)"
          >
            <ChevronLeft :size="16" />
          </button>
          <small v-if="orderedApprovals.length > 1">{{ activePosition }}</small>
          <button
            v-if="orderedApprovals.length > 1"
            class="icon-action"
            type="button"
            :aria-label="t('chat.approval.next')"
            @click="selectOffset(1)"
          >
            <ChevronRight :size="16" />
          </button>
          <button class="icon-action" type="button" :aria-label="t('common.close')" @click="closeInbox">
            <X :size="16" />
          </button>
        </div>
      </header>
      <div class="chat-approval-content">
        <p>{{ activeApproval.summary || t('chat.approval.fallbackSummary') }}</p>
        <dl>
          <div>
            <dt>{{ t('chat.approval.risk') }}</dt>
            <dd>{{ activeApproval.risk || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.timeout') }}</dt>
            <dd>{{ activeApproval.timeout_policy || 'pending' }}</dd>
          </div>
        </dl>
        <p v-if="typedOwnerRoute" class="approval-owner-note">
          {{ t('chat.approval.typedOwner') }}
        </p>
        <label v-if="!typedOwnerRoute" class="field-line">
          {{ t('chat.approval.scope') }}
          <select v-model="approvalScope" :disabled="busy">
            <option value="once">{{ t('chat.approval.scope.once') }}</option>
            <option value="turn">{{ t('chat.approval.scope.turn') }}</option>
            <option value="session">{{ t('chat.approval.scope.session') }}</option>
            <option value="global">{{ t('chat.approval.scope.global') }}</option>
          </select>
        </label>
        <p v-if="error" class="file-error" role="alert">{{ error }}</p>
      </div>
      <footer>
        <button v-if="!typedOwnerRoute" class="ghost-action" type="button" :disabled="busy" @click="decide(false)">
          {{ t('chat.approval.reject') }}
        </button>
        <button v-if="!typedOwnerRoute" class="primary-action" type="button" :disabled="busy" @click="decide(true)">
          {{ t('chat.approval.approve') }}
        </button>
        <button v-else class="primary-action" type="button" @click="openTypedOwner">
          {{ t('chat.approval.openOwner') }}
        </button>
      </footer>
    </section>
  </div>
</template>
