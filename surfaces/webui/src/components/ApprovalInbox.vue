<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, ShieldAlert, X } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import {
  approvalPresentation,
  type ApprovalScope,
} from '../adapters/approvalPresentation';
import { t } from '../i18n';
import { useEscapeKey } from '../composables/useEscapeKey';
import { appPluginForId, applicationAppIdFromApproval } from '../plugins/registry';
import { useAppStore } from '../stores/app';
import type { ApprovalPendingItem } from '../types';

const store = useAppStore();
const router = useRouter();
const approvals = ref<ApprovalPendingItem[]>([]);
const blockingCurrentApprovals = ref<ApprovalPendingItem[]>([]);
const resolvedApproval = ref<ApprovalPendingItem | null>(null);
const modalOpen = ref(false);
const selectedIndex = ref(0);
const busyApprovalId = ref('');
const error = ref('');
const approvalScope = ref<ApprovalScope>('once');
const nowMs = ref(Date.now());
const presentedInChat = new Set<string>();
let deadlineTimer: ReturnType<typeof setInterval> | null = null;

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
const activeApproval = computed(() => (
  orderedApprovals.value[selectedIndex.value] || resolvedApproval.value
));
const activeApprovalView = computed(() => activeApproval.value
  ? approvalPresentation(activeApproval.value)
  : null);
const busy = computed(() => busyApprovalId.value === activeApprovalView.value?.id);
const actionableApproval = computed(() => activeApprovalView.value?.status === 'pending');
const deadlineLabel = computed(() => {
  const expiresAt = activeApprovalView.value?.expiresAtMs;
  if (!expiresAt) return t('chat.approval.deadline.none');
  const remaining = expiresAt - nowMs.value;
  if (remaining <= 0) return t('chat.approval.deadline.expired');
  const seconds = Math.ceil(remaining / 1000);
  if (seconds < 60) return t('chat.approval.deadline.seconds', { count: seconds });
  return t('chat.approval.deadline.minutes', { count: Math.ceil(seconds / 60) });
});
const activeSourceKind = computed(() => String(activeApproval.value?.source?.kind || '').toLowerCase());
const activeSourceAppId = computed(() => applicationAppIdFromApproval(activeApproval.value));
const approvalSessionLabel = computed(() => {
  const approval = activeApproval.value;
  if (!approval) return '';
  const sessionId = String(approval?.source?.session_id || approval?.session_id || '');
  if (!sessionId) return t('chat.approval.noSession');
  const short = sessionId.length > 8 ? `${sessionId.slice(0, 8)}…` : sessionId;
  const known = store.sessions.find((session: any) => String(session.id || session.session_id || '') === sessionId);
  const title = known?.title ? String(known.title).slice(0, 40) : '';
  return title ? `session:${short} · ${title}` : `session:${short}`;
});
const typedOwnerRoute = computed(() => {
  const appId = activeSourceAppId.value;
  if (appId) return appPluginForId(appId)?.route || '';
  if (activeSourceKind.value === 'evolution') return '/audit?section=evolution';
  return '';
});
const delegatedOwner = computed(() => Boolean(typedOwnerRoute.value || activeSourceAppId.value));
const activePosition = computed(() => orderedApprovals.value.length
  ? `${selectedIndex.value + 1} / ${orderedApprovals.value.length}`
  : '0 / 0');

function approvalSessionId(approval: ApprovalPendingItem) {
  return String(approval?.source?.session_id || approval?.session_id || '');
}

function approvalScopeLabel(scope: ApprovalScope) {
  if (scope === 'turn') return t('chat.approval.scope.turn');
  if (scope === 'task') return t('chat.approval.scope.task');
  if (scope === 'session') return t('chat.approval.scope.session');
  if (scope === 'global') return t('chat.approval.scope.global');
  return t('chat.approval.scope.once');
}

function formatTimestamp(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : '—';
}

function approvalRows(payload: any): ApprovalPendingItem[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.pending || payload?.approvals?.requests || payload?.approvals?.pending || [];
  return Array.isArray(rows)
    ? rows.filter((item: ApprovalPendingItem) => ['pending', 'timed_out'].includes(String(item?.status || 'pending')))
    : [];
}

async function refresh() {
  try {
    const sessionId = activeSessionId.value;
    const [all, blocking] = await Promise.all([
      api.approvalPending(),
      sessionId
        ? api.approvalPending({ sessionId, domain: 'execution', blocksExecution: true })
        : Promise.resolve({ pending: [] }),
    ]);
    const allRows = approvalRows(all);
    const blockingRows = approvalRows(blocking);
    const known = new Set(allRows.map((item) => String(item?.approval_id || item?.id || '')));
    approvals.value = [
      ...blockingRows.filter((item) => !known.has(String(item?.approval_id || item?.id || ''))),
      ...allRows,
    ];
    blockingCurrentApprovals.value = blockingRows;
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
  resolvedApproval.value = null;
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
  resolvedApproval.value = null;
}

async function openTypedOwner() {
  if (!typedOwnerRoute.value) return;
  modalOpen.value = false;
  await router.push(typedOwnerRoute.value);
}

async function decide(approved: boolean, skip = false) {
  const view = activeApprovalView.value;
  const approvalId = view?.id || '';
  if (!approvalId || busyApprovalId.value) return;
  if (skip && !view?.canSkip) return;
  if (approved && (!view?.allowedScopes.length || !view.allowedScopes.includes(approvalScope.value))) {
    error.value = t('chat.approval.noAllowedScope');
    return;
  }
  busyApprovalId.value = approvalId;
  error.value = '';
  try {
    await api.approvalRespond(
      approvalId,
      approved,
      approved ? approvalScope.value : 'once',
      skip ? 'skipped from WebUI' : approved ? 'approved from WebUI' : 'rejected from WebUI',
      skip,
    );
    const resolved = await api.approvalExact(approvalId);
    if (resolved?.approval_id) resolvedApproval.value = resolved;
    await refresh();
    window.dispatchEvent(new CustomEvent('cowd:approval-changed', { detail: { approval_id: approvalId } }));
    // A successful decision is the terminal action for this modal. Keep the
    // resolved receipt in the canonical approval/activity projections, but do
    // not force the user to manually dismiss a stale blocking dialog. Any
    // remaining approvals stay discoverable through the global inbox badge.
    modalOpen.value = false;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    if (busyApprovalId.value === approvalId) busyApprovalId.value = '';
  }
}

async function skipApproval() {
  await decide(false, true);
}

function refreshFromRuntime() {
  refresh().catch(() => undefined);
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible') refreshFromRuntime();
}

watch(
  [activeSessionId, blockingCurrentApprovals],
  () => {
    if (!activeSessionId.value) return;
    const approval = blockingCurrentApprovals.value[0];
    const approvalId = String(approval?.approval_id || approval?.id || '');
    if (!approvalId || presentedInChat.has(approvalId)) return;
    presentedInChat.add(approvalId);
    selectedIndex.value = Math.max(0, orderedApprovals.value.findIndex(
      (candidate) => String(candidate?.approval_id || candidate?.id || '') === approvalId,
    ));
    error.value = '';
    modalOpen.value = true;
  },
  { deep: true },
);

watch(activeApprovalView, (view) => {
  if (!view) return;
  if (!view.allowedScopes.includes(approvalScope.value)) {
    approvalScope.value = view.allowedScopes[0] || 'once';
  }
});

useEscapeKey(closeInbox, () => modalOpen.value);

onMounted(() => {
  deadlineTimer = setInterval(() => { nowMs.value = Date.now(); }, 1_000);
  refreshFromRuntime();
  window.addEventListener('focus', refreshFromRuntime);
  window.addEventListener('online', refreshFromRuntime);
  window.addEventListener('cowd:approval-changed', refreshFromRuntime);
  window.addEventListener('cowd:runtime-live-reconnected', refreshFromRuntime);
  document.addEventListener('visibilitychange', refreshWhenVisible);
});

onBeforeUnmount(() => {
  if (deadlineTimer) clearInterval(deadlineTimer);
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
            <small>{{ activeApprovalView?.operation || activeApprovalView?.risk || t('chat.approval.pending') }}</small>
            <small class="approval-session-label">{{ approvalSessionLabel }}</small>
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
        <p>{{ activeApprovalView?.summary || t('chat.approval.fallbackSummary') }}</p>
        <p v-if="activeApprovalView?.status === 'timed_out'" class="approval-timeout-note">
          {{ t('chat.approval.timedOut') }}
        </p>
        <p v-else-if="!actionableApproval" class="approval-timeout-note">
          {{ t('chat.approval.finalState', { status: activeApprovalView?.status || '—' }) }}
        </p>
        <dl class="approval-fact-grid">
          <div>
            <dt>{{ t('chat.approval.operation') }}</dt>
            <dd>{{ activeApprovalView?.operation || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.risk') }}</dt>
            <dd>{{ activeApprovalView?.risk || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.effect') }}</dt>
            <dd>{{ activeApprovalView?.effectKind || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.reversibility') }}</dt>
            <dd>{{ activeApprovalView?.reversibility || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.externality') }}</dt>
            <dd>{{ activeApprovalView?.externality || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.dataSensitivity') }}</dt>
            <dd>{{ activeApprovalView?.dataSensitivity || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.cost') }}</dt>
            <dd>{{ activeApprovalView?.cost || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.authorization') }}</dt>
            <dd>{{ activeApprovalView?.authorizationStatus || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.profile') }}</dt>
            <dd>{{ activeApprovalView?.approvalProfile || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.policyRevision') }}</dt>
            <dd>{{ activeApprovalView?.policyRevision || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.approvalRevision') }}</dt>
            <dd>{{ activeApprovalView?.approvalRevision || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.requestedAt') }}</dt>
            <dd>{{ formatTimestamp(activeApprovalView?.requestedAtMs) }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.deadline.label') }}</dt>
            <dd>{{ deadlineLabel }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.requestedPosture') }}</dt>
            <dd>{{ activeApprovalView?.requestedPosture || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('chat.approval.effectivePosture') }}</dt>
            <dd>{{ activeApprovalView?.effectivePosture || '—' }}</dd>
          </div>
        </dl>
        <div v-if="activeApprovalView?.resources.length" class="approval-resources">
          <strong>{{ t('chat.approval.resources') }}</strong>
          <ul>
            <li v-for="resource in activeApprovalView.resources" :key="resource">{{ resource }}</li>
          </ul>
        </div>
        <dl v-if="activeApprovalView?.decisionActor || activeApprovalView?.decisionReason" class="approval-decision">
          <div><dt>{{ t('chat.approval.decisionActor') }}</dt><dd>{{ activeApprovalView?.decisionActor || '—' }}</dd></div>
          <div><dt>{{ t('chat.approval.decisionReason') }}</dt><dd>{{ activeApprovalView?.decisionReason || '—' }}</dd></div>
          <div><dt>{{ t('chat.approval.decisionTime') }}</dt><dd>{{ formatTimestamp(activeApprovalView?.decidedAtMs) }}</dd></div>
        </dl>
        <p v-if="delegatedOwner" class="approval-owner-note">
          {{ typedOwnerRoute ? t('chat.approval.typedOwner') : t('app.approval.ownerUnavailable') }}
        </p>
        <fieldset v-if="!delegatedOwner && activeApprovalView?.allowedScopes.length" class="approval-scope-options" :disabled="busy">
          <legend>{{ t('chat.approval.scope') }}</legend>
          <button
            v-for="scope in activeApprovalView.allowedScopes"
            :key="scope"
            type="button"
            :class="{ active: approvalScope === scope }"
            @click="approvalScope = scope"
          >
            {{ approvalScopeLabel(scope) }}
          </button>
        </fieldset>
        <p v-else-if="!delegatedOwner" class="approval-owner-note">{{ t('chat.approval.noAllowedScope') }}</p>
        <p v-if="error" class="file-error" role="alert">{{ error }}</p>
      </div>
      <footer>
        <button v-if="!delegatedOwner && actionableApproval" class="ghost-action" type="button" :disabled="!!busyApprovalId" @click="decide(false)">
          {{ t('chat.approval.reject') }}
        </button>
        <button v-if="!delegatedOwner && actionableApproval && activeApprovalView?.canSkip" class="ghost-action" type="button" :disabled="!!busyApprovalId" @click="skipApproval()">
          {{ t('chat.approval.skip') }}
        </button>
        <button v-if="!delegatedOwner && actionableApproval" class="primary-action" type="button" :disabled="!!busyApprovalId || !activeApprovalView?.allowedScopes.length" @click="decide(true)">
          {{ busy ? t('chat.approval.processing') : t('chat.approval.approve') }}
        </button>
        <button v-else-if="typedOwnerRoute && actionableApproval" class="primary-action" type="button" @click="openTypedOwner">
          {{ t('chat.approval.openOwner') }}
        </button>
        <button v-else class="primary-action" type="button" @click="closeInbox">{{ t('common.close') }}</button>
      </footer>
    </section>
  </div>
</template>
