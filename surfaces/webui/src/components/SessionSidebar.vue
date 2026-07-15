<script setup lang="ts">
import { t } from '../i18n';
import { displayStatus } from '../i18n/domain/status';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Plus, Radio, Search } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';

const store = useAppStore();
const chat = useChatSessionsStore();
const SIDEBAR_WIDTH_KEY = 'cowd.webui.sessionSidebarWidth';
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 280;
const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);
let resizeMove: ((event: PointerEvent) => void) | null = null;
let resizeEnd: (() => void) | null = null;

async function searchSessions() {
  await store.refreshSessions();
}

async function openSession(sessionId: string) {
  // Capture the session identity at the click boundary.  The chat manager
  // owns all delayed stream/receipt writes for this ID; the global store only
  // provides shell-level selection and attachments.
  await store.loadMessages(sessionId);
}

async function createSession() {
  await store.createSession();
  if (store.activeSessionId) await chat.open(store.activeSessionId);
}

function sessionLiveStatus(sessionId: string) {
  return String(chat.states[sessionId]?.projection?.live?.status || chat.states[sessionId]?.live?.status || '');
}

function isSessionRunning(session: any) {
  return chat.states[session.id]?.pending
    || ['queued', 'preparing_context', 'calling_model', 'thinking', 'calling_tool', 'waiting_approval', 'finalizing'].includes(sessionLiveStatus(session.id))
    || store.isSessionRunning(session);
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
});

onBeforeUnmount(() => {
  if (resizeMove) window.removeEventListener('pointermove', resizeMove);
  if (resizeEnd) window.removeEventListener('pointerup', resizeEnd);
  if (typeof document !== 'undefined') document.body.classList.remove('resizing-session-sidebar');
});
</script>

<template>
  <aside class="session-sidebar">
    <button class="session-sidebar-resizer" type="button" :aria-label="t('session.sidebar.resize')" @pointerdown="startResize" />
    <header class="sidebar-head">
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
        <button
          v-for="session in group.items"
          :key="session.id"
          class="session-row"
          :class="{ active: session.id === store.activeSessionId }"
          type="button"
          @click="openSession(session.id)"
        >
          <span class="session-row-top">
            <span class="session-title">
              <Radio v-if="isSessionRunning(session)" :size="11" />
              <i v-else-if="store.isSessionUnread(session)" class="session-unread-dot"></i>
              {{ store.sessionTitle(session) }}
            </span>
            <time class="session-row-time">{{ store.compactTime(session) }}</time>
          </span>
          <span v-if="store.isSessionPinned(session) || isSessionRunning(session) || store.isSessionUnread(session) || session.parent_session_id || session.branch_count" class="session-state-line">
            <small v-if="store.isSessionPinned(session)">{{ t('session.badge.pinned') }}</small>
            <small v-if="isSessionRunning(session)">{{ displayStatus(sessionLiveStatus(session.id) || 'running') }}</small>
            <small v-else-if="store.isSessionUnread(session)">{{ t('session.badge.unread') }}</small>
            <small v-if="session.parent_session_id || session.branch_count">{{ t('session.badge.branch') }}</small>
          </span>
        </button>
      </section>
      <button v-if="store.sessionRenderHasMore || store.sessionHasMore" class="ghost-action session-load-more" type="button" :disabled="store.sessionLoadingMore" @click="store.sessionRenderHasMore ? store.revealMoreSessions() : store.loadMoreSessions()">
        {{ store.sessionLoadingMore ? t('status.loading') : (store.sessionRenderHasMore ? t('session.renderMore') : t('session.loadMore')) }}
      </button>
    </div>

    <footer class="sidebar-foot">
      <span>{{ t('component.session.sidebar.text.85eb9812ae') }}</span>
      <strong>{{ store.settings?.version || '0.9.212' }}</strong>
    </footer>
  </aside>
</template>
