import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import {
  api,
  invalidateApiReadCache,
  providerModels,
} from '../api/client';
import {
  adaptRuntimeTimeline,
  type RuntimeTimelineRow,
} from '../adapters/graph/runtimeTimeline';
import { t } from '../i18n';
import type {
  ActivityEvent,
  ChatTurn,
  CompanionTab,
  NavId,
  RuntimeResourceUpload,
  SessionAttachment,
  SessionSummary,
  WorkspaceFile,
} from '../types';
import { cleanAssistantContent } from '../utils/chatContent';
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
import { activitySummary, normalizeTurnActivity } from '../utils/turnSettlement';
import { useChatSessionsStore } from './chatSessions';
import { useProjectionRegistryStore } from './projectionRegistry';

const PINNED_SESSION_KEY = 'cowd.webui.sessions.pinned';
const VIEWED_SESSION_KEY = 'cowd.webui.sessions.viewedCounts';
const WORKSPACE_RECENT_KEY = 'cowd.webui.workspace.recentFiles';
const WORKSPACE_TEXT_PREVIEW_LIMIT_BYTES = 1024 * 1024;

type CapabilityLoadPhase = 'idle' | 'loading' | 'ready' | 'error';
type CapabilityLoadState = {
  phase: CapabilityLoadPhase;
  generation: number;
  loadedAt: string;
  error: string;
};

function capabilityLoadState(): CapabilityLoadState {
  return { phase: 'idle', generation: 0, loadedAt: '', error: '' };
}

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

function timelineActivityKind(row: RuntimeTimelineRow): ActivityEvent['kind'] {
  if (row.domain === 'tool') return 'tool';
  if (row.domain === 'context') return 'context';
  if (row.kind.toLowerCase().includes('approval')) return 'approval';
  if (row.kind.toLowerCase().includes('thinking')) return 'think';
  if (['error', 'failed', 'denied', 'timed_out'].includes(row.status.toLowerCase())) return 'error';
  return 'runtime';
}

function timelineActivity(row: RuntimeTimelineRow): ActivityEvent {
  return sanitizeActivityEvent({
    id: row.id,
    kind: timelineActivityKind(row),
    title: row.title,
    detail: row.detail,
    status: row.status,
    at: row.at,
    domain: row.domain,
    event_kind: row.kind,
    sequence: row.sequence,
    route: row.route,
    correlation: row.correlation,
    refs: row.refs,
    raw: row.raw,
  });
}

function updatedAtMs(session: SessionSummary) {
  const value = session.updated_at || session.created_at || 0;
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionTitle(session: SessionSummary) {
  const title = String(session.title || '').trim();
  const snippet = String(session.snippet || session.first_message || session.summary || '').replace(/\s+/g, ' ').trim();
  if (title && title !== session.id && !isGeneratedSessionTitle(session, title)) return title;
  if (snippet) return snippet.slice(0, 40);
  if (title) return title;
  return session.id ? session.id.slice(0, 12) : 'session';
}

function isGeneratedSessionTitle(session: SessionSummary, value = String(session.title || '').trim()) {
  const title = value.toLowerCase();
  const idPrefix = String(session.id || '').slice(0, 8).toLowerCase();
  if (!title || title === String(session.id || '').toLowerCase()) return true;
  return [
    `webui ${idPrefix}`,
    `tui ${idPrefix}`,
    `session ${idPrefix}`,
    `api_server ${idPrefix}`,
    `socket ${idPrefix}`,
    `cli ${idPrefix}`,
    `internal ${idPrefix}`,
  ].includes(title);
}

function firstMessageTitle(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const characters = Array.from(normalized);
  return characters.length > 40
    ? `${characters.slice(0, 40).join('')}…`
    : normalized;
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

function visibleSessionRows(rows: unknown): SessionSummary[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((session): session is SessionSummary => (
      !!session
      && typeof session === 'object'
      && String((session as SessionSummary).status || '').toLowerCase() !== 'deleted'
    ));
}

export const useAppStore = defineStore('app', () => {
  const chatSessions = useChatSessionsStore();
  const projectionRegistry = useProjectionRegistryStore();
  let configReloadTimer: ReturnType<typeof setInterval> | null = null;
  let bootPromise: Promise<void> | null = null;
  let sessionCreateFlight: Promise<SessionSummary> | null = null;
  let activeSessionLoadGeneration = 0;
  let authorizationGeneration = 0;
  let companionHydrationController: AbortController | null = null;
  let companionHydrationGeneration = 0;
  const revokedSessionIds = new Set<string>();
  let uploadOperationSequence = 0;
  const activeUploadOperations = new Set<number>();
  const booted = ref(false);
  const sessionCreating = ref(false);
  const authorizationState = ref<'checking' | 'ready' | 'required' | 'invalidated'>('checking');
  const authorizationViewGeneration = ref(0);
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
  const activity = ref<ActivityEvent[]>([]);
  const companionTab = ref<CompanionTab>('activity');
  const criticalBoot = ref<CapabilityLoadState>(capabilityLoadState());
  const chatCapabilities = ref<CapabilityLoadState>(capabilityLoadState());
  const managementCapabilities = ref<Record<string, CapabilityLoadState>>({});
  const companionHydration = ref<CapabilityLoadState>(capabilityLoadState());
  const currentRun = ref<any>(null);
  const currentContextEnvelope = ref<any>(null);
  const currentRealityFlow = ref<any>({});
  const currentTimeline = ref<any>({});
  const runtimeTimelineRows = computed(() => adaptRuntimeTimeline(
    Array.isArray(currentTimeline.value?.events)
      ? currentTimeline.value.events
      : Array.isArray(currentTimeline.value?.timeline)
        ? currentTimeline.value.timeline
        : [],
  ));
  const sessionInputProjection = ref<any>(null);
  const turnInbox = ref<any>(null);
  const selectedActivity = ref<Record<string, unknown> | null>(null);
  const chatExecutionGraphExpanded = ref(false);
  const chatExecutionGraphId = ref('');
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
  const sessionQuery = ref('');
  const sessionPageLimit = ref(50);
  const sessionOffset = ref(0);
  const sessionHasMore = ref(true);
  const sessionLoadingMore = ref(false);
  const selectedSessionIds = ref<string[]>([]);
  const sessionBulkDeleteProgress = ref({ active: false, done: 0, total: 0 });
  const openTurnActivity = ref<Record<string, boolean>>({});
  const pinnedSessionIds = ref<string[]>(readStoredArray(PINNED_SESSION_KEY));
  const sessionViewedCounts = ref<Record<string, number>>(readStoredRecord(VIEWED_SESSION_KEY));
  const sessionRenderLimit = ref(100);
  const actionResults = ref<Record<string, any>>({});
  const authEntitlement = ref<Record<string, unknown> | null>(null);
  const editorDirty = computed(() => selectedFileContent.value !== editorContent.value);
  const filteredWorkspaceFiles = computed(() => {
    const query = workspaceFilter.value.trim().toLowerCase();
    if (!query) return workspaceFiles.value;
    return workspaceFiles.value.filter((file) => `${file.name} ${file.path}`.toLowerCase().includes(query));
  });
  const busy = ref(false);

  function beginUploadOperation() {
    const operation = ++uploadOperationSequence;
    activeUploadOperations.add(operation);
    uploadBusy.value = true;
    return operation;
  }

  function finishUploadOperation(operation: number) {
    activeUploadOperations.delete(operation);
    uploadBusy.value = activeUploadOperations.size > 0;
  }

  function clearActiveSessionDerivedState() {
    attachments.value = [];
    activity.value = [];
    currentRun.value = null;
    currentContextEnvelope.value = null;
    currentRealityFlow.value = {};
    currentTimeline.value = {};
    sessionInputProjection.value = null;
    turnInbox.value = null;
    selectedActivity.value = null;
    chatExecutionGraphExpanded.value = false;
    openTurnActivity.value = {};
  }

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
  const runStageSummary = computed(() => {
    const events = Array.isArray(currentTimeline.value?.events) ? currentTimeline.value.events : [];
    const stageIds = [
      ['intake', ['message', 'turn', 'runtimerun']],
      ['context', ['context']],
      ['memory', ['memory', 'recall']],
      ['governance', ['approval', 'policy', 'risk']],
      ['task', ['task']],
      ['execution', ['tool', 'scheduler']],
      ['agent', ['agent', 'execution_graph']],
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
    const projectionId = String(
      chatSessions.active?.executionGraphId
      || chatSessions.active?.executionId
      || '',
    );
    const projectionActivities = projectionId
      ? projectionRegistry.projectionFor(projectionId)?.activities || []
      : [];
    const typedRefs = [
      ...projectionActivities,
      ...activity.value,
    ].flatMap((event: any) => [
      ...(Array.isArray(event?.raw?.refs) ? event.raw.refs : []),
      ...(Array.isArray(event?.refs) ? event.refs : []),
    ]).filter((reference: any) => (
      ['file', 'resource'].includes(String(reference?.type || reference?.kind || '').toLowerCase())
    ));
    typedRefs.forEach((reference: any) => {
      const path = String(reference?.path || reference?.id || reference?.ref || '')
        .replace(/^resource:\/\//, '')
        .trim();
      if (path && !fileMap.has(path)) {
        fileMap.set(path, {
          path,
          kind: String(reference?.type || reference?.kind || 'runtime-ref'),
          status: 'observed',
          ref: String(reference?.ref || reference?.id || path),
        });
      }
    });
    return Array.from(fileMap.values());
  });

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

  function boot() {
    if (booted.value) return Promise.resolve();
    if (bootPromise) return bootPromise;
    const generation = authorizationGeneration;
    const isCurrent = () => generation === authorizationGeneration;
    const pendingBoot = (async () => {
      busy.value = true;
      criticalBoot.value = {
        phase: 'loading',
        generation: criticalBoot.value.generation + 1,
        loadedAt: '',
        error: '',
      };
      authorizationState.value = 'checking';
      try {
        const bootActiveSessionId = activeSessionId.value;
        const bootSessionsWereEmpty = sessions.value.length === 0;
        const authState = await api.authVerify();
        if (!isCurrent()) return;
        authEntitlement.value = authState.entitlement || null;
        if (
          String(authState.__state || '') === 'forbidden'
          || (
            authState.auth_required === true
            && authState.valid !== true
            && String(authState.__state || '') === 'ready'
          )
        ) {
          authorizationState.value = 'required';
          return;
        }
        authorizationState.value = 'ready';
        const [manifest, sessionData] = await Promise.all([
          api.health(),
          api.sessions(sessionPageLimit.value, 0, true),
        ]);
        if (!isCurrent()) return;
        health.value = manifest;
        const bootSessions = visibleSessionRows(sessionData.sessions);
        if (bootSessionsWereEmpty && sessions.value.length === 0) {
          sessions.value = bootSessions;
        }
        sessionOffset.value = sessions.value.length;
        sessionHasMore.value = sessions.value.length >= sessionPageLimit.value;
        let initialSessionId = '';
        if (bootActiveSessionId && activeSessionId.value === bootActiveSessionId) {
          initialSessionId = bootActiveSessionId;
        } else if (!activeSessionId.value && sessions.value[0]) {
          activeSessionId.value = sessions.value[0].id;
          initialSessionId = activeSessionId.value;
        }
        await (initialSessionId ? loadMessages(initialSessionId) : Promise.resolve());
        if (!isCurrent()) return;
        booted.value = true;
        criticalBoot.value = {
          phase: 'ready',
          generation: criticalBoot.value.generation,
          loadedAt: new Date().toISOString(),
          error: '',
        };
      } catch (error) {
        if (isCurrent()) {
          criticalBoot.value = {
            phase: 'error',
            generation: criticalBoot.value.generation,
            loadedAt: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }
        throw error;
      } finally {
        if (isCurrent()) busy.value = false;
      }
    });
    let trackedBoot!: Promise<void>;
    trackedBoot = pendingBoot().finally(() => {
      if (bootPromise === trackedBoot) bootPromise = null;
    });
    bootPromise = trackedBoot;
    return trackedBoot;
  }

  function startConfigReloadPolling() {
    if (typeof window === 'undefined' || configReloadTimer) return;
    configReloadTimer = window.setInterval(() => {
      refreshConfigReloadStatus().catch(() => undefined);
    }, 5000);
  }

  async function refreshConfigReloadStatus() {
    const generation = authorizationGeneration;
    const status = await api.configReloadStatus();
    if (generation !== authorizationGeneration) return configReloadStatus.value;
    configReloadStatus.value = status || {};
    return configReloadStatus.value;
  }

  async function loadMessages(sessionId: string) {
    cancelCompanionHydration();
    const generation = ++activeSessionLoadGeneration;
    activeSessionId.value = sessionId;
    const selectedSession = sessions.value.find((session) => session.id === sessionId);
    if (selectedSession?.model) selectedModel.value = selectedSession.model;
    // Shell-level projections are not session keyed. Clear them synchronously
    // at the identity boundary so session B can never display or mutate
    // session A's attachments, context, activity or input receipts while its
    // own requests are still in flight.
    clearActiveSessionDerivedState();
    openTurnActivity.value = loadTurnActivityState(sessionId);
    const chat = chatSessions;
    chat.activeSessionId = sessionId;
    await chat.open(sessionId);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
    markSessionViewed(sessionId);
    ensureSessionTitleFromFirstMessage(sessionId).catch(() => undefined);
    // Attachments and queued inputs enrich the composer but must not delay the
    // transcript. Runtime timeline/reality/context are loaded only when the
    // panorama surface is actually visible.
    queueMicrotask(() => {
      if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
      chat.hydrateExecutionIndex(sessionId, false).catch(() => undefined);
      Promise.allSettled([
        loadAttachments(sessionId, generation),
        refreshSessionInputs(sessionId, generation),
      ]).catch(() => undefined);
      if (!companionCollapsed.value) {
        hydrateCompanionTab(companionTab.value).catch(() => undefined);
      }
    });
  }

  function cancelCompanionHydration() {
    companionHydrationController?.abort();
    companionHydrationController = null;
    companionHydrationGeneration += 1;
  }

  async function hydrateCompanionTab(tab = companionTab.value) {
    const sessionId = activeSessionId.value;
    if (!sessionId) return;
    cancelCompanionHydration();
    const controller = new AbortController();
    companionHydrationController = controller;
    const generation = activeSessionLoadGeneration;
    const hydrationGeneration = companionHydrationGeneration;
    companionHydration.value = {
      phase: 'loading',
      generation: hydrationGeneration,
      loadedAt: '',
      error: '',
    };
    const isCurrent = () => (
      !controller.signal.aborted
      && activeSessionId.value === sessionId
      && activeSessionLoadGeneration === generation
      && companionTab.value === tab
      && !companionCollapsed.value
      && companionHydrationGeneration === hydrationGeneration
    );
    const chat = chatSessions;
    try {
      if (tab === 'activity') {
        await Promise.all([
          chat.hydrateRuntimeDetails(sessionId, true),
          refreshSessionInputs(sessionId, generation, controller.signal),
          refreshChatProjection(sessionId, '', generation, controller.signal),
        ]);
      } else if (tab === 'workspace') {
        await loadWorkspace('', controller.signal);
      }
      if (!isCurrent()) return;
      companionHydration.value = {
        phase: 'ready',
        generation: hydrationGeneration,
        loadedAt: new Date().toISOString(),
        error: '',
      };
    } catch (error) {
      if (!isCurrent()) return;
      companionHydration.value = {
        phase: 'error',
        generation: hydrationGeneration,
        loadedAt: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function refreshSessions(query = sessionQuery.value, reset = true) {
    const generation = authorizationGeneration;
    const offset = reset ? 0 : sessionOffset.value;
    const normalizedQuery = query.trim();
    const [data, messageMatches] = await Promise.all([
      api.searchSessions(normalizedQuery, sessionPageLimit.value, offset),
      normalizedQuery && reset
        ? api.searchMessages(normalizedQuery, sessionPageLimit.value)
        : Promise.resolve({ query: normalizedQuery, results: [], total: 0 }),
    ]);
    if (generation !== authorizationGeneration) return data;
    const directSessions = visibleSessionRows(data.sessions)
      .filter((session) => !revokedSessionIds.has(session.id));
    const directIds = new Set(directSessions.map((session) => session.id));
    const matchedSessionIds = Array.from(new Set(
      messageMatches.results
        .map((result) => result.session_id)
        .filter((sessionId) => sessionId && !directIds.has(sessionId)),
    ));
    const matchedSessions = normalizedQuery && reset
      ? (await Promise.all(matchedSessionIds.map(async (sessionId) => {
          try {
            const session = await api.session(sessionId);
            const match = messageMatches.results.find((result) => result.session_id === sessionId);
            return {
              ...session,
              snippet: match?.content_preview || session.snippet,
            };
          } catch {
            return null;
          }
        }))).filter((session): session is SessionSummary => Boolean(session))
      : [];
    if (generation !== authorizationGeneration) return data;
    const nextSessions = [...directSessions, ...matchedSessions]
      .filter((session, index, rows) => (
        rows.findIndex((candidate) => candidate.id === session.id) === index
      ))
      .sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0));
    sessions.value = reset ? nextSessions : [...sessions.value, ...nextSessions.filter((session) => !sessions.value.some((item) => item.id === session.id))];
    sessionOffset.value = sessions.value.length;
    sessionHasMore.value = directSessions.length >= sessionPageLimit.value;
    if (!activeSessionId.value && sessions.value[0]) activeSessionId.value = sessions.value[0].id;
    return data;
  }

  async function refreshSessionStatuses() {
    const generation = authorizationGeneration;
    const limit = Math.max(sessionPageLimit.value, Math.min(200, sessions.value.length));
    const data = await api.sessions(limit, 0, true);
    if (generation !== authorizationGeneration) return data;
    const updates = new Map(
      visibleSessionRows(data.sessions)
        .filter((session) => !revokedSessionIds.has(session.id))
        .map((session) => [session.id, session]),
    );
    sessions.value = sessions.value
      .filter((session) => String(session.status || '').toLowerCase() !== 'deleted')
      .map((session) => {
        const update = updates.get(session.id);
        if (!update) return session;
        const previousStatus = String(session.execution?.latest_status || '').toLowerCase();
        const previousWasRunning = [
          'queued',
          'preparing_context',
          'calling_model',
          'thinking',
          'calling_tool',
          'waiting_approval',
          'finalizing',
        ].includes(previousStatus);
        return {
          ...session,
          ...update,
          execution: update.execution || (previousWasRunning ? undefined : session.execution),
        };
      });
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

  async function createSession(): Promise<SessionSummary> {
    if (sessionCreateFlight) return sessionCreateFlight;
    const previousSessionId = activeSessionId.value;
    const creationGeneration = ++activeSessionLoadGeneration;
    activeSessionId.value = '';
    chatSessions.activeSessionId = '';
    clearActiveSessionDerivedState();
    sessionCreating.value = true;
    sessionCreateFlight = (async () => {
      let session: SessionSummary;
      try {
        session = await api.createSession(selectedModel.value || undefined);
      } catch (error) {
        if (
          activeSessionLoadGeneration === creationGeneration
          && !activeSessionId.value
          && previousSessionId
        ) {
          activeSessionId.value = previousSessionId;
          chatSessions.activeSessionId = previousSessionId;
        }
        throw error;
      }
      sessions.value = [session, ...sessions.value.filter((item) => item.id !== session.id)];
      selectedModel.value = session.model || selectedModel.value;
      if (activeSessionLoadGeneration === creationGeneration && !activeSessionId.value) {
        // Creation is the mutation boundary: once the Gateway returns the
        // Session, it is immediately actionable. Transcript/live projection
        // hydration continues independently and must not keep the composer
        // disabled behind history or projection latency.
        void loadMessages(session.id).catch((error) => {
          const state = chatSessions.states[session.id];
          if (state) {
            state.lastError = String(
              (error as any)?.message || error || 'new Session hydration failed',
            );
          }
        });
      }
      return session;
    })().finally(() => {
      sessionCreating.value = false;
      sessionCreateFlight = null;
    });
    return sessionCreateFlight;
  }

  async function deleteSession(sessionId: string) {
    await api.deleteSession(sessionId);
    const chat = chatSessions;
    chat.setDraft(sessionId, '');
    chat.close(sessionId);
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    selectedSessionIds.value = selectedSessionIds.value.filter((id) => id !== sessionId);
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0]?.id || '';
      if (activeSessionId.value) await loadMessages(activeSessionId.value);
    }
  }

  async function ensureSessionTitleFromFirstMessage(sessionId: string, content = '') {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session || !isGeneratedSessionTitle(session)) return false;
    const chat = chatSessions;
    const firstUserMessage = content || chat.states[sessionId]?.turns.find((turn) => (
      turn.role === 'user' && turn.content.trim()
    ))?.content || '';
    const title = firstMessageTitle(firstUserMessage);
    if (!title || title === session.title) return false;
    await api.updateSession(sessionId, { title });
    session.title = title;
    session.first_message = firstUserMessage;
    return true;
  }

  function toggleSessionSelected(sessionId: string) {
    selectedSessionIds.value = selectedSessionIds.value.includes(sessionId)
      ? selectedSessionIds.value.filter((id) => id !== sessionId)
      : [...selectedSessionIds.value, sessionId];
  }

  function markSessionViewed(sessionId: string) {
    const session = sessions.value.find((item) => item.id === sessionId);
    const count = Number(session?.message_count || 0);
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
    const status = String(session.execution?.latest_status || '').toLowerCase();
    return !!session.is_streaming
      || !!session.active_stream_id
      || !!session.pending_user_message
      || ['queued', 'preparing_context', 'calling_model', 'thinking', 'calling_tool', 'waiting_approval', 'finalizing'].includes(status);
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
    if (!ids.length) return { deleted: 0, failures: [] };
    sessionBulkDeleteProgress.value = { active: true, done: 0, total: ids.length };
    const failures: any[] = [];
    const deleted = new Set<string>();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor];
        cursor += 1;
        try {
          await api.deleteSession(id);
          deleted.add(id);
        } catch (error) {
          failures.push({ id, error: error instanceof Error ? error.message : String(error) });
        } finally {
          sessionBulkDeleteProgress.value = {
            active: true,
            done: sessionBulkDeleteProgress.value.done + 1,
            total: ids.length,
          };
        }
      }
    });
    await Promise.all(workers);
    const chat = chatSessions;
    deleted.forEach((id) => {
      chat.setDraft(id, '');
      chat.close(id);
    });
    sessions.value = sessions.value.filter((session) => !deleted.has(session.id));
    selectedSessionIds.value = failures.map((failure) => failure.id);
    if (deleted.has(activeSessionId.value)) {
      activeSessionId.value = sessions.value[0]?.id || '';
      if (activeSessionId.value) await loadMessages(activeSessionId.value);
    }
    sessionBulkDeleteProgress.value = { active: false, done: ids.length, total: ids.length };
    if (failures.length) {
      selectedActivity.value = { kind: 'session.bulk_delete', failures };
      companionTab.value = 'inspector';
    }
    return { deleted: deleted.size, failures };
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
    const generation = activeSessionLoadGeneration;
    const result = await api.compactSession(sessionId);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) {
      return result;
    }
    activity.value.unshift({ id: `compact-${Date.now()}`, kind: 'runtime', title: t('script.stores.app.title.2b43f89c03'), detail: JSON.stringify(result).slice(0, 220), status: 'complete' });
    await loadActivity(sessionId, generation);
    return result;
  }

  async function loadActivity(
    sessionId = activeSessionId.value,
    generation = activeSessionLoadGeneration,
    signal?: AbortSignal,
  ) {
    if (!sessionId) {
      activity.value = [];
      return;
    }
    const data: any = await api.runtimeTimeline(sessionId, signal);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
    currentTimeline.value = data;
    activity.value = runtimeTimelineRows.value.slice(0, 50).map(timelineActivity);
  }

  async function refreshChatProjection(
    sessionId = activeSessionId.value,
    query = '',
    generation = activeSessionLoadGeneration,
    signal?: AbortSignal,
  ) {
    if (!sessionId || companionCollapsed.value || companionTab.value !== 'activity') return;
    const [timeline, reality, context] = await Promise.all([
      api.runtimeTimeline(sessionId, signal),
      api.realityFlow(sessionId, 80, signal),
      api.contextCurrent(sessionId, query, 'main_turn', signal),
    ]);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
    currentTimeline.value = timeline;
    activity.value = runtimeTimelineRows.value.slice(0, 50).map(timelineActivity);
    currentRealityFlow.value = reality;
    if (!currentContextEnvelope.value || context?.identity || context?.envelope) currentContextEnvelope.value = context.envelope || context;
  }

  async function refreshSessionInputs(
    sessionId = activeSessionId.value,
    generation = activeSessionLoadGeneration,
    signal?: AbortSignal,
  ) {
    if (!sessionId) return;
    const [projection, inbox] = await Promise.all([
      api.sessionInputs(sessionId, signal).catch(() => null),
      api.turnInbox(sessionId, undefined, signal).catch(() => null),
    ]);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
    if (projection) sessionInputProjection.value = projection;
    if (inbox) turnInbox.value = inbox;
  }

  function recordActivity(kind: ActivityEvent['kind'], title: string, detail: string, status: string) {
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
  }

  function recordProjectionWarnings(receipt: any) {
    const warnings = Array.isArray(receipt?.projection_warnings) ? receipt.projection_warnings : [];
    for (const warning of warnings) {
      recordActivity(
        'runtime',
        t('chat.input.projectionWarning'),
        `${warning?.projection || 'projection'}: ${warning?.error || t('chat.input.projectionUnavailable')}`,
        'attention',
      );
    }
  }

  async function cancelSessionInput(inputId: string, reason = 'cancelled from webui') {
    if (!activeSessionId.value || !inputId) return null;
    const sessionId = activeSessionId.value;
    const generation = activeSessionLoadGeneration;
    const receipt = await api.cancelSessionInput(sessionId, inputId, reason);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return receipt;
    if (receipt?.input_projection) sessionInputProjection.value = receipt.input_projection;
    if (receipt?.turn_inbox) turnInbox.value = receipt.turn_inbox;
    recordProjectionWarnings(receipt);
    recordActivity('runtime', t('chat.input.cancelled'), inputId, receipt?.input ? 'complete' : 'error');
    return receipt;
  }

  async function reclassifySessionInput(inputId: string, decision = 'enqueue_next_step', reason = 'manual webui override') {
    if (!activeSessionId.value || !inputId) return null;
    const sessionId = activeSessionId.value;
    const generation = activeSessionLoadGeneration;
    const receipt = await api.reclassifySessionInput(sessionId, inputId, decision, reason);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return receipt;
    if (receipt?.input_projection) sessionInputProjection.value = receipt.input_projection;
    if (receipt?.turn_inbox) turnInbox.value = receipt.turn_inbox;
    recordProjectionWarnings(receipt);
    recordActivity('runtime', t('chat.input.reclassified'), `${inputId} -> ${decision}`, receipt?.input ? 'complete' : 'error');
    return receipt;
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

  async function loadWorkspace(dir = workspaceDir.value, signal?: AbortSignal) {
    const generation = authorizationGeneration;
    const data = await api.files(dir, signal);
    if (generation !== authorizationGeneration) return;
    const currentDir = data.dir || dir || '';
    const files = normalizeWorkspaceFiles(data.files || []);
    workspaceDir.value = currentDir;
    workspaceFiles.value = files;
    rememberExpandedDir(currentDir);
    mergeWorkspaceTreeDir(currentDir, files);
  }

  async function loadWorkspaceTreeDir(dir = '', setCurrent = false) {
    const currentDir = String(dir || '');
    const generation = authorizationGeneration;
    workspaceTreeLoading.value = { ...workspaceTreeLoading.value, [currentDir]: true };
    workspaceTreeRoot.value = markWorkspaceTreeLoading(workspaceTreeRoot.value, currentDir, true);
    try {
      const data = await api.files(currentDir);
      if (generation !== authorizationGeneration) return [];
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
      if (generation !== authorizationGeneration) return [];
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    } finally {
      if (generation === authorizationGeneration) {
        workspaceTreeLoading.value = { ...workspaceTreeLoading.value, [currentDir]: false };
        workspaceTreeRoot.value = markWorkspaceTreeLoading(workspaceTreeRoot.value, currentDir, false);
      }
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
    const generation = authorizationGeneration;
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
      try {
        const content = await api.rawFile(path);
        if (generation !== authorizationGeneration || selectedFile.value !== path) return;
        selectedFileContent.value = content;
        editorContent.value = content;
      } catch (error) {
        if (generation !== authorizationGeneration || selectedFile.value !== path) return;
        selectedFileContent.value = '';
        editorContent.value = '';
        fileError.value = error instanceof Error ? error.message : String(error);
      }
    } else {
      selectedFileContent.value = '';
      editorContent.value = '';
    }
    companionTab.value = 'workspace';
  }

  async function loadAttachments(
    sessionId = activeSessionId.value,
    generation = activeSessionLoadGeneration,
  ) {
    if (!sessionId) {
      attachments.value = [];
      return;
    }
    const data: any = await api.sessionAttachments(sessionId);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
    attachments.value = data.attachments || [];
  }

  async function attachWorkspaceFile(path = selectedFile.value) {
    if (!path) return;
    if (!activeSessionId.value) await createSession();
    const sessionId = activeSessionId.value;
    const generation = activeSessionLoadGeneration;
    try {
      const result: any = await api.addSessionAttachment(sessionId, path, path);
      if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
      attachments.value = [result.attachment, ...attachments.value.filter((item) => item.path !== path)];
      activity.value.unshift({ id: `attachment-${Date.now()}`, kind: 'context', title: t('script.stores.app.title.6c796f2b2a'), detail: path, status: 'complete' });
    } catch (error) {
      if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
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
    const sessionId = activeSessionId.value;
    const generation = activeSessionLoadGeneration;
    await api.deleteSessionAttachment(sessionId, refId);
    if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
    attachments.value = attachments.value.filter((item) => item.ref_id !== refId);
  }

  async function uploadWorkspaceFile(file: File, dir = workspaceDir.value) {
    const operation = beginUploadOperation();
    const generation = authorizationGeneration;
    fileError.value = '';
    try {
      const result: any = await api.uploadFile(file, dir);
      if (generation !== authorizationGeneration) return result;
      await loadWorkspace(dir);
      await loadWorkspaceTreeDir(dir, workspaceDir.value === dir);
      if (generation !== authorizationGeneration) return result;
      activity.value.unshift({ id: `upload-${Date.now()}`, kind: 'context', title: t('script.stores.app.title.71be2f4e38'), detail: `${result.path} (${result.size} bytes)`, status: 'complete' });
      return result;
    } catch (error) {
      if (generation !== authorizationGeneration) throw error;
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    } finally {
      finishUploadOperation(operation);
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
    link.download = kind === 'dir' ? `${path.split('/').filter(Boolean).at(-1) || 'workspace'}.zip` : path.split('/').filter(Boolean).at(-1) || 'download';
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
    const operation = beginUploadOperation();
    const authorization = authorizationGeneration;
    fileError.value = '';
    let sessionId = activeSessionId.value;
    let generation = activeSessionLoadGeneration;
    try {
      if (!activeSessionId.value) await createSession();
      sessionId = activeSessionId.value;
      generation = activeSessionLoadGeneration;
      const result = await api.uploadResource(file, sessionId) as RuntimeResourceUpload;
      if (
        authorization !== authorizationGeneration
        || activeSessionId.value !== sessionId
        || generation !== activeSessionLoadGeneration
      ) {
        return result;
      }
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
      if (
        authorization !== authorizationGeneration
        || activeSessionId.value !== sessionId
        || generation !== activeSessionLoadGeneration
      ) {
        throw error;
      }
      fileError.value = error instanceof Error ? error.message : String(error);
      companionTab.value = 'inspector';
      throw error;
    } finally {
      finishUploadOperation(operation);
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

  function composeChatInput(content: string) {
    const resourceIds = attachments.value
      .filter((item) => item.resource_id || item.uri?.startsWith('resource://'))
      .map((item) => item.resource_id || item.uri || item.ref_id)
      .filter((value): value is string => Boolean(value));
    return {
      transportContent: renderMessageWithAttachments(content),
      resourceIds,
    };
  }

  function clearSubmittedResourceAttachments(resourceIds: string[]) {
    if (!resourceIds.length) return;
    attachments.value = attachments.value.filter((item) => !resourceIds.includes(item.resource_id || item.uri || item.ref_id));
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
    hydrateCompanionTab(tab).catch(() => undefined);
  }

  function closeCompanion() {
    companionCollapsed.value = true;
    cancelCompanionHydration();
  }

  function toggleCompanion() {
    companionCollapsed.value = !companionCollapsed.value;
    if (!companionCollapsed.value) {
      hydrateCompanionTab(companionTab.value).catch(() => undefined);
    } else {
      cancelCompanionHydration();
    }
  }

  function openChatExecutionGraph(executionGraphId = '') {
    chatExecutionGraphId.value = executionGraphId.trim();
    chatExecutionGraphExpanded.value = true;
    if (!companionCollapsed.value && companionTab.value === 'activity') {
      hydrateCompanionTab('activity').catch(() => undefined);
    }
  }

  function closeChatExecutionGraph() {
    chatExecutionGraphExpanded.value = false;
    chatExecutionGraphId.value = '';
  }

  function toggleChatExecutionGraph() {
    if (chatExecutionGraphExpanded.value) {
      closeChatExecutionGraph();
      return;
    }
    openChatExecutionGraph();
  }

  function selectSection(page: string, sectionId: string) {
    activeSectionByPage.value = { ...activeSectionByPage.value, [page]: sectionId };
  }

  function openModal(modal: 'model' | 'workspace' | 'commands') {
    activeModal.value = modal;
    if (modal === 'commands' && !commands.value.length) refreshCommands().catch(() => undefined);
    if (modal === 'model' && !providers.value) loadChatCapabilities().catch(() => undefined);
    if (modal === 'workspace' && !workspaceRoot.value) {
      loadWorkspace().catch(() => undefined);
    }
  }

  function closeModal() {
    activeModal.value = null;
  }

  async function chooseModel(model: string) {
    commandError.value = '';
    if (!activeSessionId.value) await createSession();
    const sessionId = activeSessionId.value;
    const generation = activeSessionLoadGeneration;
    try {
      await api.updateSession(sessionId, { model });
      if (activeSessionId.value !== sessionId || generation !== activeSessionLoadGeneration) return;
      selectedModel.value = model;
      sessions.value = sessions.value.map((session) => session.id === sessionId ? { ...session, model } : session);
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

  async function loadChatCapabilities() {
    if (chatCapabilities.value.phase === 'loading' || chatCapabilities.value.phase === 'ready') {
      return;
    }
    const generation = authorizationGeneration;
    chatCapabilities.value = {
      phase: 'loading',
      generation: chatCapabilities.value.generation + 1,
      loadedAt: '',
      error: '',
    };
    try {
      const [runtime, providerData, profileData] = await Promise.all([
        api.runtimeControlPlane(),
        api.providers(),
        api.profiles(),
      ]);
      if (generation !== authorizationGeneration) return;
      controlPlane.value = runtime;
      providers.value = providerData;
      profiles.value = profileData.profiles || [];
      selectedProfile.value = profileData.active_profile || profileData.runtime_profile || selectedProfile.value;
      const reportedModel = (runtime as any).components?.provider?.configured_model
        || (providerData as any).configured_model
        || '';
      if (reportedModel && reportedModel !== 'unknown') selectedModel.value = reportedModel;
      chatCapabilities.value = {
        phase: 'ready',
        generation: chatCapabilities.value.generation,
        loadedAt: new Date().toISOString(),
        error: '',
      };
    } catch (error) {
      if (generation !== authorizationGeneration) return;
      chatCapabilities.value = {
        phase: 'error',
        generation: chatCapabilities.value.generation,
        loadedAt: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function loadManagementCapabilities(page: NavId) {
    if (page === 'chat') return;
    const previous = managementCapabilities.value[page] || capabilityLoadState();
    if (previous.phase === 'loading' || previous.phase === 'ready') return;
    const generation = authorizationGeneration;
    managementCapabilities.value = {
      ...managementCapabilities.value,
      [page]: {
        phase: 'loading',
        generation: previous.generation + 1,
        loadedAt: '',
        error: '',
      },
    };
    try {
      if (page === 'settings') {
        const [config, runtime, providerData, reloadStatus, profileData, approvals] = await Promise.all([
          api.settings(),
          api.runtimeControlPlane(),
          api.providers(),
          api.configReloadStatus(),
          api.profiles(),
          api.approvalConfig(),
        ]);
        if (generation !== authorizationGeneration) return;
        settings.value = config;
        controlPlane.value = runtime;
        providers.value = providerData;
        configReloadStatus.value = reloadStatus;
        profiles.value = profileData.profiles || [];
        approvalConfig.value = approvals;
        selectedProfile.value = profileData.active_profile || profileData.runtime_profile || selectedProfile.value;
        startConfigReloadPolling();
      } else {
        // Management pages own their domain reads and load only visible
        // sections. API contract inspection is centralized in Gateway.
      }
      if (generation !== authorizationGeneration) return;
      managementCapabilities.value = {
        ...managementCapabilities.value,
        [page]: {
          phase: 'ready',
          generation: previous.generation + 1,
          loadedAt: new Date().toISOString(),
          error: '',
        },
      };
    } catch (error) {
      if (generation !== authorizationGeneration) return;
      managementCapabilities.value = {
        ...managementCapabilities.value,
        [page]: {
          phase: 'error',
          generation: previous.generation + 1,
          loadedAt: '',
          error: error instanceof Error ? error.message : String(error),
        },
      };
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

  async function verifyAuth() {
    const result = await api.authVerify();
    authEntitlement.value = result.entitlement || null;
    authorizationState.value = (
      String(result.__state || '') === 'forbidden'
      || (
        result.auth_required === true
        && result.valid !== true
        && String(result.__state || '') === 'ready'
      )
    ) ? 'required' : 'ready';
    return result;
  }

  async function login(credential: string) {
    invalidateApiReadCache();
    failClosedAuthorization();
    useProjectionRegistryStore().failClosedAuthorization('authorization transition started');
    chatSessions.failClosedAllSessionAuthorization('authorization transition started');
    const result = await api.authLogin(credential);
    invalidateApiReadCache();
    authEntitlement.value = result.entitlement || null;
    useProjectionRegistryStore().refreshAuthorization();
    chatSessions.refreshAuthorization();
    await boot();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cowd:auth-session-refreshed', {
        detail: { entitlement: authEntitlement.value },
      }));
    }
    return result;
  }

  function failClosedAuthorization() {
    cancelCompanionHydration();
    authorizationGeneration += 1;
    authorizationViewGeneration.value += 1;
    authorizationState.value = 'invalidated';
    activeSessionLoadGeneration += 1;
    revokedSessionIds.clear();
    booted.value = false;
    criticalBoot.value = capabilityLoadState();
    chatCapabilities.value = capabilityLoadState();
    managementCapabilities.value = {};
    companionHydration.value = capabilityLoadState();
    bootPromise = null;
    if (configReloadTimer) clearInterval(configReloadTimer);
    configReloadTimer = null;
    activeUploadOperations.clear();
    uploadBusy.value = false;
    busy.value = false;
    authEntitlement.value = null;
    health.value = null;
    settings.value = null;
    controlPlane.value = null;
    providers.value = null;
    configReloadStatus.value = {};
    profiles.value = [];
    commands.value = [];
    commandHistory.value = [];
    approvalConfig.value = null;
    sessions.value = [];
    activeSessionId.value = '';
    clearActiveSessionDerivedState();
    workspaceRoot.value = '';
    workspaceDir.value = '';
    workspaceFiles.value = [];
    workspaceTreeRoot.value = createWorkspaceRoot();
    expandedWorkspaceDirs.value = [''];
    workspaceTreeLoading.value = {};
    workspaceMeta.value = null;
    recentWorkspaceFiles.value = [];
    selectedFile.value = '';
    selectedFileContent.value = '';
    editorContent.value = '';
    workspaceFilter.value = '';
    fileError.value = '';
    settingsSavedAt.value = '';
    selectedModel.value = '';
    selectedProfile.value = 'default';
    commandError.value = '';
    sessionQuery.value = '';
    sessionOffset.value = 0;
    sessionHasMore.value = true;
    sessionLoadingMore.value = false;
    selectedSessionIds.value = [];
    pinnedSessionIds.value = [];
    sessionViewedCounts.value = {};
    sessionRenderLimit.value = 100;
    actionResults.value = {};
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PINNED_SESSION_KEY);
      localStorage.removeItem(VIEWED_SESSION_KEY);
      localStorage.removeItem(WORKSPACE_RECENT_KEY);
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('cowd.webui.turnActivityOpen.')) localStorage.removeItem(key);
      }
    }
  }

  function failClosedSessionAuthorization(sessionId: string) {
    revokedSessionIds.add(sessionId);
    sessions.value = sessions.value.map((session) => (
      session.id === sessionId
        ? {
            ...session,
            title: t('session.restricted'),
            snippet: '',
            first_message: '',
            summary: '',
            model: '',
            status: 'authorization_revoked',
          }
        : session
    ));
    selectedSessionIds.value = selectedSessionIds.value.filter((id) => id !== sessionId);
    pinnedSessionIds.value = pinnedSessionIds.value.filter((id) => id !== sessionId);
    const { [sessionId]: _discarded, ...remainingViewedCounts } = sessionViewedCounts.value;
    sessionViewedCounts.value = remainingViewedCounts;
    writeStored(PINNED_SESSION_KEY, pinnedSessionIds.value);
    writeStored(VIEWED_SESSION_KEY, sessionViewedCounts.value);
    actionResults.value = {};
    commandHistory.value = [];
    if (activeSessionId.value !== sessionId) return;
    activeSessionLoadGeneration += 1;
    selectedModel.value = '';
    clearActiveSessionDerivedState();
  }

  const authorizationInvalidated = () => failClosedAuthorization();
  const sessionAuthorizationInvalidated = (event: Event) => {
    const sessionId = String((event as CustomEvent)?.detail?.sessionId || '');
    if (sessionId) failClosedSessionAuthorization(sessionId);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('cowd:authorization-invalidated', authorizationInvalidated);
    window.addEventListener('cowd:session-authorization-invalidated', sessionAuthorizationInvalidated);
    onScopeDispose(() => {
      window.removeEventListener('cowd:authorization-invalidated', authorizationInvalidated);
      window.removeEventListener('cowd:session-authorization-invalidated', sessionAuthorizationInvalidated);
    });
  }

  async function refreshCommands() {
    const [registry, history] = await Promise.all([api.commands(), api.commandHistory()]);
    commands.value = registry.commands || [];
    commandHistory.value = history.history || [];
  }

  async function executeCommand(command: string, args: Record<string, unknown> = {}) {
    const sessionId = activeSessionId.value;
    const sessionGeneration = activeSessionLoadGeneration;
    const authGeneration = authorizationGeneration;
    const isCurrent = () => (
      sessionId === activeSessionId.value
      && sessionGeneration === activeSessionLoadGeneration
      && authGeneration === authorizationGeneration
      && !revokedSessionIds.has(sessionId)
    );
    const resolution: any = await api.resolveCommand(command, 'webui', { session_id: sessionId });
    if (!isCurrent()) return null;
    const resolvedCommand = resolution?.resolution?.command?.name || command;
    const result: any = await api.executeCommand(resolvedCommand, args);
    if (!isCurrent()) return result;
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

  async function executeSessionCommand(
    command: string,
    args: Record<string, unknown> = {},
  ) {
    const sessionId = String(args.session_id || activeSessionId.value || '').trim();
    if (!sessionId) throw new Error('Session command requires an active Session');
    commandError.value = '';
    const chat = useChatSessionsStore();
    try {
      const mutation = await chat.runSessionCommandMutation(
        sessionId,
        () => executeCommand(command, { ...args, session_id: sessionId }),
      );
      if (!mutation.attached) {
        throw new Error(
          chat.states[sessionId]?.degradedReason
          || chat.states[sessionId]?.lastError
          || 'this WebUI tab could not acquire the Session writer',
        );
      }
      return mutation.value;
    } catch (error) {
      commandError.value = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  return {
    booted,
    sessionCreating,
    authorizationState,
    authorizationViewGeneration,
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
    activity,
    companionTab,
    criticalBoot,
    chatCapabilities,
    managementCapabilities,
    companionHydration,
    currentRun,
    currentContextEnvelope,
    currentRealityFlow,
    currentTimeline,
    runtimeTimelineRows,
    sessionInputProjection,
    turnInbox,
    selectedActivity,
    chatExecutionGraphExpanded,
    chatExecutionGraphId,
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
    availableModels,
    availableProfiles,
    commandError,
    sessionQuery,
    filteredSessions,
    groupedSessions,
    sessionHasMore,
    sessionLoadingMore,
    selectedSessionIds,
    sessionBulkDeleteProgress,
    pinnedSessionIds,
    sessionRenderLimit,
    sessionRenderHasMore,
    openTurnActivity,
    actionResults,
    authEntitlement,
    editorDirty,
    busy,
    activeSession,
    boot,
    refreshSessions,
    refreshSessionStatuses,
    loadMoreSessions,
    loadMessages,
    createSession,
    deleteSession,
    ensureSessionTitleFromFirstMessage,
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
    loadActivity,
    isTurnActivityOpen,
    toggleTurnActivity,
    turnActivitySummary,
    refreshChatProjection,
    refreshSessionInputs,
    hydrateCompanionTab,
    loadWorkspace,
    loadWorkspaceTreeDir,
    toggleWorkspaceTreeDir,
    selectWorkspacePath,
    rememberRecentWorkspaceFile,
    openFile,
    loadAttachments,
    attachWorkspaceFile,
    removeAttachment,
    composeChatInput,
    clearSubmittedResourceAttachments,
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
    openChatExecutionGraph,
    closeChatExecutionGraph,
    toggleChatExecutionGraph,
    cancelSessionInput,
    reclassifySessionInput,
    selectSection,
    openModal,
    closeModal,
    chooseModel,
    chooseProfile,
    refreshRuntimeConfigProjection,
    loadChatCapabilities,
    loadManagementCapabilities,
    refreshConfigReloadStatus,
    saveDefaultModel,
    refreshProfiles,
    createProfile,
    deleteProfile,
    saveApprovalConfig,
    verifyAuth,
    login,
    failClosedAuthorization,
    refreshCommands,
    executeCommand,
    executeSessionCommand,
    sessionTitle,
    sessionSnippet,
    compactTime,
  };
});
