<script setup lang="ts">
import { t } from '../i18n';
import { Copy, GitBranch, Plus, Search, X } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';

const store = useAppStore();

async function searchSessions() {
  await store.refreshSessions();
}

async function copySession(sessionId: string) {
  await navigator.clipboard?.writeText(sessionId);
}

async function onScroll(event: Event) {
  const target = event.currentTarget as HTMLElement;
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 32) {
    await store.loadMoreSessions();
  }
}
</script>

<template>
  <aside class="session-sidebar">
    <header class="sidebar-head">
      <button class="primary-action" type="button" @click="store.createSession">
        <Plus :size="16" />
        {{ t('template.components.sessionsidebar.5c881d23b5') }}
      </button>
      <label class="search-field">
        <Search :size="15" />
        <input v-model="store.sessionQuery" type="search" :placeholder="t('component.session.sidebar.placeholder.e7ed08a804')" @input="searchSessions" />
      </label>
      <div v-if="store.selectedSessionIds.length" class="session-bulk-bar">
        <span>{{ t('session.bulk.selected', { count: store.selectedSessionIds.length }) }}</span>
        <button class="icon-action danger" type="button" :aria-label="t('session.bulk.delete')" @click="store.deleteSelectedSessions"><X :size="14" /></button>
        <button class="icon-action" type="button" :aria-label="t('session.bulk.clear')" @click="store.clearSessionSelection"><X :size="14" /></button>
      </div>
    </header>

    <div class="session-list" :aria-label="t('component.session.sidebar.aria-label.d05d37d8a1')" @scroll="onScroll">
      <section v-for="group in store.groupedSessions" :key="group.label" class="session-group">
        <header>{{ group.label }}</header>
        <article
          v-for="session in group.items"
          :key="session.id"
          class="session-row"
          :class="{ active: session.id === store.activeSessionId, selected: store.selectedSessionIds.includes(session.id) }"
        >
          <input
            type="checkbox"
            :checked="store.selectedSessionIds.includes(session.id)"
            :aria-label="t('session.select')"
            @change="store.toggleSessionSelected(session.id)"
          />
          <button type="button" class="session-open" @click="store.loadMessages(session.id)">
            <span class="session-title">{{ store.sessionTitle(session) }}</span>
            <span class="session-meta">{{ store.compactTime(session) }} · {{ store.sessionSnippet(session) || session.id }}</span>
          </button>
          <span class="session-actions">
            <button class="icon-action" type="button" :title="t('session.copyId')" @click="copySession(session.id)"><Copy :size="13" /></button>
            <button class="icon-action" type="button" :title="t('session.branch')" @click="store.branchSession(session.id)"><GitBranch :size="13" /></button>
            <button class="icon-action danger" type="button" :title="t('component.session.sidebar.title.2d9ee31bda')" @click="store.deleteSession(session.id)"><X :size="13" /></button>
          </span>
        </article>
      </section>
      <button v-if="store.sessionHasMore" class="ghost-action session-load-more" type="button" :disabled="store.sessionLoadingMore" @click="store.loadMoreSessions">
        {{ store.sessionLoadingMore ? t('status.loading') : t('session.loadMore') }}
      </button>
    </div>

    <footer class="sidebar-foot">
      <span>{{ t('component.session.sidebar.text.85eb9812ae') }}</span>
      <strong>{{ store.settings?.version || '0.9.212' }}</strong>
    </footer>
  </aside>
</template>
