<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, nextTick, ref } from 'vue';
import { Bot, Boxes, Brain, CircleDot, FileText, Folder, Paperclip, RotateCcw, Send, Square, Zap } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import MarkdownBlock from '../components/MarkdownBlock.vue';
import PrimaryContextBar from '../components/layout/PrimaryContextBar.vue';
import TurnEvidenceDrawer from '../components/workbench/TurnEvidenceDrawer.vue';

const store = useAppStore();
const draft = ref('');
const sending = ref(false);
const contextUsage = computed(() => store.contextUsagePercent);
const modelLabel = computed(() => store.selectedModel || 'Select model');
const isPanorama = computed(() => store.chatDisplayMode === 'panorama');
const chatContext = computed(() => [
  { label: t('script.pages.chatpage.label.f7f1997c6c'), value: store.activeSessionId || 'new session' },
  { label: t('script.pages.chatpage.label.68c2cc7f0c'), value: modelLabel.value },
  { label: t('script.pages.chatpage.label.ff4fc0276e'), value: store.selectedProfile || 'default' },
  { label: t('script.pages.chatpage.label.cc11b3a28f'), value: contextUsage.value === null ? store.contextUsageSource : `${contextUsage.value}%`, tone: contextUsage.value && contextUsage.value > 85 ? 'warn' : 'success' },
  { label: t('script.pages.chatpage.label.4fa8cc860c'), value: String(store.toolCallCount) },
  { label: t('script.pages.chatpage.label.89c8a2851d'), value: `${store.memoryRecallCount}/${store.memoryEvidenceCount}` },
]);
const cleanCounters = computed(() => [
  { label: t('page.chat.cleanCounters.tools'), value: store.toolCallCount },
  { label: t('page.chat.cleanCounters.memoryRecall'), value: store.memoryRecallCount },
  { label: t('page.chat.cleanCounters.memoryEvidence'), value: store.memoryEvidenceCount },
]);
const runStatus = computed(() => store.currentRun?.status || 'idle');
const runIdentity = computed(() => store.currentRun?.run_id || store.currentRun?.turn_id || store.activeSessionId || 'no active run');
const visibleStages = computed(() => store.runStageSummary.filter((stage: any) => stage.status !== 'missing' || isPanorama.value));

async function submit() {
  const text = draft.value.trim();
  if (!text || sending.value) return;
  if (text === '/model') {
    store.openModal('model');
    draft.value = '';
    return;
  }
  if (text === '/workspace') {
    store.openModal('workspace');
    draft.value = '';
    return;
  }
  if (text === '/status') {
    store.openCompanion('activity');
    draft.value = '';
    return;
  }
  sending.value = true;
  draft.value = '';
  await store.send(text);
  sending.value = false;
  await nextTick();
}

async function stop() {
  await store.stopCurrentTurn();
  sending.value = false;
}

async function inspectTurn(turn: any) {
  await store.loadTurnEvidence(turn);
}

async function chooseCommand(command: any) {
  const name = command.name || command;
  if (name === '/model') {
    store.closeModal();
    store.openModal('model');
    return;
  }
  if (name === '/workspace') {
    store.closeModal();
    store.openModal('workspace');
    return;
  }
  await store.executeCommand(name, { session_id: store.activeSessionId });
  draft.value = `${name} `;
  store.closeModal();
}
</script>

<template>
  <section class="chat-page">
    <header class="page-header chat-topbar">
      <div>
        <h1>{{ t('page.chat.page.text.177c6b9656') }}</h1>
        <p>{{ isPanorama ? t('page.chat.page.inline.bfa241e27c') : t('page.chat.page.inline.276b6d067f') }}</p>
      </div>
      <div class="chat-top-actions">
        <div class="mode-switch" role="group" :aria-label="t('page.chat.page.aria-label.67bb66bc9a')">
          <button type="button" :class="{ active: isPanorama }" @click="store.setChatDisplayMode('panorama')">{{ t('page.chat.page.text.a94b1a4460') }}</button>
          <button type="button" :class="{ active: !isPanorama }" @click="store.setChatDisplayMode('clean')">{{ t('page.chat.page.text.864a2f44ef') }}</button>
        </div>
        <div class="status-strip">
          <span>{{ store.health?.status || t('page.chat.page.inline.b82c49c3b2') }}</span>
          <button type="button" @click="store.openModal('model')">{{ modelLabel }}</button>
        </div>
      </div>
    </header>
    <PrimaryContextBar v-if="isPanorama" :items="chatContext" />
    <div v-else class="clean-counts" :aria-label="t('page.chat.page.aria-label.91fba48319')">
      <span v-for="item in cleanCounters" :key="item.label"><strong>{{ item.value }}</strong>{{ item.label }}</span>
    </div>
    <nav v-if="isPanorama" class="chat-workbench-links" :aria-label="t('page.chat.page.aria-label.d1fb2b96b2')">
      <RouterLink class="ghost-action" to="/runtime">{{ t('page.chat.page.text.6c7ae3cbf8') }}</RouterLink>
      <RouterLink class="ghost-action" to="/context">{{ t('page.chat.page.text.3b537364be') }}</RouterLink>
      <RouterLink class="ghost-action" to="/reality">{{ t('page.chat.page.text.4a51e673c3') }}</RouterLink>
      <RouterLink class="ghost-action" to="/tools">{{ t('page.chat.page.text.41354fa167') }}</RouterLink>
      <RouterLink class="ghost-action" to="/audit">{{ t('page.chat.page.text.e0cabf393b') }}</RouterLink>
    </nav>
    <section v-if="isPanorama" class="run-panorama" :aria-label="t('page.chat.page.aria-label.62b09f4b3d')">
      <div class="run-card primary">
        <span>{{ t('page.chat.page.text.ae6ca51251') }}</span>
        <strong>{{ runStatus }}</strong>
        <small>{{ runIdentity }}</small>
      </div>
      <div class="run-stage-grid">
        <button
          v-for="stage in visibleStages"
          :key="stage.id"
          class="stage-pill"
          type="button"
          :data-status="stage.status"
          @click="stage.id === 'context' ? store.openCompanion('evidence') : store.openCompanion('activity')"
        >
          <CircleDot :size="13" />
          <span>{{ stage.label }}</span>
          <strong>{{ stage.count }}</strong>
        </button>
      </div>
      <div class="run-actions">
        <button class="ghost-action" type="button" @click="store.openCompanion('evidence')"><Brain :size="15" />{{ t('page.chat.page.text.848af509ba') }}</button>
        <button class="ghost-action" type="button" @click="store.openCompanion('workspace')"><FileText :size="15" /> Files {{ store.currentRunFiles.length }}</button>
        <button class="ghost-action" type="button" @click="store.retryLastUserTurn"><RotateCcw :size="15" />{{ t('page.chat.page.text.5699b59e33') }}</button>
        <button class="danger-action" type="button" @click="stop"><Square :size="15" />{{ t('page.chat.page.text.2090c0732a') }}</button>
      </div>
    </section>

    <div class="transcript" :aria-label="t('page.chat.page.aria-label.e683294716')">
      <article v-for="turn in store.turns" :key="turn.id" class="turn" :data-role="turn.role">
        <div v-if="isPanorama" class="message-meta">
          <span>{{ turn.status || t('page.chat.page.inline.86e76c9ec6') }}</span>
          <span v-if="turn.sequence">#{{ turn.sequence }}</span>
          <span v-if="turn.tool_name">{{ turn.tool_name }}</span>
          <button type="button" @click="inspectTurn(turn)">{{ t('page.chat.page.text.848af509ba') }}</button>
        </div>
        <MarkdownBlock :content="turn.content" />
      </article>
    </div>

    <TurnEvidenceDrawer
      v-if="isPanorama && store.selectedTurnEvidence"
      :evidence="store.selectedTurnEvidence"
      @close="store.clearTurnEvidence()"
    />

    <footer class="composer">
      <textarea v-model="draft" :placeholder="t('page.chat.page.placeholder.3e0e768fa8')" @keydown.enter.exact.prevent="submit" />
      <div class="composer-bar">
        <div class="composer-context">
          <button type="button" class="composer-chip" @click="store.openModal('workspace')"><Folder :size="14" /> {{ store.workspaceDir || t('page.chat.page.inline.59c92a9169') }}</button>
          <button type="button" class="composer-chip" @click="store.openModal('model')"><Bot :size="14" /> {{ store.selectedProfile }}</button>
          <button v-if="store.attachments.length" type="button" class="composer-chip" @click="store.openCompanion('workspace')"><Paperclip :size="14" /> {{ formatCount('sources', store.attachments.length) }}</button>
          <span>{{ t('page.chat.context.usage', { value: contextUsage === null ? store.contextUsageSource : `${contextUsage}%` }) }}</span>
          <div class="context-meter"><i :style="{ width: `${contextUsage || 0}%` }" /></div>
        </div>
        <div class="composer-actions">
          <button class="icon-action" type="button" @click="store.openCompanion('workspace')"><Paperclip :size="16" /></button>
          <button class="ghost-action" type="button" @click="store.openModal('commands')"><Zap :size="15" />{{ t('page.chat.page.text.01bed7d85c') }}</button>
          <button v-if="sending" class="primary-action" type="button" @click="stop"><Square :size="15" />{{ t('page.chat.page.text.2090c0732a') }}</button>
          <button v-else class="primary-action" type="button" :disabled="!draft.trim()" @click="submit"><Send :size="15" />{{ t('page.chat.page.text.aeee9b2149') }}</button>
        </div>
      </div>
    </footer>

    <div v-if="store.activeModal" class="modal-scrim" @click.self="store.closeModal">
      <section v-if="store.activeModal === 'model'" class="command-modal">
        <header>
          <h2>{{ t('page.chat.page.text.371e4b7b8d') }}</h2>
          <button type="button" @click="store.closeModal">{{ t('page.chat.page.text.a98aee1251') }}</button>
        </header>
        <div class="modal-columns">
          <div>
            <h3>{{ t('page.chat.page.text.3cd6d283c3') }}</h3>
            <p v-if="!store.availableModels.length" class="modal-note">{{ t('page.chat.page.text.1c06661208') }}</p>
            <button v-for="model in store.availableModels" :key="model" class="choice-row" :class="{ active: store.selectedModel === model }" type="button" @click="store.chooseModel(model)">
              {{ model }}
            </button>
          </div>
          <div>
            <h3>{{ t('page.chat.page.text.45db77b17b') }}</h3>
            <p v-if="!store.availableProfiles.length" class="modal-note">{{ t('page.chat.page.text.b2658db093') }}</p>
            <button v-for="profile in store.availableProfiles" :key="profile" class="choice-row" :class="{ active: store.selectedProfile === profile }" type="button" @click="store.chooseProfile(profile)">
              {{ profile }}
            </button>
          </div>
        </div>
        <p v-if="store.commandError" class="file-error">{{ store.commandError }}</p>
      </section>

      <section v-else-if="store.activeModal === 'workspace'" class="command-modal">
        <header>
          <h2>{{ t('page.chat.page.text.46144acb47') }}</h2>
          <button type="button" @click="store.closeModal">{{ t('page.chat.page.text.a98aee1251') }}</button>
        </header>
        <button class="choice-row active" type="button" @click="store.openCompanion('workspace'); store.closeModal()">
          <Folder :size="15" />
          {{ store.workspaceRoot || t('page.chat.page.inline.cc6aef43a0') }}
        </button>
        <p class="modal-note">{{ t('page.chat.page.text.92b37b0298') }}</p>
      </section>

      <section v-else class="command-modal">
        <header>
          <h2>{{ t('page.chat.page.text.01bed7d85c') }}</h2>
          <button type="button" @click="store.closeModal">{{ t('page.chat.page.text.a98aee1251') }}</button>
        </header>
        <p v-if="!store.commands.length" class="modal-note">{{ t('page.chat.page.text.0a237ff19e') }}</p>
        <button v-for="command in store.commands" :key="command.name" class="command-row" type="button" @click="chooseCommand(command)">
          <Boxes :size="15" />
          <span><strong>{{ command.name }}</strong><small>{{ command.description || command.detail }}</small></span>
        </button>
      </section>
    </div>
  </section>
</template>
