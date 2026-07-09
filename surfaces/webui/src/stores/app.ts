import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, normalizeActivity, providerModels, type EndpointSnapshot } from '../api/client';
import { t } from '../i18n';
import type {
  ActivityEvent,
  ChatDisplayMode,
  ChatTurn,
  CompanionTab,
  GatewayCapabilityContract,
  GatewayOpenAiTools,
  NavId,
  RuntimeResourceUpload,
  SessionAttachment,
  SessionSummary,
  WorkspaceFile,
} from '../types';
import { cleanAssistantContent, collapseRepeatedText } from '../utils/chatContent';
import {
  createWorkspaceRoot,
  findWorkspaceTreeNode,
  joinWorkspacePath,
  markWorkspaceTreeLoading,
  mergeWorkspaceTreeChildren,
  parentPathOf,
  setWorkspaceTreeExpanded,
  type WorkspaceTreeNode,
} from '../utils/workspaceTree';
import { buildWorkspacePreviewHtml, isWorkspaceTextPreview, workspacePreviewKind, workspacePreviewMime } from '../utils/workspacePreview';
import { activitySummary, mergeTurnActivity, normalizeTurnActivity } from '../utils/turnSettlement';

const PINNED_SESSION_KEY = 'cowd.webui.sessions.pinned';
const VIEWED_SESSION_KEY = 'cowd.webui.sessions.viewedCounts';
const WORKSPACE_RECENT_KEY = 'cowd.webui.workspace.recentFiles';
const WORKSPACE_TEXT_PREVIEW_LIMIT_BYTES = 512 * 1024;

function readStoredArray(key: string) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function readStoredRecord(key: string) {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

function writeStored(key: string, value: unknown) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

function readStoredWorkspaceFiles() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_RECENT_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.path === 'string' && typeof item.name === 'string')
      .map((item) => ({
        name: item.name,
        path: item.path,
        kind: 'file' as const,
        size: typeof item.size === 'number' ? item.size : undefined,
        modified: typeof item.modified === 'string' ? item.modified : undefined,
      }))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function formatFileSize(size?: number) {
  const value = Number(size || 0);
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function blockText(block: any): string {
  if (!block) return '';
  if (typeof block === 'string') return block;
  return block.text || block.content || block.output || block.thinking || '';
}

function normalizeTurnContent(role: string, content: string) {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  if (String(role || '').toLowerCase() === 'user') return normalized;
  return cleanAssistantContent(collapseRepeatedText(normalized), (tool, outcome) => t(outcome === 'failed' ? 'chat.toolEvidence.failed' : 'chat.toolEvidence.inline', { tool }));
}

function cleanRuntimeSummary(content: string) {
  return cleanAssistantContent(String(content || ''), (tool, outcome) => t(outcome === 'failed' ? 'chat.toolEvidence.failed' : 'chat.toolEvidence.inline', { tool }));
}

function sanitizeActivityEvent(event: ActivityEvent): ActivityEvent {
  return {
    ...event,
    title: cleanRuntimeSummary(event.title),
    detail: cleanRuntimeSummary(event.detail),
  };
}

function comparableText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sameAssistantFinal(a: string, b: string) {
  const left = comparableText(a);
  const right = comparableText(b);
  return !!left && left === right;
}

function sameTurnContent(a: ChatTurn | null | undefined, b: ChatTurn) {
  if (!a || a.role !== b.role) return false;
  const left = comparableText(a.content);
  const right = comparableText(b.content);
  return !!left && left === right;
}

function contentDedupeKey(turn: ChatTurn) {
  const text = comparableText(turn.content).toLowerCase();
  return text ? `${turn.role}:${text}` : '';
}

function turnStableKey(turn: ChatTurn) {
  if (turn.id && !turn.id.startsWith('local-') && !turn.id.startsWith('assistant-stream-')) return `id:${turn.id}`;
  if (turn.sequence !== undefined && turn.sequence !== null) return `seq:${turn.role}:${turn.sequence}`;
  if (turn.tool_use_id) return `tool:${turn.role}:${turn.tool_use_id}`;
  return '';
}

function updatedAtMs(session: SessionSummary) {
  const value = session.updated_at || session.created_at || 0;
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionTitle(session: SessionSummary) {
  const title = String(session.title || '').trim();
  if (title && title !== session.id) return title;
  const snippet = String(session.snippet || session.first_message || session.summary || '').replace(/\s+/g, ' ').trim();
  if (snippet) return snippet.slice(0, 40);
  return session.id ? session.id.slice(0, 12) : 'session';
}

function sessionSnippet(session: SessionSummary) {
  return String(session.snippet || session.first_message || session.summary || '').replace(/\s+/g, ' ').trim();
}

function sessionGroupLabel(session: SessionSummary) {
  const ms = updatedAtMs(session);
  if (!ms) return t('session.group.earlier');
  const date = new Date(ms);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startOfToday - startOfDate) / 86_400_000);
  if (days <= 0) return t('session.group.today');
  if (days === 1) return t('session.group.yesterday');
  if (days < 7) return t('session.group.lastSevenDays');
  return t('session.group.earlier');
}

function compactTime(session: SessionSummary) {
  const ms = updatedAtMs(session);
  if (!ms) return '-';
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export const useAppStore = defineStore('app', () => {
  let sessionStream: EventSource | null = null;
  let sessionStreamId = '';
  let streamingAssistantId = '';
  let configReloadTimer: ReturnType<typeof setInterval> | null = null;
  const booted = ref(false);
  const health = ref<any>(null);
  const settings = ref<any>(null);
  const controlPlane = ref<any>(null);
  const providers = ref<any>(null);
  const configReloadStatus = ref<any>({});
  const profiles = ref<any[]>([]);
  const commands = ref<any[]>([]);
  const commandHistory = ref<any[]>([]);
  const approvalConfig = ref<any>(null);
  const sessions = ref<SessionSummary[]>([]);
  const activeSessionId = ref('');
  const turns = ref<ChatTurn[]>([]);
  const activity = ref<ActivityEvent[]>([]);
  const companionTab = ref<CompanionTab>('activity');
  const chatDisplayMode = ref<ChatDisplayMode>('panorama');
  const currentRun = ref<any>(null);
  const currentContextEnvelope = ref<any>(null);
  const currentRealityFlow = ref<any>({});
  const currentTimeline = ref<any>({});
  const sessionInputProjection = ref<any>(null);
  const turnInbox = ref<any>(null);
  const selectedTurnEvidence = ref<Record<string, any> | null>(null);
  const selectedActivity = ref<Record<string, unknown> | null>(null);
  const liveToolCount = ref(0);
  const liveMemoryRecallCount = ref(0);
  const liveMemoryEvidenceCount = ref(0);
  const workspaceRoot = ref('');
  const workspaceDir = ref('');
  const workspaceFiles = ref<WorkspaceFile[]>([]);
  const workspaceTreeRoot = ref<WorkspaceTreeNode>(createWorkspaceRoot());
  const expandedWorkspaceDirs = ref<string[]>(['']);
  const workspaceTreeLoading = ref<Record<string, boolean>>({});
  const workspaceMeta = ref<Record<string, unknown> | null>(null);
  const recentWorkspaceFiles = ref<WorkspaceFile[]>(readStoredWorkspaceFiles());
  const attachments = ref<SessionAttachment[]>([]);
  const selectedFile = ref('');
  const selectedFileContent = ref('');
  const editorContent = ref('');
  const workspaceFilter = ref('');
  const fileError = ref('');
  const uploadBusy = ref(false);
  const settingsSavedAt = ref('');
  const activeSectionByPage = ref<Record<string, string>>({});
  const companionCollapsed = ref(true);
  const activeModal = ref<'model' | 'workspace' | 'commands' | null>(null);
  const selectedModel = ref('');
  const selectedProfile = ref('default');
  const commandError = ref('');
  const contextUsagePercent = ref<number | null>(null);
  const contextUsageSource = ref(t('store.app.string.18eb606335'));
  const contextUsedTokens = ref(0);
  const contextLimitTokens = ref(0);
  const sessionQuery = ref('');
  const sessionPageLimit = ref(50);
  const sessionOffset = ref(0);
  const sessionHasMore = ref(true);
  const sessionLoadingMore = ref(false);
  const selectedSessionIds = ref<string[]>([]);
  const openTurnActivity = ref<Record<string, boolean>>({});
  const pinnedSessionIds = ref<string[]>(readStoredArray(PINNED_SESSION_KEY));
  const sessionViewedCounts = ref<Record<string, number>>(readStoredRecord(VIEWED_SESSION_KEY));
  const sessionRenderLimit = ref(100);
  const actionResults = ref<Record<string, any>>({});
  const gatewayCapabilityContract = ref<GatewayCapabilityContract | null>(null);
  const gatewayOpenApi = ref<Record<string, any> | null>(null);
  const gatewayOpenAiTools = ref<GatewayOpenAiTools | null>(null);
  const gatewayContractError = ref('');
  const capabilitySnapshots = ref<Record<string, EndpointSnapshot[]>>({});
  const capabilityLoading = ref<Record<string, boolean>>({});
  const capabilityError = ref<Record<string, string>>({});
  const editorDirty = computed(() => selectedFileContent.value !== editorContent.value);
  const filteredWorkspaceFiles = computed(() => {
    const query = workspaceFilter.value.trim().toLowerCase();
    if (!query) return workspaceFiles.value;
    return workspaceFiles.value.filter((file) => `${file.name} ${file.path}`.toLowerCase().includes(query));
  });
  const busy = ref(false);

  const activeSession = computed(() => sessions.value.find((item) => item.id === activeSessionId.value) || sessions.value[0]);
  const filteredSessions = computed(() => {
    const query = sessionQuery.value.trim().toLowerCase();
    const pinned = new Set(pinnedSessionIds.value);
    const sorted = [...sessions.value].sort((a, b) => {
      const pinDelta = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
      if (pinDelta) return pinDelta;
      return updatedAtMs(b) - updatedAtMs(a);
    });
    if (!query) return sorted;
    return sorted.filter((session) => `${sessionTitle(session)} ${sessionSnippet(session)} ${session.status}`.toLowerCase().includes(query));
  });
  const renderedSessions = computed(() => filteredSessions.value.slice(0, sessionRenderLimit.value));
  const sessionRenderHasMore = computed(() => filteredSessions.value.length > renderedSessions.value.length);
  const groupedSessions = computed(() => {
    const groups = new Map<string, SessionSummary[]>();
    renderedSessions.value.forEach((session) => {
      const label = sessionGroupLabel(session);
      groups.set(label, [...(groups.get(label) || []), session]);
    });
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  });
  const contextUsageLabel = computed(() => {
    const used = contextUsedTokens.value;
    const limit = contextLimitTokens.value;
    if (used > 0 && limit > 0) return `${used.toLocaleString()} / ${limit.toLocaleString()}`;
    if (limit > 0) return `0 / ${limit.toLocaleString()}`;
    if (used > 0) return `${used.toLocaleString()} / ${contextUsageSource.value}`;
    return contextUsageSource.value;
  });
  const availableModels = computed(() => {
    const models = providerModels(controlPlane.value, providers.value || settings.value);
    return models.length ? models : (selectedModel.value ? [selectedModel.value] : []);
  });
  const availableProfiles = computed(() => profiles.value.map((profile: any) => profile.id || profile.name).filter(Boolean));
  const configReloadInvalid = computed(() => String(configReloadStatus.value?.status || '').toLowerCase() === 'invalid');
  const configReloadNeedsRestart = computed(() => configReloadStatus.value?.restart_required?.required === true);
  const configReloadAttention = computed(() => {
    const status = String(configReloadStatus.value?.status || '').toLowerCase();
    return configReloadInvalid.value || configReloadNeedsRestart.value || status === 'attention' || status === 'reload_needed';
  });
  const toolCallCount = computed(() => {
    const timelineEvents = Array.isArray(currentTimeline.value?.events) ? currentTimeline.value.events : [];
    const timelineCount = timelineEvents.filter((event: any) => String(event.kind || event.event_type || event.type || '').toLowerCase().includes('tool')).length;
    return Math.max(liveToolCount.value, timelineCount);
  });
  const memoryRecallCount = computed(() => {
    const timelineEvents = Array.isArray(currentTimeline.value?.events) ? currentTimeline.value.events : [];
    const timelineCount = timelineEvents.filter((event: any) => {
      const kind = String(event.kind || event.event_type || event.type || '').toLowerCase();
      return kind.includes('memory') || kind.includes('recall');
    }).length;
    return Math.max(liveMemoryRecallCount.value, timelineCount);
  });
  const memoryEvidenceCount = computed(() => {
    const stages = Array.isArray(currentRealityFlow.value?.stages) ? currentRealityFlow.value.stages : [];
    const memoryStages = stages.filter((stage: any) => String(stage.kind || '').toLowerCase().includes('memory'));
    return Math.max(liveMemoryEvidenceCount.value, memoryStages.length);
  });
  const runStageSummary = computed(() => {
    const events = Array.isArray(currentTimeline.value?.events) ? currentTimeline.value.events : [];
    const stageIds = [
      ['intake', ['message', 'turn', 'runtimerun']],
      ['context', ['context']],
      ['memory', ['memory', 'recall']],
      ['governance', ['approval', 'policy', 'risk']],
      ['task', ['task']],
      ['execution', ['tool', 'scheduler']],
      ['agent', ['agent', 'workgraph']],
      ['channel', ['channel', 'platform', 'cross_plane']],
    ];
    return stageIds.map(([id, needles]) => {
      const matched = events.filter((event: any) => {
        const haystack = `${event.scope || ''} ${event.kind || ''} ${event.event_type || ''} ${event.type || ''}`.toLowerCase();
        return (needles as string[]).some((needle) => haystack.includes(needle));
      });
      const failed = matched.some((event: any) => String(event.status || '').toLowerCase().includes('fail') || String(event.kind || '').toLowerCase().includes('error'));
      return {
        id,
        label: String(id).replace(/^\w/, (char) => char.toUpperCase()),
        status: failed ? 'failed' : matched.length ? 'observed' : id === 'channel' ? 'optional' : 'missing',
        count: matched.length,
      };
    });
  });
  const currentRunFiles = computed(() => {
    const fileMap = new Map<string, any>();
    attachments.value.forEach((attachment) => {
      fileMap.set(attachment.path, {
        path: attachment.path,
        kind: 'attachment',
        status: 'attached',
        ref: attachment.ref_id,
      });
    });
    const events = Array.isArray(currentTimeline.value?.events) ? currentTimeline.value.events : [];
    events.forEach((event: any) => {
      const text = JSON.stringify(event);
      const matches = text.match(/(?:resource:\/\/|path["': ]+)([A-Za-z0-9_./@-]+\.[A-Za-z0-9]+)/g) || [];
      matches.forEach((match) => {
        const path = match.replace(/^resource:\/\//, '').replace(/^path["': ]+/, '');
        if (!fileMap.has(path)) fileMap.set(path, { path, kind: 'runtime-ref', status: event.status || 'observed', ref: event.kind || event.type });
      });
    });
    return Array.from(fileMap.values());
  });

  function summarizeEvent(event: any) {
    return {
      kind: String(event.kind || event.event_type || event.type || event.source || 'event'),
      status: String(event.status || event.phase || event.decision || 'observed'),
      summary: String(event.detail || event.summary || event.message || event.title || event.ref || event.id || '').slice(0, 180),
      raw: event,
    };
  }

  function turnActivityStorageKey(sessionId = activeSessionId.value) {
    return `cowd.webui.turnActivityOpen.${sessionId || 'none'}`;
  }

  function loadTurnActivityState(sessionId = activeSessionId.value) {
    if (typeof localStorage === 'undefined') return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(turnActivityStorageKey(sessionId)) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function persistTurnActivityState(sessionId = activeSessionId.value) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(turnActivityStorageKey(sessionId), JSON.stringify(openTurnActivity.value));
  }

  function isTurnActivityOpen(turnId: string) {
    return !!openTurnActivity.value[turnId];
  }

  function toggleTurnActivity(turnId: string) {
    openTurnActivity.value = {
      ...openTurnActivity.value,
      [turnId]: !openTurnActivity.value[turnId],
    };
    persistTurnActivityState();
  }

  function turnActivitySummary(turn: ChatTurn) {
    return activitySummary(turn);
  }

  function attachActivityToStreamingTurn(event: ActivityEvent) {
    const turn = streamingAssistantId ? turns.value.find((item) => item.id === streamingAssistantId) : null;
    if (!turn) return;
    turn.activity = mergeTurnActivity(turn.activity || [], event);
  }

  function eventText(event: any) {
    return `${event.kind || ''} ${event.event_type || ''} ${event.type || ''} ${event.source || ''} ${event.status || ''} ${event.detail || ''} ${event.summary || ''}`.toLowerCase();
  }

  function turnEvidenceFromProjection(turn: ChatTurn, runtimeTurn: any = null) {
    const timelineEvents = Array.isArray(currentTimeline.value?.events) ? currentTimeline.value.events : [];
    const realityEvents = [
      ...(Array.isArray(currentRealityFlow.value?.events) ? currentRealityFlow.value.events : []),
      ...(Array.isArray(currentRealityFlow.value?.stages) ? currentRealityFlow.value.stages : []),
      ...(Array.isArray(currentRealityFlow.value?.promotions) ? currentRealityFlow.value.promotions : []),
    ];
    const envelope = currentContextEnvelope.value?.envelope || currentContextEnvelope.value || {};
    const contextItems = [
      ...(Array.isArray(envelope.items) ? envelope.items : []),
      ...(Array.isArray(envelope.context_items) ? envelope.context_items : []),
      ...(Array.isArray(envelope.evidence) ? envelope.evidence : []),
    ];
    const activityRows = activity.value.map((item) => ({
      kind: item.kind,
      status: item.status || 'observed',
      summary: `${item.title}${item.detail ? `: ${item.detail}` : ''}`,
      raw: item,
    }));
    const toolEvents = [
      ...timelineEvents.filter((event: any) => eventText(event).includes('tool')).map(summarizeEvent),
      ...activityRows.filter((event) => event.kind === 'tool'),
      ...(turn.tool_name ? [{ kind: 'message.tool', status: turn.status || 'complete', summary: turn.tool_name, raw: turn }] : []),
    ];
    const memoryEvents = [
      ...timelineEvents.filter((event: any) => eventText(event).includes('memory') || eventText(event).includes('recall')).map(summarizeEvent),
      ...realityEvents.filter((event: any) => eventText(event).includes('memory') || eventText(event).includes('fact') || eventText(event).includes('promotion')).map(summarizeEvent),
      ...contextItems.filter((item: any) => eventText(item).includes('memory') || eventText(item).includes('recall')).map(summarizeEvent),
    ];
    const approvalEvents = [
      ...timelineEvents.filter((event: any) => eventText(event).includes('approval') || eventText(event).includes('policy') || eventText(event).includes('risk')).map(summarizeEvent),
      ...activityRows.filter((event) => event.kind === 'approval' || eventText(event).includes('policy')),
    ];
    const runtimeEvents = timelineEvents.slice(0, 24).map(summarizeEvent);
    const files = currentRunFiles.value.slice(0, 24).map((file: any) => ({
      path: file.path || file.ref || '-',
      kind: file.kind || 'runtime-ref',
      status: file.status || 'observed',
      raw: file,
    }));
    return {
      turn,
      runtime_turn: runtimeTurn,
      source_note: t('store.app.string.718831f909'),
      summary: [
        { label: t('script.stores.app.label.4fa8cc860c'), value: toolEvents.length },
        { label: t('script.stores.app.label.89c8a2851d'), value: memoryEvents.length },
        { label: t('script.stores.app.label.6ce6c512ea'), value: files.length },
        { label: t('script.stores.app.label.deb9d03cf0'), value: approvalEvents.length },
        { label: t('script.stores.app.label.c5497bca58'), value: runtimeEvents.length },
      ],
      tools: toolEvents,
      memory: memoryEvents,
      files,
      approvals: approvalEvents,
      events: runtimeEvents,
      context: envelope,
      reality: currentRealityFlow.value,
    };
  }

  function rowContent(row: any) {
    const direct = String(row?.content || '').trim();
    if (direct) return direct;
    const blockParts = (Array.isArray(row?.blocks) ? row.blocks : [])
      .map(blockText)
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .filter((part, index, parts) => index === 0 || comparableText(part) !== comparableText(parts[index - 1]));
    return blockParts.join('\n\n');
  }

  function rowActivity(row: any) {
    const events = Array.isArray(row?.activity) ? row.activity : Array.isArray(row?.events) ? row.events : [];
    return events.map((event: any) => sanitizeActivityEvent(normalizeTurnActivity(event)));
  }

  function rowTokenUsage(row: any) {
    return row?.token_usage
      || row?.usage
      || row?.usage_metadata
      || row?.stats?.token_usage
      || row?.metrics?.token_usage
      || undefined;
  }

  function rowToTurn(row: any, index: number): ChatTurn {
    const role = row.role || 'assistant';
    const content = rowContent(row);
    return {
      id: String(row.id || row.sequence || index),
      role,
      content: normalizeTurnContent(role, content),
      status: 'complete',
      activity: rowActivity(row),
      blocks: row.blocks || [],
      sequence: row.sequence,
      created_at_ms: row.created_at_ms,
      tool_use_id: row.tool_use_id,
      tool_name: row.tool_name,
      token_usage: rowTokenUsage(row),
    };
  }

  function mergeLoadedTurns(rows: any[]): ChatTurn[] {
    const loaded = rows.map(rowToTurn);
    const merged: ChatTurn[] = [];
    const seen = new Set<string>();
    const assistantContentSinceUser = new Set<string>();
    loaded.forEach((turn) => {
      const key = turnStableKey(turn);
      const previous = merged.at(-1);
      const duplicateStable = key && seen.has(key);
      const duplicateAdjacent = sameTurnContent(previous, turn);
      const contentKey = contentDedupeKey(turn);
      const duplicateAssistantInSameReply = turn.role === 'assistant' && contentKey && assistantContentSinceUser.has(contentKey);
      if (duplicateStable || duplicateAdjacent || duplicateAssistantInSameReply) return;
      if (key) seen.add(key);
      if (turn.role === 'user') assistantContentSinceUser.clear();
      if (turn.role === 'assistant' && contentKey) assistantContentSinceUser.add(contentKey);
      merged.push(turn);
    });

    const streaming = streamingAssistantId ? turns.value.find((turn) => turn.id === streamingAssistantId && turn.status === 'streaming') : null;
    if (streaming) {
      const hasFinal = merged.some((turn) => turn.role === 'assistant' && sameAssistantFinal(turn.content, streaming.content));
      if (hasFinal) {
        streamingAssistantId = '';
      } else {
        merged.push(streaming);
      }
    }
    return merged;
  }

  function numberFrom(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function tokenCountFrom(value: any) {
    if (!value || typeof value !== 'object') return 0;
    const direct = numberFrom(value.total_tokens)
      || numberFrom(value.totalTokens)
      || numberFrom(value.total)
      || numberFrom(value.tokens_total)
      || numberFrom(value.token_count)
      || numberFrom(value.tokenCount)
      || numberFrom(value.token_usage?.total_tokens)
      || numberFrom(value.token_usage?.total)
      || numberFrom(value.usage?.total_tokens)
      || numberFrom(value.usage?.total)
      || numberFrom(value.usage_metadata?.total_tokens)
      || numberFrom(value.usage_metadata?.total);
    if (direct) return direct;
    const input = numberFrom(value.input_tokens)
      || numberFrom(value.prompt_tokens)
      || numberFrom(value.inputTokens)
      || numberFrom(value.promptTokens)
      || numberFrom(value.token_usage?.input_tokens)
      || numberFrom(value.token_usage?.prompt_tokens)
      || numberFrom(value.usage?.input_tokens)
      || numberFrom(value.usage?.prompt_tokens)
      || numberFrom(value.usage_metadata?.input_tokens)
      || numberFrom(value.usage_metadata?.prompt_tokens);
    const output = numberFrom(value.output_tokens)
      || numberFrom(value.completion_tokens)
      || numberFrom(value.outputTokens)
      || numberFrom(value.completionTokens)
      || numberFrom(value.token_usage?.output_tokens)
      || numberFrom(value.token_usage?.completion_tokens)
      || numberFrom(value.usage?.output_tokens)
      || numberFrom(value.usage?.completion_tokens)
      || numberFrom(value.usage_metadata?.output_tokens)
      || numberFrom(value.usage_metadata?.completion_tokens);
    return input + output;
  }

  function findContextWindowIn(value: any, model = selectedModel.value): number {
    const candidateKeys = [
      'context_window',
      'contextWindow',
      'max_context_tokens',
      'maxContextTokens',
      'context_limit',
      'contextLimit',
      'context_length',
      'contextLength',
      'model_context_window',
      'modelContextWindow',
      'max_input_tokens',
      'maxInputTokens',
      'max_tokens',
      'maxTokens',
      'token_budget',
      'tokenBudget',
    ];
    const visited = new Set<any>();
    const wantedModel = String(model || '').toLowerCase();
    const visit = (node: any): number => {
      if (!node || typeof node !== 'object' || visited.has(node)) return 0;
      visited.add(node);
      for (const key of candidateKeys) {
        const direct = numberFrom(node[key]);
        if (direct) return direct;
      }
      if (wantedModel) {
        const name = String(node.id || node.name || node.model || '').toLowerCase();
        if (name && name === wantedModel) {
          for (const key of candidateKeys) {
            const direct = numberFrom(node[key]);
            if (direct) return direct;
          }
        }
      }
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = visit(item);
          if (found) return found;
        }
      } else {
        for (const child of Object.values(node)) {
          const found = visit(child);
          if (found) return found;
        }
      }
      return 0;
    };
    return visit(value);
  }

  function resolveContextLimit(stats: any) {
    return numberFrom(stats.context_window)
      || numberFrom(stats.max_context_tokens)
      || numberFrom(stats.context_limit)
      || numberFrom(stats.token_budget)
      || numberFrom(stats.model_context_window)
      || numberFrom(stats.token_usage?.limit)
      || numberFrom(stats.token_usage?.context_window)
      || numberFrom(stats.usage?.limit)
      || numberFrom(stats.usage?.context_window)
      || findContextWindowIn(stats)
      || findContextWindowIn(controlPlane.value)
      || findContextWindowIn(providers.value)
      || findContextWindowIn(settings.value);
  }

  async function boot() {
    if (booted.value) return;
    busy.value = true;
    const [
      manifest,
      sessionData,
      config,
      runtime,
      providerData,
      reloadStatus,
      profileData,
      commandData,
      workspace,
      approvals,
      capabilityContract,
      openApi,
      openAiTools,
    ] = await Promise.all([
      api.health(),
      api.sessions(),
      api.settings(),
      api.runtimeControlPlane(),
      api.providers(),
      api.configReloadStatus(),
      api.profiles(),
      api.commands(),
      api.workspace(),
      api.approvalConfig(),
      api.gatewayCapabilityContract(),
      api.gatewayOpenApi(),
      api.gatewayOpenAiTools(),
    ]);
    health.value = manifest;
    settings.value = config;
    controlPlane.value = runtime;
    providers.value = providerData;
    configReloadStatus.value = reloadStatus;
    profiles.value = profileData.profiles || [];
    commands.value = commandData.commands || [];
    approvalConfig.value = approvals;
    gatewayCapabilityContract.value = capabilityContract;
    gatewayOpenApi.value = openApi;
    gatewayOpenAiTools.value = openAiTools;
    gatewayContractError.value = [capabilityContract.__error, openApi.__error, openAiTools.__error].filter(Boolean).join(' · ');
    const reportedModel = runtime.configured_model || config.model || '';
    selectedModel.value = reportedModel && reportedModel !== 'unknown' ? reportedModel : selectedModel.value;
    selectedProfile.value = profileData.active_profile || profileData.runtime_profile || selectedProfile.value;
    sessions.value = sessionData.sessions;
    sessionOffset.value = sessions.value.length;
    sessionHasMore.value = sessions.value.length >= sessionPageLimit.value;
    if (!activeSessionId.value && sessions.value[0]) activeSessionId.value = sessions.value[0].id;
    workspaceRoot.value = workspace.workspace_canonical || workspace.workspace_root || '';
    await Promise.all([
      activeSessionId.value ? loadMessages(activeSessionId.value) : Promise.resolve(),
      loadWorkspace(''),
      activeSessionId.value ? loadAttachments(activeSessionId.value) : Promise.resolve(),
      loadActivity(),
    ]);
    busy.value = false;
    booted.value = true;
    startConfigReloadPolling();
  }

  function startConfigReloadPolling() {
    if (typeof window === 'undefined' || configReloadTimer) return;
    configReloadTimer = window.setInterval(() => {
      refreshConfigReloadStatus().catch(() => undefined);
    }, 5000);
  }

  async function refreshConfigReloadStatus() {
    const status = await api.configReloadStatus();
    configReloadStatus.value = status || {};
    return configReloadStatus.value;
  }

  async function loadMessages(sessionId: string) {
    activeSessionId.value = sessionId;
    openTurnActivity.value = loadTurnActivityState(sessionId);
    const data = await api.messages(sessionId);
    const rows = Array.isArray(data) ? data : (data.messages || []);
    turns.value = mergeLoadedTurns(rows);
    if (!turns.value.length) turns.value = [{ id: 'empty', role: 'system', content: t('store.app.session.empty'), status: 'complete' }];
    markSessionViewed(sessionId);
    connectSessionStream(sessionId);
    await refreshContextUsage(sessionId);
    await loadAttachments(sessionId);
    if (chatDisplayMode.value === 'panorama') await refreshChatProjection(sessionId);
  }

  async function refreshContextUsage(sessionId = activeSessionId.value) {
    if (!sessionId) {
      contextUsagePercent.value = null;
      contextUsageSource.value = t('store.app.string.44a6946f79');
      contextUsedTokens.value = 0;
      contextLimitTokens.value = 0;
      return;
    }
    const stats: any = await api.sessionStats(sessionId);
    const used = tokenCountFrom(stats);
    const limit = resolveContextLimit(stats);
    contextUsedTokens.value = Number.isFinite(used) && used > 0 ? used : 0;
    contextLimitTokens.value = limit;
    if (used > 0 && limit > 0) {
      contextUsagePercent.value = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
      contextUsageSource.value = t('store.app.string.6e69362394');
    } else if (limit > 0) {
      contextUsagePercent.value = 0;
      contextUsageSource.value = t('chat.context.limitOnly');
    } else {
      contextUsagePercent.value = null;
      contextUsageSource.value = t('store.app.string.18eb606335');
    }
  }

  async function refreshSessions(query = sessionQuery.value, reset = true) {
    const offset = reset ? 0 : sessionOffset.value;
    const data = await api.searchSessions(query.trim(), sessionPageLimit.value, offset);
    const nextSessions = data.sessions || [];
    sessions.value = reset ? nextSessions : [...sessions.value, ...nextSessions.filter((session) => !sessions.value.some((item) => item.id === session.id))];
    sessionOffset.value = sessions.value.length;
    sessionHasMore.value = nextSessions.length >= sessionPageLimit.value;
    if (!activeSessionId.value && sessions.value[0]) activeSessionId.value = sessions.value[0].id;
    return data;
  }

  async function loadMoreSessions() {
    if (sessionLoadingMore.value || !sessionHasMore.value) return;
    sessionLoadingMore.value = true;
    try {
      await refreshSessions(sessionQuery.value, false);
    } finally {
      sessionLoadingMore.value = false;
    }
  }

  async function createSession() {
    const session = await api.createSession(selectedModel.value || undefined);
    sessions.value = [session, ...sessions.value.filter((item) => item.id !== session.id)];
    activeSessionId.value = session.id;
    selectedModel.value = session.model || selectedModel.value;
    turns.value = [{ id: `system-${Date.now()}`, role: 'system', content: t('store.app.session.created'), status: 'complete' }];
    attachments.value = [];
    markSessionViewed(session.id);
    connectSessionStream(session.id);
  }

  async function deleteSession(sessionId: string) {
    await api.deleteSession(sessionId);
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    selectedSessionIds.value = selectedSessionIds.value.filter((id) => id !== sessionId);
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0]?.id || '';
      if (activeSessionId.value) await loadMessages(activeSessionId.value);
      else turns.value = [];
    }
  }

  function toggleSessionSelected(sessionId: string) {
    selectedSessionIds.value = selectedSessionIds.value.includes(sessionId)
      ? selectedSessionIds.value.filter((id) => id !== sessionId)
      : [...selectedSessionIds.value, sessionId];
  }

  function markSessionViewed(sessionId: string) {
    const session = sessions.value.find((item) => item.id === sessionId);
    const count = Number(session?.message_count || turns.value.length || 0);
    sessionViewedCounts.value = { ...sessionViewedCounts.value, [sessionId]: count };
    writeStored(VIEWED_SESSION_KEY, sessionViewedCounts.value);
  }

  function isSessionPinned(session: SessionSummary) {
    return session.pinned === true || pinnedSessionIds.value.includes(session.id);
  }

  function isSessionUnread(session: SessionSummary) {
    if (session.id === activeSessionId.value) return false;
    const count = Number(session.message_count || 0);
    return count > Number(sessionViewedCounts.value[session.id] || 0);
  }

  function isSessionRunning(session: SessionSummary) {
    const status = String(session.status || '').toLowerCase();
    return !!session.is_streaming || !!session.active_stream_id || !!session.pending_user_message || ['running', 'active', 'queued', 'processing', 'replying'].some((item) => status.includes(item));
  }

  function sessionAttention(session: SessionSummary) {
    if (isSessionRunning(session)) return 'running';
    if (isSessionUnread(session)) return 'unread';
    if (isSessionPinned(session)) return 'pinned';
    return '';
  }

  function toggleSessionPin(sessionId: string) {
    pinnedSessionIds.value = pinnedSessionIds.value.includes(sessionId)
      ? pinnedSessionIds.value.filter((id) => id !== sessionId)
      : [sessionId, ...pinnedSessionIds.value];
    writeStored(PINNED_SESSION_KEY, pinnedSessionIds.value);
  }

  function revealMoreSessions() {
    sessionRenderLimit.value += 100;
  }

  function clearSessionSelection() {
    selectedSessionIds.value = [];
  }

  async function deleteSelectedSessions() {
    const ids = [...selectedSessionIds.value];
    const failures: any[] = [];
    for (const id of ids) {
      try {
        await deleteSession(id);
      } catch (error) {
        failures.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (failures.length) {
      selectedActivity.value = { kind: 'session.bulk_delete', failures };
      companionTab.value = 'inspector';
    }
    return { deleted: ids.length - failures.length, failures };
  }

  async function branchSession(sessionId: string) {
    const receipt = await api.branchSession(sessionId);
    if (receipt.ok && receipt.data) {
      const next = receipt.data as SessionSummary;
      sessions.value = [next, ...sessions.value.filter((item) => item.id !== next.id)];
      activeSessionId.value = next.id;
      await loadMessages(next.id);
    } else {
      selectedActivity.value = receipt as any;
      companionTab.value = 'inspector';
    }
    return receipt;
  }

  async function compactSession(sessionId: string) {
    const result = await api.compactSession(sessionId);
    activity.value.unshift({ id: `compact-${Date.now()}`, kind: 'runtime', title: t('script.stores.app.title.2b43f89c03'), detail: JSON.stringify(result).slice(0, 220), status: 'complete' });
    await loadActivity();
  }

  async function send(content: string) {
    const sessionId = activeSessionId.value;
    if (!sessionId) {
      await createSession();
    }
    turns.value.push({ id: `local-${Date.now()}`, role: 'user', content, status: 'complete' });
    resetCurrentRun(content);
    ensureStreamingAssistantTurn();
    companionTab.value = 'activity';
    activity.value.unshift({ id: `send-${Date.now()}`, kind: 'runtime', title: t('script.stores.app.title.001e413a9b'), detail: content.slice(0, 140), status: 'pending' });
    try {
      const contentWithAttachments = renderMessageWithAttachments(content);
      const resourceIds = attachments.value
        .filter((item) => item.resource_id || item.uri?.startsWith('resource://'))
        .map((item) => item.resource_id || item.uri || item.ref_id)
        .filter((value): value is string => Boolean(value));
      const idempotencyKey = `webui:${activeSessionId.value}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const receipt: any = await api.sendMessage(activeSessionId.value, contentWithAttachments, resourceIds, idempotencyKey);
      if (resourceIds.length) {
        attachments.value = attachments.value.filter((item) => !resourceIds.includes(item.resource_id || item.uri || item.ref_id));
      }
      if (receipt?.input_projection) sessionInputProjection.value = receipt.input_projection;
      if (receipt?.turn_inbox) turnInbox.value = receipt.turn_inbox;
      if (receipt?.mode === 'attached_to_active_turn') {
        currentRun.value = {
          ...(currentRun.value || {}),
          run_id: receipt.run_id || currentRun.value?.run_id || '',
          turn_id: receipt.input?.active_turn_id || currentRun.value?.turn_id || '',
          status: 'running',
          latest_input_receipt: receipt.input,
        };
        recordLiveActivity('runtime', 'Input attached', receipt.input?.reason?.summary || receipt.input?.decision || '', 'running');
      } else {
        currentRun.value = {
          ...(currentRun.value || {}),
          run_id: receipt?.run_id || currentRun.value?.run_id || '',
          turn_id: receipt?.turn?.turn_id || currentRun.value?.turn_id || '',
          status: receipt?.status || 'running',
          turn_receipt: receipt?.turn || null,
        };
        recordLiveActivity('runtime', 'Turn accepted', receipt?.turn?.turn_id || receipt?.run_id || '', 'running');
      }
      await loadActivity();
      if (chatDisplayMode.value === 'panorama') await refreshChatProjection(activeSessionId.value, content);
    } catch (error) {
      turns.value.push({
        id: `error-${Date.now()}`,
        role: 'system',
        content: t('store.app.send.failed', { error: error instanceof Error ? error.message : String(error) }),
        status: 'error',
      });
      activity.value.unshift({ id: `send-error-${Date.now()}`, kind: 'error', title: t('script.stores.app.title.91172a3984'), detail: error instanceof Error ? error.message : String(error), status: 'error' });
    }
  }

  async function loadActivity() {
    if (!activeSessionId.value) {
      activity.value = [];
      return;
    }
    const data: any = await api.runtimeTimeline(activeSessionId.value);
    currentTimeline.value = data;
    activity.value = normalizeActivity(data.events || data.timeline || []).map(sanitizeActivityEvent);
  }

  async function loadTurnEvidence(turn: ChatTurn) {
    if (chatDisplayMode.value === 'panorama' && activeSessionId.value) {
      await refreshChatProjection(activeSessionId.value, turn.content || '').catch(() => undefined);
    }
    let runtimeTurn: any = null;
    const canInspectTurn = turn.id
      && !turn.id.startsWith('local-')
      && !turn.id.startsWith('assistant-stream-')
      && !turn.id.startsWith('system-')
      && turn.id !== 'empty'
      && (turn.id.startsWith('turn-') || turn.id.startsWith('runtime-turn-') || turn.id.startsWith('rt-'));
    if (canInspectTurn) {
      runtimeTurn = await api.runtimeTurn(turn.id).catch((error) => ({
        ok: false,
        endpoint: `/api/runtime/turns/${turn.id}`,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    selectedTurnEvidence.value = turnEvidenceFromProjection(turn, runtimeTurn);
    companionTab.value = 'evidence';
    return selectedTurnEvidence.value;
  }

  function clearTurnEvidence() {
    selectedTurnEvidence.value = null;
  }

  async function refreshChatProjection(sessionId = activeSessionId.value, query = '') {
    if (!sessionId || chatDisplayMode.value !== 'panorama') return;
    const [timeline, reality, context] = await Promise.all([
      api.runtimeTimeline(sessionId),
      api.realityFlow(sessionId, 80),
      api.contextCurrent(sessionId, query, 'main_turn'),
    ]);
    currentTimeline.value = timeline;
    currentRealityFlow.value = reality;
    if (!currentContextEnvelope.value || context?.identity || context?.envelope) currentContextEnvelope.value = context.envelope || context;
  }

  async function refreshSessionInputs(sessionId = activeSessionId.value) {
    if (!sessionId) return;
    const [projection, inbox] = await Promise.all([
      api.sessionInputs(sessionId).catch(() => null),
      api.turnInbox(sessionId).catch(() => null),
    ]);
    if (projection) sessionInputProjection.value = projection;
    if (inbox) turnInbox.value = inbox;
  }

  function resetCurrentRun(prompt = '') {
    currentRun.value = {
      run_id: '',
      turn_id: '',
      status: 'queued',
      prompt,
      started_at_ms: Date.now(),
    };
    currentContextEnvelope.value = null;
    currentRealityFlow.value = {};
    currentTimeline.value = {};
    sessionInputProjection.value = null;
    turnInbox.value = null;
    liveToolCount.value = 0;
    liveMemoryRecallCount.value = 0;
    liveMemoryEvidenceCount.value = 0;
  }

  function connectSessionStream(sessionId: string) {
    if (!sessionId || (sessionStream && sessionStreamId === sessionId)) return;
    if (sessionStream) sessionStream.close();
    sessionStreamId = sessionId;
    streamingAssistantId = '';
    try {
      sessionStream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
      sessionStream.onmessage = (event) => handleSessionEvent(event.data);
      sessionStream.onerror = () => {
        if (sessionStreamId === sessionId) {
          sessionStream?.close();
          sessionStream = null;
          sessionStreamId = '';
          activity.value.unshift({
            id: `stream-error-${Date.now()}`,
            kind: 'error',
            title: t('script.stores.app.title.f16e471052'),
            detail: t('script.stores.app.detail.58a8a8b820'),
            status: 'error',
          });
        }
      };
    } catch (error) {
      activity.value.unshift({
        id: `stream-open-error-${Date.now()}`,
        kind: 'error',
        title: t('script.stores.app.title.9b07b06010'),
        detail: error instanceof Error ? error.message : String(error),
        status: 'error',
      });
    }
  }

  function handleSessionEvent(raw: string) {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      event = { type: 'RuntimeEvent', content: raw };
    }
    const type = event.type || 'RuntimeEvent';
    if (type === 'Connected') return;

    if (type === 'TurnStarted') {
      ensureStreamingAssistantTurn();
      currentRun.value = { ...(currentRun.value || {}), status: 'running', started_at_ms: currentRun.value?.started_at_ms || Date.now() };
      recordLiveActivity('runtime', 'Turn started', '', 'running');
      return;
    }

    if (type === 'TextDelta') {
      appendAssistantDelta(event.content || event.text || '');
      return;
    }

    if (type === 'ThinkingDelta') {
      companionTab.value = 'thinking';
      recordLiveActivity('think', 'Thinking', event.content || event.thinking || '', 'running');
      return;
    }

    if (type === 'ToolStart' || type === 'ToolProgress' || type === 'ToolComplete') {
      companionTab.value = 'activity';
      if (type === 'ToolStart') liveToolCount.value += 1;
      recordLiveActivity(
        'tool',
        event.name || type,
        event.summary || event.progress || event.preview || event.id || '',
        type === 'ToolComplete' ? 'complete' : 'running',
      );
      return;
    }

    if (type === 'SessionInputReceived') {
      companionTab.value = 'activity';
      currentRun.value = {
        ...(currentRun.value || {}),
        status: 'running',
        latest_input_receipt: event.receipt || event.input,
      };
      recordLiveActivity(
        'runtime',
        'Input received',
        event.receipt?.reason?.summary || event.receipt?.decision || event.input?.decision || '',
        'running',
      );
      return;
    }

    if (type === 'SessionInputProjection') {
      sessionInputProjection.value = event.projection || event.input_projection || event;
      return;
    }

    if (type === 'TurnInboxUpdated') {
      turnInbox.value = event.inbox || event.turn_inbox || event;
      recordLiveActivity('context', 'Turn inbox updated', `${turnInbox.value?.pending_count || 0} pending`, 'running');
      return;
    }

    if (type === 'TurnInputCheckpointConsumed') {
      turnInbox.value = {
        ...(turnInbox.value || {}),
        last_checkpoint: event.checkpoint,
        last_consumed: event.consumed || [],
      };
      recordLiveActivity(
        'context',
        'Input checkpoint consumed',
        `${event.checkpoint || ''} ${(event.consumed || []).length} item(s)`,
        'complete',
      );
      return;
    }

    if (type === 'ContextEnvelope') {
      const envelope = event.envelope || event;
      currentContextEnvelope.value = envelope;
      currentRun.value = {
        ...(currentRun.value || {}),
        run_id: event.run_id || currentRun.value?.run_id || '',
        turn_id: event.turn_id || currentRun.value?.turn_id || '',
        context_envelope_id: event.envelope_id || envelope.envelope_id || envelope.id || '',
      };
      const envelopeItems = [
        ...(Array.isArray(envelope.items) ? envelope.items : []),
        ...(Array.isArray(envelope.context_items) ? envelope.context_items : []),
        ...(Array.isArray(envelope.evidence) ? envelope.evidence : []),
      ];
      const memoryItems = envelopeItems.filter((item: any) => {
        const text = `${item.kind || ''} ${item.source || ''} ${item.source_type || ''} ${item.ref || ''}`.toLowerCase();
        return text.includes('memory') || text.includes('recall');
      });
      const envelopeText = JSON.stringify(event).toLowerCase();
      const memoryMentions = (envelopeText.match(/memory|recall/g) || []).length;
      liveMemoryEvidenceCount.value = Math.max(liveMemoryEvidenceCount.value, memoryItems.length || Math.min(memoryMentions, 99));
      recordLiveActivity('context', 'Context envelope', event.envelope_id || event.run_id || '', 'complete');
      return;
    }

    if (type === 'TurnComplete') {
      currentRun.value = { ...(currentRun.value || {}), status: 'complete', completed_at_ms: Date.now(), iterations: event.iterations };
      completeAssistantTurn(event.response || event.text || '');
      recordLiveActivity('runtime', 'Turn complete', event.iterations ? `${event.iterations} iterations` : '', 'complete');
      if (activeSessionId.value) {
        loadMessages(activeSessionId.value).catch(() => undefined);
        api.sessionInputProjection(activeSessionId.value).then((value: any) => {
          sessionInputProjection.value = value;
        }).catch(() => undefined);
        api.turnInbox(activeSessionId.value).then((value: any) => {
          turnInbox.value = value;
        }).catch(() => undefined);
      }
      if (chatDisplayMode.value === 'panorama') refreshChatProjection(activeSessionId.value).catch(() => undefined);
      return;
    }

    if (type === 'TurnError') {
      companionTab.value = 'inspector';
      currentRun.value = { ...(currentRun.value || {}), status: 'error', error: event.error || 'Turn failed', completed_at_ms: Date.now() };
      completeAssistantTurn(event.error || 'Turn failed', 'error');
      recordLiveActivity('error', 'Turn failed', event.error || '', 'error');
      return;
    }

    if (String(type).toLowerCase().includes('error')) companionTab.value = 'inspector';
    recordLiveActivity('runtime', type, event.summary || event.content || JSON.stringify(event).slice(0, 220), event.status || 'observed');
  }

  function ensureStreamingAssistantTurn() {
    const current = streamingAssistantId ? turns.value.find((turn) => turn.id === streamingAssistantId) : null;
    if (current && current.status === 'streaming') return current;
    streamingAssistantId = `assistant-stream-${Date.now()}`;
    const turn = { id: streamingAssistantId, role: 'assistant' as const, content: '', status: 'streaming' as const, activity: [] };
    turns.value.push(turn);
    return turn;
  }

  function appendAssistantDelta(delta: string) {
    if (!delta) return;
    const turn = ensureStreamingAssistantTurn();
    const incoming = String(delta || '');
    const current = comparableText(turn.content);
    const incomingComparable = comparableText(incoming);
    if (current && incomingComparable.startsWith(current)) {
      turn.content = normalizeTurnContent('assistant', incoming);
    } else {
      turn.content += incoming;
    }
  }

  function completeAssistantTurn(content: string, status: 'complete' | 'error' = 'complete') {
    const visibleContent = normalizeTurnContent(status === 'error' ? 'system' : 'assistant', content);
    const turn = streamingAssistantId ? turns.value.find((item) => item.id === streamingAssistantId) : null;
    if (turn) {
      const currentContent = normalizeTurnContent(turn.role, turn.content);
      if (visibleContent && !sameAssistantFinal(currentContent, visibleContent)) {
        const currentComparable = comparableText(currentContent);
        const visibleComparable = comparableText(visibleContent);
        turn.content = currentComparable
          && visibleComparable
          && currentComparable.length > visibleComparable.length
          && currentComparable.includes(visibleComparable)
          ? currentContent
          : visibleContent;
      } else if (currentContent) {
        turn.content = currentContent;
      }
      turn.status = status;
    } else if (visibleContent) {
      const alreadyShown = turns.value.some((item, index) => {
        if (item.role !== 'assistant' || !sameAssistantFinal(item.content, visibleContent)) return false;
        const next = turns.value[index + 1];
        return !next || next.role !== 'user';
      });
      if (!alreadyShown) turns.value.push({ id: `assistant-${Date.now()}`, role: status === 'error' ? 'system' : 'assistant', content: visibleContent, status });
    }
    streamingAssistantId = '';
  }

  function recordLiveActivity(kind: ActivityEvent['kind'], title: string, detail: string, status: string) {
    const id = `live-${title}-${status}`;
    const event = normalizeTurnActivity({
      id: `${id}-${Date.now()}`,
      kind,
      title: cleanRuntimeSummary(title),
      detail: cleanRuntimeSummary(String(detail || '').slice(0, 240)),
      status,
    });
    const existingIndex = activity.value.findIndex((item) => item.title === title && item.kind === kind && item.status !== 'complete' && item.status !== 'error');
    if (existingIndex >= 0) {
      activity.value.splice(existingIndex, 1, event);
    } else {
      activity.value.unshift(event);
    }
    activity.value = activity.value.slice(0, 80);
    attachActivityToStreamingTurn(event);
    const lower = `${title} ${detail}`.toLowerCase();
    if (kind === 'context' && (lower.includes('memory') || lower.includes('recall'))) liveMemoryRecallCount.value += 1;
  }

  async function stopCurrentTurn() {
    if (!activeSessionId.value) return;
    const receipt = await api.cancelSessionTurn(activeSessionId.value);
    currentRun.value = { ...(currentRun.value || {}), status: 'cancel_requested', cancel_receipt: receipt };
    activity.value.unshift({
      id: `cancel-${Date.now()}`,
      kind: receipt.ok ? 'runtime' : 'error',
      title: t('script.stores.app.title.d42269932f'),
      detail: receipt.error || receipt.payload_summary || activeSessionId.value,
      status: receipt.ok ? 'complete' : 'error',
    });
    return receipt;
  }

  async function cancelSessionInput(inputId: string, reason = 'cancelled from webui') {
    if (!activeSessionId.value || !inputId) return null;
    const receipt = await api.cancelSessionInput(activeSessionId.value, inputId, reason);
    if (receipt?.input_projection) sessionInputProjection.value = receipt.input_projection;
    if (receipt?.turn_inbox) turnInbox.value = receipt.turn_inbox;
    recordLiveActivity('runtime', t('chat.input.cancelled'), inputId, receipt?.input ? 'complete' : 'error');
    return receipt;
  }

  async function reclassifySessionInput(inputId: string, decision = 'enqueue_next_step', reason = 'manual webui override') {
    if (!activeSessionId.value || !inputId) return null;
    const receipt = await api.reclassifySessionInput(activeSessionId.value, inputId, decision, reason);
    if (receipt?.input_projection) sessionInputProjection.value = receipt.input_projection;
    if (receipt?.turn_inbox) turnInbox.value = receipt.turn_inbox;
    recordLiveActivity('runtime', t('chat.input.reclassified'), `${inputId} -> ${decision}`, receipt?.input ? 'complete' : 'error');
    return receipt;
  }

  async function retryLastUserTurn() {
    const lastUser = [...turns.value].reverse().find((turn) => turn.role === 'user' && turn.content.trim());
    if (!lastUser) return;
    await send(lastUser.content);
  }

  function setChatDisplayMode(mode: ChatDisplayMode) {
    chatDisplayMode.value = mode;
    if (mode === 'panorama' && activeSessionId.value) {
      refreshChatProjection(activeSessionId.value).catch(() => undefined);
      loadActivity().catch(() => undefined);
    }
  }

  function normalizeWorkspaceFiles(files: any[]): WorkspaceFile[] {
    return (files || []).map((file: any) => ({
      ...file,
      kind: file.kind || (file.is_dir ? 'dir' : 'file'),
    }));
  }

  function rememberExpandedDir(dir: string) {
    const normalized = String(dir || '');
    if (!expandedWorkspaceDirs.value.includes(normalized)) {
      expandedWorkspaceDirs.value = [...expandedWorkspaceDirs.value, normalized];
    }
  }

  function forgetExpandedDir(dir: string) {
    const normalized = String(dir || '');
    expandedWorkspaceDirs.value = expandedWorkspaceDirs.value.filter((item) => item !== normalized);
  }

  function mergeWorkspaceTreeDir(dir: string, files: WorkspaceFile[]) {
    const expanded = new Set(expandedWorkspaceDirs.value);
    workspaceTreeRoot.value = mergeWorkspaceTreeChildren(workspaceTreeRoot.value, dir, files, expanded);
  }

  function workspaceFileMeta(path: string): WorkspaceFile | null {
    const treeNode = findWorkspaceTreeNode(workspaceTreeRoot.value, path);
    if (treeNode) {
      return {
        name: treeNode.name,
        path: treeNode.path,
        kind: treeNode.kind,
        is_dir: treeNode.is_dir,
        size: treeNode.size,
        modified: treeNode.modified,
      };
    }
    return workspaceFiles.value.find((file) => file.path === path) || null;
  }

  function rememberRecentWorkspaceFile(path: string) {
    const meta = workspaceFileMeta(path);
    const file: WorkspaceFile = {
      name: meta?.name || path.split('/').filter(Boolean).at(-1) || path,
      path,
      kind: 'file',
      size: meta?.size,
      modified: meta?.modified,
    };
    recentWorkspaceFiles.value = [file, ...recentWorkspaceFiles.value.filter((item) => item.path !== path)].slice(0, 8);
    writeStored(WORKSPACE_RECENT_KEY, recentWorkspaceFiles.value);
  }

  async function loadWorkspace(dir = workspaceDir.value) {
    const data = await api.files(dir);
    const currentDir = data.dir || dir || '';
    const files = normalizeWorkspaceFiles(data.files || []);
    workspaceDir.value = currentDir;
    workspaceFiles.value = files;
    rememberExpandedDir(currentDir);
    mergeWorkspaceTreeDir(currentDir, files);
  }

  async function loadWorkspaceTreeDir(dir = '', setCurrent = false) {
    const currentDir = String(dir || '');
    workspaceTreeLoading.value = { ...workspaceTreeLoading.value, [currentDir]: true };
    workspaceTreeRoot.value = markWorkspaceTreeLoading(workspaceTreeRoot.value, currentDir, true);
    try {
      const data = await api.files(currentDir);
      const resolvedDir = data.dir || currentDir;
      const files = normalizeWorkspaceFiles(data.files || []);
      rememberExpandedDir(resolvedDir);
      if (setCurrent) {
        workspaceDir.value = resolvedDir;
        workspaceFiles.value = files;
      }
      mergeWorkspaceTreeDir(resolvedDir, files);
      return files;
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    } finally {
      workspaceTreeLoading.value = { ...workspaceTreeLoading.value, [currentDir]: false };
      workspaceTreeRoot.value = markWorkspaceTreeLoading(workspaceTreeRoot.value, currentDir, false);
    }
  }

  async function toggleWorkspaceTreeDir(path: string) {
    const node = findWorkspaceTreeNode(workspaceTreeRoot.value, path);
    if (node?.expanded) {
      forgetExpandedDir(path);
      workspaceTreeRoot.value = setWorkspaceTreeExpanded(workspaceTreeRoot.value, path, false);
      return;
    }
    rememberExpandedDir(path);
    workspaceTreeRoot.value = setWorkspaceTreeExpanded(workspaceTreeRoot.value, path, true);
    if (!node?.loaded) await loadWorkspaceTreeDir(path, true);
    else {
      workspaceDir.value = path;
      workspaceFiles.value = node.children.map((child) => ({
        name: child.name,
        path: child.path,
        kind: child.kind,
        is_dir: child.is_dir,
        size: child.size,
        modified: child.modified,
      }));
    }
  }

  async function selectWorkspacePath(path: string, kind: 'dir' | 'file') {
    if (kind === 'dir') {
      await toggleWorkspaceTreeDir(path);
      return;
    }
    await openFile(path);
  }

  async function refreshWorkspaceTreeParent(path: string) {
    const parent = parentPathOf(path);
    await loadWorkspaceTreeDir(parent, workspaceDir.value === parent);
  }

  async function openFile(path: string) {
    selectedFile.value = path;
    fileError.value = '';
    rememberRecentWorkspaceFile(path);
    if (isWorkspaceTextPreview(path)) {
      const meta = workspaceFileMeta(path);
      if (Number(meta?.size || 0) > WORKSPACE_TEXT_PREVIEW_LIMIT_BYTES) {
        selectedFileContent.value = '';
        editorContent.value = '';
        fileError.value = t('workspace.preview.largeFile', { size: formatFileSize(meta?.size) });
        companionTab.value = 'workspace';
        return;
      }
      selectedFileContent.value = await api.rawFile(path);
      editorContent.value = selectedFileContent.value;
    } else {
      selectedFileContent.value = '';
      editorContent.value = '';
    }
    companionTab.value = 'workspace';
  }

  async function loadAttachments(sessionId = activeSessionId.value) {
    if (!sessionId) {
      attachments.value = [];
      return;
    }
    const data: any = await api.sessionAttachments(sessionId);
    attachments.value = data.attachments || [];
  }

  async function attachWorkspaceFile(path = selectedFile.value) {
    if (!path) return;
    if (!activeSessionId.value) await createSession();
    try {
      const result: any = await api.addSessionAttachment(activeSessionId.value, path, path);
      attachments.value = [result.attachment, ...attachments.value.filter((item) => item.path !== path)];
      activity.value.unshift({ id: `attachment-${Date.now()}`, kind: 'context', title: t('script.stores.app.title.6c796f2b2a'), detail: path, status: 'complete' });
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function removeAttachment(refId: string) {
    const pendingResource = attachments.value.find((item) => item.ref_id === refId && (item.resource_id || item.uri?.startsWith('resource://')));
    if (pendingResource) {
      attachments.value = attachments.value.filter((item) => item.ref_id !== refId);
      return;
    }
    if (!activeSessionId.value) return;
    await api.deleteSessionAttachment(activeSessionId.value, refId);
    attachments.value = attachments.value.filter((item) => item.ref_id !== refId);
  }

  async function uploadWorkspaceFile(file: File, dir = workspaceDir.value) {
    uploadBusy.value = true;
    fileError.value = '';
    try {
      const result: any = await api.uploadFile(file, dir);
      await loadWorkspace(dir);
      await loadWorkspaceTreeDir(dir, workspaceDir.value === dir);
      activity.value.unshift({ id: `upload-${Date.now()}`, kind: 'context', title: t('script.stores.app.title.71be2f4e38'), detail: `${result.path} (${result.size} bytes)`, status: 'complete' });
      return result;
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    } finally {
      uploadBusy.value = false;
    }
  }

  async function uploadWorkspaceFiles(files: FileList | File[], dir = workspaceDir.value) {
    const uploaded = [];
    for (const file of Array.from(files)) {
      uploaded.push(await uploadWorkspaceFile(file, dir));
    }
    return uploaded;
  }

  function rawWorkspaceFileUrl(path = selectedFile.value) {
    return path ? api.workspaceRawUrl(path) : '';
  }

  function downloadWorkspacePath(path: string, kind: 'file' | 'dir' = 'file') {
    if (!path) return;
    const link = document.createElement('a');
    link.href = api.workspaceDownloadUrl(path);
    link.download = kind === 'dir' ? `${path.split('/').filter(Boolean).at(-1) || 'workspace'}.tar` : path.split('/').filter(Boolean).at(-1) || 'download';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function openWorkspacePathExternally(path = selectedFile.value) {
    if (!path) return;
    const kind = workspacePreviewKind(path);
    if (isWorkspaceTextPreview(path)) {
      let content = selectedFile.value === path ? editorContent.value : '';
      if (!content) content = await api.rawFile(path);
      const body = ['markdown', 'web', 'structured', 'text'].includes(kind)
        ? buildWorkspacePreviewHtml(path, content)
        : content;
      const mime = ['markdown', 'web', 'structured', 'text'].includes(kind) ? 'text/html' : workspacePreviewMime(path);
      const blob = new Blob([body], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    if (kind !== 'binary') {
      window.open(api.workspaceRawUrl(path), '_blank', 'noopener,noreferrer');
      return;
    }
    downloadWorkspacePath(path, 'file');
  }

  async function uploadResource(file: File) {
    uploadBusy.value = true;
    fileError.value = '';
    try {
      if (!activeSessionId.value) await createSession();
      const result = await api.uploadResource(file, activeSessionId.value) as RuntimeResourceUpload;
      const resource = result.resource;
      const attachment: SessionAttachment = {
        ref_id: resource.id,
        resource_id: resource.id,
        uri: resource.uri,
        kind: resource.kind,
        path: resource.uri,
        label: resource.original_name,
        size: resource.size_bytes,
        sha256: resource.sha256,
        detected_mime: resource.detected_mime,
        status: 'stored',
        added_at_ms: Date.now(),
      };
      attachments.value = [attachment, ...attachments.value.filter((item) => item.ref_id !== attachment.ref_id)];
      activity.value.unshift({ id: `resource-${Date.now()}`, kind: 'context', title: t('script.stores.app.title.5ccc1613c7'), detail: `${resource.original_name} (${resource.kind})`, status: 'complete' });
      return result;
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    } finally {
      uploadBusy.value = false;
    }
  }

  async function createWorkspaceDir(name: string) {
    return createWorkspaceDirAt(workspaceDir.value, name);
  }

  async function createWorkspaceDirAt(parent: string, name: string) {
    const path = joinWorkspacePath(parent, name.trim());
    if (!path) return;
    try {
      await api.createDir(path);
      await loadWorkspaceTreeDir(parent, workspaceDir.value === parent);
      fileError.value = '';
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    }
  }

  async function createWorkspaceFile(path: string, content = '') {
    const cleanPath = String(path || '').trim();
    if (!cleanPath) return;
    try {
      await api.saveFile(cleanPath, content);
      await refreshWorkspaceTreeParent(cleanPath);
      await openFile(cleanPath);
      fileError.value = '';
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    }
  }

  async function deleteWorkspacePath(path: string) {
    return deleteWorkspacePathConfirmed(path);
  }

  async function deleteWorkspacePathConfirmed(path: string) {
    try {
      await api.deleteWorkspacePath(path);
      if (selectedFile.value === path) {
        selectedFile.value = '';
        selectedFileContent.value = '';
        editorContent.value = '';
      }
      await refreshWorkspaceTreeParent(path);
      fileError.value = '';
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    }
  }

  async function renameWorkspacePath(path: string, to: string) {
    try {
      const result: any = await api.renameWorkspacePath(path, to);
      const nextPath = result.to || to;
      if (selectedFile.value === path) selectedFile.value = nextPath;
      await refreshWorkspaceTreeParent(path);
      if (parentPathOf(nextPath) !== parentPathOf(path)) await refreshWorkspaceTreeParent(nextPath);
      fileError.value = '';
      return result;
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    }
  }

  async function loadWorkspaceMeta(path: string) {
    try {
      workspaceMeta.value = await api.workspaceMeta(path) as Record<string, unknown>;
      fileError.value = '';
      return workspaceMeta.value;
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    }
  }

  function renderMessageWithAttachments(content: string) {
    if (!attachments.value.length) return content;
    const refs = attachments.value
      .filter((item) => !item.resource_id && !item.uri?.startsWith('resource://'))
      .map((item) => `- ${item.path} (${item.label || item.path}, ${item.sha256})`)
      .join('\n');
    if (!refs) return content;
    return `${content}\n\nContext attachments:\n${refs}`;
  }

  async function saveFile() {
    if (!selectedFile.value) return;
    try {
      await api.saveFile(selectedFile.value, editorContent.value);
      selectedFileContent.value = editorContent.value;
      fileError.value = '';
    } catch (error) {
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
    }
  }

  function resetFile() {
    editorContent.value = selectedFileContent.value;
  }

  function openCompanion(tab: CompanionTab) {
    companionTab.value = tab;
    companionCollapsed.value = false;
  }

  function closeCompanion() {
    companionCollapsed.value = true;
  }

  function toggleCompanion() {
    companionCollapsed.value = !companionCollapsed.value;
  }

  function selectSection(page: string, sectionId: string) {
    activeSectionByPage.value = { ...activeSectionByPage.value, [page]: sectionId };
  }

  function openModal(modal: 'model' | 'workspace' | 'commands') {
    activeModal.value = modal;
    if (modal === 'commands' && !commands.value.length) refreshCommands().catch(() => undefined);
  }

  function closeModal() {
    activeModal.value = null;
  }

  async function chooseModel(model: string) {
    commandError.value = '';
    if (!activeSessionId.value) await createSession();
    try {
      await api.updateSession(activeSessionId.value, { model });
      selectedModel.value = model;
      sessions.value = sessions.value.map((session) => session.id === activeSessionId.value ? { ...session, model } : session);
      closeModal();
    } catch (error) {
      commandError.value = t('store.app.model.switchFailed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function chooseProfile(profile: string) {
    commandError.value = '';
    try {
      const result: any = await api.switchProfile(profile);
      selectedProfile.value = result.active_profile || profile;
      const data: any = await api.profiles();
      profiles.value = data.profiles || [];
      closeModal();
    } catch (error) {
      commandError.value = t('store.app.profile.switchFailed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function refreshRuntimeConfigProjection() {
    const [runtime, providerData, reloadStatus] = await Promise.all([
      api.runtimeControlPlane(),
      api.providers(),
      api.configReloadStatus(),
    ]);
    controlPlane.value = runtime;
    providers.value = providerData;
    configReloadStatus.value = reloadStatus;
    const result = {
      kind: 'runtime_projection_refresh',
      status: reloadStatus?.status || 'refreshed',
      config_reload_status: reloadStatus,
    };
    activity.value.unshift({ id: `providers-${Date.now()}`, kind: 'runtime', title: t('script.stores.app.title.8f89f14595'), detail: JSON.stringify(result).slice(0, 240), status: 'complete' });
    return result;
  }

  async function saveDefaultModel(model: string) {
    settings.value = await api.saveConfig({ model });
    providers.value = await api.providers();
    await refreshConfigReloadStatus();
    selectedModel.value = model;
    settingsSavedAt.value = new Date().toLocaleTimeString();
  }

  async function refreshProfiles() {
    const data: any = await api.profiles();
    profiles.value = data.profiles || [];
    selectedProfile.value = data.active_profile || data.runtime_profile || selectedProfile.value;
    return data;
  }

  async function createProfile(name: string) {
    await api.createProfile(name);
    await refreshProfiles();
  }

  async function deleteProfile(id: string) {
    await api.deleteProfile(id);
    await refreshProfiles();
  }

  async function saveApprovalConfig(nextConfig: Record<string, unknown>) {
    approvalConfig.value = await api.updateApprovalConfig(nextConfig);
    settingsSavedAt.value = new Date().toLocaleTimeString();
  }

  async function toggleSolo() {
    approvalConfig.value = await api.toggleSolo();
  }

  async function verifyAuth() {
    return api.authVerify();
  }

  async function refreshGatewayCapabilityContract() {
    const [contract, openApi, openAiTools] = await Promise.all([
      api.gatewayCapabilityContract(),
      api.gatewayOpenApi(),
      api.gatewayOpenAiTools(),
    ]);
    gatewayCapabilityContract.value = contract;
    gatewayOpenApi.value = openApi;
    gatewayOpenAiTools.value = openAiTools;
    gatewayContractError.value = [contract.__error, openApi.__error, openAiTools.__error].filter(Boolean).join(' · ');
    return { contract, openApi, openAiTools };
  }

  async function loadCapability(page: Exclude<NavId, 'chat' | 'settings'>) {
    capabilityLoading.value = { ...capabilityLoading.value, [page]: true };
    capabilityError.value = { ...capabilityError.value, [page]: '' };
    try {
      if (!gatewayCapabilityContract.value) await refreshGatewayCapabilityContract();
      const snapshots = await api.loadCapabilityPage(page, activeSessionId.value, gatewayCapabilityContract.value);
      capabilitySnapshots.value = { ...capabilitySnapshots.value, [page]: snapshots };
    } catch (error) {
      capabilityError.value = { ...capabilityError.value, [page]: error instanceof Error ? error.message : String(error) };
    } finally {
      capabilityLoading.value = { ...capabilityLoading.value, [page]: false };
    }
  }

  async function refreshCommands() {
    const [registry, history] = await Promise.all([api.commands(), api.commandHistory()]);
    commands.value = registry.commands || [];
    commandHistory.value = history.history || [];
  }

  async function executeCommand(command: string, args: Record<string, unknown> = {}) {
    const resolution: any = await api.resolveCommand(command, 'webui', { session_id: activeSessionId.value });
    const resolvedCommand = resolution?.resolution?.command?.name || command;
    const result: any = await api.executeCommand(resolvedCommand, args);
    commandHistory.value = [result, ...commandHistory.value];
    activity.value.unshift({
      id: `command-${Date.now()}`,
      kind: 'runtime',
      title: `Command ${result.command || command}`,
      detail: JSON.stringify(result).slice(0, 220),
      status: result.ok ? 'complete' : 'error',
    });
    return result;
  }

  async function runCapabilityAction(page: string, label: string, endpoint?: string) {
    if (!endpoint) return;
    const id = `${page}:${label}`;
    companionTab.value = 'activity';
    activity.value.unshift({
      id: `${id}:${Date.now()}`,
      kind: 'tool',
      title: label,
      detail: endpoint,
      status: 'running',
    });
    try {
      const result = await api.executeCapabilityAction(endpoint, { label, session_id: activeSessionId.value });
      actionResults.value = { ...actionResults.value, [id]: result };
      activity.value.unshift({
        id: `${id}:done:${Date.now()}`,
        kind: 'tool',
        title: `${label} completed`,
        detail: JSON.stringify(result).slice(0, 220),
        status: 'complete',
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      actionResults.value = { ...actionResults.value, [id]: { error: detail } };
      activity.value.unshift({ id: `${id}:error:${Date.now()}`, kind: 'error', title: `${label} failed`, detail, status: 'error' });
    }
  }

  return {
    booted,
    health,
    settings,
    controlPlane,
    providers,
    configReloadStatus,
    configReloadInvalid,
    configReloadNeedsRestart,
    configReloadAttention,
    profiles,
    commands,
    commandHistory,
    approvalConfig,
    sessions,
    activeSessionId,
    turns,
    activity,
    companionTab,
    chatDisplayMode,
    currentRun,
    currentContextEnvelope,
    currentRealityFlow,
    currentTimeline,
    sessionInputProjection,
    turnInbox,
    selectedTurnEvidence,
    selectedActivity,
    toolCallCount,
    memoryRecallCount,
    memoryEvidenceCount,
    runStageSummary,
    currentRunFiles,
    workspaceRoot,
    workspaceDir,
    workspaceFiles,
    workspaceTreeRoot,
    expandedWorkspaceDirs,
    workspaceTreeLoading,
    workspaceMeta,
    recentWorkspaceFiles,
    attachments,
    workspaceFilter,
    filteredWorkspaceFiles,
    selectedFile,
    selectedFileContent,
    editorContent,
    fileError,
    uploadBusy,
    settingsSavedAt,
    activeSectionByPage,
    companionCollapsed,
    activeModal,
    selectedModel,
    selectedProfile,
    contextUsagePercent,
    contextUsageSource,
    contextUsedTokens,
    contextLimitTokens,
    contextUsageLabel,
    availableModels,
    availableProfiles,
    commandError,
    sessionQuery,
    filteredSessions,
    groupedSessions,
    sessionHasMore,
    sessionLoadingMore,
    selectedSessionIds,
    pinnedSessionIds,
    sessionRenderLimit,
    sessionRenderHasMore,
    openTurnActivity,
    actionResults,
    gatewayCapabilityContract,
    gatewayOpenApi,
    gatewayOpenAiTools,
    gatewayContractError,
    capabilitySnapshots,
    capabilityLoading,
    capabilityError,
    editorDirty,
    busy,
    activeSession,
    boot,
    refreshSessions,
    loadMoreSessions,
    loadMessages,
    refreshContextUsage,
    createSession,
    deleteSession,
    toggleSessionSelected,
    clearSessionSelection,
    deleteSelectedSessions,
    markSessionViewed,
    isSessionPinned,
    isSessionUnread,
    isSessionRunning,
    sessionAttention,
    toggleSessionPin,
    revealMoreSessions,
    branchSession,
    compactSession,
    send,
    loadActivity,
    loadTurnEvidence,
    clearTurnEvidence,
    isTurnActivityOpen,
    toggleTurnActivity,
    turnActivitySummary,
    refreshChatProjection,
    refreshSessionInputs,
    loadWorkspace,
    loadWorkspaceTreeDir,
    toggleWorkspaceTreeDir,
    selectWorkspacePath,
    rememberRecentWorkspaceFile,
    openFile,
    loadAttachments,
    attachWorkspaceFile,
    removeAttachment,
    uploadWorkspaceFile,
    uploadWorkspaceFiles,
    uploadResource,
    createWorkspaceDir,
    createWorkspaceDirAt,
    createWorkspaceFile,
    deleteWorkspacePath,
    deleteWorkspacePathConfirmed,
    renameWorkspacePath,
    loadWorkspaceMeta,
    rawWorkspaceFileUrl,
    downloadWorkspacePath,
    openWorkspacePathExternally,
    saveFile,
    resetFile,
    openCompanion,
    closeCompanion,
    toggleCompanion,
    stopCurrentTurn,
    cancelSessionInput,
    reclassifySessionInput,
    retryLastUserTurn,
    setChatDisplayMode,
    selectSection,
    openModal,
    closeModal,
    chooseModel,
    chooseProfile,
    refreshRuntimeConfigProjection,
    refreshConfigReloadStatus,
    saveDefaultModel,
    refreshProfiles,
    createProfile,
    deleteProfile,
    saveApprovalConfig,
    toggleSolo,
    verifyAuth,
    refreshGatewayCapabilityContract,
    loadCapability,
    refreshCommands,
    executeCommand,
    runCapabilityAction,
    sessionTitle,
    sessionSnippet,
    compactTime,
  };
});
