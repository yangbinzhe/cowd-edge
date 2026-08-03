<script setup lang="ts">
import { t } from '../i18n';
import { displayStatus } from '../i18n/domain/status';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { AlertTriangle, Ban, CircleAlert, CircleCheck, GitFork, Plus, Radio, Search, Trash2, X } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import { useEscapeKey } from '../composables/useEscapeKey';

const store = useAppStore();
const chat = useChatSessionsStore();
const projections = useProjectionRegistryStore();
const emit = defineEmits<{
  'session-opened': [];
}>();
const SIDEBAR_WIDTH_KEY = 'cowd.webui.sessionSidebarWidth';
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 280;
const ACTIVE_EXECUTION_STATUSES = new Set([
  'queued',
  'preparing_context',
  'calling_model',
  'thinking',
  'calling_tool',
  'waiting_approval',
  'finalizing',
]);
const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);
const batchMode = ref(false);
const confirmBulkDelete = ref(false);
const batchDeleting = ref(false);
let resizeMove: ((event: PointerEvent) => void) | null = null;
let resizeEnd: (() => void) | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
const visibleSessionIds = computed(() => store.groupedSessions.flatMap((group) => group.items.map((session) => session.id)));
const allVisibleSelected = computed(() => (
  visibleSessionIds.value.length > 0
  && visibleSessionIds.value.every((id) => store.selectedSessionIds.includes(id))
));
const selectedRunningCount = computed(() => store.sessions.filter((session) => (
  store.selectedSessionIds.includes(session.id) && isSessionRunning(session)
)).length);

function setBatchMode(enabled: boolean) {
  batchMode.value = enabled;
  confirmBulkDelete.value = false;
  if (!enabled) store.clearSessionSelection();
}

function toggleVisibleSelection() {
  const shouldSelect = !allVisibleSelected.value;
  for (const id of visibleSessionIds.value) {
    const selected = store.selectedSessionIds.includes(id);
    if (selected !== shouldSelect) store.toggleSessionSelected(id);
  }
}

async function confirmDeleteSelected() {
  if (!store.selectedSessionIds.length || batchDeleting.value) return;
  batchDeleting.value = true;
  try {
    const result = await store.deleteSelectedSessions();
    confirmBulkDelete.value = false;
    if (!result.failures.length) setBatchMode(false);
  } finally {
    batchDeleting.value = false;
  }
}

async function searchSessions() {
  await store.refreshSessions();
}

async function openSession(sessionId: string) {
  // Capture the session identity at the click boundary.  The chat manager
  // owns all delayed stream/receipt writes for this ID; the global store only
  // provides shell-level selection and attachments.
  const loading = store.loadMessages(sessionId);
  emit('session-opened');
  await loading;
}

async function createSession() {
  const creating = store.createSession();
  emit('session-opened');
  await creating;
}

async function branchSession(sessionId: string) {
  await store.branchSession(sessionId);
}

async function deleteSession(sessionId: string) {
  await store.deleteSession(sessionId);
}

function localSessionExecutionStatus(sessionId: string) {
  const state = chat.states[sessionId];
  const projection = state?.executionGraphId ? projections.projectionFor(state.executionGraphId) : null;
  return String(projection?.live?.status || state?.live?.status || '');
}

function sessionExecutionStatus(session: any) {
  const state = chat.states[session.id];
  const localStatus = localSessionExecutionStatus(session.id).toLowerCase();
  const indexedStatus = String(session.execution?.latest_status || '').toLowerCase();
  if (state?.pending) return localStatus || indexedStatus || 'queued';
  if (['complete', 'cancelled', 'error'].includes(localStatus)) return localStatus;
  if (indexedStatus) return indexedStatus;
  if (localStatus) return localStatus;
  const lifecycle = String(session.status || '').toLowerCase();
  return ['closed', 'archived'].includes(lifecycle) ? lifecycle : 'idle';
}

function isSessionRunning(session: any) {
  return chat.states[session.id]?.pending || ACTIVE_EXECUTION_STATUSES.has(sessionExecutionStatus(session));
}

function sessionStatusTone(session: any) {
  const status = sessionExecutionStatus(session);
  if (status === 'complete') return 'complete';
  if (status === 'error') return 'error';
  if (status === 'cancelled') return 'cancelled';
  if (ACTIVE_EXECUTION_STATUSES.has(status)) return 'running';
  return 'idle';
}

function sessionTransportLabel(sessionId: string) {
  const state = chat.states[sessionId];
  if (!state || !['reconnecting', 'degraded', 'offline'].includes(state.streamState)) return '';
  return state.streamState === 'degraded' ? state.degradedReason : state.streamState;
}

function isSessionUnread(session: any) {
  return Number(chat.states[session.id]?.unread || 0) > 0 || store.isSessionUnread(session);
}

function clampSidebarWidth(width: number) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));
}

function applySidebarWidth(width: number) {
  const next = clampSidebarWidth(width);
  sidebarWidth.value = next;
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--session-sidebar-width', `${next}px`);
  }
}

function persistSidebarWidth() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
}

function startResize(event: PointerEvent) {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = sidebarWidth.value;
  resizeMove = (moveEvent: PointerEvent) => {
    applySidebarWidth(startWidth + moveEvent.clientX - startX);
  };
  resizeEnd = () => {
    if (resizeMove) window.removeEventListener('pointermove', resizeMove);
    if (resizeEnd) window.removeEventListener('pointerup', resizeEnd);
    document.body.classList.remove('resizing-session-sidebar');
    persistSidebarWidth();
    resizeMove = null;
    resizeEnd = null;
  };
  document.body.classList.add('resizing-session-sidebar');
  window.addEventListener('pointermove', resizeMove);
  window.addEventListener('pointerup', resizeEnd, { once: true });
}

async function onScroll(event: Event) {
  const target = event.currentTarget as HTMLElement;
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 32) {
    if (store.sessionRenderHasMore) store.revealMoreSessions();
    else await store.loadMoreSessions();
  }
}

function reconcileSessionStatuses() {
  if (
    store.authorizationState === 'ready'
    && (typeof document === 'undefined' || document.visibilityState === 'visible')
  ) {
    void store.refreshSessionStatuses().catch(() => undefined);
  }
}

onMounted(() => {
  const stored = typeof localStorage !== 'undefined' ? Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) : 0;
  applySidebarWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_SIDEBAR_WIDTH);
  statusTimer = setInterval(reconcileSessionStatuses, 30_000);
  window.addEventListener('focus', reconcileSessionStatuses);
  window.addEventListener('online', reconcileSessionStatuses);
  document.addEventListener('visibilitychange', reconcileSessionStatuses);
});

onBeforeUnmount(() => {
  if (resizeMove) window.removeEventListener('pointermove', resizeMove);
  if (resizeEnd) window.removeEventListener('pointerup', resizeEnd);
  if (statusTimer) clearInterval(statusTimer);
  window.removeEventListener('focus', reconcileSessionStatuses);
  window.removeEventListener('online', reconcileSessionStatuses);
  document.removeEventListener('visibilitychange', reconcileSessionStatuses);
  if (typeof document !== 'undefined') document.body.classList.remove('resizing-session-sidebar');
});

useEscapeKey(() => {
  if (confirmBulkDelete.value) confirmBulkDelete.value = false;
  else if (batchMode.value) setBatchMode(false);
}, () => confirmBulkDelete.value || batchMode.value);
</script>

<template>
  <aside class="session-sidebar">
    <button class="session-sidebar-resizer" type="button" :aria-label="t('session.sidebar.resize')" @pointerdown="startResize" />
    <header class="sidebar-head">
      <div class="session-create-row">
        <button
          :class="batchMode ? 'danger-action' : 'primary-action'"
          type="button"
          :disabled="store.sessionCreating || (batchMode && !store.selectedSessionIds.length)"
          @click="batchMode ? (confirmBulkDelete = true) : createSession()"
        >
          <Trash2 v-if="batchMode" :size="16" />
          <Plus v-else :size="16" />
          {{ batchMode ? t('session.bulk.selected', { count: store.selectedSessionIds.length }) : t('template.components.sessionsidebar.5c881d23b5') }}
        </button>
        <button
          class="icon-action"
          type="button"
          :aria-label="batchMode ? t('session.bulk.clear') : t('session.bulk.delete')"
          @click="setBatchMode(!batchMode)"
        >
          <X v-if="batchMode" :size="15" />
          <Trash2 v-else :size="15" />
        </button>
      </div>
      <label class="search-field">
        <Search :size="15" />
        <input v-model="store.sessionQuery" type="search" :placeholder="t('component.session.sidebar.placeholder.e7ed08a804')" @input="searchSessions" />
      </label>
    </header>

    <div class="session-list" :aria-label="t('component.session.sidebar.aria-label.d05d37d8a1')" @scroll="onScroll">
      <label v-if="batchMode" class="session-select-all">
        <input type="checkbox" :checked="allVisibleSelected" @change="toggleVisibleSelection" />
        <span>{{ t('session.bulk.selectAll') }}</span>
      </label>
      <section v-for="group in store.groupedSessions" :key="group.label" class="session-group">
        <header>{{ group.label }}</header>
        <div
          v-for="session in group.items"
          :key="session.id"
          class="session-row"
          :class="{ active: session.id === store.activeSessionId, selected: store.selectedSessionIds.includes(session.id), batch: batchMode }"
        >
          <input
            v-if="batchMode"
            class="session-select-checkbox"
            type="checkbox"
            :checked="store.selectedSessionIds.includes(session.id)"
            :aria-label="t('session.select')"
            @change="store.toggleSessionSelected(session.id)"
          />
          <button class="session-open" type="button" @click="batchMode ? store.toggleSessionSelected(session.id) : openSession(session.id)">
            <span class="session-row-top">
              <span class="session-title">
                <Radio v-if="isSessionRunning(session)" :size="11" />
                <CircleCheck v-else-if="sessionExecutionStatus(session) === 'complete'" :size="12" />
                <CircleAlert v-else-if="sessionExecutionStatus(session) === 'error'" :size="12" />
                <Ban v-else-if="sessionExecutionStatus(session) === 'cancelled'" :size="12" />
                <i v-else-if="isSessionUnread(session)" class="session-unread-dot"></i>
                {{ store.sessionTitle(session) }}
              </span>
              <time class="session-row-time">{{ store.compactTime(session) }}</time>
            </span>
            <span class="session-state-line">
              <small v-if="store.isSessionPinned(session)">{{ t('session.badge.pinned') }}</small>
              <small class="session-execution-status" :data-status="sessionStatusTone(session)">{{ displayStatus(sessionExecutionStatus(session)) }}</small>
              <small v-if="isSessionUnread(session)">{{ t('session.badge.unread') }}{{ chat.states[session.id]?.unread ? ` ${chat.states[session.id].unread}` : '' }}</small>
              <small v-if="sessionTransportLabel(session.id)">{{ sessionTransportLabel(session.id) }}</small>
              <small v-if="session.parent_session_id || session.branch_count">{{ t('session.badge.branch') }}</small>
            </span>
          </button>
          <span v-if="!batchMode" class="session-actions">
            <button class="icon-action" type="button" :aria-label="t('session.action.fork')" :title="t('session.action.fork')" @click.stop="branchSession(session.id)">
              <GitFork :size="12" />
            </button>
            <button class="icon-action danger" type="button" :aria-label="t('session.action.delete')" :title="t('session.action.delete')" @click.stop="deleteSession(session.id)">
              <X :size="13" />
            </button>
          </span>
        </div>
      </section>
      <button v-if="store.sessionRenderHasMore || store.sessionHasMore" class="ghost-action session-load-more" type="button" :disabled="store.sessionLoadingMore" @click="store.sessionRenderHasMore ? store.revealMoreSessions() : store.loadMoreSessions()">
        {{ store.sessionLoadingMore ? t('status.loading') : (store.sessionRenderHasMore ? t('session.renderMore') : t('session.loadMore')) }}
      </button>
    </div>

    <div v-if="confirmBulkDelete" class="modal-scrim" @click.self="confirmBulkDelete = false">
      <section class="session-delete-confirm" role="dialog" :aria-label="t('session.bulk.confirmTitle')">
        <header>
          <AlertTriangle :size="18" />
          <strong>{{ t('session.bulk.confirmTitle') }}</strong>
          <button class="icon-action" type="button" :aria-label="t('common.close')" @click="confirmBulkDelete = false"><X :size="15" /></button>
        </header>
        <p>{{ t('session.bulk.confirmBody', { count: store.selectedSessionIds.length }) }}</p>
        <p v-if="selectedRunningCount" class="field-warning">
          {{ t('session.bulk.runningNotice', { count: selectedRunningCount }) }}
        </p>
        <div v-if="store.sessionBulkDeleteProgress.active" class="session-delete-progress">
          <span>{{ store.sessionBulkDeleteProgress.done }} / {{ store.sessionBulkDeleteProgress.total }}</span>
          <progress :value="store.sessionBulkDeleteProgress.done" :max="store.sessionBulkDeleteProgress.total"></progress>
        </div>
        <footer>
          <button class="ghost-action" type="button" :disabled="batchDeleting" @click="confirmBulkDelete = false">{{ t('common.cancel') }}</button>
          <button class="danger-action" type="button" :disabled="batchDeleting" @click="confirmDeleteSelected">
            <Trash2 :size="14" />{{ t('session.bulk.delete') }}
          </button>
        </footer>
      </section>
    </div>
  </aside>
</template>
