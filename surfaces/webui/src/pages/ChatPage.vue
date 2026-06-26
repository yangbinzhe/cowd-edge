<script setup lang="ts">
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
  { label: 'Session', value: store.activeSessionId || 'new session' },
  { label: 'Model', value: modelLabel.value },
  { label: 'Profile', value: store.selectedProfile || 'default' },
  { label: 'Context', value: contextUsage.value === null ? store.contextUsageSource : `${contextUsage.value}%`, tone: contextUsage.value && contextUsage.value > 85 ? 'warn' : 'success' },
  { label: 'Tools', value: String(store.toolCallCount) },
  { label: 'Memory', value: `${store.memoryRecallCount}/${store.memoryEvidenceCount}` },
]);
const cleanCounters = computed(() => [
  { label: '工具调用', value: store.toolCallCount },
  { label: '记忆唤起', value: store.memoryRecallCount },
  { label: '记忆证据', value: store.memoryEvidenceCount },
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
        <h1>Cowd Chat</h1>
        <p>{{ isPanorama ? '全景展示正文、工具、上下文、Reality 证据和运行轨迹。' : '纯净展示只保留正文和必要计数，减少额外投影刷新。' }}</p>
      </div>
      <div class="chat-top-actions">
        <div class="mode-switch" role="group" aria-label="Chat display mode">
          <button type="button" :class="{ active: isPanorama }" @click="store.setChatDisplayMode('panorama')">全景</button>
          <button type="button" :class="{ active: !isPanorama }" @click="store.setChatDisplayMode('clean')">纯净</button>
        </div>
        <div class="status-strip">
          <span>{{ store.health?.status || 'local' }}</span>
          <button type="button" @click="store.openModal('model')">{{ modelLabel }}</button>
        </div>
      </div>
    </header>
    <PrimaryContextBar v-if="isPanorama" :items="chatContext" />
    <div v-else class="clean-counts" aria-label="Clean mode counters">
      <span v-for="item in cleanCounters" :key="item.label"><strong>{{ item.value }}</strong>{{ item.label }}</span>
    </div>
    <nav v-if="isPanorama" class="chat-workbench-links" aria-label="Chat workbench links">
      <RouterLink class="ghost-action" to="/runtime">Inspect runtime</RouterLink>
      <RouterLink class="ghost-action" to="/context">Build context</RouterLink>
      <RouterLink class="ghost-action" to="/reality">Reality flow</RouterLink>
      <RouterLink class="ghost-action" to="/tools">Review tools</RouterLink>
      <RouterLink class="ghost-action" to="/audit">Open audit</RouterLink>
    </nav>
    <section v-if="isPanorama" class="run-panorama" aria-label="Current run panorama">
      <div class="run-card primary">
        <span>Run status</span>
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
        <button class="ghost-action" type="button" @click="store.openCompanion('evidence')"><Brain :size="15" /> Evidence</button>
        <button class="ghost-action" type="button" @click="store.openCompanion('workspace')"><FileText :size="15" /> Files {{ store.currentRunFiles.length }}</button>
        <button class="ghost-action" type="button" @click="store.retryLastUserTurn"><RotateCcw :size="15" /> Retry</button>
        <button class="danger-action" type="button" @click="stop"><Square :size="15" /> Stop</button>
      </div>
    </section>

    <div class="transcript" aria-label="Chat transcript">
      <article v-for="turn in store.turns" :key="turn.id" class="turn" :data-role="turn.role">
        <div v-if="isPanorama" class="message-meta">
          <span>{{ turn.status || 'complete' }}</span>
          <span v-if="turn.sequence">#{{ turn.sequence }}</span>
          <span v-if="turn.tool_name">{{ turn.tool_name }}</span>
          <button type="button" @click="inspectTurn(turn)">Evidence</button>
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
      <textarea v-model="draft" placeholder="Ask Cowd, reference files, or type / for commands" @keydown.enter.exact.prevent="submit" />
      <div class="composer-bar">
        <div class="composer-context">
          <button type="button" class="composer-chip" @click="store.openModal('workspace')"><Folder :size="14" /> {{ store.workspaceDir || 'root' }}</button>
          <button type="button" class="composer-chip" @click="store.openModal('model')"><Bot :size="14" /> {{ store.selectedProfile }}</button>
          <button v-if="store.attachments.length" type="button" class="composer-chip" @click="store.openCompanion('workspace')"><Paperclip :size="14" /> {{ store.attachments.length }} sources</button>
          <span>Context {{ contextUsage === null ? store.contextUsageSource : `${contextUsage}%` }}</span>
          <div class="context-meter"><i :style="{ width: `${contextUsage || 0}%` }" /></div>
        </div>
        <div class="composer-actions">
          <button class="icon-action" type="button" @click="store.openCompanion('workspace')"><Paperclip :size="16" /></button>
          <button class="ghost-action" type="button" @click="store.openModal('commands')"><Zap :size="15" /> Commands</button>
          <button v-if="sending" class="primary-action" type="button" @click="stop"><Square :size="15" /> Stop</button>
          <button v-else class="primary-action" type="button" :disabled="!draft.trim()" @click="submit"><Send :size="15" /> Send</button>
        </div>
      </div>
    </footer>

    <div v-if="store.activeModal" class="modal-scrim" @click.self="store.closeModal">
      <section v-if="store.activeModal === 'model'" class="command-modal">
        <header>
          <h2>Model and profile</h2>
          <button type="button" @click="store.closeModal">Close</button>
        </header>
        <div class="modal-columns">
          <div>
            <h3>Model</h3>
            <p v-if="!store.availableModels.length" class="modal-note">后端未报告可切换模型。请检查 runtime provider 配置。</p>
            <button v-for="model in store.availableModels" :key="model" class="choice-row" :class="{ active: store.selectedModel === model }" type="button" @click="store.chooseModel(model)">
              {{ model }}
            </button>
          </div>
          <div>
            <h3>Profile</h3>
            <p v-if="!store.availableProfiles.length" class="modal-note">后端未报告 profile。</p>
            <button v-for="profile in store.availableProfiles" :key="profile" class="choice-row" :class="{ active: store.selectedProfile === profile }" type="button" @click="store.chooseProfile(profile)">
              {{ profile }}
            </button>
          </div>
        </div>
        <p v-if="store.commandError" class="file-error">{{ store.commandError }}</p>
      </section>

      <section v-else-if="store.activeModal === 'workspace'" class="command-modal">
        <header>
          <h2>Workspace picker</h2>
          <button type="button" @click="store.closeModal">Close</button>
        </header>
        <button class="choice-row active" type="button" @click="store.openCompanion('workspace'); store.closeModal()">
          <Folder :size="15" />
          {{ store.workspaceRoot || 'Current workspace' }}
        </button>
        <p class="modal-note">Workspace details, file preview, and editing are available in the right Workspace tab.</p>
      </section>

      <section v-else class="command-modal">
        <header>
          <h2>Commands</h2>
          <button type="button" @click="store.closeModal">Close</button>
        </header>
        <p v-if="!store.commands.length" class="modal-note">后端未报告 command registry。</p>
        <button v-for="command in store.commands" :key="command.name" class="command-row" type="button" @click="chooseCommand(command)">
          <Boxes :size="15" />
          <span><strong>{{ command.name }}</strong><small>{{ command.description || command.detail }}</small></span>
        </button>
      </section>
    </div>
  </section>
</template>
