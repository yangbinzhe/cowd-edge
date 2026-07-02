import type { ActivityEvent, NavId, SessionSummary, WorkspaceFile } from '../types';

export interface ApiOffline {
  __offline?: boolean;
  __error?: string;
}

export interface EndpointSnapshot extends ApiOffline {
  id: string;
  label: string;
  path: string;
  method: string;
  status: 'ready' | 'empty' | 'offline' | 'error';
  count: number;
  data: any;
}

export interface ApiReceipt<T = any> {
  ok: boolean;
  endpoint: string;
  method: string;
  payload_summary?: string;
  status?: number;
  status_text?: string;
  data?: T;
  error?: string;
  retryable?: boolean;
}

export class ApiWriteError extends Error {
  endpoint: string;
  method: string;
  payload_summary: string;
  status: number;
  status_text: string;
  body: string;
  retryable: boolean;

  constructor(message: string, options: {
    endpoint: string;
    method: string;
    payload_summary: string;
    status: number;
    status_text: string;
    body: string;
  }) {
    super(message);
    this.name = 'ApiWriteError';
    this.endpoint = options.endpoint;
    this.method = options.method;
    this.payload_summary = options.payload_summary;
    this.status = options.status;
    this.status_text = options.status_text;
    this.body = options.body;
    this.retryable = options.status === 0 || options.status >= 500 || options.status === 429;
  }
}

function headers(init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return headers;
}

async function parseResponse(response: Response, path = '') {
  const text = await response.text();
  if (!text) return {};
  const contentType = response.headers.get('content-type') || '';
  const trimmed = text.trim().toLowerCase();
  const isApi = path.startsWith('/api/') || response.url.includes('/api/');
  if (isApi && (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html'))) {
    throw new Error(`Expected JSON from API but received ${contentType || 'unknown content type'}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    if (isApi) throw new Error('Expected JSON from API but received non-JSON body');
    return text;
  }
}

async function read<T>(path: string, fallback: T, init: RequestInit = {}): Promise<T & ApiOffline> {
  try {
    const response = await fetch(path, { ...init, headers: headers(init) });
    if (!response.ok) throw new Error(await response.text());
    return await parseResponse(response, path) as T;
  } catch (error) {
    return {
      ...(fallback as any),
      __offline: true,
      __error: error instanceof Error ? error.message : String(error),
    };
  }
}

function payloadSummary(body: BodyInit | null | undefined): string {
  if (!body) return '';
  if (body instanceof FormData) {
    return Array.from(body.keys()).join(', ');
  }
  const text = typeof body === 'string' ? body : String(body);
  return text.length > 280 ? `${text.slice(0, 280)}...` : text;
}

async function write<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: headers(init) });
  if (!response.ok) {
    const body = await response.text();
    throw new ApiWriteError(body || `${response.status} ${response.statusText}`, {
      endpoint: path,
      method: init.method || 'POST',
      payload_summary: payloadSummary(init.body),
      status: response.status,
      status_text: response.statusText,
      body,
    });
  }
  return await parseResponse(response, path) as T;
}

async function writeWithReceipt<T>(path: string, init: RequestInit = {}): Promise<ApiReceipt<T>> {
  const method = init.method || 'POST';
  const summary = payloadSummary(init.body);
  try {
    const data = await write<T>(path, init);
    return {
      ok: true,
      endpoint: path,
      method,
      payload_summary: summary,
      data,
    };
  } catch (error) {
    if (error instanceof ApiWriteError) {
      return {
        ok: false,
        endpoint: error.endpoint,
        method: error.method,
        payload_summary: error.payload_summary,
        status: error.status,
        status_text: error.status_text,
        error: error.body || error.message,
        retryable: error.retryable,
      };
    }
    return {
      ok: false,
      endpoint: path,
      method,
      payload_summary: summary,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}

function countPayload(data: any): number {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== 'object') return data ? 1 : 0;
  for (const key of ['sessions', 'messages', 'events', 'timeline', 'tools', 'skills', 'runs', 'tasks', 'entries', 'files', 'profiles', 'accounts', 'resources', 'facts', 'incidents', 'playbooks', 'cases', 'executions']) {
    if (Array.isArray(data[key])) return data[key].length;
  }
  if (typeof data.count === 'number') return data.count;
  if (typeof data.total === 'number') return data.total;
  return Object.keys(data).filter((key) => !key.startsWith('__')).length;
}

function endpointStatus(data: any): EndpointSnapshot['status'] {
  if (data?.__offline) return 'offline';
  if (data?.error) return 'error';
  return countPayload(data) > 0 ? 'ready' : 'empty';
}

async function endpoint(label: string, path: string, init: RequestInit = {}): Promise<EndpointSnapshot> {
  const method = init.method || 'GET';
  const data = method === 'GET' ? await read(path, {}) : await write(path, init).catch((error) => ({
    __offline: true,
    __error: error instanceof Error ? error.message : String(error),
  }));
  return {
    id: `${method}:${path}`,
    label,
    path,
    method,
    status: endpointStatus(data),
    count: countPayload(data),
    data,
    __offline: data?.__offline,
    __error: data?.__error,
  };
}

const pageEndpoints = (page: Exclude<NavId, 'chat' | 'settings'>, sessionId: string) => {
  const sid = encodeURIComponent(sessionId || 'api-context');
  const routes: Record<Exclude<NavId, 'chat' | 'settings'>, Array<[string, string]>> = {
    mission: [
      ['Mission Control', '/api/mission/control'],
      ['Mission approvals', '/api/mission/approvals'],
      ['Mission relations', '/api/mission/relations'],
      ['Session detail', `/api/mission/sessions/${sid}`],
      ['Session inbox', `/api/mission/sessions/${sid}/inbox`],
      ['Pending approvals', '/api/approval/pending'],
      ['Runtime timeline', `/api/runtime/timeline?session_id=${sid}&limit=80`],
      ['Reality flow', `/api/reality/flow?session_id=${sid}&limit=80`],
    ],
    runtime: [
      ['Control plane', '/api/runtime/control-plane'],
      ['Runtime status', '/api/runtime/status'],
      ['Runtime snapshot', '/api/runtime/snapshot'],
      ['Source audit', '/api/runtime/source-audit'],
      ['Runtime turns', '/api/runtime/turns'],
      ['Effective config', '/api/runtime/config/effective'],
      ['Session leases', '/api/runtime/session-leases'],
      ['Mission Control', '/api/mission/control'],
      ['Mission approvals', '/api/mission/approvals'],
      ['Mission relations', '/api/mission/relations'],
      ['Timeline', `/api/runtime/timeline?session_id=${sid}&limit=80`],
      ['Growth status', '/api/growth/status'],
      ['Growth events', '/api/growth/events'],
      ['Approvals pending', '/api/approval/pending'],
      ['Tasks', '/api/tasks'],
    ],
    context: [
      ['Current context', '/api/context/current'],
      ['Context history', `/api/sessions/${sid}/context`],
      ['Session runs', `/api/sessions/${sid}/runs`],
      ['Session stats', `/api/sessions/${sid}/stats`],
    ],
    memory: [
      ['Status', '/api/memory/status'],
      ['Stats', '/api/memory/stats'],
      ['Layers', '/api/memory/layers'],
      ['Runtime', '/api/memory/runtime'],
      ['Maintenance', '/api/memory/maintenance'],
      ['Clusters', '/api/memory/clusters'],
      ['Lifecycle', `/api/memory/lifecycle/${encodeURIComponent(sessionId || 'api-context')}`],
    ],
    skills: [
      ['Catalog', '/api/skills/catalog'],
      ['Projection', '/api/skills/projection'],
      ['Runs', '/api/skills/runs'],
    ],
    agents: [
      ['Agent runs', '/api/agents/runs'],
      ['Tasks', '/api/tasks'],
      ['Task graph', '/api/tasks/current/agent-graph'],
    ],
    tools: [
      ['Registry', '/api/tools'],
      ['Slash history', '/api/slash/history'],
      ['Cowd capabilities', '/api/cowd/capabilities'],
      ['Cross-plane summary', '/api/cross-plane/summary'],
    ],
    surfaces: [
      ['Surface registry', '/api/surfaces'],
      ['Surface host health', '/api/surfaces/health'],
      ['Cowd surfaces projection', '/api/cowd/surfaces'],
    ],
    gateway: [
      ['Connectors summary', '/api/connectors/summary'],
      ['Connector accounts', '/api/connectors/accounts'],
      ['Connector capabilities', '/api/connectors/capabilities'],
      ['MCP servers', '/api/connectors/mcp/servers'],
      ['Platforms', '/api/platforms'],
      ['WeChat QR', '/api/channels/wechat-ilink/qr'],
      ['WeChat accounts', '/api/channels/wechat-ilink/accounts'],
    ],
    mfg: [
      ['App descriptor', '/api/apps/mfg/app'],
      ['Health', '/api/apps/mfg/reality/health'],
      ['Metrics', '/api/apps/mfg/reality/metrics'],
      ['Entities', '/api/apps/mfg/reality/entities'],
      ['Changes', '/api/apps/mfg/reality/changes'],
      ['Incidents', '/api/apps/mfg/incidents'],
      ['Skills', '/api/apps/mfg/skills'],
      ['Command center', '/api/apps/mfg/command-center'],
    ],
    audit: [
      ['Audit export', '/api/audit/export?limit=50'],
      ['Approval history', '/api/approval/history?limit=50'],
      ['Cross-plane audit', '/api/cross-plane/audit'],
      ['Action executions', '/api/cross-plane/action/executions'],
      ['Harness Eval latest', '/api/harness-eval/reports/latest'],
      ['Harness Eval reports', '/api/harness-eval/reports'],
      ['Harness Eval runs', '/api/harness-eval/runs'],
    ],
  };
  return routes[page];
};

export const api = {
  writeReceipt: writeWithReceipt,
  health: () => read('/api/webui/manifest', {
    kind: 'cowd.webui.manifest',
    status: 'offline',
    static_webui: 'local vite fallback',
  }),
  authVerify: () => read('/api/auth/verify', { authenticated: false, status: 'offline' }),
  sessions: (limit = 50, offset = 0) => read<{ sessions: SessionSummary[] }>(`/api/sessions?limit=${limit}&offset=${offset}`, { sessions: [] }),
  searchSessions: (query: string, limit = 50, offset = 0) => read<{ sessions: SessionSummary[] }>(`/api/sessions?limit=${limit}&offset=${offset}${query ? `&q=${encodeURIComponent(query)}` : ''}`, { sessions: [] }),
  searchMessages: (query: string) => read(`/api/sessions/search?q=${encodeURIComponent(query)}`, { matches: [] }),
  createSession: (model?: string) => write<SessionSummary>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ model }),
  }),
  deleteSession: (sessionId: string) => write(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  branchSession: (sessionId: string) => writeWithReceipt<SessionSummary>(`/api/sessions/${encodeURIComponent(sessionId)}/branch`, { method: 'POST' }),
  compactSession: (sessionId: string) => write(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, { method: 'POST' }),
  cancelSessionTurn: (sessionId: string) => writeWithReceipt(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
  sessionStats: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/stats`, {}),
  updateSession: (sessionId: string, patch: Record<string, unknown>) => write(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }),
  messages: (sessionId: string) => read<{ messages: any[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=50`, { messages: [] }),
  sendMessage: (sessionId: string, content: string, resourceIds: string[] = []) => write(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, resource_ids: resourceIds }),
  }),
  workspace: () => read('/api/workspace', {
    workspace_root: '',
    workspace_canonical: '',
    profile_id: '',
  }),
  workspaces: () => read('/api/workspaces', { workspaces: [] }),
  files: (dir = '') => {
    const suffix = dir ? `?dir=${encodeURIComponent(dir)}` : '';
    return read<{ dir: string; files: WorkspaceFile[] }>(`/api/workspace/files${suffix}`, {
      dir,
      files: [],
    });
  },
  workspaceRawUrl: (path: string) => `/api/file/raw?path=${encodeURIComponent(path)}`,
  workspaceDownloadUrl: (path: string) => `/api/workspace/download?path=${encodeURIComponent(path)}`,
  rawFile: (path: string) => readText(`/api/file/raw?path=${encodeURIComponent(path)}`),
  saveFile: (path: string, content: string) => write('/api/workspace/files', {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  }),
  uploadFile: (file: File, dir = '', overwrite = false) => {
    const body = new FormData();
    body.set('file', file);
    body.set('dir', dir);
    body.set('overwrite', overwrite ? 'true' : 'false');
    return write('/api/upload', { method: 'POST', body });
  },
  uploadResource: (file: File, sessionId = '') => {
    const body = new FormData();
    body.set('file', file);
    body.set('source', 'webui');
    if (sessionId) body.set('session_id', sessionId);
    if (file.type) body.set('declared_mime', file.type);
    return write('/api/resources', { method: 'POST', body });
  },
  createDir: (path: string) => write('/api/workspace/dirs', {
    method: 'POST',
    body: JSON.stringify({ path }),
  }),
  deleteWorkspacePath: (path: string) => write(`/api/workspace/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  renameWorkspacePath: (path: string, to: string) => write('/api/workspace/rename', {
    method: 'POST',
    body: JSON.stringify({ path, to }),
  }),
  workspaceMeta: (path: string) => read(`/api/workspace/meta?path=${encodeURIComponent(path)}`, {}),
  sessionAttachments: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, { attachments: [] }),
  addSessionAttachment: (sessionId: string, path: string, label = '') => write(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ path, label: label || path, kind: 'workspace_file' }),
  }),
  deleteSessionAttachment: (sessionId: string, refId: string) => write(`/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(refId)}`, { method: 'DELETE' }),
  runtimeTimeline: (sessionId: string) => read(`/api/runtime/timeline?session_id=${encodeURIComponent(sessionId)}&limit=50`, { events: [] }),
  runtimeControlPlane: () => read('/api/runtime/control-plane', {}),
  runtimeStatus: () => read('/api/runtime/status', {}),
  runtimeSnapshot: () => read('/api/runtime/snapshot', {}),
  runtimeSourceAudit: () => read('/api/runtime/source-audit', {}),
  runtimeSourceRepairPlan: () => read('/api/runtime/source-repair-plan', {}),
  runtimeTurns: () => read('/api/runtime/turns', { turns: [] }),
  submitRuntimeTurn: (prompt: string, sessionId?: string, taskId?: string) => writeWithReceipt('/api/runtime/turns', {
    method: 'POST',
    body: JSON.stringify({ prompt, session_id: sessionId, task_id: taskId }),
  }),
  runtimeTurn: (id: string) => read(`/api/runtime/turns/${encodeURIComponent(id)}`, {}),
  cancelRuntimeTurn: (id: string) => writeWithReceipt(`/api/runtime/turns/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  missionControl: () => read('/api/mission/control', { projection: { mission: { sessions: [], events: [] }, sessions: [], teams: [], agents: [], approvals: [], stewards: [], event_digest: { latest: [] } } }),
  missionControlCommand: (body: Record<string, unknown>) => writeWithReceipt('/api/mission/control/command', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  dispatchMissionSessions: (policy: Record<string, unknown> = { max_commands: 10, dispatch_mode: 'mark_claimed_only', allow_background: true }) => writeWithReceipt('/api/mission/control/sessions/dispatch', {
    method: 'POST',
    body: JSON.stringify(policy),
  }),
  bridgeMissionSession: (body: Record<string, unknown>) => writeWithReceipt('/api/mission/control/sessions/bridge', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  teamExecutionPlan: (teamId: string) => read(`/api/mission/control/teams/${encodeURIComponent(teamId)}/execution`, {}),
  tickTeamExecution: (teamId: string) => writeWithReceipt(`/api/mission/control/teams/${encodeURIComponent(teamId)}/execution`, { method: 'POST' }),
  collaborationRuns: () => read('/api/mission/control/teams', { projection: { runs: [] } }),
  collaborationRun: (teamId: string) => read(`/api/mission/control/teams/${encodeURIComponent(teamId)}/run`, {}),
  cancelTeamRuntime: (teamId: string) => writeWithReceipt(`/api/mission/control/teams/${encodeURIComponent(teamId)}/cancel`, { method: 'POST' }),
  handoffTeamRuntime: (teamId: string, body: Record<string, unknown>) => writeWithReceipt(`/api/mission/control/teams/${encodeURIComponent(teamId)}/handoff`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  synthesizeTeamRuntime: (teamId: string) => writeWithReceipt(`/api/mission/control/teams/${encodeURIComponent(teamId)}/synthesis`, { method: 'POST' }),
  teamMissionEvidence: (teamId: string) => read(`/api/mission/control/teams/${encodeURIComponent(teamId)}/evidence`, { events: [], tasks: [], evidence: [] }),
  agentMissionEvents: (agentId: string) => read(`/api/mission/control/agents/${encodeURIComponent(agentId)}/events`, { events: [], tasks: [] }),
  stewardScheduler: () => read('/api/mission/control/stewards/scheduler', {}),
  tickStewardScheduler: (config: Record<string, unknown> = { max_session_commands_per_tick: 10, max_team_ticks: 10, allow_background_sessions: true }) => writeWithReceipt('/api/mission/control/stewards/scheduler', {
    method: 'POST',
    body: JSON.stringify(config),
  }),
  stewardHandoff: (stewardId: string) => read(`/api/mission/control/stewards/${encodeURIComponent(stewardId)}/handoff`, {}),
  runtimeRecoveryReport: () => read('/api/runtime/events/replay-report', {}),
  applyRuntimeRecovery: () => writeWithReceipt('/api/runtime/events/recover', { method: 'POST' }),
  missionApprovals: () => read('/api/mission/approvals', { approvals: { requests: [], pending_count: 0 } }),
  missionRelations: () => read('/api/mission/relations', { relations: { relations: [], proxies: [] } }),
  missionSessionDetail: (sessionId: string) => read(`/api/mission/sessions/${encodeURIComponent(sessionId)}`, {}),
  missionSessionInbox: (sessionId: string) => read(`/api/mission/sessions/${encodeURIComponent(sessionId)}/inbox`, { commands: [], summary: {} }),
  consumeMissionSessionCommand: (sessionId: string, commandId: string, mode = 'mark_claimed_only') => writeWithReceipt(`/api/mission/sessions/${encodeURIComponent(sessionId)}/inbox/${encodeURIComponent(commandId)}/consume`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  }),
  cancelMissionSessionCommand: (sessionId: string, commandId: string) => writeWithReceipt(`/api/mission/sessions/${encodeURIComponent(sessionId)}/inbox/${encodeURIComponent(commandId)}/cancel`, { method: 'POST' }),
  retryMissionSessionCommand: (sessionId: string, commandId: string) => writeWithReceipt(`/api/mission/sessions/${encodeURIComponent(sessionId)}/inbox/${encodeURIComponent(commandId)}/retry`, { method: 'POST' }),
  startMissionTeamRuntime: (sessionId: string, objective: string, executionMode = 'provider_in_process') => writeWithReceipt(`/api/mission/sessions/${encodeURIComponent(sessionId)}/teams/runtime`, {
    method: 'POST',
    body: JSON.stringify({ objective, execution_mode: executionMode }),
  }),
  routeMissionCommand: (body: Record<string, unknown>) => writeWithReceipt('/api/mission/route', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  decideMissionApproval: (approvalId: string, approved: boolean, reason = '') => writeWithReceipt(`/api/mission/approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ approved, decided_by: 'webui', reason }),
  }),
  realityStatus: () => read('/api/reality/status', {}),
  realityStatic: () => read('/api/reality/static', { core_map: [] }),
  realityFlow: (sessionId?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (sessionId) params.set('session_id', sessionId);
    params.set('limit', String(limit));
    const suffix = params.toString();
    const query = suffix ? `?${suffix}` : '';
    return read(`/api/reality/flow${query}`, { stages: [], events: [], promotions: [] });
  },
  realityPromotions: (filters: { sessionId?: string; target?: string; status?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.sessionId) params.set('session_id', filters.sessionId);
    if (filters.target) params.set('target', filters.target);
    if (filters.status) params.set('status', filters.status);
    params.set('limit', String(filters.limit || 100));
    return read(`/api/reality/promotions?${params.toString()}`, { promotions: [] });
  },
  realityBoundaries: () => read('/api/reality/boundaries', { boundaries: [] }),
  growthStatus: () => read('/api/growth/status', {}),
  growthEvents: () => read('/api/growth/events', { events: [], promotions: [] }),
  providers: () => read('/api/config/providers', { providers: [], models: [] }),
  effectiveConfig: () => read('/api/runtime/config/effective', {}),
  reloadProviders: () => write('/api/runtime/providers/reload', { method: 'POST' }),
  approvalConfig: () => read('/api/approval/config', {}),
  updateApprovalConfig: (config: Record<string, unknown>) => write('/api/approval/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  }),
  toggleSolo: () => write('/api/approval/solo', { method: 'POST' }),
  approvalPending: () => read('/api/approval/pending', []),
  approvalRiskReceipt: (toolName: string, input: unknown, sessionId?: string) => writeWithReceipt('/api/approval/risk-receipt', {
    method: 'POST',
    body: JSON.stringify({ tool_name: toolName, input, session_id: sessionId }),
  }),
  approvalRespond: (id: string, approved: boolean, reason = '') => write('/api/approval/respond', {
    method: 'POST',
    body: JSON.stringify({ id, approved, reason }),
  }),
  approvalHistory: () => read('/api/approval/history?limit=20', []),
  runtimeSessionLeases: () => read('/api/runtime/session-leases', {}),
  acquireRuntimeLease: (sessionId: string, owner: string, mode = 'shared') => write('/api/runtime/session-leases/acquire', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, owner, mode }),
  }),
  releaseRuntimeLease: (sessionId: string, owner: string) => write('/api/runtime/session-leases/release', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, owner }),
  }),
  contextCurrent: (sessionId: string, q = '', profile = 'main_turn') => read(`/api/context/current?session_id=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(q)}&profile=${encodeURIComponent(profile)}`, {}),
  contextHistory: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/context?limit=20&include_envelopes=true`, {}),
  contextRecommendations: (sessionId: string) => read(`/api/sessions/${encodeURIComponent(sessionId)}/context/recommendations?limit=20`, {}),
  recordContextRecommendation: (sessionId: string, envelopeId: string, recommendation: string, action = 'acknowledged') => write(`/api/sessions/${encodeURIComponent(sessionId)}/context/recommendations`, {
    method: 'POST',
    body: JSON.stringify({ envelope_id: envelopeId, recommendation, action }),
  }),
  resolveEvidence: (ref: string) => read(`/api/evidence/resolve?ref=${encodeURIComponent(ref)}`, {}),
  memoryStatus: () => read('/api/memory/status', {}),
  memoryStats: () => read('/api/memory/stats', {}),
  memoryLayers: () => read('/api/memory/layers', { layers: [] }),
  memoryLayer: (layer: string) => read(`/api/memory/${encodeURIComponent(layer)}`, { entries: [] }),
  memoryRuntime: () => read('/api/memory/runtime', {}),
  memoryLifecycle: (id: string) => read(`/api/memory/lifecycle/${encodeURIComponent(id)}`, {}),
  memoryClusters: (limit = 24) => read(`/api/memory/clusters?limit=${limit}`, { clusters: [] }),
  memoryLinks: () => read('/api/memory/links', { links: [] }),
  memoryEntities: () => read('/api/memory/entities', { entities: [] }),
  memoryTriples: () => read('/api/memory/triples', { triples: [] }),
  memoryPerformance: () => read('/api/memory/performance', {}),
  memoryMaintenance: (status = '', kind = '', limit = 100) => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (kind) query.set('kind', kind);
    query.set('limit', String(limit));
    return read(`/api/memory/maintenance?${query.toString()}`, { candidates: [] });
  },
  memorySearch: (q: string) => read(`/api/memory/search?q=${encodeURIComponent(q)}`, {}),
  memoryRecallExplain: (q: string, limit = 10) => read(`/api/memory/recall/explain?q=${encodeURIComponent(q)}&limit=${limit}`, { results: [] }),
  memoryPacket: (q: string, maxItems = 12, maxTokens = 2000) => read(`/api/memory/packet?q=${encodeURIComponent(q)}&max_items=${maxItems}&max_tokens=${maxTokens}`, {}),
  memorySymbolLinks: (symbol: string) => read(`/api/memory/symbol-links?q=${encodeURIComponent(symbol)}`, { entries: [] }),
  createMemorySymbolLink: (body: Record<string, unknown>) => write('/api/memory/symbol-links', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  createMemoryEntry: (layer: string, body: Record<string, unknown>) => write(`/api/memory/${encodeURIComponent(layer)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  updateMemoryEntry: (id: string, body: Record<string, unknown>) => write(`/api/memory/entry/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
  deleteMemoryEntry: (layer: string, id: string) => write(`/api/memory/${encodeURIComponent(layer)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  scanMemoryMaintenance: (body: Record<string, unknown> = {}) => write('/api/memory/maintenance', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  updateMemoryMaintenance: (id: string, status: string) => write(`/api/memory/maintenance/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }),
  structuredSources: () => read('/api/cowd/structured/sources', {}),
  structuredFacts: () => read('/api/cowd/structured/facts', {}),
  structuredEvidence: () => read('/api/cowd/structured/evidence', {}),
  structuredWatermarks: () => read('/api/cowd/structured/watermarks', {}),
  structuredIngestPlan: (body: Record<string, unknown>) => write('/api/cowd/structured/ingest-plan', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  skillCatalog: () => read('/api/skills/catalog', {}),
  skillProjection: () => read('/api/skills/projection?surface=webui', {}),
  skillRuns: () => read('/api/skills/runs', {}),
  skillRunDetail: (id: string) => read(`/api/skills/runs/${encodeURIComponent(id)}`, {}),
  skillDetail: (id: string) => read(`/api/skills/${encodeURIComponent(id)}`, {}),
  skillFiles: (id: string) => read(`/api/skills/${encodeURIComponent(id)}/files`, {}),
  skillFileRaw: (id: string, path = 'SKILL.md') => read(`/api/skills/${encodeURIComponent(id)}/files/raw?path=${encodeURIComponent(path)}`, {}),
  skillTranslate: (id: string, content: string, path = 'SKILL.md', locale = 'zh-CN') => write(`/api/skills/${encodeURIComponent(id)}/translate`, {
    method: 'POST',
    body: JSON.stringify({ content, path, locale }),
  }),
  skillAction: (id: string, action: 'validate' | 'plan' | 'run', body: Record<string, unknown> = {}) => writeWithReceipt(`/api/skills/${encodeURIComponent(id)}/actions/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  tasks: () => read('/api/tasks', {}),
  startTask: (objective: string, yoloMode = false) => write('/api/tasks/start', {
    method: 'POST',
    body: JSON.stringify({ objective, yolo_mode: yoloMode }),
  }),
  cancelTask: (id: string) => write(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  completeTask: (id: string) => write(`/api/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' }),
  recordTaskFailure: (id: string, reason: string) => write(`/api/tasks/${encodeURIComponent(id)}/failure`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  startTaskPhase: (id: string, body: Record<string, unknown>) => write(`/api/tasks/${encodeURIComponent(id)}/phases`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  recordTaskArtifact: (id: string, phaseId: string, body: Record<string, unknown>) => write(`/api/tasks/${encodeURIComponent(id)}/phases/${encodeURIComponent(phaseId)}/artifacts`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  reviewTaskPhase: (id: string, phaseId: string, result: string, completed = true) => write(`/api/tasks/${encodeURIComponent(id)}/phases/${encodeURIComponent(phaseId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ result, completed }),
  }),
  agentCatalog: () => read('/api/agents/catalog', { agents: [], summary: {} }),
  agentDirectory: () => read('/api/agents/directory', { agents: [], summary: {} }),
  agentDiscover: (task: string) => read(`/api/agents/discover?task=${encodeURIComponent(task)}`, { agents: [], team: null }),
  agentAssemble: (task: string) => write('/api/agents/assemble', {
    method: 'POST',
    body: JSON.stringify({ task }),
  }),
  agentReputation: () => read('/api/agents/reputation', { items: [], summary: {} }),
  agentRuns: () => read('/api/agents/runs', { runs: [] }),
  agentTeamProfiles: () => read('/api/agents/team-profiles', { profiles: [] }),
  agentTeamProfile: (id: string) => read(`/api/agents/team-profiles/${encodeURIComponent(id)}`, {}),
  createAgentTeamProfile: (body: Record<string, unknown>) => write('/api/agents/team-profiles', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  updateAgentTeamProfile: (id: string, body: Record<string, unknown>) => write(`/api/agents/team-profiles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),
  deleteAgentTeamProfile: (id: string) => write(`/api/agents/team-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  taskAgentGraph: (id: string) => read(`/api/tasks/${encodeURIComponent(id)}/agent-graph`, { nodes: [] }),
  upsertTaskAgentGraph: (id: string, body: Record<string, unknown>) => write(`/api/tasks/${encodeURIComponent(id)}/agent-graph`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  toolRegistry: () => read('/api/tools', {}),
  toolExecute: (name: string, input: Record<string, unknown> = {}, mode = 'read_only') => write('/api/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ name, input, mode }),
  }),
  toolCacheStats: () => read('/api/tools/cache', {}),
  toolBatchReadonly: (calls: Array<Record<string, unknown>>, max_concurrency = 4) => write('/api/tools/batch-readonly', {
    method: 'POST',
    body: JSON.stringify({ calls, max_concurrency }),
  }),
  toolMutationPreview: (edits: Array<Record<string, unknown>>) => write('/api/tools/mutations/preview', {
    method: 'POST',
    body: JSON.stringify({ edits }),
  }),
  toolMutationApply: (edits: Array<Record<string, unknown>>, expected_hashes: Record<string, string> = {}) => write('/api/tools/mutations/apply', {
    method: 'POST',
    body: JSON.stringify({ edits, expected_hashes }),
  }),
  toolCheckpoints: () => read('/api/tools/checkpoints', { checkpoints: [] }),
  toolCheckpointCreate: (label = '') => write('/api/tools/checkpoints', {
    method: 'POST',
    body: JSON.stringify({ label: label || undefined }),
  }),
  toolCheckpointDiff: (id: string) => read(`/api/tools/checkpoints/${encodeURIComponent(id)}/diff`, {}),
  toolCheckpointRestore: (id: string) => write(`/api/tools/checkpoints/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  toolIntentPlan: (prompt: string, selected_tools: string[] = []) => write('/api/tools/intent-plan', {
    method: 'POST',
    body: JSON.stringify({ prompt, selected_tools }),
  }),
  toolContextFanoutPlan: (prompt: string) => write('/api/tools/context-fanout/plan', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  }),
  surfaceRegistry: () => read('/api/surfaces', { kind: 'surface.registry', registry: { surfaces: [] } }),
  surfaceHostHealth: () => read('/api/surfaces/health', { kind: 'surface.health', status: 'offline', registry: { surfaces: [] } }),
  surfaceDetail: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}`, {}),
  surfaceRoutes: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/routes`, { routes: [] }),
  surfaceResources: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/resources`, { resources: [] }),
  surfaceStatus: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/status`, {}),
  surfaceHealth: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/health`, {}),
  surfaceHealthCheck: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/health-check`, { method: 'POST' }),
  surfaceEvents: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/events`, { events: [] }),
  surfaceInbox: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/inbox`, { inbox: [], snapshot: {} }),
  surfaceOutbox: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/outbox`, { outbox: [], dead_letters: [] }),
  surfaceDeliveries: (id: string) => read(`/api/surfaces/${encodeURIComponent(id)}/deliveries`, { deliveries: [] }),
  surfaceReplayInbox: (id: string, messageId: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/inbox/${encodeURIComponent(messageId)}/replay`, { method: 'POST' }),
  surfaceRetryOutbox: (id: string, deliveryId: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/outbox/${encodeURIComponent(deliveryId)}/retry`, { method: 'POST' }),
  surfaceDeadLetterOutbox: (id: string, deliveryId: string, reason = 'operator moved delivery to dead letter') => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/outbox/${encodeURIComponent(deliveryId)}/dead-letter`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  surfaceStart: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/start`, { method: 'POST' }),
  surfaceStop: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  surfaceRestart: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/restart`, { method: 'POST' }),
  surfaceRepair: (id: string) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/repair`, { method: 'POST' }),
  surfaceSend: (id: string, recipient: string, text: string, thread?: string, metadata: Record<string, unknown> = {}) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    body: JSON.stringify({ recipient, text, thread: thread || undefined, metadata }),
  }),
  surfaceAction: (id: string, action: string, payload: Record<string, unknown> = {}) => writeWithReceipt(`/api/surfaces/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, payload }),
  }),
  edgeRegistry: () => read('/api/edges', { kind: 'edge.registry', health: {}, surfaces: [], message_connectors: [], source_connectors: [], automation_connectors: [] }),
  edgeHealth: () => read('/api/edges/health', { kind: 'edge.health', health: {} }),
  edgeSurfaces: () => read('/api/edges/surfaces', { kind: 'edge.surfaces', surfaces: [] }),
  edgeConnectors: () => read('/api/edges/connectors', { kind: 'edge.connectors', message_connectors: [], source_connectors: [], automation_connectors: [] }),
  edgeMessageConnectors: () => read('/api/edges/connectors/message', { kind: 'edge.connectors.message', connectors: [] }),
  edgeSourceConnectors: () => read('/api/edges/connectors/source', { kind: 'edge.connectors.source', connectors: [] }),
  matrixSourcePackUpsert: (source_pack: Record<string, unknown>) => writeWithReceipt('/api/matrix/source-packs/upsert', {
    method: 'POST',
    body: JSON.stringify({ source_pack, session_id: 'webui-edge' }),
  }),
  matrixSourceSnapshotPlan: (id: string, body: Record<string, unknown>) => writeWithReceipt(`/api/matrix/source-packs/${encodeURIComponent(id)}/snapshots/plan`, {
    method: 'POST',
    body: JSON.stringify({ ...body, session_id: body.session_id || 'webui-edge' }),
  }),
  matrixSourceSnapshotRun: (id: string, body: Record<string, unknown>) => writeWithReceipt(`/api/matrix/source-packs/${encodeURIComponent(id)}/snapshots/run`, {
    method: 'POST',
    body: JSON.stringify({ ...body, session_id: body.session_id || 'webui-edge' }),
  }),
  matrixSourceSnapshots: (id: string) => read(`/api/matrix/source-packs/${encodeURIComponent(id)}/snapshots`, { snapshots: [] }),
  platforms: () => read('/api/platforms', {}),
  platform: (name: string) => read(`/api/platforms/${encodeURIComponent(name)}`, {}),
  channels: () => read('/api/channels', { kind: 'channel.registry', channels: [] }),
  channelStatus: (name: string) => read(`/api/channels/${encodeURIComponent(name)}/status`, {}),
  channelRepair: (name: string) => writeWithReceipt(`/api/channels/${encodeURIComponent(name)}/repair`, { method: 'POST' }),
  wechatIlinkQrStart: (botType = '3') => writeWithReceipt('/api/channels/wechat-ilink/qr', {
    method: 'POST',
    body: JSON.stringify({ bot_type: botType }),
  }),
  wechatIlinkQrPoll: (qrcode: string, baseUrl?: string) => writeWithReceipt('/api/channels/wechat-ilink/qr/poll', {
    method: 'POST',
    body: JSON.stringify({ qrcode, base_url: baseUrl }),
  }),
  connectorsSummary: () => read('/api/connectors/summary', {}),
  connectorAccounts: () => read('/api/connectors/accounts', {}),
  connectorCapabilities: () => read('/api/connectors/capabilities', {}),
  connectorResources: () => read('/api/connectors/resources', {}),
  connectorMcpServers: () => read('/api/connectors/mcp/servers', {}),
  connectorServices: () => read('/api/connectors/services', { services: [] }),
  connectorServiceTools: (serviceId: string) => read(`/api/connectors/services/${encodeURIComponent(serviceId)}/tools`, { tools: [] }),
  connectorServiceExecute: (serviceId: string, body: Record<string, unknown>) => writeWithReceipt(`/api/connectors/services/${encodeURIComponent(serviceId)}/execute`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  connectorRevalidateResource: (reference: string) => write('/api/connectors/resources/revalidate', {
    method: 'POST',
    body: JSON.stringify({ reference }),
  }),
  connectorPromoteMemory: (reference: string) => write('/api/connectors/resources/promote-memory', {
    method: 'POST',
    body: JSON.stringify({ reference }),
  }),
  crossPlaneSummary: () => read('/api/cross-plane/summary', {}),
  crossPlaneIdentities: () => read('/api/cross-plane/identities', {}),
  crossPlaneCreateIdentity: (body: Record<string, unknown>) => write('/api/cross-plane/identities', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  crossPlaneRevokeIdentity: (id: string) => write(`/api/cross-plane/identities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  crossPlaneGrants: () => read('/api/cross-plane/grants', {}),
  crossPlaneCreateGrant: (body: Record<string, unknown>) => write('/api/cross-plane/grants', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  crossPlaneRevokeGrant: (id: string) => write(`/api/cross-plane/grants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  crossPlaneAudit: () => read('/api/cross-plane/audit', {}),
  crossPlaneAdapters: () => read('/api/cross-plane/action/adapters', {}),
  crossPlaneExecutions: () => read('/api/cross-plane/action/executions', {}),
  crossPlanePolicySimulate: (body: Record<string, unknown>) => write('/api/cross-plane/policy/simulate', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  crossPlanePreflight: (body: Record<string, unknown>) => write('/api/cross-plane/action/preflight', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  crossPlaneExecute: (action: Record<string, unknown>, mode = 'dry_run', idempotency_key?: string) => writeWithReceipt('/api/cross-plane/action/execute', {
    method: 'POST',
    body: JSON.stringify({ action, mode, idempotency_key }),
  }),
  crossPlaneResolveIdentity: (identity_ref: string) => write('/api/cross-plane/identity/resolve', {
    method: 'POST',
    body: JSON.stringify({ identity_ref }),
  }),
  auditExport: (source = 'all', limit = 50, offset = 0) => read(`/api/audit/export?source=${encodeURIComponent(source)}&limit=${limit}&offset=${offset}`, {}),
  usageSummary: () => read('/api/usage', {}),
  cowdCapabilities: () => read('/api/cowd/capabilities', {}),
  cowdProjection: (surface = 'webui') => read(`/api/cowd/projection?surface=${encodeURIComponent(surface)}`, {}),
  cowdSurfaces: () => read('/api/cowd/surfaces', {}),
  cowdReleaseGate: () => read('/api/cowd/release-gate', {}),
  harnessEvalLatestReport: () => read('/api/harness-eval/reports/latest', {}),
  harnessEvalReports: () => read('/api/harness-eval/reports', { reports: [] }),
  harnessEvalReport: (id: string) => read(`/api/harness-eval/reports/${encodeURIComponent(id)}`, {}),
  harnessEvalScenarios: () => read('/api/harness-eval/scenarios', { scenarios: [] }),
  harnessEvalRuns: () => read('/api/harness-eval/runs', { runs: [] }),
  harnessEvalRun: (id: string) => read(`/api/harness-eval/runs/${encodeURIComponent(id)}`, {}),
  harnessEvalRunSmoke: () => writeWithReceipt('/api/harness-eval/runs', {
    method: 'POST',
    body: JSON.stringify({
      level: 'quick',
      budget: 'low',
      actor: 'webui.audit',
      objective: 'operator requested harness eval smoke',
      allow_real_model: false,
    }),
  }),
  harnessEvalCancelRun: (id: string) => writeWithReceipt(`/api/harness-eval/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  mfgApp: () => read('/api/apps/mfg/app', {}),
  mfgHealth: () => read('/api/apps/mfg/reality/health', {}),
  mfgProductionGovernance: () => read('/api/apps/mfg/production/governance', {}),
  mfgDataPlaneHealth: () => read('/api/apps/mfg/reality/data-plane/health', {}),
  mfgDataPlaneIngestPlan: (ingest: Record<string, unknown>) => write('/api/apps/mfg/reality/data-plane/ingest-plan', {
    method: 'POST',
    body: JSON.stringify({ ingest, session_id: 'webui-mfg' }),
  }),
  mfgCommandCenter: () => read('/api/apps/mfg/command-center', {}),
  mfgCommandCenterLive: () => read('/api/apps/mfg/command-center/live', {}),
  mfgDecisionTrace: (params: { incident_id?: string; report_id?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.incident_id) query.set('incident_id', params.incident_id);
    if (params.report_id) query.set('report_id', params.report_id);
    const suffix = query.toString();
    return read('/api/apps/mfg/decision-trace' + (suffix ? `?${suffix}` : ''), {});
  },
  mfgSourcePackUpsert: (source_pack: Record<string, unknown>) => write('/api/apps/mfg/reality/source-packs/upsert', {
    method: 'POST',
    body: JSON.stringify({ source_pack, session_id: 'webui-mfg' }),
  }),
  mfgSourcePack: (id: string) => read(`/api/apps/mfg/reality/source-packs/${encodeURIComponent(id)}`, {}),
  mfgSourcePackValidate: (id: string) => write(`/api/apps/mfg/reality/source-packs/${encodeURIComponent(id)}/validate`, { method: 'POST' }),
  mfgSourcePackDeltaPlan: (id: string) => write(`/api/apps/mfg/reality/source-packs/${encodeURIComponent(id)}/delta-plan`, { method: 'POST' }),
  mfgSourcePackIngestFile: (id: string, facts: Record<string, unknown>[]) => write(`/api/apps/mfg/reality/source-packs/${encodeURIComponent(id)}/ingest-file`, {
    method: 'POST',
    body: JSON.stringify({ facts, session_id: 'webui-mfg' }),
  }),
  mfgSourcePackConnectorPlan: (id: string, run?: Record<string, unknown>) => write(`/api/apps/mfg/reality/source-packs/${encodeURIComponent(id)}/connector-runs/plan`, {
    method: 'POST',
    body: JSON.stringify({ run, session_id: 'webui-mfg' }),
  }),
  mfgSourcePackConnectorRun: (id: string, run?: Record<string, unknown>) => write(`/api/apps/mfg/reality/source-packs/${encodeURIComponent(id)}/connector-runs/run`, {
    method: 'POST',
    body: JSON.stringify({ run, session_id: 'webui-mfg' }),
  }),
  mfgConnectorRun: (id: string) => read(`/api/apps/mfg/reality/connector-runs/${encodeURIComponent(id)}`, {}),
  mfgMetrics: () => read('/api/apps/mfg/reality/metrics', {}),
  mfgMetricDetail: (id: string) => read(`/api/apps/mfg/reality/metrics/${encodeURIComponent(id)}`, {}),
  mfgMetricLineage: (id: string) => read(`/api/apps/mfg/reality/metrics/${encodeURIComponent(id)}/lineage`, {}),
  mfgAttentionPlan: (body: Record<string, unknown>) => write('/api/apps/mfg/reality/metrics/attention-plan', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgMetricSnapshotMaterialize: (metric_ids: string[], scope_ref?: string) => write('/api/apps/mfg/reality/metrics/snapshots/materialize', {
    method: 'POST',
    body: JSON.stringify({ metric_ids, scope_ref, session_id: 'webui-mfg' }),
  }),
  mfgMetricRecompute: () => write('/api/apps/mfg/reality/metrics/recompute', { method: 'POST' }),
  mfgMetricDependencyUpsert: (dependency: Record<string, unknown>) => write('/api/apps/mfg/reality/metric-dependencies/upsert', {
    method: 'POST',
    body: JSON.stringify({ dependency, session_id: 'webui-mfg' }),
  }),
  mfgMetricAffectedByFactType: (fact_type: string) => write('/api/apps/mfg/reality/metric-dependencies/affected-by-fact-type', {
    method: 'POST',
    body: JSON.stringify({ fact_type, session_id: 'webui-mfg' }),
  }),
  mfgComputeJobPlan: (job: Record<string, unknown>) => write('/api/apps/mfg/reality/compute/jobs/plan', {
    method: 'POST',
    body: JSON.stringify({ job, session_id: 'webui-mfg' }),
  }),
  mfgComputeJob: (id: string) => read(`/api/apps/mfg/reality/compute/jobs/${encodeURIComponent(id)}`, {}),
  mfgComputeJobRun: (id: string) => write(`/api/apps/mfg/reality/compute/jobs/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  mfgEntities: () => read('/api/apps/mfg/reality/entities', {}),
  mfgEntity: (id: string) => read(`/api/apps/mfg/reality/entities/${encodeURIComponent(id)}`, {}),
  mfgEntityUpsert: (entity: Record<string, unknown>) => write('/api/apps/mfg/reality/entities/upsert', {
    method: 'POST',
    body: JSON.stringify({ entity, session_id: 'webui-mfg' }),
  }),
  mfgEntityResolveSourceKey: (source_system: string, source_key: string) => write('/api/apps/mfg/reality/entities/resolve-source-key', {
    method: 'POST',
    body: JSON.stringify({ source_system, source_key, session_id: 'webui-mfg' }),
  }),
  mfgEntityMatchCandidate: (left_entity_id: string, right_entity_id: string) => write('/api/apps/mfg/reality/entities/match-candidate', {
    method: 'POST',
    body: JSON.stringify({ left_entity_id, right_entity_id, session_id: 'webui-mfg' }),
  }),
  mfgEntityConflictDecision: (body: Record<string, unknown>) => write('/api/apps/mfg/reality/entities/conflict-decision', {
    method: 'POST',
    body: JSON.stringify({ ...body, session_id: 'webui-mfg' }),
  }),
  mfgEntityRelations: (id: string) => read(`/api/apps/mfg/reality/entities/${encodeURIComponent(id)}/relations`, {}),
  mfgEntityImpactPath: (id: string) => read(`/api/apps/mfg/reality/entities/${encodeURIComponent(id)}/impact-path`, {}),
  mfgRelationUpsert: (relation: Record<string, unknown>) => write('/api/apps/mfg/reality/relations/upsert', {
    method: 'POST',
    body: JSON.stringify({ relation, session_id: 'webui-mfg' }),
  }),
  mfgChanges: () => read('/api/apps/mfg/reality/changes', {}),
  mfgAttentionHot: () => read('/api/apps/mfg/reality/attention/hot', {}),
  mfgEvidenceBuild: (body: Record<string, unknown>) => write('/api/apps/mfg/reality/evidence/build', {
    method: 'POST',
    body: JSON.stringify({ ...body, session_id: 'webui-mfg' }),
  }),
  mfgEvidence: (id: string) => read(`/api/apps/mfg/reality/evidence/${encodeURIComponent(id)}`, {}),
  mfgEvidenceQualityGate: (id: string) => write(`/api/apps/mfg/reality/evidence/${encodeURIComponent(id)}/quality-gate`, { method: 'POST' }),
  mfgEvidenceContext: (id: string) => read(`/api/apps/mfg/reality/evidence/${encodeURIComponent(id)}/context`, {}),
  mfgQualityGate: (id: string) => read(`/api/apps/mfg/reality/quality-gates/${encodeURIComponent(id)}`, {}),
  mfgIncidents: () => read('/api/apps/mfg/incidents', {}),
  mfgIncident: (id: string) => read(`/api/apps/mfg/incidents/${encodeURIComponent(id)}`, {}),
  mfgSkills: () => read('/api/apps/mfg/skills', {}),
  mfgSkill: (id: string) => read(`/api/apps/mfg/skills/${encodeURIComponent(id)}`, {}),
  mfgSkillRun: (id: string) => read(`/api/apps/mfg/skill-runs/${encodeURIComponent(id)}`, {}),
  mfgCreateIncident: (body: Record<string, unknown>) => write('/api/apps/mfg/incidents', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgIncidentRoom: (id: string) => read(`/api/apps/mfg/incidents/${encodeURIComponent(id)}/room`, {}),
  mfgAnalyzeIncident: (id: string) => write(`/api/apps/mfg/incidents/${encodeURIComponent(id)}/analyze`, { method: 'POST' }),
  mfgPromoteIncidentCase: (id: string) => write(`/api/apps/mfg/incidents/${encodeURIComponent(id)}/cases/promote`, { method: 'POST' }),
  mfgCase: (id: string) => read(`/api/apps/mfg/cases/${encodeURIComponent(id)}`, {}),
  mfgCaseSearch: (query: string) => read(`/api/apps/mfg/cases/search?q=${encodeURIComponent(query)}`, { cases: [] }),
  mfgPlaybook: (id: string) => read(`/api/apps/mfg/playbooks/${encodeURIComponent(id)}`, {}),
  mfgPlaybookUpsert: (body: Record<string, unknown>) => write('/api/apps/mfg/playbooks/upsert', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgRecommendPlaybooks: (id: string, limit = 5) => write(`/api/apps/mfg/incidents/${encodeURIComponent(id)}/playbooks/recommend`, {
    method: 'POST',
    body: JSON.stringify({ limit }),
  }),
  mfgPlanSkills: (id: string, limit = 3) => write(`/api/apps/mfg/incidents/${encodeURIComponent(id)}/skills/plan`, {
    method: 'POST',
    body: JSON.stringify({ limit }),
  }),
  mfgRunSkill: (id: string, skillId: string) => write(`/api/apps/mfg/incidents/${encodeURIComponent(id)}/skills/${encodeURIComponent(skillId)}/run`, {
    method: 'POST',
    body: JSON.stringify({ session_id: id }),
  }),
  mfgSkillRuns: (id: string) => read(`/api/apps/mfg/incidents/${encodeURIComponent(id)}/skills`, {}),
  mfgExecuteAction: (analysisId: string, actionId: string, body: Record<string, unknown>) => write(`/api/apps/mfg/analyses/${encodeURIComponent(analysisId)}/actions/${encodeURIComponent(actionId)}/execute`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgExecutionBridge: (executionId: string, body: Record<string, unknown>) => write(`/api/apps/mfg/executions/${encodeURIComponent(executionId)}/cross-plane/execute`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgExecutionFeedback: (executionId: string, body: Record<string, unknown>) => write(`/api/apps/mfg/executions/${encodeURIComponent(executionId)}/feedback`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgUpsertProfile: (profile: Record<string, unknown>) => write('/api/apps/mfg/cockpit/profiles/upsert', {
    method: 'POST',
    body: JSON.stringify({ profile }),
  }),
  mfgGenerateReport: (profileId: string, report: Record<string, unknown>) => write(`/api/apps/mfg/cockpit/profiles/${encodeURIComponent(profileId)}/reports/generate`, {
    method: 'POST',
    body: JSON.stringify({ report }),
  }),
  mfgReportDeliveryState: (reportId: string) => read(`/api/apps/mfg/cockpit/reports/${encodeURIComponent(reportId)}/delivery-state`, {}),
  mfgReport: (reportId: string) => read(`/api/apps/mfg/cockpit/reports/${encodeURIComponent(reportId)}`, {}),
  mfgDeliverReport: (reportId: string, body: Record<string, unknown>) => write(`/api/apps/mfg/cockpit/reports/${encodeURIComponent(reportId)}/deliver`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgRetryReportDelivery: (reportId: string, body: Record<string, unknown>) => write(`/api/apps/mfg/cockpit/reports/${encodeURIComponent(reportId)}/delivery/retry`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgRunReportSchedule: (body: Record<string, unknown>) => write('/api/apps/mfg/cockpit/reports/schedules/run', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  mfgIngestFact: (facts: Record<string, unknown>[]) => write('/api/apps/mfg/reality/facts/ingest', {
    method: 'POST',
    body: JSON.stringify({ facts, session_id: 'webui-mfg' }),
  }),
  mfgSeedDomain: () => write('/api/apps/mfg/domain/server-manufacturing/seed', { method: 'POST' }),
  mfgSeedOntology: () => write('/api/apps/mfg/ontology/server-manufacturing/seed', { method: 'POST' }),
  settings: () => read('/api/config', { model: 'unknown', version: 'unknown' }),
  saveConfig: (config: Record<string, unknown>) => write('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  }),
  commands: (surface = 'webui') => read(`/api/slash?surface=${encodeURIComponent(surface)}`, { commands: [] }),
  commandHistory: () => read('/api/slash/history', { history: [] }),
  resolveCommand: (command: string, surface = 'webui', context: Record<string, unknown> = {}) => write('/api/slash/resolve', {
    method: 'POST',
    body: JSON.stringify({ input: command, surface, context }),
  }),
  executeCommand: (command: string, args: Record<string, unknown> = {}) => write('/api/slash/dispatch', {
    method: 'POST',
    body: JSON.stringify({ command, args }),
  }),
  profiles: () => read('/api/profiles', { profiles: [], active_profile: '', runtime_profile: '' }),
  createProfile: (name: string) => write('/api/profiles', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  switchProfile: (profile: string) => write('/api/profiles/switch', {
    method: 'POST',
    body: JSON.stringify({ profile }),
  }),
  deleteProfile: (id: string) => write(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  loadCapabilityPage: async (page: Exclude<NavId, 'chat' | 'settings'>, sessionId: string) => Promise.all(
    pageEndpoints(page, sessionId).map(([label, path]) => endpoint(label, path)),
  ),
  executeCapabilityAction: (path: string, body: Record<string, unknown> = {}) => write(path, {
    method: 'POST',
    body: JSON.stringify({ source: 'webui', ...body }),
  }),
};

async function readText(path: string, fallback = ''): Promise<string> {
  try {
    const response = await fetch(path, { headers: headers() });
    if (!response.ok) throw new Error(await response.text());
    return await response.text();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export function providerModels(controlPlane: any, config: any): string[] {
  if (Array.isArray(config?.models) && config.models.length) {
    return config.models
      .map((model: any) => model.id || model.name || model)
      .filter((model: any) => typeof model === 'string' && model.trim() && model !== 'unknown');
  }
  const models = new Set<string>();
  const configured = controlPlane?.configured_model || config?.model;
  const normalized = typeof configured === 'string' ? configured.trim() : '';
  if (normalized && normalized !== 'unknown') models.add(normalized);
  const providerNames = controlPlane?.provider_names || [];
  const count = Number(controlPlane?.provider_model_count || 0);
  if (count > 0 && models.size === 0) {
    providerNames.forEach((name: string) => models.add(`${name}:default`));
  }
  return Array.from(models);
}

export function normalizeActivity(raw: any[]): ActivityEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.slice(0, 50).map((event, index) => ({
    id: String(event.id || event.sequence || index),
    kind: event.kind || event.type || 'runtime',
    title: event.title || event.type || event.kind || 'Runtime event',
    detail: event.detail || event.message || event.summary || JSON.stringify(event.payload || event).slice(0, 240),
    status: event.status || event.phase || 'observed',
  }));
}
