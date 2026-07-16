<script setup lang="ts">
import { formatCount, t } from '../i18n';
import { computed, nextTick, ref, watch } from 'vue';
import { Bot, Boxes, Brain, ChevronDown, CircleDot, Folder, Hash, Paperclip, Search, Send, Square, Wrench, X, Zap } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import MarkdownBlock from '../components/MarkdownBlock.vue';
import { useEscapeKey } from '../composables/useEscapeKey';
import { displayStatus } from '../i18n/domain/status';

const store = useAppStore();
const chat = useChatSessionsStore();
const projections = useProjectionRegistryStore();
const draft = ref('');
const sending = ref(false);
const commandQuery = ref('');
const inlineCommandIndex = ref(0);
const activeProjection = computed(() => chat.active?.executionId ? projections.projectionFor(chat.active.executionId) : null);
const live = computed(() => activeProjection.value?.live || chat.active?.live || null);
const contextUsage = computed(() => {
  const value = Number(live.value?.context_usage?.usage_percent_bp);
  return Number.isFinite(value) ? value / 100 : null;
});
const contextLabel = computed(() => {
  const usage = live.value?.context_usage;
  return usage?.window_tokens ? `${Number(usage.input_tokens || 0).toLocaleString()} / ${Number(usage.window_tokens).toLocaleString()}` : '—';
});
const executionStatus = computed(() => String(live.value?.status || (chat.active?.pending ? 'queued' : 'idle')));
const gatewayStatus = computed(() => store.health?.health?.status || store.health?.status || 'unknown');
const modelLabel = computed(() => store.selectedModel || 'Select model');
const isPanorama = computed(() => store.chatDisplayMode === 'panorama');
const turnRunning = computed(() => !!chat.active?.pending || ['queued', 'preparing_context', 'calling_model', 'thinking', 'calling_tool', 'waiting_approval', 'finalizing'].includes(executionStatus.value));
const composerStats = computed(() => [
  { label: t('page.chat.cleanCounters.tools'), value: Number(live.value?.metrics?.tool_calls || 0) },
  { label: t('page.chat.cleanCounters.memoryRecall'), value: Number(live.value?.metrics?.memory_recalls || 0) },
  { label: t('page.chat.cleanCounters.memoryEvidence'), value: Number(live.value?.metrics?.memory_evidence || 0) },
]);
const filteredCommands = computed(() => {
  const query = commandQuery.value.trim().toLowerCase().replace(/^\//, '');
  if (!query) return store.commands;
  return store.commands.filter((command: any) => `${command.name || ''} ${command.description || ''} ${command.detail || ''}`.toLowerCase().includes(query));
});
const activeSlash = computed(() => activeSlashCommand(draft.value));
const inlineCommandOptions = computed(() => {
  const query = activeSlash.value?.query.trim().toLowerCase().replace(/^\//, '') || '';
  const rows = query
    ? store.commands.filter((command: any) => `${command.name || ''} ${command.description || ''} ${command.detail || ''} ${command.args || ''}`.toLowerCase().includes(query))
    : store.commands;
  return rows.slice(0, 8);
});

useEscapeKey(() => store.closeModal(), () => !!store.activeModal);
watch(() => store.activeSessionId, (sessionId) => { if (sessionId) chat.open(sessionId).catch(() => undefined); }, { immediate: true });

watch(() => activeSlash.value?.query, () => {
  inlineCommandIndex.value = 0;
});

function commandName(command: any) {
  const name = String(command?.name || command || '').trim();
  return name.startsWith('/') ? name : `/${name}`;
}

function activeSlashCommand(value: string) {
  const text = String(value || '');
  const caret = text.length;
  const before = text.slice(0, caret);
  const match = before.match(/(^|\s)\/([^\s/]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[1].length;
  return {
    start,
    end: caret,
    query: match[2] || '',
  };
}

function commandDescription(command: any) {
  return command.description || command.detail || command.args || t('chat.commands.noDescription');
}

function commandSource(command: any) {
  return command.source || command.kind || command.group || t('chat.commands.source.gateway');
}

function replaceActiveSlash(name: string) {
  const active = activeSlash.value;
  if (!active) return;
  draft.value = `${draft.value.slice(0, active.start)}${name} ${draft.value.slice(active.end)}`;
}

async function selectInlineCommand(command: any) {
  const name = commandName(command);
  if (name === '/model') {
    replaceActiveSlash('');
    store.openModal('model');
    return;
  }
  if (name === '/workspace') {
    replaceActiveSlash('');
    store.openModal('workspace');
    return;
  }
  if (name === '/status') {
    replaceActiveSlash('');
    store.openCompanion('activity');
    return;
  }
  replaceActiveSlash(name);
  await nextTick();
}

async function handleComposerKeydown(event: KeyboardEvent) {
  const hasInline = !!activeSlash.value && inlineCommandOptions.value.length > 0;
  if (hasInline) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      inlineCommandIndex.value = (inlineCommandIndex.value + 1) % inlineCommandOptions.value.length;
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      inlineCommandIndex.value = (inlineCommandIndex.value - 1 + inlineCommandOptions.value.length) % inlineCommandOptions.value.length;
      return;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      await selectInlineCommand(inlineCommandOptions.value[inlineCommandIndex.value] || inlineCommandOptions.value[0]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      replaceActiveSlash('');
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    await submit();
  }
}

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
  try {
    if (store.activeSessionId) {
      const input = store.composeChatInput(text);
      const accepted = await chat.send(store.activeSessionId, text, input);
      if (accepted) store.clearSubmittedResourceAttachments(input.resourceIds);
    }
  } finally {
    sending.value = false;
    await nextTick();
  }
}

async function stop() {
  try {
    if (store.activeSessionId) await chat.stop(store.activeSessionId);
  } finally {
    sending.value = false;
  }
}

function turnActivityParts(turn: any) {
  const summary = store.turnActivitySummary(turn);
  return [
    { key: 'tool', icon: Wrench, value: summary.tools, label: t('chat.turnActivity.tools') },
    { key: 'thinking', icon: Brain, value: summary.thinking, label: t('chat.turnActivity.thinking') },
    { key: 'context', icon: CircleDot, value: summary.context, label: t('chat.turnActivity.context') },
    { key: 'approval', icon: Hash, value: summary.approvals, label: t('chat.turnActivity.approvals') },
  ].filter((item) => item.value > 0);
}

function numberFrom(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function usageNumber(usage: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = numberFrom(usage[key]);
    if (direct) return direct;
  }
  return 0;
}

function turnUsageParts(turn: any) {
  const usage = turn?.token_usage && typeof turn.token_usage === 'object' ? turn.token_usage as Record<string, unknown> : {};
  const input = usageNumber(usage, ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens']);
  const output = usageNumber(usage, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens']);
  const total = usageNumber(usage, ['total_tokens', 'totalTokens', 'total']) || input + output;
  return [
    { key: 'input', label: t('chat.turnUsage.input'), value: input },
    { key: 'output', label: t('chat.turnUsage.output'), value: output },
    { key: 'total', label: t('chat.turnUsage.total'), value: total },
  ].filter((item) => item.value > 0);
}

async function chooseCommand(command: any) {
  const name = commandName(command);
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
  commandQuery.value = '';
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
        <div class="session-evidence-head" :title="`${chat.active?.evidence?.evidence_refs?.length || 0} evidence refs`">
          {{ chat.active?.evidence?.evidence_refs?.length || 0 }} {{ t('page.chat.page.text.848af509ba') }}
        </div>
        <div class="mode-switch" role="group" :aria-label="t('page.chat.page.aria-label.67bb66bc9a')">
          <button type="button" :class="{ active: isPanorama }" @click="store.setChatDisplayMode('panorama')">{{ t('page.chat.page.text.a94b1a4460') }}</button>
          <button type="button" :class="{ active: !isPanorama }" @click="store.setChatDisplayMode('clean')">{{ t('page.chat.page.text.864a2f44ef') }}</button>
        </div>
        <div class="status-strip">
          <span>{{ displayStatus(gatewayStatus) }}</span>
          <button type="button" @click="store.openModal('model')">{{ store.selectedProfile || 'default' }}</button>
        </div>
      </div>
    </header>
    <nav v-if="isPanorama" class="chat-workbench-links" :aria-label="t('page.chat.page.aria-label.d1fb2b96b2')">
      <RouterLink class="ghost-action" to="/runtime">{{ t('page.chat.page.text.6c7ae3cbf8') }}</RouterLink>
      <RouterLink class="ghost-action" to="/context">{{ t('page.chat.page.text.3b537364be') }}</RouterLink>
      <RouterLink class="ghost-action" to="/reality">{{ t('page.chat.page.text.4a51e673c3') }}</RouterLink>
      <RouterLink class="ghost-action" to="/tools">{{ t('page.chat.page.text.41354fa167') }}</RouterLink>
      <RouterLink class="ghost-action" to="/audit">{{ t('page.chat.page.text.e0cabf393b') }}</RouterLink>
    </nav>

    <div class="transcript" :aria-label="t('page.chat.page.aria-label.e683294716')">
      <article v-for="turn in chat.active?.turns || []" :key="turn.id" class="turn" :data-role="turn.role">
        <div v-if="isPanorama" class="message-meta">
          <span v-if="turn.sequence" class="meta-sequence">#{{ turn.sequence }}</span>
          <span><CircleDot :size="12" />{{ displayStatus(turn.status || 'unknown') }}</span>
          <span v-if="turn.tool_name"><Wrench :size="12" />{{ turn.tool_name }}</span>
        </div>
        <MarkdownBlock :content="turn.content" />
        <p v-if="turn.id === `stream:${chat.active?.sessionId}` && turnRunning" class="turn-run-state" role="status">
          {{ displayStatus(executionStatus) }} · {{ live?.status_detail || t('status.loading') }}
        </p>
        <section
          v-if="isPanorama && turn.role === 'assistant' && store.turnActivitySummary(turn).total"
          class="turn-activity"
          :data-open="store.isTurnActivityOpen(turn.id)"
        >
          <button class="turn-activity-summary" type="button" @click="store.toggleTurnActivity(turn.id)">
            <ChevronDown :size="14" />
            <span>{{ t('chat.turnActivity.title') }}</span>
            <small v-for="item in turnActivityParts(turn)" :key="item.key">
              <component :is="item.icon" :size="12" />
              {{ item.value }} {{ item.label }}
            </small>
          </button>
          <div v-if="store.isTurnActivityOpen(turn.id)" class="turn-activity-list">
            <article v-for="event in turn.activity" :key="event.id" class="turn-activity-item" :data-kind="event.kind">
              <strong>{{ event.title }}</strong>
              <span>{{ displayStatus(event.status || 'observed') }}</span>
              <p v-if="event.detail">{{ event.detail }}</p>
            </article>
          </div>
        </section>
        <section v-if="isPanorama && turnUsageParts(turn).length" class="turn-usage" :data-role="turn.role">
          <small v-for="item in turnUsageParts(turn)" :key="item.key">{{ item.label }} {{ item.value.toLocaleString() }}</small>
        </section>
      </article>
    </div>

    <footer class="composer">
      <textarea v-model="draft" :placeholder="t('page.chat.page.placeholder.3e0e768fa8')" @keydown="handleComposerKeydown" />
      <div v-if="activeSlash && inlineCommandOptions.length" class="composer-command-popover">
        <div class="command-inline-head">
          <strong>{{ t('chat.commands.inline.title') }}</strong>
          <span>{{ t('chat.commands.inline.hint') }}</span>
        </div>
        <button
          v-for="(command, index) in inlineCommandOptions"
          :key="command.name || index"
          class="command-inline-row"
          :class="{ active: inlineCommandIndex === index }"
          type="button"
          @mousedown.prevent="selectInlineCommand(command)"
        >
          <Boxes :size="15" />
          <span><strong>{{ commandName(command) }}</strong><small>{{ commandDescription(command) }}</small></span>
          <em>{{ commandSource(command) }}</em>
        </button>
      </div>
      <div class="composer-bar">
        <div class="composer-context">
          <span class="composer-context-usage">
            <span class="context-ring" :style="{ '--context-progress': `${contextUsage ?? 0}%` }" :aria-label="`Context ${contextLabel}`"><i>{{ contextUsage === null ? '—' : Math.round(contextUsage) + '%' }}</i></span>
            <span>{{ t('page.chat.context.usage', { value: contextLabel }) }}</span>
          </span>
          <span class="composer-stats">
            <small v-for="item in composerStats" :key="item.label"><strong>{{ item.value }}</strong>{{ item.label }}</small>
          </span>
          <span class="run-status" :data-status="executionStatus" role="status" aria-live="polite" :title="chat.active?.degradedReason || ''">{{ displayStatus(executionStatus) }} · {{ live?.status_detail || chat.active?.degradedReason || chat.active?.streamState }}</span>
          <button type="button" class="composer-chip" @click="store.openModal('workspace')"><Folder :size="14" /> {{ store.workspaceDir || t('page.chat.page.inline.59c92a9169') }}</button>
          <button type="button" class="composer-chip" @click="store.openModal('model')"><Bot :size="14" /> {{ modelLabel }}</button>
          <button v-if="store.attachments.length" type="button" class="composer-chip" @click="store.openCompanion('workspace')"><Paperclip :size="14" /> {{ formatCount('sources', store.attachments.length) }}</button>
        </div>
        <div class="composer-actions">
          <button class="icon-action" type="button" :aria-label="t('component.companion.panel.text.727690de87')" @click="store.openCompanion('workspace')"><Paperclip :size="16" /></button>
          <button class="ghost-action" type="button" @click="store.openModal('commands')"><Zap :size="15" />{{ t('page.chat.page.text.01bed7d85c') }}</button>
          <button v-if="turnRunning" class="icon-action" type="button" :aria-label="t('page.chat.page.text.2090c0732a')" @click="stop"><Square :size="15" /></button>
          <button class="primary-action" type="button" :disabled="!draft.trim() || sending" @click="submit"><Send :size="15" />{{ t('page.chat.page.text.aeee9b2149') }}</button>
        </div>
      </div>
    </footer>

    <div v-if="store.activeModal" class="modal-scrim" @click.self="store.closeModal">
      <section v-if="store.activeModal === 'model'" class="command-modal">
        <header>
          <h2>{{ t('page.chat.page.text.371e4b7b8d') }}</h2>
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="store.closeModal"><X :size="16" /></button>
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
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="store.closeModal"><X :size="16" /></button>
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
          <button class="modal-close icon-action" type="button" :aria-label="t('common.close')" @click="store.closeModal"><X :size="16" /></button>
        </header>
        <label class="search-field command-search">
          <Search :size="15" />
          <input v-model="commandQuery" type="search" :placeholder="t('chat.commands.search')" />
        </label>
        <p v-if="!store.commands.length" class="modal-note">{{ t('page.chat.page.text.0a237ff19e') }}</p>
        <button v-for="command in filteredCommands" :key="command.name" class="command-row" type="button" @click="chooseCommand(command)">
          <Boxes :size="15" />
          <span><strong>{{ commandName(command) }}</strong><small>{{ commandDescription(command) }}</small></span>
        </button>
      </section>
    </div>
  </section>
</template>
