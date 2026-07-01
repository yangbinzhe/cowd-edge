<script setup lang="ts">
import { t } from '../i18n';
import { Archive, Plus, RefreshCw, Search, Trash2 } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { displayStatus } from '../i18n/domain/status';

const store = useAppStore();

async function searchSessions() {
  await store.refreshSessions();
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
        <input v-model="store.sessionQuery" type="search" :placeholder="t('component.session.sidebar.placeholder.e7ed08a804')" @keydown.enter.prevent="searchSessions" />
      </label>
      <button class="ghost-action" type="button" @click="searchSessions">
        <RefreshCw :size="15" />
        {{ t('template.components.sessionsidebar.56e3badc4e') }}
      </button>
    </header>

    <div class="session-list" :aria-label="t('component.session.sidebar.aria-label.d05d37d8a1')">
      <article
        v-for="session in store.filteredSessions"
        :key="session.id"
        class="session-row"
        :class="{ active: session.id === store.activeSessionId }"
      >
        <button type="button" class="session-open" @click="store.loadMessages(session.id)">
          <span class="session-title">{{ session.title }}</span>
          <span class="session-meta">{{ session.model || t('component.session.sidebar.inline.6fc3b1f59f') }} · {{ displayStatus(session.status || 'unknown') }}</span>
        </button>
        <span class="session-actions">
          <button class="icon-action" type="button" :title="t('component.session.sidebar.title.38b7208b6a')" @click="store.compactSession(session.id)"><Archive :size="13" /></button>
          <button class="icon-action danger" type="button" :title="t('component.session.sidebar.title.2d9ee31bda')" @click="store.deleteSession(session.id)"><Trash2 :size="13" /></button>
        </span>
      </article>
    </div>

    <footer class="sidebar-foot">
      <span>{{ t('component.session.sidebar.text.85eb9812ae') }}</span>
      <strong>{{ store.settings?.version || '0.9.212' }}</strong>
    </footer>
  </aside>
</template>
