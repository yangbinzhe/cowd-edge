<script setup lang="ts">
import { t } from '../i18n';
import { displayStatus } from '../i18n/domain/status';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Ban, CircleAlert, CircleCheck, GitFork, Plus, Radio, Search, X } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import { releaseProjection } from '../release';

const store = useAppStore();
const chat = useChatSessionsStore();
const projections = useProjectionRegistryStore();
const emit = defineEmits<{
  close: [];
  'session-opened': [];
}>();
const release = computed(() => releaseProjection(store.gatewayOpenApi));
const releaseTitle = computed(() => t('release.versions', {
  edge: release.value.edge,
  gateway: release.value.gateway,
}));
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
let resizeMove: ((event: PointerEvent) => void) | null = null;
let resizeEnd: (() => void) | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;

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

onMounted(() => {
  const stored = typeof localStorage !== 'undefined' ? Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) : 0;
  applySidebarWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_SIDEBAR_WIDTH);
  statusTimer = setInterval(() => {
    if (store.authorizationState === 'ready') {
      void store.refreshSessionStatuses().catch(() => undefined);
    }
  }, 5000);
});

onBeforeUnmount(() => {
  if (resizeMove) window.removeEventListener('pointermove', resizeMove);
  if (resizeEnd) window.removeEventListener('pointerup', resizeEnd);
  if (statusTimer) clearInterval(statusTimer);
  if (typeof document !== 'undefined') document.body.classList.remove('resizing-session-sidebar');
});
</script>

<template>
  <aside class="session-sidebar">
    <button class="session-sidebar-resizer" type="button" :aria-label="t('session.sidebar.resize')" @pointerdown="startResize" />
    <header class="sidebar-head">
      <button class="icon-action mobile-session-close" type="button" :aria-label="t('common.close')" @click="emit('close')">
        <X :size="16" />
      </button>
      <button class="primary-action" type="button" @click="createSession">
        <Plus :size="16" />
        {{ t('template.components.sessionsidebar.5c881d23b5') }}
      </button>
      <label class="search-field">
        <Search :size="15" />
        <input v-model="store.sessionQuery" type="search" :placeholder="t('component.session.sidebar.placeholder.e7ed08a804')" @input="searchSessions" />
      </label>
    </header>

    <div class="session-list" :aria-label="t('component.session.sidebar.aria-label.d05d37d8a1')" @scroll="onScroll">
      <section v-for="group in store.groupedSessions" :key="group.label" class="session-group">
        <header>{{ group.label }}</header>
        <div
          v-for="session in group.items"
          :key="session.id"
          class="session-row"
          :class="{ active: session.id === store.activeSessionId }"
        >
          <button class="session-open" type="button" @click="openSession(session.id)">
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
          <span class="session-actions">
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

    <footer class="sidebar-foot" :data-version-mismatch="release.mismatch" :title="releaseTitle">
      <span>{{ t('component.session.sidebar.text.85eb9812ae') }}</span>
      <strong>{{ release.label }}</strong>
      <small v-if="release.mismatch">{{ t('release.mismatch') }}</small>
    </footer>
  </aside>
</template>
