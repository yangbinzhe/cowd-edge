import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, nextTick } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import { api, invalidateApiReadCache } from './api/client';
import ChatPage from './pages/ChatPage.vue';
import AgentsPage from './pages/AgentsPage.vue';
import AuditPage from './pages/AuditPage.vue';
import MemoryPage from './pages/MemoryPage.vue';
import RealityCorePage from './pages/RealityCorePage.vue';
import RuntimePage from './pages/RuntimePage.vue';
import ContextPage from './pages/ContextPage.vue';
import GatewayPage from './pages/GatewayPage.vue';
import MissionControlPage from './pages/MissionControlPage.vue';
import MfgPage from '@cowd/app-mfg-webui/MfgApp.vue';
import { mfgApi } from '@cowd/app-mfg-webui/api/mfgApi';
import SettingsPage from './pages/SettingsPage.vue';
import SkillsPage from './pages/SkillsPage.vue';
import SurfacePage from './pages/SurfacePage.vue';
import ToolsPage from './pages/ToolsPage.vue';
import { pluginRoutes, webuiPagePlugins } from './plugins/registry';
import { useAppStore } from './stores/app';
import { useChatSessionsStore } from './stores/chatSessions';
import { useMfgCockpitStore } from '@cowd/app-mfg-webui/stores/mfgCockpit';
import { createMfgMutationIntent } from '@cowd/app-mfg-webui/stores/mutationIntents';
import { useProjectionRegistryStore } from './stores/projectionRegistry';
import { resetLiveTransportForTests } from './stores/liveTransport';
import { cleanAssistantContent, collapseRepeatedText } from './utils/chatContent';
import { activitySummary, mergeTurnActivity } from './utils/turnSettlement';
import { createWorkspaceRoot, mergeWorkspaceTreeChildren } from './utils/workspaceTree';
import { isWorkspaceTextPreview, workspacePreviewKind } from './utils/workspacePreview';
import { canonicalMfgMutationResponse } from './testing/mfgReceiptMock';
import { activeCapabilitySectionKey } from './composables/useCapabilitySection';

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
vi.mock('vue-echarts', () => ({ default: { template: '<div class="chart"></div>' } }));

afterEach(() => {
  vi.restoreAllMocks();
  resetLiveTransportForTests();
});

function mountApp(path = '/chat') {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', redirect: '/chat' },
      { path: '/chat', component: ChatPage },
      { path: '/runtime', component: RuntimePage },
      { path: '/context', component: ContextPage },
      { path: '/memory', component: MemoryPage },
      { path: '/reality', component: RealityCorePage },
      { path: '/skills', component: SkillsPage },
      { path: '/agents', component: AgentsPage },
      { path: '/tools', component: ToolsPage },
      { path: '/surfaces', component: SurfacePage },
      { path: '/gateway', component: GatewayPage },
      { path: '/mission', component: MissionControlPage },
      ...pluginRoutes,
      { path: '/apps/mfg', component: MfgPage },
      { path: '/audit', component: AuditPage },
      { path: '/settings', component: SettingsPage },
    ],
  });
  router.push(path);
  return router.isReady().then(() => mount(App, { global: { plugins: [createPinia(), router] } }));
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

async function settleAsync() {
  await settle();
  await vi.dynamicImportSettled();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settle();
}

function installCanonicalExecutionProjection(
  executionId: string,
  turnId: string,
  rows: Array<Record<string, any>>,
) {
  const registry = useProjectionRegistryStore();
  const rootActivityId = `activity:execution:${executionId}`;
  const activities = [
    {
      schema_version: 4,
      activity_id: rootActivityId,
      scope: {
        workspace_id: 'workspace',
        session_id: useAppStore().activeSessionId,
        turn_id: turnId,
        execution_id: executionId,
      },
      kind: 'execution',
      display_label: '本轮执行',
      visibility: ['narrative', 'operational', 'audit'],
      causal_parent_ids: [],
      dependency_ids: [],
      status: rows.some((row) => ['running', 'started', 'pending'].includes(row.status))
        ? 'running'
        : rows.some((row) => ['failed', 'error'].includes(row.status))
          ? 'failed'
          : 'completed',
      required: true,
      sequence: 0,
      commit_cursor: 1,
      artifact_refs: [],
      evidence_refs: [],
      definition_refs: [],
    },
    ...rows.map((row, index) => ({
      schema_version: 4,
      activity_id: row.activity_id || `activity:execution:${executionId}:${row.kind}:${row.id}`,
      scope: {
        workspace_id: 'workspace',
        session_id: useAppStore().activeSessionId,
        turn_id: turnId,
        execution_id: executionId,
      },
      kind: row.kind === 'think' ? 'reasoning' : row.kind,
      display_label: row.title,
      visibility: row.kind === 'think'
        ? ['narrative', 'audit']
        : ['narrative', 'operational', 'audit'],
      parent_activity_id: row.parent_activity_id || rootActivityId,
      initiator_activity_id: rootActivityId,
      causal_parent_ids: [],
      dependency_ids: [],
      tool_call_id: row.tool_call_id || (row.kind === 'tool' ? row.id : undefined),
      status: row.status || 'completed',
      required: true,
      started_at_ms: index + 2,
      completed_at_ms: ['complete', 'completed', 'failed', 'error'].includes(row.status)
        ? index + 3
        : undefined,
      duration_ms: row.duration_ms,
      sequence: index + 1,
      commit_cursor: index + 2,
      public_summary: row.detail || row.title,
      result_summary: typeof row.output === 'string' ? row.output : undefined,
      artifact_refs: row.artifact_refs || [],
      evidence_refs: row.evidence_refs || [],
      definition_refs: row.definition_refs || [],
    })),
  ];
  registry.entries[executionId] = {
    executionId,
    projection: {
      schema_version: 2,
      execution_id: executionId,
      revision: 1,
      cursor: activities.length,
      detail_scope: 'summary',
      authorization_revision: 1,
      redaction_revision: 'test',
      session_id: useAppStore().activeSessionId,
      turn_id: turnId,
      activities,
      activity_relations: activities.slice(1).map((activity: any, index: number) => ({
        relation_id: `relation:${executionId}:${index}`,
        kind: activity.kind === 'tool' || activity.kind === 'skill' ? 'invoked' : 'contains',
        from_activity_id: activity.parent_activity_id,
        to_activity_id: activity.activity_id,
      })),
      graph: {
        graph_id: executionId,
        revision: 1,
        objective: 'canonical execution test',
        nodes: [],
        edges: [],
        commit_cursor: activities.length,
        terminal_result_ref: null,
      },
      child_executions: [],
      goals: [],
      agents: [],
      teams: [],
      relations: [],
      approvals: [],
      admissions: [],
      outcomes: [],
      interventions: [],
      usage: [],
      context: [],
      evidence: [],
      health: [],
      recovery: [],
      available_commands: [],
    } as any,
    cursor: activities.length,
    detailScope: 'summary',
    connectionState: 'live',
    lastUpdatedAt: Date.now(),
    lastEventAt: Date.now(),
    lastError: '',
    degradedReason: '',
    resyncCount: 0,
    requestEpoch: 1,
    reconnectBlocked: false,
    authorizationSessionId: useAppStore().activeSessionId,
    consumers: {},
    materializingConsumers: {},
  };
}

function mfgIntent(action: string, resource: string, payload: unknown = {}) {
  return createMfgMutationIntent(action, resource, payload);
}

function expectMfgMutation(
  fetchMock: ReturnType<typeof vi.fn>,
  path: string,
  expectedBody: Record<string, unknown>,
  expectedKey?: string,
) {
  const call = fetchMock.mock.calls.find(([url]) => String(url) === path);
  expect(call, `missing MFG mutation call ${path}`).toBeTruthy();
  const init = (call?.[1] || {}) as RequestInit;
  const body = init.body ? JSON.parse(String(init.body)) : {};
  expect(body).toMatchObject(expectedBody);
  const headerKey = new Headers(init.headers).get('Idempotency-Key');
  expect(headerKey).toBeTruthy();
  // 幂等键属于传输治理元数据，只能通过规范请求头发送，不能污染严格业务 DTO。
  expect(body).not.toHaveProperty('idempotency_key');
  if (expectedKey) expect(headerKey).toBe(expectedKey);
}

describe('Cowd Vue WebUI shell', () => {
  it('restores the Settings section from the route query', async () => {
    const wrapper = await mountApp('/settings?section=policy');
    await settleAsync();
    expect(wrapper.find('[data-section="policy"]').exists()).toBe(true);
    expect(wrapper.find('[data-section="ui"]').exists()).toBe(false);
  });

  it('keeps actual policy axes separate from the next requested preset when defaults drift', async () => {
    vi.spyOn(api, 'executionPolicyDefaults').mockResolvedValue({
      matched_preset: null,
      policy: {
        autonomy_profile: 'yolo',
        permission_mode: 'workspace-write',
        approval_profile: 'supervised',
        sandbox_posture: 'read_only_sandbox',
        interruption_policy: 'always_pause_for_human',
      },
    } as any);
    const wrapper = await mountApp('/settings?section=policy');
    await settleAsync();

    const summary = wrapper.get('.execution-policy-defaults .execution-policy-summary').text();
    expect(summary).toContain('yolo');
    expect(summary).toContain('workspace-write');
    expect(summary).toContain('read_only_sandbox');
    expect(summary).toContain('always_pause_for_human');
    expect((wrapper.get('#default-autonomy-preset').element as HTMLSelectElement).value)
      .toBe('supervised');
    wrapper.unmount();
  });

  it('registers MFG through the generated external APP catalog', async () => {
    const plugin = webuiPagePlugins.find((item) => item.appId === 'mfg');
    expect(plugin).toBeTruthy();
    expect(plugin?.route).toBe('/apps/mfg');
    expect(plugin?.readiness.appApi).toBe('/api/apps/mfg/app');
    expect(plugin?.readiness.requiredCapabilities).toContain('mfg.report.review');
    expect((await plugin?.page()).default).toBe(MfgPage);

    const wrapper = await mountApp('/chat');
    const railButtons = wrapper.findAll('.rail-button');
    expect(railButtons.some((button) => button.attributes('aria-label') === '制造运营工作台')).toBe(true);
    const legacyLabel = ['IA', 'CC'].join('');
    expect(railButtons.some((button) => button.attributes('aria-label') === legacyLabel)).toBe(false);
  });

  it('keeps Workspace out of the left rail and inside the right companion panel', async () => {
    const wrapper = await mountApp('/chat');
    const rail = wrapper.get('.rail').text();
    expect(rail).not.toContain('工作区');
    await wrapper.get('.companion-toggle').trigger('click');
    await settleAsync();
    expect(wrapper.get('.companion-tabs').text()).toContain('活动');
    expect(wrapper.get('.companion-tabs').text()).toContain('工作区');
    expect(wrapper.get('.companion-tabs').text()).toContain('检查器');
    expect(wrapper.get('.companion-tabs').text()).not.toContain('思考');
    expect(wrapper.get('.companion-tabs').text()).not.toContain('证据');
    expect(wrapper.findAll('.companion-tabs button')).toHaveLength(3);
  });

  it('renders compact Chat facts and keeps display mode on the companion toggle', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    expect(wrapper.get('.transcript').exists()).toBe(true);
    expect(wrapper.get('.composer textarea').exists()).toBe(true);
    expect(wrapper.get('.context-ring').exists()).toBe(true);
    expect(wrapper.find('.mode-switch').exists()).toBe(false);
    expect(wrapper.find('.chat-top-actions').exists()).toBe(false);
    expect(wrapper.find('.run-panorama').exists()).toBe(false);
    expect(wrapper.find('.companion-panel').exists()).toBe(false);
    expect(wrapper.get('.companion-toggle').exists()).toBe(true);
    expect(wrapper.get('.chat-session-facts').exists()).toBe(true);
    expect(wrapper.find('.chat-fact.model').exists()).toBe(false);
    expect(wrapper.find('.chat-fact.context').exists()).toBe(false);
    expect(wrapper.get('.chat-fact.observer').exists()).toBe(true);
    expect(wrapper.get('.session-evidence-head').exists()).toBe(true);
    expect(wrapper.get('.composer-runtime-summary').exists()).toBe(true);
    expect(wrapper.get('.composer-runtime-chip.model').exists()).toBe(true);
    expect(wrapper.get('.composer-runtime-chip.context').text()).toContain('—');
    expect(wrapper.find('.composer-actions').exists()).toBe(false);
    expect(wrapper.find('[aria-label="命令"]').exists()).toBe(false);
    expect(wrapper.get('.composer-runtime-summary .workspace').exists()).toBe(true);
    expect(wrapper.get('.composer-input-shell [aria-label="添加文件"]').exists()).toBe(true);
    const sendButton = wrapper.get('.composer-input-actions').findAll('button')
      .find((button) => button.attributes('aria-label') === '发送');
    expect(sendButton?.text()).toBe('');
    expect(wrapper.get('.chat-page').exists()).toBe(true);
  });

  it('opens the existing global Mission graph in place from the observer status', async () => {
    vi.spyOn(api, 'missionControl').mockResolvedValue({
      ok: true,
      snapshot: {
        schema_version: 1,
        kind: 'mission_control.materialized_snapshot',
        cursor: 4,
        revision: 2,
        needs_resync: false,
        projection: {
          missions: [{
            mission_id: 'mission-global',
            objective: 'Coordinate all active work',
            status: 'active',
            revision: 2,
          }],
          mission: { mission_id: 'mission-global' },
          mission_graph: {
            schema_version: 1,
            mission_id: 'mission-global',
            nodes: [{
              node_id: 'mission:mission-global',
              kind: 'mission',
              label: 'Coordinate all active work',
              status: 'active',
              mission_id: 'mission-global',
            }],
            edges: [],
          },
        },
      },
    } as any);
    const wrapper = await mountApp('/chat');
    await settle();

    const observer = wrapper.get('.mission-observer-entry');
    expect(observer.attributes('aria-label')).toBe('打开全局 Mission 运行图');
    await observer.trigger('click');
    await settleAsync();

    expect(wrapper.vm.$route.path).toBe('/chat');
    expect(wrapper.get('.global-mission-graph-dialog').text())
      .toContain('Coordinate all active work');
    expect(wrapper.get('.global-mission-graph-dialog .execution-graph-canvas').exists())
      .toBe(true);
  });

  it('opens the unified command palette from slash and fills the selected command without executing it', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.commands = [{
      name: '/status',
      description: '查看运行状态',
    }] as any;
    const execute = vi.spyOn(store, 'executeCommand');
    const composer = wrapper.get('.composer textarea');

    await composer.trigger('keydown', { key: '/' });
    await settle();

    expect(store.activeModal).toBe('commands');
    expect(wrapper.find('.composer-command-popover').exists()).toBe(false);
    const search = wrapper.get('.command-search input');
    await search.setValue('状态');
    expect(wrapper.get('.command-row').text()).toContain('/status');
    await search.trigger('keydown', { key: 'Enter' });
    await settle();

    expect(store.activeModal).toBeNull();
    expect((wrapper.get('.composer textarea').element as HTMLTextAreaElement).value).toBe('/status ');
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
    wrapper.unmount();
  });

  it('dispatches the permissions slash through the Session writer command boundary', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.activeSessionId = 'permissions-session';
    store.sessionCreating = false;
    useChatSessionsStore().activeSessionId = 'permissions-session';
    const execute = vi.spyOn(store, 'executeSessionCommand').mockResolvedValue({
      ok: true,
      data: {
        permission_mode: 'danger-full-access',
        persisted: true,
      },
    } as any);
    const composer = wrapper.get('.composer textarea');

    await composer.setValue('/permissions yolo');
    await composer.trigger('keydown', { key: 'Enter' });
    await settle();

    expect(execute).toHaveBeenCalledWith('/permissions', {
      session_id: 'permissions-session',
      input: '/permissions yolo',
      mode: 'yolo',
    });
    expect((composer.element as HTMLTextAreaElement).value).toBe('');
    execute.mockRestore();
    wrapper.unmount();
  });

  it('updates the canonical Session execution policy with writer ownership and revision control', async () => {
    const readPolicy = vi.spyOn(api, 'sessionExecutionPolicy').mockResolvedValue({
      session_id: 'policy-ui-session',
      policy: {
        autonomy_profile: 'supervised',
        permission_mode: 'workspace-write',
        approval_profile: 'balanced',
        sandbox_posture: 'workspace_write_sandbox',
        interruption_policy: 'pause_on_risk',
        revision: 7,
        origin: 'session_explicit',
      },
      state: {
        effective: {
          autonomy_profile: 'supervised',
          permission_mode: 'workspace-write',
          approval_profile: 'balanced',
          sandbox_posture: 'workspace_write_sandbox',
          interruption_policy: 'pause_on_risk',
          revision: 7,
          origin: 'session_explicit',
        },
      },
      matched_preset: 'supervised',
      active_turn: { state: 'applied', applied_revision: 7 },
    } as any);
    const updatePolicy = vi.spyOn(api, 'updateSessionExecutionPolicy').mockResolvedValue({
      session_id: 'policy-ui-session',
      policy: {
        autonomy_profile: 'yolo',
        permission_mode: 'danger-full-access',
        approval_profile: 'autonomous',
        interruption_policy: 'continue_until_blocked',
        revision: 8,
        origin: 'session_explicit',
      },
      state: {
        effective: {
          autonomy_profile: 'yolo',
          permission_mode: 'danger-full-access',
          approval_profile: 'autonomous',
          sandbox_posture: 'host_full_access',
          interruption_policy: 'continue_until_blocked',
          revision: 8,
          origin: 'session_explicit',
        },
      },
      matched_preset: 'yolo',
      active_turn: { state: 'applied', applied_revision: 8 },
    });
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'policy-ui-session';
    chat.activeSessionId = 'policy-ui-session';
    chat.active!.attachmentRole = 'writer';
    chat.active!.writable = true;
    await settleAsync();

    expect(readPolicy).toHaveBeenCalledWith('policy-ui-session');
    await wrapper.get('.composer-runtime-chip.execution-policy').trigger('click');
    const policySummary = wrapper.get('.execution-policy-summary').text();
    expect(policySummary).toContain('supervised');
    expect(policySummary).toContain('workspace_write_sandbox');
    expect(policySummary).toContain('pause_on_risk');
    await wrapper.get('.execution-policy-options [data-preset="yolo"]').trigger('click');
    await settleAsync();

    expect(updatePolicy).toHaveBeenCalledWith('policy-ui-session', 'yolo', 7);
    expect(wrapper.get('.composer-runtime-chip.execution-policy').text()).toContain('YOLO 全信任');
    wrapper.unmount();
  });

  it('keeps the effective policy visible while a desired revision is draining', async () => {
    vi.spyOn(api, 'sessionExecutionPolicy').mockResolvedValue({
      session_id: 'policy-transition-session',
      state: {
        effective: {
          autonomy_profile: 'supervised',
          permission_mode: 'workspace-write',
          approval_profile: 'balanced',
          sandbox_posture: 'workspace_write_sandbox',
          interruption_policy: 'pause_on_risk',
          revision: 7,
          origin: 'session_explicit',
        },
        desired: {
          autonomy_profile: 'yolo',
          permission_mode: 'danger-full-access',
          approval_profile: 'trust_all',
          sandbox_posture: 'host_full_access',
          interruption_policy: 'continue_until_blocked',
          revision: 8,
          origin: 'session_explicit',
        },
        pending_transition: {
          transition_id: 'policy-transition-8',
          phase: 'draining',
          desired_revision: 8,
          effective_revision: 7,
          old_revision_active_attempts: 2,
          requested_at_ms: 1_700_000_000_000,
          blocker: 'waiting for 2 old attempts',
        },
      },
      policy: {
        autonomy_profile: 'yolo',
        permission_mode: 'danger-full-access',
        approval_profile: 'trust_all',
        sandbox_posture: 'host_full_access',
        interruption_policy: 'continue_until_blocked',
        revision: 8,
        origin: 'session_explicit',
      },
      matched_preset: 'yolo',
      active_turn: { state: 'draining_previous_revision', applied_revision: 7 },
      transition: {
        transition_id: 'policy-transition-8',
        phase: 'draining',
        desired_revision: 8,
        effective_revision: 7,
        old_revision_active_attempts: 2,
        requested_at_ms: 1_700_000_000_000,
        blocker: 'waiting for 2 old attempts',
      },
    } as any);
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'policy-transition-session';
    chat.activeSessionId = 'policy-transition-session';
    await settleAsync();

    expect(wrapper.get('.composer-runtime-chip.execution-policy').text()).toContain('监督');
    expect(wrapper.get('.composer-runtime-chip.execution-policy').text()).not.toContain('YOLO');
    await wrapper.get('.composer-runtime-chip.execution-policy').trigger('click');
    const transition = wrapper.get('.execution-policy-transition');
    expect(transition.attributes('data-active')).toBe('true');
    expect(transition.text()).toContain('排空旧版本执行');
    expect(transition.text()).toContain('supervised@7');
    expect(transition.text()).toContain('yolo@8');
    expect(transition.text()).toContain('2');
    expect(transition.text()).toContain('waiting for 2 old attempts');
    wrapper.unmount();
  });

  it('does not disguise a custom or unavailable Session policy as a built-in preset', async () => {
    const readPolicy = vi.spyOn(api, 'sessionExecutionPolicy');
    readPolicy.mockResolvedValueOnce({
      session_id: 'custom-policy-session',
      policy: {
        autonomy_profile: 'yolo',
        permission_mode: 'danger-full-access',
        approval_profile: 'supervised',
        interruption_policy: 'continue_until_blocked',
        revision: 4,
        origin: 'session_explicit',
      },
      state: {
        effective: {
          autonomy_profile: 'yolo',
          permission_mode: 'danger-full-access',
          approval_profile: 'supervised',
          sandbox_posture: 'host_full_access',
          interruption_policy: 'continue_until_blocked',
          revision: 4,
          origin: 'session_explicit',
        },
      },
      matched_preset: null,
      active_turn: { state: 'applied', applied_revision: 4 },
      __state: 'ready',
    });
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'custom-policy-session';
    chat.activeSessionId = 'custom-policy-session';
    await settleAsync();

    expect(wrapper.get('.composer-runtime-chip.execution-policy').text()).toContain('自定义');

    readPolicy.mockResolvedValueOnce({
      session_id: 'unavailable-policy-session',
      policy: {
        autonomy_profile: 'supervised',
        permission_mode: 'workspace-write',
        approval_profile: 'balanced',
        interruption_policy: 'pause_on_risk',
        revision: 0,
        origin: 'config_default',
      },
      state: {
        effective: {
          autonomy_profile: 'supervised',
          permission_mode: 'workspace-write',
          approval_profile: 'balanced',
          sandbox_posture: 'workspace_write_sandbox',
          interruption_policy: 'pause_on_risk',
          revision: 0,
          origin: 'config_default',
        },
      },
      matched_preset: null,
      active_turn: { state: 'applies_on_activation', applied_revision: null },
      __state: 'forbidden',
      __error: 'policy access denied',
    });
    store.activeSessionId = 'unavailable-policy-session';
    chat.activeSessionId = 'unavailable-policy-session';
    await settleAsync();

    expect(wrapper.get('.composer-runtime-chip.execution-policy').text()).toContain('不可用');
    await wrapper.get('.composer-runtime-chip.execution-policy').trigger('click');
    expect(wrapper.get('.execution-policy-modal').text()).toContain('policy access denied');
    expect(wrapper.get('.execution-policy-summary').findAll('strong').every((value) => value.text() === '—'))
      .toBe(true);
    wrapper.unmount();
  });

  it('opens and closes the complete session list from the active Chat navigation control', async () => {
    const wrapper = await mountApp('/chat');
    await settle();

    expect(wrapper.find('.mobile-sessions-button').exists()).toBe(false);
    const trigger = wrapper.get('.rail-button[aria-label="对话"]');
    await trigger.trigger('click');
    await nextTick();
    expect(wrapper.get('.session-sidebar').classes()).toContain('mobile-open');
    expect(wrapper.get('.mobile-session-backdrop').exists()).toBe(true);

    await wrapper.get('.mobile-session-backdrop').trigger('click');
    await nextTick();
    expect(wrapper.get('.session-sidebar').classes()).not.toContain('mobile-open');
    expect(wrapper.find('.mobile-session-backdrop').exists()).toBe(false);
    wrapper.unmount();
  });

  it('closes the mobile session drawer immediately while the selected session loads', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.sessions = [{ id: 'slow-session', title: 'Slow session' }] as any;
    let resolveLoad!: () => void;
    const load = vi.spyOn(store, 'loadMessages').mockImplementation(() => new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }));
    await nextTick();

    await wrapper.get('.rail-button[aria-label="对话"]').trigger('click');
    expect(wrapper.get('.session-sidebar').classes()).toContain('mobile-open');
    const selection = wrapper.get('.session-open').trigger('click');
    await nextTick();

    expect(load).toHaveBeenCalledWith('slow-session');
    expect(wrapper.get('.session-sidebar').classes()).not.toContain('mobile-open');
    expect(wrapper.find('.mobile-session-backdrop').exists()).toBe(false);

    resolveLoad();
    await selection;
    wrapper.unmount();
  });

  it('loads the typed execution index after the transcript without requesting a second turn projection', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.sessions = [{ id: 'history-session', title: 'History' }] as any;
    const open = vi.spyOn(chat, 'open').mockResolvedValue(undefined);
    const execution = vi.spyOn(chat, 'hydrateExecutionIndex').mockResolvedValue(undefined);

    await store.loadMessages('history-session');
    await settle();

    expect(open).toHaveBeenCalledWith('history-session');
    expect(execution).toHaveBeenCalledWith('history-session', false);
    wrapper.unmount();
  });

  it('atomically changes the send target while a new session is being created', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.sessions = [{ id: 'old-session', title: 'Old session' }] as any;
    store.activeSessionId = 'old-session';
    chat.activeSessionId = 'old-session';
    let resolveCreate!: (session: any) => void;
    const create = vi.spyOn(api, 'createSession').mockImplementation(() => (
      new Promise((resolve) => { resolveCreate = resolve; })
    ));

    const first = store.createSession();
    const second = store.createSession();
    expect(store.sessionCreating).toBe(true);
    expect(store.activeSessionId).toBe('');
    expect(chat.activeSessionId).toBe('');
    expect(create).toHaveBeenCalledTimes(1);

    resolveCreate({ id: 'new-session', title: 'New session', model: 'deepseek-v4-pro' });
    await Promise.all([first, second]);
    expect(store.sessionCreating).toBe(false);
    expect(store.activeSessionId).toBe('new-session');
    expect(chat.activeSessionId).toBe('new-session');
    expect(create).toHaveBeenCalledTimes(1);
    create.mockRestore();
    wrapper.unmount();
  });

  it('does not keep a newly created session blocked behind transcript hydration', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    let releaseOpen!: () => void;
    vi.spyOn(api, 'createSession').mockResolvedValue({
      id: 'actionable-session',
      title: 'Actionable session',
      model: 'deepseek-v4-pro',
    } as any);
    vi.spyOn(chat, 'open').mockImplementation(() => (
      new Promise<void>((resolve) => { releaseOpen = resolve; })
    ));

    await store.createSession();

    expect(store.sessionCreating).toBe(false);
    expect(store.activeSessionId).toBe('actionable-session');
    expect(chat.activeSessionId).toBe('actionable-session');
    releaseOpen();
    await settle();
    wrapper.unmount();
  });

  it('moves a draft typed during creation into the newly created session', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    let resolveCreate!: (session: any) => void;
    vi.spyOn(api, 'createSession').mockImplementation(() => (
      new Promise((resolve) => { resolveCreate = resolve; })
    ));
    vi.spyOn(chat, 'open').mockImplementation(() => new Promise<void>(() => undefined));

    const creating = store.createSession();
    await wrapper.get('.composer textarea').setValue('draft during creation');
    resolveCreate({
      id: 'draft-session',
      title: 'Draft session',
      model: 'deepseek-v4-pro',
    });
    await creating;
    await settle();

    expect(store.activeSessionId).toBe('draft-session');
    expect(chat.states['draft-session'].draft).toBe('draft during creation');
    expect((wrapper.get('.composer textarea').element as HTMLTextAreaElement).value)
      .toBe('draft during creation');
    expect(wrapper.get('.composer-input-actions [aria-label="发送"]').attributes('disabled'))
      .toBeUndefined();
    wrapper.unmount();
  });

  it('presents current-session approvals in Chat and resolves them through the unified approval API', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    let resolved = false;
    const pending = vi.spyOn(api, 'approvalPending')
      .mockImplementation(async (filters = {}) => ({
        kind: 'gateway.unified_approval_pending',
        pending: resolved ? [] : [{
          approval_id: 'approval-chat-1',
          status: 'pending',
          action: 'tool.workspace_write',
          summary: 'Allow the current execution write',
          risk: 'medium',
          timeout_policy: 'pending',
          domain: 'execution',
          blocks_execution: true,
          source: { session_id: 'approval-session' },
          context: {
            requested_sandbox_posture: 'workspace_write_sandbox',
            effective_sandbox_posture: 'workspace_write_sandbox',
          },
          allowed_scopes: ['once', 'session'],
          skippable: true,
          effect_assessment: {
            operation: 'workspace.write',
            read_write_class: 'write',
            reversibility: 'reversible',
            resource_targets: [{ resource: 'workspace', operation: 'write', target: 'README.md' }],
          },
          policy_revision: 8,
          revision: 2,
        }],
        filter: filters,
      } as any));
    const respond = vi.spyOn(api, 'approvalRespond').mockImplementation(async () => {
      resolved = true;
      return { ok: true } as any;
    });
    const exact = vi.spyOn(api, 'approvalExact').mockResolvedValue({
      approval_id: 'approval-chat-1',
      status: 'approved',
      action: 'tool.workspace_write',
      summary: 'Allow the current execution write',
      risk: 'medium',
      domain: 'execution',
      blocks_execution: true,
      context: {},
      source: { session_id: 'approval-session' },
      decision: {
        actor: { actor_id: 'human:operator' },
        reason: 'approved from WebUI',
        decided_at_ms: 1_700_000_000_000,
      },
    } as any);
    const store = useAppStore();
    store.activeSessionId = 'approval-session';
    window.dispatchEvent(new CustomEvent('cowd:approval-changed'));
    await settleAsync();

    expect(pending).toHaveBeenCalledWith(
      { sessionId: 'approval-session', domain: 'execution', blocksExecution: true },
    );
    expect(wrapper.get('.chat-approval-modal').text()).toContain('Allow the current execution write');
    expect(wrapper.get('.chat-approval-modal').text()).toContain('workspace.write');
    expect(wrapper.get('.chat-approval-modal').text()).toContain('workspace:write:README.md');
    expect(wrapper.get('.chat-approval-modal').text()).toContain('workspace_write_sandbox');
    expect(wrapper.get('.chat-approval-modal').text()).not.toContain('跳过并继续');
    expect(wrapper.get('.global-approval-button').text()).toContain('1');
    await wrapper.get('.chat-approval-modal .primary-action').trigger('click');
    await settleAsync();

    expect(respond).toHaveBeenCalledWith('approval-chat-1', true, 'once', 'approved from WebUI', false);
    expect(exact).toHaveBeenCalledWith('approval-chat-1');
    expect(wrapper.get('.chat-approval-modal').text()).toContain('审批已进入终态：approved');
    expect(wrapper.get('.chat-approval-modal').text()).toContain('human:operator');
    expect(wrapper.get('.chat-approval-modal').text()).toContain('approved from WebUI');
    expect(wrapper.get('.chat-approval-modal').text()).not.toContain('批准并继续');
    wrapper.unmount();
    pending.mockRestore();
    respond.mockRestore();
    exact.mockRestore();
  });

  it('offers only backend-authorized scopes and skip for a typed read approval', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    let resolved = false;
    vi.spyOn(api, 'approvalPending').mockImplementation(async (filters = {}) => ({
      kind: 'gateway.unified_approval_pending',
      pending: resolved ? [] : [{
        approval_id: 'approval-read-1',
        status: 'pending',
        action: 'workspace.read',
        summary: 'Read a workspace report',
        risk: 'low',
        domain: 'execution',
        blocks_execution: true,
        context: {},
        source: { session_id: 'approval-read-session' },
        allowed_scopes: ['turn', 'task'],
        skippable: true,
        effect_assessment: { read_write_class: 'read_only' },
      }],
      filter: filters,
      approvals: null,
    } as any));
    const respond = vi.spyOn(api, 'approvalRespond').mockImplementation(async () => {
      resolved = true;
      return { ok: true } as any;
    });
    const store = useAppStore();
    store.activeSessionId = 'approval-read-session';
    window.dispatchEvent(new CustomEvent('cowd:runtime-live-reconnected'));
    await settleAsync();

    const modal = wrapper.get('.chat-approval-modal');
    expect(modal.findAll('.approval-scope-options button').map((button) => button.text()))
      .toEqual(['当前回合', '当前任务']);
    const skip = modal.findAll('footer button').find((button) => button.text().includes('跳过并继续'));
    expect(skip).toBeDefined();
    await skip!.trigger('click');
    await settleAsync();

    expect(respond).toHaveBeenCalledWith('approval-read-1', false, 'once', 'skipped from WebUI', true);
    wrapper.unmount();
  });

  it('restores a blocking approval from the canonical endpoint after live reconnect', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    let reconnected = false;
    const pending = vi.spyOn(api, 'approvalPending').mockImplementation(async (filters = {}) => ({
      kind: 'gateway.unified_approval_pending',
      pending: reconnected ? [{
        approval_id: 'approval-recovered-1',
        status: 'pending',
        action: 'tool.write',
        summary: 'Recovered after reconnect',
        risk: 'high',
        domain: 'execution',
        blocks_execution: true,
        context: {},
        source: { session_id: 'approval-recovery-session' },
        allowed_scopes: ['once'],
        effect_assessment: { read_write_class: 'write' },
      }] : [],
      filter: filters,
      approvals: null,
    } as any));
    const store = useAppStore();
    store.activeSessionId = 'approval-recovery-session';
    await settleAsync();
    expect(wrapper.find('.chat-approval-modal').exists()).toBe(false);

    reconnected = true;
    window.dispatchEvent(new CustomEvent('cowd:runtime-live-reconnected'));
    await settleAsync();

    expect(wrapper.get('.chat-approval-modal').text()).toContain('Recovered after reconnect');
    expect(pending).toHaveBeenCalledWith(
      { sessionId: 'approval-recovery-session', domain: 'execution', blocksExecution: true },
    );
    wrapper.unmount();
  });

  it('does not auto-open non-execution governance approvals in Chat', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const pending = vi.spyOn(api, 'approvalPending').mockImplementation(async (filters = {}) => ({
      kind: 'gateway.unified_approval_pending',
      pending: Object.keys(filters).length ? [] : [{
        approval_id: 'approval-knowledge-1',
        status: 'pending',
        action: 'knowledge.promote_l4',
        summary: 'Promote verified knowledge',
        risk: 'medium',
        timeout_policy: 'pending',
        domain: 'knowledge',
        blocks_execution: false,
        source: { session_id: 'approval-session' },
      }],
    } as any));
    const store = useAppStore();
    store.activeSessionId = 'approval-session';
    window.dispatchEvent(new CustomEvent('cowd:approval-changed'));
    await settleAsync();

    expect(wrapper.find('.chat-approval-modal').exists()).toBe(false);
    expect(wrapper.get('.global-approval-button').text()).toContain('1');
    wrapper.unmount();
    pending.mockRestore();
  });

  it('keeps pending approvals available from the global top status outside Chat', async () => {
    const wrapper = await mountApp('/runtime');
    await settleAsync();
    const pending = vi.spyOn(api, 'approvalPending').mockResolvedValue({
      kind: 'gateway.unified_approval_pending',
      pending: [{
        approval_id: 'approval-global-1',
        status: 'pending',
        action: 'runtime.release',
        summary: 'Release the candidate runtime',
        risk: 'high',
        timeout_policy: 'pending',
        source: { session_id: 'another-session' },
      }],
    } as any);
    window.dispatchEvent(new CustomEvent('cowd:approval-changed'));
    await settleAsync();

    expect(wrapper.get('.global-approval-button').text()).toContain('1');
    await wrapper.get('.global-approval-button').trigger('click');
    expect(wrapper.get('.chat-approval-modal').text()).toContain('Release the candidate runtime');
    wrapper.unmount();
    pending.mockRestore();
  });

  it('routes typed evolution approvals to their owning review workspace', async () => {
    const wrapper = await mountApp('/runtime');
    await settleAsync();
    const pending = vi.spyOn(api, 'approvalPending').mockResolvedValue({
      kind: 'gateway.unified_approval_pending',
      pending: [{
        approval_id: 'approval-evolution-1',
        status: 'pending',
        action: 'evolution.release',
        summary: 'Review the candidate release',
        risk: 'high',
        timeout_policy: 'pending',
        source: { kind: 'Evolution', review_ref: 'release-review-1' },
      }],
    } as any);
    window.dispatchEvent(new CustomEvent('cowd:approval-changed'));
    await settleAsync();

    await wrapper.get('.global-approval-button').trigger('click');
    expect(wrapper.get('.chat-approval-modal').text()).toContain('打开审批工作台');
    expect(wrapper.find('.chat-approval-modal .ghost-action').exists()).toBe(false);
    await wrapper.get('.chat-approval-modal .primary-action').trigger('click');
    await settleAsync();
    expect(wrapper.get('.main-surface').attributes('data-page')).toBe('audit');
    wrapper.unmount();
    pending.mockRestore();
  });

  it('opens the current execution graph from the Chat status control', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    const projections = useProjectionRegistryStore();
    store.activeSessionId = 'graph-session';
    chat.activeSessionId = 'graph-session';
    chat.active!.executionId = 'execution-graph-1';
    chat.active!.executionGraphId = 'execution-graph-1';
    projections.entries['execution-graph-1'] = {
      executionId: 'execution-graph-1',
      projection: {
        schema_version: 2,
        kind: 'runtime.execution_projection',
        execution_id: 'execution-graph-1',
        revision: 1,
        cursor: 1,
        live: { status: 'running' },
        graph: {
          graph_id: 'execution-graph-1',
          objective: 'Inspect technical standard evidence',
          status: 'running',
          nodes: [{
            node_id: 'research',
            kind: 'tool_batch',
            executor_kind: 'WebSearch',
            status: 'running',
            payload_ref: JSON.stringify({
              calls: [{
                id: 'web-search-1',
                name: 'WebSearch',
                input: { query: 'technical standard' },
                depends_on: [],
              }],
            }),
            acceptance: {
              criteria: ['current sources'],
              required_evidence: ['web'],
            },
            resource_scopes: ['network:read'],
            summary: 'Technical evidence is being collected',
            result_ref: 'result://technical-research',
            evidence_refs: [],
            usage: {},
          }],
          edges: [],
        },
        activities: [
          {
            schema_version: 1,
            activity_id: 'activity:execution:execution-graph-1',
            scope: {
              workspace_id: 'workspace',
              session_id: 'graph-session',
              turn_id: 'turn-graph-1',
              execution_id: 'execution-graph-1',
            },
            kind: 'execution',
            visibility: ['narrative', 'operational', 'audit'],
            causal_parent_ids: [],
            dependency_ids: [],
            status: 'running',
            started_at_ms: 1,
            sequence: 1,
            commit_cursor: 1,
            public_summary: 'Inspect technical standard evidence',
            artifact_refs: [],
            evidence_refs: [],
          },
          {
            schema_version: 1,
            activity_id: 'activity:execution:execution-graph-1:tool:web-search-1',
            scope: {
              workspace_id: 'workspace',
              session_id: 'graph-session',
              turn_id: 'turn-graph-1',
              execution_id: 'execution-graph-1',
            },
            kind: 'tool',
            visibility: ['narrative', 'operational', 'audit'],
            parent_activity_id: 'activity:execution:execution-graph-1',
            initiator_activity_id: 'activity:execution:execution-graph-1',
            causal_parent_ids: [],
            dependency_ids: [],
            tool_call_id: 'web-search-1',
            status: 'completed',
            started_at_ms: 2,
            completed_at_ms: 12,
            duration_ms: 10,
            sequence: 2,
            commit_cursor: 2,
            public_summary: 'WebSearch',
            artifact_refs: ['result://technical-research'],
            evidence_refs: ['evidence://technical-research'],
          },
        ],
        activity_relations: [{
          relation_id: 'relation:invoked:execution:web-search-1',
          kind: 'invoked',
          from_activity_id: 'activity:execution:execution-graph-1',
          to_activity_id: 'activity:execution:execution-graph-1:tool:web-search-1',
        }],
      } as any,
      cursor: 1,
      detailScope: 'full',
      connectionState: 'live',
      lastUpdatedAt: Date.now(),
      lastEventAt: Date.now(),
      lastError: '',
      degradedReason: '',
      resyncCount: 0,
      requestEpoch: 1,
      reconnectBlocked: false,
      authorizationSessionId: 'graph-session',
      consumers: {},
      materializingConsumers: {},
    };
    await nextTick();

    await wrapper.get('.chat-execution-status').trigger('click');
    await settle();

    expect(store.chatExecutionGraphExpanded).toBe(true);
    expect(wrapper.get('.chat-execution-overlay').text()).toContain('实时执行图');
    await wrapper
      .get('.chat-execution-overlay .graph-toolbar [aria-label="列表视图"]')
      .trigger('click');
    await nextTick();
    const toolRow = wrapper
      .findAll('.chat-execution-overlay .data-table tbody tr')
      .find((row) => row.text().includes('WebSearch'));
    expect(toolRow).toBeTruthy();
    await toolRow!.trigger('click');
    await nextTick();
    expect(wrapper.get('.execution-node-detail').text()).toContain('WebSearch');
    await wrapper
      .get('.execution-node-detail [aria-label="完整输出详情"]')
      .trigger('click');
    await nextTick();
    expect(wrapper.get('.execution-node-detail').text()).toContain('result://technical-research');

    await wrapper.get('.chat-execution-status').trigger('click');
    await settle();
    expect(wrapper.find('.chat-execution-overlay').exists()).toBe(false);

    store.openCompanion('activity');
    await settleAsync();
    expect(wrapper.get('.companion-execution-graph').exists()).toBe(true);
    await wrapper
      .get('.companion-execution-graph .graph-toolbar [aria-label="全屏"]')
      .trigger('click');
    await settle();
    expect(wrapper.get('.chat-execution-overlay').exists()).toBe(true);
    await wrapper.get('.chat-execution-overlay > header .icon-action').trigger('click');
    expect(store.chatExecutionGraphExpanded).toBe(false);
    wrapper.unmount();
  });

  it('shows Stop for a running turn and keeps supplemental Send available when input is present', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'supplement-session';
    chat.activeSessionId = 'supplement-session';
    chat.active!.pending = true;
    await nextTick();

    expect(wrapper.get('.composer-input-actions [aria-label="停止"]').exists()).toBe(true);
    expect(wrapper.find('.composer-input-actions [aria-label="补充当前执行"]').exists()).toBe(false);

    chat.active!.draft = '补充一条约束';
    await nextTick();

    const send = wrapper.get('.composer-input-actions [aria-label="补充当前执行"]');
    expect(send.attributes('disabled')).toBeUndefined();
    expect(send.attributes('title')).toBe('补充当前执行');
    expect(wrapper.get('.composer-input-actions [aria-label="停止"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows an accepted-supplement badge on the sent user message', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'supplement-badge-session';
    chat.activeSessionId = 'supplement-badge-session';
    chat.active!.turns = [
      { id: 'message-1', input_id: 'input-supplement-1', role: 'user', content: '之前的方案可能不合理，请全新生成一版' },
    ] as any;
    store.sessionInputProjection = {
      session_id: 'supplement-badge-session',
      inputs: [{
        input_id: 'input-supplement-1',
        decision: 'supplement_current_turn',
        status: 'attached_to_turn',
        application_receipt: { action: 'amend_current_turn', state: 'applied' },
        content_preview: '之前的方案可能不合理，请全新生成一版',
      }],
    } as any;
    await nextTick();

    const badge = wrapper.get('.turn[data-role="user"] .turn-input-badge');
    expect(badge.attributes('title')).toBe('已接纳');
    wrapper.unmount();
  });

  it('never cross-labels identical message text without an input_id mapping', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'duplicate-text-session';
    chat.activeSessionId = 'duplicate-text-session';
    chat.active!.turns = [
      { id: 'message-a', input_id: 'input-a', role: 'user', content: '重试同一条指令' },
      { id: 'message-b', role: 'user', content: '重试同一条指令' },
    ] as any;
    store.sessionInputProjection = {
      session_id: 'duplicate-text-session',
      inputs: [{
        input_id: 'input-a',
        decision: 'supplement_current_turn',
        status: 'attached_to_turn',
        application_receipt: { action: 'amend_current_turn', state: 'applied' },
      }],
    } as any;
    await nextTick();

    const badges = wrapper.findAll('.turn[data-role="user"] .turn-input-badge');
    expect(badges).toHaveLength(1);
    wrapper.unmount();
  });

  it('confirms single delete once per browser and deduplicates concurrent deletes', async () => {
    localStorage.removeItem('cowd.webui.sessionDeleteConfirmed.v1');
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.sessions = [{ id: 'delete-me', title: 'Delete me' } as any];
    store.activeSessionId = 'delete-me';
    const apiDelete = vi.spyOn(api, 'deleteSession').mockResolvedValue({ ok: true } as any);

    store.requestDeleteSession('delete-me');
    expect(store.pendingDeleteSessionId).toBe('delete-me');
    expect(apiDelete).not.toHaveBeenCalled();

    store.confirmDeleteSession();
    await settleAsync();
    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('cowd.webui.sessionDeleteConfirmed.v1')).toBe('1');

    store.sessions = [{ id: 'delete-me-2', title: 'Second' } as any];
    store.activeSessionId = 'delete-me-2';
    store.requestDeleteSession('delete-me-2');
    expect(store.pendingDeleteSessionId).toBeNull();
    await settleAsync();
    expect(apiDelete).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    localStorage.removeItem('cowd.webui.sessionDeleteConfirmed.v1');
  });

  it('returns the same flight for concurrent deletes of the same session', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.sessions = [{ id: 'same-delete', title: 'Same' } as any];
    store.activeSessionId = 'same-delete';
    let release!: () => void;
    vi.spyOn(api, 'deleteSession').mockImplementation(() => (
      new Promise((resolve) => {
        release = () => resolve({ ok: true } as any);
      })
    ));

    const first = store.deleteSession('same-delete');
    const second = store.deleteSession('same-delete');
    release();
    await Promise.all([first, second]);

    expect(api.deleteSession).toHaveBeenCalledTimes(1);
    expect(store.deletingSessionIds).toEqual([]);
    wrapper.unmount();
  });

  it('clears a submitted draft immediately and never overwrites newer input on failure', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'draft-submit-session';
    chat.activeSessionId = 'draft-submit-session';
    chat.setDraft('draft-submit-session', '');
    let finishSend!: (accepted: boolean) => void;
    const send = vi.spyOn(chat, 'send').mockImplementation(() => (
      new Promise<boolean>((resolve) => { finishSend = resolve; })
    ));
    await nextTick();

    const composer = wrapper.get('.composer textarea');
    await composer.setValue('第一条内容');
    void wrapper.get('.composer-input-actions [aria-label="发送"]').trigger('click');
    await nextTick();

    expect(send).toHaveBeenCalledWith(
      'draft-submit-session',
      '第一条内容',
      expect.objectContaining({ transportContent: '第一条内容' }),
    );
    expect((composer.element as HTMLTextAreaElement).value).toBe('');

    await composer.setValue('发送等待期间的新内容');
    finishSend(false);
    await settle();

    expect((composer.element as HTMLTextAreaElement).value).toBe('发送等待期间的新内容');
    wrapper.unmount();
  });

  it('renders one final answer with a compact execution timeline and aggregate token usage', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'timeline-session';
    store.companionCollapsed = false;
    store.selectedModel = 'deepseek-v4';
    store.providers = {
      catalog: {
        models: [{ id: 'deepseek-v4', context_window_tokens: 1_000_000 }],
      },
    } as any;
    chat.activeSessionId = 'timeline-session';
    chat.active!.turns = [
      { id: 'u1', role: 'user', content: '分析 README' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        token_usage: { input_tokens: 2_000, output_tokens: 40 },
        activity: [{
          id: 'tool-1',
          kind: 'tool',
          title: 'workspace.read',
          status: 'complete',
          duration_ms: 125,
          input: { path: 'README.md' },
        }],
      },
      {
        id: 'tool-result',
        role: 'tool',
        content: 'FULL TOOL OUTPUT SHOULD NOT BE IN TRANSCRIPT',
        activity: [{
          id: 'tool-1',
          kind: 'tool',
          title: 'workspace.read',
          status: 'complete',
          output: { lines: 42 },
        }],
      },
      {
        id: 'progress',
        role: 'assistant',
        content: '正在比对现有说明。',
        token_usage: { input_tokens: 1_000, output_tokens: 20 },
      },
      {
        id: 'structured-progress',
        role: 'assistant',
        content: '{"summary":"STRUCTURED AGENT RESULT SHOULD NOT BE A THOUGHT"}',
      },
      {
        id: 'answer',
        role: 'assistant',
        content: '最终分析结果。',
        token_usage: { input_tokens: 500, output_tokens: 80 },
        execution_id: 'execution-turn-1',
        turn_id: 'turn-1',
      },
    ] as any;
    chat.active!.executionIndex = {
      session_id: 'timeline-session',
      active_execution_ids: [],
      latest_execution_id: 'execution-turn-1',
      latest_graph_id: 'graph-turn-1',
      latest_status: 'complete',
      executions: [{
        execution_id: 'execution-turn-1',
        graph_id: 'graph-turn-1',
        turn_id: 'turn-1',
        status: 'complete',
        updated_at_ms: Date.now(),
      }],
    };
    chat.active!.activity = [
      {
        id: 'memory-1',
        kind: 'context',
        title: 'memory recall',
        status: 'complete',
        turn_id: 'turn-1',
      },
    ];
    installCanonicalExecutionProjection('graph-turn-1', 'turn-1', [
      {
        id: 'think-1',
        kind: 'think',
        title: '思考',
        detail: '正在比对现有说明',
        status: 'completed',
      },
      {
        id: 'tool-1',
        kind: 'tool',
        title: 'workspace.read',
        status: 'completed',
        duration_ms: 125,
        output: '读取 42 行',
      },
    ]);
    await nextTick();

    expect(wrapper.get('.composer-runtime-chip.model').text()).toContain('deepseek-v4');
    expect(wrapper.get('.composer-runtime-chip.context').text()).toContain('500 / 1M');
    expect(wrapper.get('.composer-runtime-summary').text()).toContain('工具调用1');
    expect(wrapper.get('.composer-runtime-summary').text()).toContain('记忆召回1');
    expect(wrapper.get('.composer-runtime-summary').text()).toContain('总 Token3.6K');
    expect(wrapper.findAll('.turn[data-role="assistant"]')).toHaveLength(1);
    expect(wrapper.findAll('.conversation-answer')).toHaveLength(1);
    expect(wrapper.findAll('.execution-activity-tree')).toHaveLength(1);
    expect(wrapper.findAll('.conversation-timeline')).toHaveLength(0);
    expect(wrapper.get('.conversation-answer').text()).toContain('最终分析结果');
    const activityTree = wrapper.get('.execution-activity-tree');
    expect(activityTree.text()).toContain('工具调用');
    expect(activityTree.text()).toContain('已执行 1/1');
    expect(wrapper.get('.reasoning-group.is-global').text()).toContain('正在比对现有说明');
    expect(activityTree.text()).not.toContain('正在比对现有说明');
    expect(activityTree.text()).not.toContain('STRUCTURED AGENT RESULT SHOULD NOT BE A THOUGHT');
    expect(activityTree.findAll('.execution-activity-node[data-kind="tool_batch"]')).toHaveLength(1);
    await activityTree
      .get('.execution-activity-node[data-kind="tool_batch"] .execution-activity-toggle')
      .trigger('click');
    expect(activityTree.text()).toContain('workspace.read');
    expect(wrapper.get('.answer-usage').text()).toContain('3.5K');
    expect(wrapper.get('.answer-usage').text()).toContain('140');
    expect(wrapper.get('.answer-execution-link').attributes('title')).toBe('查看本次执行图');
    await wrapper.get('.answer-execution-link').trigger('click');
    expect(store.chatExecutionGraphExpanded).toBe(true);
    expect(store.chatExecutionGraphId).toBe('graph-turn-1');
    store.closeChatExecutionGraph();
    const messageCopy = wrapper.get('.message-copy-link');
    expect(messageCopy.attributes('title')).toBe('复制消息');
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWrite }, configurable: true });
    await messageCopy.trigger('click');
    expect(clipboardWrite).toHaveBeenCalledWith('分析 README');
    expect(messageCopy.attributes('title')).toBe('已复制');
    delete (navigator as any).clipboard;
    expect(wrapper.get('.answer-copy-link').attributes('title')).toBe('复制答案');
    await wrapper.get('.answer-copy-link').trigger('click');
    expect(wrapper.get('.answer-copy-link').attributes('title')).toBe('已复制');
    expect(wrapper.text()).not.toContain('FULL TOOL OUTPUT SHOULD NOT BE IN TRANSCRIPT');

    store.openCompanion('activity');
    await settleAsync();
    const toolTimelineItem = wrapper
      .findAll('.execution-turn-group .timeline-list li')
      .find((item) => item.text().includes('workspace.read'));
    expect(toolTimelineItem).toBeTruthy();
    await toolTimelineItem!.trigger('click');
    expect(wrapper.get('.activity-detail-modal').text()).toContain('workspace.read');
    expect(wrapper.get('.activity-detail-modal').text()).toContain('125 ms');
    expect(wrapper.findAll('.activity-detail-modal .activity-structured-section')).toHaveLength(1);
    expect(wrapper.findAll('.activity-detail-modal .raw-payload')).toHaveLength(1);
  });

  it('forks a new session from a final answer footer', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.sessions = [{ id: 'fork-source', title: 'Original' } as any];
    store.activeSessionId = 'fork-source';
    chat.activeSessionId = 'fork-source';
    chat.active!.turns = [
      { id: 'u1', role: 'user', content: '分析 fork 流程' },
      { id: 'a1', role: 'assistant', content: '可以从此处分支。' },
    ] as any;
    const open = vi.spyOn(chat, 'open').mockResolvedValue();
    vi.spyOn(api, 'branchSession').mockResolvedValue({
      ok: true,
      data: { id: 'fork-branch', title: 'Original (branch)', parent_session_id: 'fork-source' },
    } as any);
    await nextTick();

    const branchLink = wrapper.get('.answer-branch-link');
    expect(branchLink.attributes('title')).toBe('从此结果分支新会话');
    await branchLink.trigger('click');
    await settleAsync();

    expect(api.branchSession).toHaveBeenCalledWith('fork-source');
    expect(store.activeSessionId).toBe('fork-branch');
    expect(store.sessions.map((session) => session.id)).toEqual(['fork-branch', 'fork-source']);
    expect(open).toHaveBeenCalledWith('fork-branch');
    wrapper.unmount();
  });

  it('shows a rolling live action before the causal thought and tool timeline', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'live-now-session';
    store.companionCollapsed = false;
    chat.activeSessionId = 'live-now-session';
    chat.active!.pending = true;
    chat.active!.streamTurnId = 'stream:live-now-session:1';
    chat.active!.executionId = 'execution-live-now';
    chat.active!.executionGraphId = 'execution-live-now';
    chat.active!.executionTurnId = 'turn-live-now';
    chat.active!.executionIndex = {
      session_id: 'live-now-session',
      active_execution_ids: ['execution-live-now'],
      latest_execution_id: 'execution-live-now',
      latest_graph_id: 'execution-live-now',
      latest_status: 'running',
      executions: [{
        execution_id: 'execution-live-now',
        graph_id: 'execution-live-now',
        turn_id: 'turn-live-now',
        status: 'running',
        updated_at_ms: Date.now(),
      }],
    };
    chat.active!.live = {
      status: 'preparing_context',
      status_detail: 'durable input committed',
    } as any;
    chat.active!.turns = [
      { id: 'u-live', role: 'user', content: '检查 README' },
      {
        id: 'stream:live-now-session:1',
        role: 'assistant',
        content: '',
        status: 'streaming',
        activity: [],
      },
    ] as any;
    installCanonicalExecutionProjection('execution-live-now', 'turn-live-now', []);
    await nextTick();

    expect(wrapper.get('.conversation-live-now').text()).toContain('正在整理上下文');
    expect(wrapper.findAll('.execution-activity-tree')).toHaveLength(1);

    chat.active!.live = {
      ...chat.active!.live,
      status: 'calling_tool',
    } as any;
    chat.active!.turns[1].activity = [
      {
        id: 'runtime-1',
        kind: 'runtime',
        title: '执行阶段',
        status: 'running',
      },
      {
        id: 'context-1',
        kind: 'context',
        title: 'memory recall',
        status: 'complete',
      },
      {
        id: 'think-1',
        kind: 'think',
        title: '思考',
        detail: '先读取项目说明，再核对目标。',
        status: 'running',
      },
      {
        id: 'tool-live',
        kind: 'tool',
        title: 'workspace.read',
        input: '{"path":"README.md","offset":0,"limit":200}',
        status: 'running',
      },
    ] as any;
    installCanonicalExecutionProjection('execution-live-now', 'turn-live-now', [
      {
        id: 'think-1',
        kind: 'think',
        title: '思考',
        detail: '先读取项目说明，再核对目标。',
        status: 'running',
      },
      {
        id: 'tool-live',
        kind: 'tool',
        title: 'workspace.read',
        status: 'running',
      },
    ]);
    await nextTick();

    const liveNow = wrapper.get('.conversation-live-now');
    expect(liveNow.text()).toContain('正在调用 workspace.read');
    expect(liveNow.text()).toContain('README.md');
    const reasoning = wrapper.get('.reasoning-group.is-global');
    expect(reasoning.text()).toContain('先读取项目说明');
    const timeline = wrapper.get('.execution-activity-tree');
    expect(timeline.text()).not.toContain('先读取项目说明');
    expect(timeline.text()).toContain('工具调用');
    expect(timeline.text()).not.toContain('{"path"');
    expect(timeline.text()).not.toContain('执行阶段');
    expect(timeline.text()).not.toContain('memory recall');
    expect(timeline.text()).toContain('workspace.read');
    wrapper.unmount();
  });

  it('keeps a failed optimistic message in the transcript without rendering assistant execution UI', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'optimistic-error-session';
    chat.activeSessionId = 'optimistic-error-session';
    chat.active!.turns = [
      {
        id: 'local:failed',
        role: 'user',
        content: '保留这条已发送消息',
        status: 'error',
        submission_error: 'writer lease rejected',
      },
    ];
    await nextTick();

    expect(wrapper.get('.turn[data-role="user"] .markdown-body').text())
      .toContain('保留这条已发送消息');
    expect(wrapper.get('.turn-submission-error').text()).toContain('writer lease rejected');
    expect(wrapper.find('.conversation-execution').exists()).toBe(false);
    expect(wrapper.find('textarea').element.value).toBe('');
    wrapper.unmount();
  });

  it('keeps completed execution trees after a newer turn becomes current', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'historical-tree-session';
    chat.activeSessionId = 'historical-tree-session';
    chat.active!.executionId = 'execution-2';
    chat.active!.turns = [
      { id: 'u1', role: 'user', content: '先检查配置' },
      {
        id: 'work-1',
        role: 'assistant',
        content: '',
        activity: [{
          id: 'tool-1',
          kind: 'tool',
          title: 'read_config',
          status: 'complete',
          execution_id: 'execution-1',
          turn_id: 'turn-1',
        }],
      },
      {
        id: 'answer-1',
        role: 'assistant',
        content: '配置检查完成。',
        execution_id: 'execution-1',
        turn_id: 'turn-1',
      },
      { id: 'u2', role: 'user', content: '再检查服务' },
      {
        id: 'answer-2',
        role: 'assistant',
        content: '服务检查完成。',
        execution_id: 'execution-2',
        turn_id: 'turn-2',
        activity: [{
          id: 'tool-2',
          kind: 'tool',
          title: 'check_service',
          status: 'complete',
          execution_id: 'execution-2',
          turn_id: 'turn-2',
        }],
      },
    ] as any;
    installCanonicalExecutionProjection('execution-1', 'turn-1', [{
      id: 'tool-1',
      kind: 'tool',
      title: 'read_config',
      status: 'completed',
    }]);
    installCanonicalExecutionProjection('execution-2', 'turn-2', [{
      id: 'tool-2',
      kind: 'tool',
      title: 'check_service',
      status: 'completed',
    }]);
    await nextTick();

    const trees = wrapper.findAll('.execution-activity-tree');
    expect(trees).toHaveLength(2);
    expect(trees[0].text()).toContain('工具调用');
    expect(trees[1].text()).toContain('工具调用');
    expect(wrapper.findAll('.conversation-timeline')).toHaveLength(0);
    expect(wrapper.findAll('.turn[data-role="assistant"]')).toHaveLength(2);
    wrapper.unmount();
  });

  it('keeps a failed execution tree even when no final answer was produced', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const chat = useChatSessionsStore();
    store.activeSessionId = 'failed-tree-session';
    chat.activeSessionId = 'failed-tree-session';
    chat.active!.turns = [
      { id: 'u-failed', role: 'user', content: '执行检查' },
      {
        id: 'failed-execution',
        role: 'assistant',
        content: '',
        status: 'error',
        execution_id: 'execution-failed',
        turn_id: 'turn-failed',
        activity: [{
          id: 'tool-failed',
          kind: 'tool',
          title: 'check_service',
          status: 'failed',
          execution_id: 'execution-failed',
          turn_id: 'turn-failed',
        }],
      },
    ] as any;
    installCanonicalExecutionProjection('execution-failed', 'turn-failed', [{
      id: 'tool-failed',
      kind: 'tool',
      title: 'check_service',
      status: 'failed',
    }]);
    await nextTick();

    expect(wrapper.findAll('.turn[data-role="assistant"]')).toHaveLength(1);
    expect(wrapper.get('.execution-activity-tree').text()).toContain('工具调用');
    expect(wrapper.find('.conversation-answer').exists()).toBe(false);
    wrapper.unmount();
  });

  it('exposes fork and delete controls on every session row and derives generated titles from the first prompt', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.sessions = [{
      id: 'abcdefgh-session',
      title: 'webui abcdefgh',
      updated_at: Date.now(),
    }];
    const update = vi.spyOn(api, 'updateSession').mockResolvedValue({ ok: true } as any);
    await store.ensureSessionTitleFromFirstMessage(
      'abcdefgh-session',
      '这是第一次发出的完整需求，需要作为会话名称并在长度过长时被安全截断，不展示随机会话编号。',
    );
    await nextTick();

    const row = wrapper.get('.session-row');
    expect(row.get('[aria-label="分支会话"]').exists()).toBe(true);
    expect(row.get('[aria-label="删除会话"]').exists()).toBe(true);
    expect(row.get('.session-title').text()).toContain('这是第一次发出的完整需求');
    expect(store.sessions[0].title?.endsWith('…')).toBe(true);
    expect(update).toHaveBeenCalledWith('abcdefgh-session', expect.objectContaining({
      title: expect.stringContaining('这是第一次发出的完整需求'),
    }));
    update.mockRestore();
  });

  it('keeps mobile Chat panorama usable by collapsing companion until requested', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const wrapper = await mountApp('/chat');
    const store = useAppStore();
    await settle();
    expect(wrapper.get('.chat-page').exists()).toBe(true);
    expect(wrapper.find('.companion-panel').exists()).toBe(false);
    expect(wrapper.find('.companion-toggle').exists()).toBe(true);
    await wrapper.get('.companion-toggle').trigger('click');
    await settleAsync();
    expect(wrapper.find('.companion-panel').exists()).toBe(true);
    expect(store.companionCollapsed).toBe(false);
    await wrapper.get('.companion-toggle').trigger('click');
    await settle();
    expect(wrapper.find('.companion-panel').exists()).toBe(false);
    expect(store.companionCollapsed).toBe(true);
    wrapper.unmount();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  });

  it('cleans raw tool evidence from assistant-visible Chat content', () => {
    const raw = [
      'Done.',
      'Tool workspace.read completed. Raw evidence ref: evidence://tool/1',
      'Summary: {"path":"README.md","content":"large payload"}',
      'Next step is ready.',
    ].join('\n');
    const cleaned = cleanAssistantContent(raw, (tool) => `工具 ${tool} 已完成，详细证据已进入证据面板。`);
    expect(cleaned).toContain('工具 workspace.read 已完成');
    expect(cleaned).toContain('Next step is ready.');
    expect(cleaned).not.toContain('Raw evidence ref');
    expect(cleaned).not.toContain('Summary: {');
  });

  it('cleans failed tool evidence from assistant-visible Chat content', () => {
    const raw = 'Tool read_file failed. Raw evidence ref: tool://tool-1. Summary: No such file or directory';
    const cleaned = cleanAssistantContent(raw, (tool, outcome) => `工具 ${tool} ${outcome === 'failed' ? '失败' : '完成'}，详细证据已进入证据面板。`);
    expect(cleaned).toContain('工具 read_file 失败');
    expect(cleaned).not.toContain('Raw evidence ref');
    expect(cleaned).not.toContain('Summary:');
  });

  it('collapses repeated assistant-visible content', () => {
    const repeated = ['完成第一步。', '继续处理第二步。'].join('\n\n');
    expect(collapseRepeatedText([repeated, repeated, repeated].join('\n\n'))).toBe(repeated);
  });

  it('switches Chat into clean mode without duplicating execution stats in the composer', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.currentTimeline = { events: [{ kind: 'ToolStart' }, { kind: 'ToolComplete' }, { kind: 'memory_recall' }] };
    store.currentRealityFlow = { stages: [{ kind: 'memory.promoted' }, { kind: 'memory.held' }, { kind: 'context.fact' }] };
    await wrapper.get('.companion-toggle').trigger('click');
    await settleAsync();
    await wrapper.get('.companion-toggle').trigger('click');
    await settle();
    expect(store.companionCollapsed).toBe(true);
    expect(wrapper.find('.run-panorama').exists()).toBe(false);
    expect(wrapper.find('.companion-panel').exists()).toBe(false);
    expect(wrapper.find('.clean-counts').exists()).toBe(false);
    expect(wrapper.get('.composer-runtime-summary').exists()).toBe(true);
    expect(wrapper.get('.chat-session-facts').exists()).toBe(true);
  });

  it('renders Surface operations without the obsolete generic workflow strip', async () => {
    const wrapper = await mountApp('/surfaces');
    await settle();
    expect(wrapper.find('.workflow-strip').exists()).toBe(false);
    expect(wrapper.text()).toContain('Surface 宿主');
  });

  it('keeps session evidence in the top header instead of duplicating it per message', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    await settle();
    expect(wrapper.get('.session-evidence-head').text()).toContain('证据');
    expect(wrapper.find('.message-meta button').exists()).toBe(false);
    expect(wrapper.find('.turn-evidence-drawer').exists()).toBe(false);
  });

  it('deduplicates turn activity and summarizes assistant work signals', () => {
    const activity = mergeTurnActivity([], [
      { id: 'a1', kind: 'tool', title: 'workspace.read', detail: 'README.md', status: 'complete' },
      { id: 'a2', kind: 'tool', title: 'workspace.read', detail: 'README.md', status: 'complete' },
      { id: 'a3', kind: 'context', title: 'context packed', detail: 'memory', status: 'observed' },
      { id: 'a4', kind: 'approval', title: 'approval', detail: 'allowed', status: 'approved' },
    ]);
    expect(activity).toHaveLength(3);
    expect(activitySummary({ activity, tool_name: 'workspace.read' })).toMatchObject({
      total: 3,
      tools: 1,
      context: 1,
      approvals: 1,
    });
  });

  it('tracks session attention, pinning, and loaded-list pagination in the store', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.sessions = Array.from({ length: 105 }, (_, index) => ({
      id: `session-${index}`,
      title: `Session ${index}`,
      status: 'active',
      execution: {
        session_id: `session-${index}`,
        active_execution_ids: index === 0 ? ['execution-0'] : [],
        latest_status: index === 0 ? 'calling_model' : 'complete',
      },
      message_count: index + 1,
      updated_at: Date.now() - index * 1000,
    }));
    expect(store.groupedSessions.flatMap((group) => group.items)).toHaveLength(100);
    expect(store.sessionRenderHasMore).toBe(true);
    store.revealMoreSessions();
    expect(store.groupedSessions.flatMap((group) => group.items)).toHaveLength(105);
    store.toggleSessionPin('session-90');
    expect(store.isSessionPinned(store.sessions[90])).toBe(true);
    expect(store.groupedSessions[0].items[0].id).toBe('session-90');
    expect(store.isSessionRunning(store.sessions[0])).toBe(true);
    expect(store.isSessionRunning({ id: 'idle-session', status: 'active' })).toBe(false);
    store.markSessionViewed('session-0');
    expect(store.isSessionUnread(store.sessions[0])).toBe(false);
    wrapper.unmount();
  });

  it('filters deleted tombstones and renders canonical execution outcomes in the session list', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    vi.spyOn(api, 'searchSessions').mockResolvedValue({
      sessions: [
        { id: 'deleted-session', status: 'deleted', title: 'Deleted' },
        {
          id: 'complete-session',
          status: 'active',
          title: 'Complete',
          execution: {
            session_id: 'complete-session',
            active_execution_ids: [],
            latest_status: 'complete',
          },
        },
        {
          id: 'error-session',
          status: 'active',
          title: 'Error',
          execution: {
            session_id: 'error-session',
            active_execution_ids: [],
            latest_status: 'error',
          },
        },
      ],
    } as any);

    await store.refreshSessions();
    await nextTick();

    expect(store.sessions.map((session) => session.id)).toEqual(['complete-session', 'error-session']);
    const statuses = wrapper.findAll('.session-execution-status').map((node) => node.text());
    expect(statuses).toContain('完成');
    expect(statuses).toContain('错误');
    expect(wrapper.text()).not.toContain('Deleted');
    wrapper.unmount();
  });

  it('extends Session search with message matches and hydrates only matched Sessions', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    const sessionSearch = vi.spyOn(api, 'searchSessions').mockResolvedValue({
      sessions: [],
    } as any);
    const messageSearch = vi.spyOn(api, 'searchMessages').mockResolvedValue({
      query: 'needle',
      total: 1,
      results: [{
        session_id: 'message-match',
        message_id: 'message-1',
        content_preview: 'needle in durable history',
        created_at_ms: 42,
      }],
    });
    const sessionRead = vi.spyOn(api, 'session').mockResolvedValue({
      id: 'message-match',
      title: 'Matched by message',
      updated_at: 42,
    } as any);

    await store.refreshSessions('needle');

    expect(sessionSearch).toHaveBeenCalledWith('needle', 50, 0);
    expect(messageSearch).toHaveBeenCalledWith('needle', 50);
    expect(sessionRead).toHaveBeenCalledWith('message-match');
    expect(store.sessions).toEqual([
      expect.objectContaining({
        id: 'message-match',
        snippet: 'needle in durable history',
      }),
    ]);
    sessionSearch.mockRestore();
    messageSearch.mockRestore();
    sessionRead.mockRestore();
    wrapper.unmount();
  });

  it('renders Workspace file tree controls and Inspector tab from real store state', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    store.workspaceFiles = [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }];
    store.workspaceTreeRoot = mergeWorkspaceTreeChildren(createWorkspaceRoot(), '', store.workspaceFiles, new Set(['']));
    store.openCompanion('workspace');
    await settleAsync();
    expect(wrapper.find('.workspace-tree').exists()).toBe(true);
    expect(wrapper.find('.workspace-tree-node').text()).toContain('a.md');
    await wrapper.get('button[aria-label="a.md 更多操作"]').trigger('click');
    await settle();
    expect(wrapper.find('.workspace-context-menu').exists()).toBe(true);
    expect(wrapper.find('.workspace-context-menu').text()).toContain('重命名');
    store.openCompanion('inspector');
    await settleAsync();
    expect(wrapper.text()).toContain('检查器');
    expect(wrapper.text()).toContain('上下文');
  });

  it('executes Workspace tree right-click create through the store action', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const files = [{ name: 'docs', path: 'docs', kind: 'dir' as const }];
    store.workspaceTreeRoot = mergeWorkspaceTreeChildren(createWorkspaceRoot(), '', files, new Set(['']));
    const createFile = vi.spyOn(store, 'createWorkspaceFile').mockResolvedValue(undefined as any);
    store.openCompanion('workspace');
    await settleAsync();
    await wrapper.get('button[aria-label="docs 更多操作"]').trigger('click');
    await settle();
    await wrapper.findAll('.workspace-context-menu button').find((button) => button.text().includes('新建文件'))?.trigger('click');
    await settle();
    await wrapper.get('.workspace-inline-action input').setValue('plan.md');
    await wrapper.findAll('.workspace-inline-action button').find((button) => button.text().includes('创建'))?.trigger('click');
    await settleAsync();
    expect(createFile).toHaveBeenCalledWith('docs/plan.md');
  });

  it('requires confirmation before Workspace tree delete calls the backend action', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const files = [{ name: 'a.md', path: 'docs/a.md', kind: 'file' as const }];
    store.workspaceTreeRoot = mergeWorkspaceTreeChildren(createWorkspaceRoot(), '', files, new Set(['']));
    const deletePath = vi.spyOn(store, 'deleteWorkspacePathConfirmed').mockResolvedValue(undefined as any);
    store.openCompanion('workspace');
    await settleAsync();
    await wrapper.get('button[aria-label="a.md 更多操作"]').trigger('click');
    await settle();
    const deleteButton = () => wrapper.findAll('.workspace-context-menu button').find((button) => button.text().includes('删除'));
    await deleteButton()?.trigger('click');
    await settle();
    expect(deletePath).not.toHaveBeenCalled();
    expect(wrapper.find('.workspace-context-menu').text()).toContain('确认删除');
    await deleteButton()?.trigger('click');
    await settleAsync();
    expect(deletePath).toHaveBeenCalledWith('docs/a.md');
  });

  it('exposes Workspace download and browser-open actions from tree menus', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const files = [{ name: 'a.md', path: 'docs/a.md', kind: 'file' as const }];
    store.workspaceTreeRoot = mergeWorkspaceTreeChildren(createWorkspaceRoot(), '', files, new Set(['']));
    const download = vi.spyOn(store, 'downloadWorkspacePath').mockImplementation(() => undefined);
    const openExternal = vi.spyOn(store, 'openWorkspacePathExternally').mockResolvedValue(undefined as any);
    store.openCompanion('workspace');
    await settleAsync();
    await wrapper.get('button[aria-label="a.md 更多操作"]').trigger('click');
    await settle();
    const menuText = wrapper.find('.workspace-context-menu').text();
    expect(menuText).toContain('下载');
    expect(menuText).toContain('在浏览器打开');
    await wrapper.findAll('.workspace-context-menu button').find((button) => button.text().includes('下载'))?.trigger('click');
    await wrapper.get('button[aria-label="a.md 更多操作"]').trigger('click');
    await settle();
    await wrapper.findAll('.workspace-context-menu button').find((button) => button.text().includes('在浏览器打开'))?.trigger('click');
    expect(download).toHaveBeenCalledWith('docs/a.md', 'file');
    expect(openExternal).toHaveBeenCalledWith('docs/a.md');
  });

  it('records recent Workspace files and blocks oversized inline text preview', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const rawFile = vi.spyOn(api, 'rawFile').mockResolvedValue('should not load');
    const files = [{ name: 'huge.md', path: 'docs/huge.md', kind: 'file' as const, size: 2 * 1024 * 1024 }];
    store.workspaceFiles = files;
    store.workspaceTreeRoot = mergeWorkspaceTreeChildren(createWorkspaceRoot(), '', files, new Set(['']));
    await store.openFile('docs/huge.md');
    expect(rawFile).not.toHaveBeenCalled();
    expect(store.recentWorkspaceFiles[0].path).toBe('docs/huge.md');
    expect(store.fileError).toContain('超过内嵌预览阈值');
    expect(store.editorContent).toBe('');
    rawFile.mockRestore();
    wrapper.unmount();
  });

  it('uploads dropped local files directly into a Workspace folder node', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    const files = [{ name: 'docs', path: 'docs', kind: 'dir' as const }];
    store.workspaceTreeRoot = mergeWorkspaceTreeChildren(createWorkspaceRoot(), '', files, new Set(['']));
    const upload = vi.spyOn(store, 'uploadWorkspaceFiles').mockResolvedValue([] as any);
    const reload = vi.spyOn(store, 'loadWorkspaceTreeDir').mockResolvedValue([] as any);
    store.openCompanion('workspace');
    await settleAsync();
    await wrapper.get('.workspace-tree-node').trigger('drop', {
      dataTransfer: { files: [new File(['hello'], 'dropped.txt', { type: 'text/plain' })] },
    });
    await settleAsync();
    expect(upload).toHaveBeenCalledWith(expect.any(Array), 'docs');
    expect(reload).toHaveBeenCalledWith('docs', true);
  });

  it('renders tools management page with real registry controls', async () => {
    const wrapper = await mountApp('/tools');
    await settle();
    expect(wrapper.text()).toContain('工具注册表');
    expect(wrapper.find('.workflow-strip').exists()).toBe(false);
    expect(wrapper.findAll('.metric-card').length).toBe(4);
    expect(wrapper.find('.capability-sidebar').exists()).toBe(true);
    expect(wrapper.find('.session-sidebar').exists()).toBe(false);
    expect(wrapper.findAll('.section-row').length).toBe(7);
    expect(wrapper.text()).toContain('执行规划器');
    expect(wrapper.text()).toContain('变更事务');
    expect(wrapper.text()).toContain('应用工作区变更');
    expect(wrapper.text()).toContain('检查点');
    expect(wrapper.text()).toContain('恢复检查点');
    expect(wrapper.text()).toContain('工具缓存');
    expect(wrapper.text()).toContain('工具流水');
    expect(wrapper.text()).toContain('风险预检');
    expect(wrapper.find('.capability-sidebar').text()).not.toContain('记忆');
    expect(wrapper.find('.capability-sidebar').text()).not.toContain('Settings');
  });

  it('renders gateway governance panels and evidence surfaces', async () => {
    const wrapper = await mountApp('/gateway?section=connectors');
    await settle();
    expect(wrapper.text()).toContain('Gateway 与跨平面');
    expect(wrapper.text()).toContain('将连接器资源晋升到记忆');
    expect(wrapper.text()).toContain('执行跨平面动作');
    expect(wrapper.text()).toContain('管理跨平面身份');
    expect(wrapper.text()).toContain('创建跨平面授权');
    expect(wrapper.text()).toContain('Gateway 证据轨迹');
    expect(wrapper.text()).toContain('Gateway 选中详情');
    expect(wrapper.text()).toContain('Gateway 修复建议');
  });

  it('does not load Gateway contract projections outside the alignment section', async () => {
    const calls: string[] = [];
    vi.mocked(fetch).mockImplementation((url: any) => {
      const path = String(url);
      calls.push(path);
      if (path.includes('/api/gateway/capability-contract')) {
        return Promise.resolve(new Response(JSON.stringify({
          kind: 'gateway.capability_contract',
          schema_version: 2,
          owner: 'gateway',
          source: 'test',
          route_count: 1,
          capability_count: 1,
          coverage: {
            route_count: 1,
            capability_count: 1,
            p1_count: 1,
            webui_required_count: 1,
            tui_required_count: 0,
            ai_tool_count: 1,
            openapi_path_count: 1,
            route_contract_parity: true,
          },
          capabilities: [
            { id: 'gateway.test', domain: 'gateway', title: 'Gateway test', http: { method: 'GET', path: '/api/gateway/test' }, risk: 'read', consumed_by: ['webui'], discoverability: { http: true, openapi: true, ai_tool: true } },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/gateway/openapi.json')) {
        return Promise.resolve(new Response(JSON.stringify({ openapi: '3.1.0', paths: { '/api/gateway/test': {} } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/gateway/openai-tools')) {
        return Promise.resolve(new Response(JSON.stringify({ kind: 'gateway.openai_tools', tool_count: 1, tools: [{ type: 'function', function: { name: 'gateway_test', description: 'test', parameters: { type: 'object', properties: {} } } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ sessions: [], commands: [], profiles: [], workspace_files: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    const wrapper = await mountApp('/gateway?section=connectors');
    await settleAsync();
    expect(calls.some((path) => path.includes('/api/gateway/capability-contract'))).toBe(false);
    expect(calls.some((path) => path.includes('/api/gateway/openapi.json'))).toBe(false);
    expect(calls.some((path) => path.includes('/api/gateway/openai-tools'))).toBe(false);
    wrapper.unmount();
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error('offline')));
  });

  it('renders schema v2 Surface requirements without treating API-only capabilities as WebUI features', async () => {
    vi.mocked(fetch).mockImplementation((url: any) => {
      const path = String(url);
      if (path.includes('/api/gateway/capability-contract')) {
        return Promise.resolve(new Response(JSON.stringify({
          kind: 'gateway.capability_contract',
          schema_version: 2,
          owner: 'gateway',
          source: 'test',
          route_count: 2,
          capability_count: 2,
          coverage: {
            route_count: 2,
            capability_count: 2,
            p1_count: 1,
            webui_required_count: 1,
            tui_required_count: 1,
            ai_tool_count: 0,
            openapi_path_count: 2,
            route_contract_parity: true,
          },
          capabilities: [
            {
              id: 'gateway.session.get', domain: 'session', title: 'Session',
              http: { method: 'GET', path: '/api/sessions', criticality: 'p1' }, risk: 'read',
              consumed_by: ['webui', 'tui'], discoverability: { http: true, openapi: true, ai_tool: false },
            },
            {
              id: 'gateway.internal.get', domain: 'gateway', title: 'Internal',
              http: { method: 'GET', path: '/api/internal', criticality: 'p2' }, risk: 'read',
              consumed_by: [], discoverability: { http: true, openapi: true, ai_tool: false },
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/gateway/openapi.json')) {
        return Promise.resolve(new Response(JSON.stringify({ openapi: '3.1.0', paths: { '/api/sessions': {}, '/api/internal': {} } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/gateway/openai-tools')) {
        return Promise.resolve(new Response(JSON.stringify({ kind: 'gateway.openai_tools', tool_count: 0, tools: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ sessions: [], commands: [], profiles: [], workspace_files: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    const wrapper = await mountApp('/gateway?section=alignment');
    await settleAsync();
    expect(wrapper.text()).toContain('WebUI 必须消费');
    expect(wrapper.text()).toContain('TUI 必须消费');
    expect(wrapper.text()).toContain('必须接线');
    expect(wrapper.text()).toContain('API / 自动化');
    expect(wrapper.text()).toContain('内部能力');
    expect(wrapper.text()).not.toContain('visible');
    wrapper.unmount();
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error('offline')));
  });

  it('renders context workbench evidence and detail surfaces', async () => {
    const wrapper = await mountApp('/context');
    await settle();
    expect(wrapper.text()).toContain('上下文构建');
    expect(wrapper.find('.workflow-strip').exists()).toBe(false);
    expect(wrapper.text()).toContain('上下文证据链');
    expect(wrapper.text()).toContain('上下文选中详情');
  });

  it('renders adaptive context coverage, conflicts, omissions, and source governance as structured data', async () => {
    const fetchMock = vi.fn((request: RequestInfo | URL) => {
      const path = String(request);
      if (path.includes('/api/context/current')) {
        return Promise.resolve(new Response(JSON.stringify({
          envelope_id: 'envelope-structured',
          envelope: {
            selected: [{
              id: 'context-1',
              role: 'rule',
              source: 'session',
              authority: 'user_explicit',
              score: 0.99,
              summary: 'Keep the canonical constraint.',
            }],
            budget: {
              used_tokens: 5_000,
              token_budget: 10_000,
              coverage_basis_points: 8_700,
              borrowed_budget_tokens: 1_024,
            },
            diagnostics: {
              unresolved_conflict_count: 2,
            },
            omitted: [{
              source: 'memory',
              token_estimate: 320,
              reason: 'lower marginal utility',
            }],
          },
          budget_explanation: {
            allocations: [{
              source: 'session',
              used_tokens: 3_000,
              target_tokens: 2_500,
              max_tokens: 5_000,
              selected_count: 4,
              omitted_count: 1,
              exhausted: false,
            }],
          },
          source_registry: [{
            source: 'reality',
            lifecycle: 'active',
            authority: 'verified_external',
            reason: 'current fact view',
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.includes('/api/sessions/') && path.includes('/context/recommendations')) {
        return Promise.resolve(new Response(JSON.stringify({ recommendations: [] }), { status: 200 }));
      }
      if (path.includes('/api/sessions/') && path.includes('/context')) {
        return Promise.resolve(new Response(JSON.stringify({ summaries: [] }), { status: 200 }));
      }
      if (path.includes('/api/runtime/timeline')) {
        return Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = await mountApp('/context?section=budget');
    await settleAsync();

    const budget = wrapper.get('[data-section="budget"].context-panel');
    expect(wrapper.text()).toContain('87%');
    expect(wrapper.text()).toContain('1024');
    expect(wrapper.text()).toContain('2');
    expect(budget.text()).toContain('session');
    expect(budget.text()).toContain('lower marginal utility');
    expect(budget.text()).toContain('verified_external');
    expect(wrapper.find('.raw-payload').exists()).toBe(false);
    wrapper.unmount();
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error('offline')));
  });

  it('renders audit workbench evidence and selected detail surfaces', async () => {
    const wrapper = await mountApp('/audit');
    await settle();
    expect(wrapper.text()).toContain('审计与治理');
    expect(wrapper.find('.workflow-strip').exists()).toBe(false);
    expect(wrapper.text()).toContain('全局时间线');
    expect(wrapper.text()).toContain('Harness 评测');
    expect(wrapper.text()).toContain('审计证据链');
    expect(wrapper.text()).toContain('审计选中证据');
  });

  it('loads Mission schedule and Team evidence only when their owning section is opened', async () => {
    const missionControl = vi.spyOn(api, 'missionControl').mockResolvedValue({
      snapshot: {
        projection: {
          mission: { mission_id: 'mission-1' },
          sessions: [{ session_id: 'session-1' }],
          workspace: { active_session_id: 'session-1' },
          team_projection: {
            runs: [{
              team: { team_id: 'team-1', status: 'running' },
              agent_runs: [],
            }],
          },
        },
      },
    } as any);
    const teamRun = vi.spyOn(api, 'collaborationRun').mockResolvedValue({
      run: { team_id: 'team-1' },
    } as any);
    const teamPlan = vi.spyOn(api, 'teamExecutionPlan').mockResolvedValue({
      plan_id: 'plan-1',
    } as any);
    const teamEvidence = vi.spyOn(api, 'teamMissionEvidence').mockResolvedValue({
      evidence: [{ id: 'evidence-1' }],
    } as any);
    const schedules = vi.spyOn(api, 'missionSchedules').mockResolvedValue({
      schedules: {
        schedules: [{
          schedule_id: 'schedule-1',
          revision: 3,
          objective: 'Original objective',
          status: 'active',
          target_session_id: 'session-1',
          trigger: { interval: { every_ms: 60_000 } },
        }],
        fires: [],
      },
    } as any);
    const updateSchedule = vi.spyOn(api, 'updateMissionSchedule').mockResolvedValue({
      ok: true,
    } as any);

    const wrapper = await mountApp('/mission?section=schedules');
    await settleAsync();

    expect(teamRun).not.toHaveBeenCalled();
    expect(teamPlan).not.toHaveBeenCalled();
    expect(teamEvidence).not.toHaveBeenCalled();
    await wrapper.get('button[aria-label="编辑计划"]').trigger('click');
    await settle();
    await wrapper.get('[data-section="schedules"] textarea').setValue('Updated objective');
    const save = wrapper
      .get('[data-section="schedules"]')
      .findAll('button')
      .find((button) => button.text().includes('保存计划'));
    expect(save).toBeTruthy();
    await save!.trigger('click');
    await settleAsync();

    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', expect.objectContaining({
      expected_revision: 3,
      objective: 'Updated objective',
    }));
    wrapper.unmount();

    const teamWrapper = await mountApp('/mission?section=teams');
    await settleAsync();
    expect(teamRun).toHaveBeenCalledWith('team-1');
    expect(teamPlan).toHaveBeenCalledWith('team-1');
    expect(teamEvidence).toHaveBeenCalledWith('team-1');
    teamWrapper.unmount();

    missionControl.mockRestore();
    teamRun.mockRestore();
    teamPlan.mockRestore();
    teamEvidence.mockRestore();
    schedules.mockRestore();
    updateSchedule.mockRestore();
  });

  it('loads Harness Eval and Evolution drilldowns from their owning workbench', async () => {
    const reports = vi.spyOn(api, 'harnessEvalReports').mockResolvedValue({
      reports: [{ id: 'report-live', status: 'passed' }],
    } as any);
    const report = vi.spyOn(api, 'harnessEvalReport').mockResolvedValue({
      report: { id: 'report-live', status: 'passed' },
    } as any);
    const artifacts = vi.spyOn(api, 'harnessEvalArtifacts').mockResolvedValue({
      artifacts: ['report.md'],
    } as any);
    const gate = vi.spyOn(api, 'harnessEvalReportGate').mockResolvedValue({
      status: 'passed',
      gates: [],
    } as any);
    const missions = vi.spyOn(api, 'evolutionMissionsSummary').mockResolvedValue({
      missions: [{ mission_id: 'evolution-mission-1', status: 'active' }],
    } as any);
    const missionDetail = vi.spyOn(api, 'evolutionMissionDetail').mockResolvedValue({
      mission_id: 'evolution-mission-1',
    } as any);
    const proposals = vi.spyOn(api, 'evolutionProposals').mockResolvedValue({
      proposals: [{ proposal_id: 'proposal-live', status: 'draft' }],
    } as any);
    const proposal = vi.spyOn(api, 'evolutionProposal').mockResolvedValue({
      proposal_id: 'proposal-live',
    } as any);
    const chain = vi.spyOn(api, 'evolutionChain').mockResolvedValue({
      proposal_id: 'proposal-live',
      nodes: [],
    } as any);
    const candidates = vi.spyOn(api, 'evolutionCandidates').mockResolvedValue({
      candidates: [{
        candidate_id: 'candidate-live',
        proposal_id: 'proposal-live',
        lifecycle: 'validated',
        subject: {
          kind: 'agent_definition',
          revision_ref: { definition_id: 'agent-1', revision: 2 },
        },
        source_evidence_refs: [{ ref_type: 'eval', id: 'report-live', boundary: 'observed' }],
      }],
    } as any);
    const candidate = vi.spyOn(api, 'evolutionCandidateDetail').mockResolvedValue({
      candidate_id: 'candidate-live',
    } as any);
    const reviews = vi.spyOn(api, 'evolutionReviews').mockResolvedValue({
      reviews: [{ review_id: 'review-live', status: 'pending' }],
    } as any);
    const review = vi.spyOn(api, 'evolutionReview').mockResolvedValue({
      review_id: 'review-live',
      status: 'pending',
    } as any);
    const createReview = vi.spyOn(api, 'evolutionCreateReleaseReview').mockResolvedValue({
      ok: true,
    } as any);

    const wrapper = await mountApp('/audit?section=evolution');
    await settleAsync();
    const clickRow = async (text: string) => {
      const row = wrapper.findAll('.data-table tbody tr').find(
        (node) => node.find('td').text().trim() === text,
      );
      expect(row, `missing row ${text}`).toBeTruthy();
      await row!.trigger('click');
      await settleAsync();
    };

    await clickRow('report-live');
    expect(report).toHaveBeenCalledWith('report-live');
    expect(artifacts).toHaveBeenCalledWith('report-live');
    expect(gate).toHaveBeenCalledWith('report-live');
    await clickRow('evolution-mission-1');
    expect(missionDetail).toHaveBeenCalledWith('evolution-mission-1');
    await clickRow('proposal-live');
    expect(proposal).toHaveBeenCalledWith('proposal-live');
    expect(chain).toHaveBeenCalledWith('proposal-live');
    await clickRow('candidate-live');
    expect(candidate).toHaveBeenCalledWith('candidate-live');
    const setLatest = wrapper.findAll('button')
      .find((button) => button.text().includes('申请设为最新稳定版'));
    expect(setLatest).toBeTruthy();
    await setLatest!.trigger('click');
    await settleAsync();
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({
      candidate_id: 'candidate-live',
      action: 'set_default_latest',
    }));
    await clickRow('review-live');
    expect(review).toHaveBeenCalledWith('review-live');

    [
      reports, report, artifacts, gate, missions, missionDetail, proposals, proposal,
      chain, candidates, candidate, reviews, review, createReview,
    ].forEach((spy) => spy.mockRestore());
    wrapper.unmount();
  });

  it('calls harness eval report and smoke run endpoints', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, reports: [], runs: [], scenarios: [] }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await api.harnessEvalLatestReport();
    await api.harnessEvalReports();
    await api.harnessEvalReport('report-1');
    await api.harnessEvalScenarios();
    await api.harnessEvalRuns();
    await api.harnessEvalRun('run-1');
    await api.harnessEvalRunStatus('run-1');
    await api.harnessEvalStartRun({ level: 'full', budget: 'full', objective: 'test full eval' });
    await api.harnessEvalRunSmoke();
    await api.harnessEvalArtifacts('report-1');
    await api.harnessEvalReportGate('report-1');
    await api.terminalGateRun();
    await api.harnessEvalCancelRun('run-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/reports/latest', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/reports', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/reports/report-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/scenarios', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs/run-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs/run-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/reports/report-1/artifacts', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/reports/report-1/gate', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs/run-1/cancel', expect.objectContaining({ method: 'POST' }));
  });

  it('uses Runtime-owned evolution candidates and typed release review endpoints', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, signals: [], diagnoses: [], proposals: [], candidates: [], reviews: [] }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await api.evolutionSignals();
    await api.evolutionCreateSignal({ signal_type: 'slow_progress', summary: 'slow', source: { owner: 'test' }, severity: 'warning', suggested_action: 'review', evidence_refs: [{ ref_type: 'test', id: 'signal-1', boundary: 'observed' }] });
    await api.evolutionDiagnoses();
    await api.evolutionCreateDiagnosis(['signal-1']);
    await api.evolutionMissionsSummary();
    await api.evolutionMissionDetail('mission-1');
    await api.evolutionProposals();
    await api.evolutionCreateProposal(['signal-1']);
    await api.evolutionProposal('proposal-1');
    await api.evolutionChain('proposal-1');
    await api.evolutionProposalDecision('proposal-1', 'approved');
    await api.evolutionSkillDraft('proposal-1');
    await api.evolutionCandidates();
    await api.evolutionCandidateDetail('candidate-1');
    await api.evolutionCreateCandidate({ candidate_id: 'candidate-1', proposal_id: 'proposal-1', subject: { kind: 'agent_definition', revision_ref: { definition_id: 'workspace/cowd/test', revision: 2 } }, baseline_revision: 1, source_evidence_refs: [{ ref_type: 'eval', id: '1', boundary: 'observed' }] });
    await api.evolutionCandidateEvaluate('candidate-1');
    await api.evolutionCandidateCanaryReview('candidate-1');
    await api.evolutionCandidateStableReview('candidate-1');
    await api.evolutionReviews();
    await api.evolutionReview('review-1');
    await api.evolutionCreateReleaseReview({ request_id: 'rollback-1', subject: { kind: 'agent_definition' }, action: 'rollback', selector: { kind: 'exact_approved_revision', revision: 1 }, evidence_refs: [{ ref_type: 'run', id: '1', boundary: 'observed' }] });
    await api.evolutionReviewDecision('review-1', 'approve', 'verified');
    await api.evolutionEvaluationPolicy();
    await api.evolutionEvaluationPolicyReviews();
    await api.evolutionCreateEvaluationPolicyReview({ request_id: 'policy-1', proposed_policy: { policy_id: 'default', revision: 2 } });
    await api.evolutionEvaluationPolicyReviewDecision('policy-review-1', 'reject', 'insufficient evidence');

    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/signals', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/signals', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/diagnoses', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/diagnoses', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/missions/summary', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/missions/mission-1/detail', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/proposals', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/proposals', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/proposals/proposal-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/chain/proposal-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/proposals/proposal-1/decision', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/proposals/proposal-1/skill-draft', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/candidates', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/candidates/candidate-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/candidates', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/candidates/candidate-1/evaluate', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/candidates/candidate-1/reviews/canary', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/candidates/candidate-1/reviews/stable', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/reviews', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/reviews/review-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/reviews', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/reviews/review-1/decision', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/evaluation-policy', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/evaluation-policy/reviews', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/evaluation-policy/reviews', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/evaluation-policy/reviews/policy-review-1/decision', expect.objectContaining({ method: 'POST' }));
  });

  it('uses Runtime-owned Managed Agent intent and projection endpoints', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      definitions: [], invocations: [], health: [], effects: [],
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await api.managedAgents();
    await api.managedAgentDefinitions();
    await api.createManagedAgentDefinition({
      managed_agent_id: 'workspace/test/agent',
      revision: 1,
      target: { kind: 'agent', definition_id: 'workspace/test', selector: { kind: 'latest_approved_stable' } },
      trigger: { kind: 'schedule', trigger: { interval: { every_ms: 60_000 } } },
    });
    await api.triggerManagedAgent('workspace/test/agent', 'request-1');
    await api.dispatchManagedAgents('webui-test', 8);
    await api.resetManagedAgentHealth('workspace/test/agent');
    await api.managedAgentEffects();

    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents/definitions', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents/definitions', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents/workspace%2Ftest%2Fagent/trigger', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents/dispatch', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents/workspace%2Ftest%2Fagent/health/reset', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents/effects', expect.any(Object));
    const registration = fetchMock.mock.calls.find(([path, init]) => String(path) === '/api/runtime/managed-agents/definitions' && init?.method === 'POST');
    expect(JSON.parse(String(registration?.[1]?.body))).toMatchObject({
      trigger: { kind: 'schedule', trigger: { interval: { every_ms: 60_000 } } },
    });
  });

  it('renders the Managed Agent control plane as structured Runtime intent and projections', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/agents/catalog') return Promise.resolve(new Response(JSON.stringify({ summary: {}, agents: [] })));
      if (url === '/api/agents/directory') return Promise.resolve(new Response(JSON.stringify({ agents: [{ definition_ref: { definition_id: 'workspace/cowd/researcher' } }] })));
      if (url === '/api/agents/self-models') return Promise.resolve(new Response(JSON.stringify({ items: [] })));
      if (url === '/api/agents/execution-graphs') return Promise.resolve(new Response(JSON.stringify({ graphs: [] })));
      if (url === '/api/tasks') return Promise.resolve(new Response(JSON.stringify({ tasks: [] })));
      if (url === '/api/team-templates') return Promise.resolve(new Response(JSON.stringify({ templates: [{ revision_ref: { template_id: 'workspace/cowd/research-team' } }] })));
      if (url === '/api/runtime/managed-agents') return Promise.resolve(new Response(JSON.stringify({
        definitions: [{
          managed_agent_id: 'workspace/cowd/nightly-research',
          revision: 2,
          target: { kind: 'team', template_id: 'workspace/cowd/research-team' },
          trigger: { kind: 'event', source_id: 'feishu', source_kind: 'connector_source', event_type: 'message.received' },
          objective: 'Review overnight evidence',
          enabled: true,
        }],
        invocations: [{ invocation_id: 'invoke-1', definition_id: 'workspace/cowd/nightly-research', definition_revision: 2, status: 'pending', attempt_no: 1, trigger: { kind: 'event' } }],
        health: [{ managed_agent_id: 'workspace/cowd/nightly-research', revision: 2, status: 'healthy', consecutive_failures: 0, max_consecutive_failures: 3, active_invocation_ids: [] }],
        effects: [{ effect_id: 'effect-1', invocation_id: 'invoke-1', effect_kind: 'tool', status: 'completed' }],
      })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const pinia = createPinia();
    setActivePinia(pinia);

    const wrapper = mount(AgentsPage, { global: { plugins: [pinia] } });
    await settleAsync();
    await settleAsync();

    const section = wrapper.get('[data-section="managed-agents"]');
    expect(section.text()).toContain('受管 Agent');
    expect(section.text()).toContain('团队模板');
    expect(section.text()).toContain('外部事件');
    expect(section.text()).toContain('调用记录');
    expect(section.text()).toContain('围栏副作用');
    expect(section.findAll('select').length).toBeGreaterThanOrEqual(2);
    expect(section.text()).not.toContain('RawPayload');
    wrapper.unmount();
  });

  it('submits Audit review decisions through typed release and policy endpoints', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      const url = String(path);
      if (url === '/api/evolution/reviews') return Promise.resolve(new Response(JSON.stringify({ reviews: [{ review_id: 'release-review-1', class: 'release', action: 'promote', status: 'pending', approval_id: 'approval-1' }] })));
      if (url === '/api/evolution/evaluation-policy') return Promise.resolve(new Response(JSON.stringify({ policy_id: 'default-floor', revision: 3 })));
      if (url === '/api/evolution/evaluation-policy/reviews') return Promise.resolve(new Response(JSON.stringify({ reviews: [{ review_id: 'policy-review-1', status: 'pending', proposed_policy: { policy_id: 'default-floor', revision: 4 } }] })));
      if (url.endsWith('/decision') && init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ status: 'accepted' }), { status: 202 }));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/audit', component: AuditPage }],
    });
    await router.push('/audit');
    await router.isReady();

    const wrapper = mount(AuditPage, {
      global: {
        plugins: [router],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });
    await settleAsync();
    await settleAsync();

    const evolution = wrapper.get('[data-section="evolution"]');
    await evolution.find('tbody tr').trigger('click');
    await evolution.get('input[type="text"]').setValue('evidence comparison is acceptable');
    await evolution.findAll('button').find((button) => button.text() === '批准')?.trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/reviews/release-review-1/decision', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', reason: 'evidence comparison is acceptable' }),
    }));

    const policy = wrapper.get('[data-section="evaluation-policy"]');
    await policy.findAll('tbody tr')[1]?.trigger('click');
    await policy.get('input[type="text"]').setValue('policy floor is sufficiently protected');
    await policy.findAll('button').find((button) => button.text() === '通过策略审核')?.trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/evolution/evaluation-policy/reviews/policy-review-1/decision', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', reason: 'policy floor is sufficiently protected' }),
    }));
    wrapper.unmount();
  });


  it('calls real tool operation endpoints through the backend', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, checkpoints: [] }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.toolExecute('tool_cache_stats');
    await api.toolBatchReadonly([{ name: 'tool_cache_stats', input: {} }], 2);
    await api.toolMutationPreview([{ path: 'README.md', old_string: 'A', new_string: 'B' }]);
    await api.toolMutationApply([{ path: 'README.md', old_string: 'A', new_string: 'B' }], { 'README.md': 'hash' });
    await api.toolCheckpoints();
    await api.toolCheckpointCreate('before edit');
    await api.toolCheckpointDiff('cp-1');
    await api.toolCheckpointRestore('cp-1');
    await api.toolIntentPlan('inspect workspace', ['tool_cache_stats']);
    await api.toolContextFanoutPlan('inspect workspace');
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/execute', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/batch-readonly', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/mutations/preview', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/mutations/apply', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/checkpoints', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/checkpoints', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/checkpoints/cp-1/diff', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/checkpoints/cp-1/restore', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/intent-plan', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/tools/context-fanout/plan', expect.objectContaining({ method: 'POST' }));
  });

  it('marks HTML API fallback as an invalid response instead of successful data', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const manifest = await api.health();
    expect(manifest.__state).toBe('invalid_response');
    expect(manifest.__error).toContain('Expected JSON');
  });

  it('keeps authorization, missing-resource, and server failures distinct', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('denied', { status: 403 }))
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await api.providers()).__state).toBe('forbidden');
    expect((await api.providerCatalog()).__state).toBe('not_found');
    expect((await api.effectiveConfig()).__state).toBe('server_error');
  });

  it('keeps the last successful projection as explicitly stale only for transient read failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ready', revision: 7 }), { status: 200 }))
      .mockRejectedValueOnce(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    const current = await api.health();
    const stale = await api.health();
    expect(current.__state).toBe('ready');
    expect(stale.__state).toBe('stale');
    expect(stale.revision).toBe(7);
    expect(stale.__last_success_at).toBeTruthy();
  });

  it('merges execution detail scopes over one physical live transport', async () => {
    const urls: string[] = [];
    const closed: string[] = [];
    class FakeEventSource {
      constructor(readonly url: string) { urls.push(url); }
      addEventListener() {}
      close() { closed.push(this.url); }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    let subscriptionRevision = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/runtime/live-subscriptions') {
        subscriptionRevision = 1;
        const request = JSON.parse(String(init?.body || '{}'));
        return Promise.resolve(new Response(JSON.stringify({
          schema_version: 1,
          id: 'live-test',
          surface_instance: request.surface_instance,
          revision: subscriptionRevision,
          selector: request.selector,
          selector_hash: 'selector-1',
          expires_at_ms: Date.now() + 60_000,
          stream_url: '/api/runtime/live/live-test',
        }), { status: 201 }));
      }
      if (path === '/api/runtime/live-subscriptions/live-test' && init?.method === 'PATCH') {
        subscriptionRevision += 1;
        const request = JSON.parse(String(init.body || '{}'));
        return Promise.resolve(new Response(JSON.stringify({
          schema_version: 1,
          id: 'live-test',
          surface_instance: 'webui:test',
          revision: subscriptionRevision,
          selector: request.selector,
          selector_hash: `selector-${subscriptionRevision}`,
          expires_at_ms: Date.now() + 60_000,
          stream_url: '/api/runtime/live/live-test',
        }), { status: 200 }));
      }
      if (path === '/api/runtime/live-subscriptions/live-test' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const executionId = path.match(/\/executions\/([^/?]+)/)?.[1] || '';
      return Promise.resolve(new Response(JSON.stringify({
        schema_version: 2,
        execution_id: decodeURIComponent(executionId),
        revision: 1,
        cursor: 0,
        detail_scope: 'summary',
        authorization_revision: 1,
        redaction_revision: 'redaction-1',
        live: { status: 'running' },
      }), { status: 200 }));
    }));
    setActivePinia(createPinia());
    const registry = useProjectionRegistryStore();
    registry.acquire('exec-1', 'chat:session-1', 'summary');
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    registry.acquire('exec-1', 'mission', 'full');
    await vi.waitFor(() => expect(registry.entries['exec-1'].detailScope).toBe('full'));
    registry.release('mission');
    await vi.waitFor(() => expect(registry.entries['exec-1'].detailScope).toBe('summary'));
    registry.acquire('exec-2', 'agents', 'full');
    await vi.waitFor(() => expect(registry.activeSourceCount).toBe(2));
    expect(urls).toEqual(['/api/runtime/live/live-test']);
    expect(closed).toHaveLength(0);
    registry.release('chat:session-1');
    registry.release('agents');

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });

  it('keeps a missing initial projection materializing without opening a stream', async () => {
    const closed: string[] = [];
    class FakeEventSource {
      constructor(readonly url: string) {}
      addEventListener() {}
      close() { closed.push(this.url); }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('missing execution', { status: 404 }))));
    setActivePinia(createPinia());
    const registry = useProjectionRegistryStore();

    registry.acquire('missing-execution', 'chat:missing-session', 'full');

    await vi.waitFor(() => {
      expect(registry.entries['missing-execution'].connectionState).toBe('materializing');
      expect(registry.activeSourceCount).toBe(0);
    });
    expect(closed).toEqual([]);
    registry.release('chat:missing-session');
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });

  it('uploads files as multipart form data without fake success', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ uploaded: true, path: 'uploads/sample.md' }), { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.uploadFile(new File(['# sample'], 'sample.md', { type: 'text/markdown' }), 'uploads');
    expect(fetchMock).toHaveBeenCalledWith('/api/upload', expect.objectContaining({ method: 'POST' }));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('builds Workspace raw and download URLs through API helpers', () => {
    expect(api.workspaceRawUrl('docs/a b.md')).toBe('/api/file/raw?path=docs%2Fa%20b.md');
    expect(api.workspaceDownloadUrl('docs/a b.md')).toBe('/api/workspace/download?path=docs%2Fa%20b.md');
  });

  it('classifies Workspace preview types before loading file content', () => {
    expect(workspacePreviewKind('README.md')).toBe('markdown');
    expect(workspacePreviewKind('public/index.html')).toBe('web');
    expect(workspacePreviewKind('diagram.png')).toBe('image');
    expect(workspacePreviewKind('manual.pdf')).toBe('pdf');
    expect(workspacePreviewKind('audio.mp3')).toBe('audio');
    expect(workspacePreviewKind('archive.zip')).toBe('binary');
    expect(isWorkspaceTextPreview('src/main.rs')).toBe(true);
    expect(isWorkspaceTextPreview('archive.zip')).toBe(false);
  });

  it('uploads chat resources through the resource endpoint', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      resource: {
        id: 'res-1',
        uri: 'resource://res-1',
        original_name: 'voice.mp3',
        kind: 'audio',
        size_bytes: 3,
        sha256: 'sha256:test',
        artifact: {
          selector: 'artifact://art-test',
          sha256: 'sha256:test',
          bytes: 3,
          media_type: 'audio/mpeg',
          durability: 'durable',
          visibility_scope: 'session:session-1',
        },
        source: 'webui',
        created_at: 'now',
      },
    }), { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.uploadResource(new File(['mp3'], 'voice.mp3', { type: 'audio/mpeg' }), 'session-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/resources', expect.objectContaining({ method: 'POST' }));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(Array.from((init.body as FormData).keys())).toEqual([
      'source',
      'session_id',
      'declared_mime',
      'file',
    ]);
  });

  it('recrops only the revoked session shell and preserves another session summary', () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    store.sessions = [
      { id: 'session-A', title: 'Private A', model: 'model-A', status: 'active' },
      { id: 'session-B', title: 'Visible B', model: 'model-B', status: 'idle' },
    ] as any;
    store.activeSessionId = 'session-A';
    store.attachments = [{ ref_id: 'private-A', path: 'secret.md' }] as any;
    store.currentTimeline = { events: [{ detail: 'secret-A' }] };
    store.actionResults = { 'session-A:runtime:stop': { secret: 'private-A' } };

    window.dispatchEvent(new CustomEvent('cowd:session-authorization-invalidated', {
      detail: { sessionId: 'session-A', reason: 'scope removed' },
    }));

    expect(store.sessions.find((session) => session.id === 'session-A')).toMatchObject({
      model: '',
      status: 'authorization_revoked',
    });
    expect(store.sessions.find((session) => session.id === 'session-A')?.title).not.toBe('Private A');
    expect(store.sessions.find((session) => session.id === 'session-B')).toMatchObject({
      title: 'Visible B',
      model: 'model-B',
    });
    expect(store.attachments).toEqual([]);
    expect(store.currentTimeline).toEqual({});
    expect(store.actionResults).toEqual({});
  });

  it('keeps upload busy until every concurrent operation has settled', async () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    store.activeSessionId = 'session-upload';
    const completions: Array<(value: any) => void> = [];
    const upload = vi.spyOn(api, 'uploadResource').mockImplementation(() => (
      new Promise((resolve) => completions.push(resolve))
    ));

    const first = store.uploadResource(new File(['A'], 'A.txt'));
    const second = store.uploadResource(new File(['B'], 'B.txt'));
    expect(store.uploadBusy).toBe(true);
    completions[1]({
      resource: {
        id: 'resource-B', uri: 'resource://resource-B', original_name: 'B.txt',
        kind: 'text', size_bytes: 1, sha256: 'B', detected_mime: 'text/plain',
      },
    });
    await second;
    expect(store.uploadBusy).toBe(true);
    completions[0]({
      resource: {
        id: 'resource-A', uri: 'resource://resource-A', original_name: 'A.txt',
        kind: 'text', size_bytes: 1, sha256: 'A', detected_mime: 'text/plain',
      },
    });
    await first;
    expect(store.uploadBusy).toBe(false);
    upload.mockRestore();
  });

  it('clears the complete authenticated shell and makes boot eligible after logout', () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    store.booted = true;
    store.health = { secret: 'health' };
    store.settings = { secret: 'settings' };
    store.sessions = [{ id: 'session-A', title: 'Private A' }] as any;
    store.workspaceRoot = '/private/workspace';
    store.workspaceFiles = [{ name: 'secret', path: 'secret.md', kind: 'file' }] as any;
    const previousViewGeneration = store.authorizationViewGeneration;
    localStorage.setItem('cowd.webui.sessions.pinned', JSON.stringify(['session-A']));
    localStorage.setItem('cowd.webui.workspace.recentFiles', JSON.stringify([{ name: 'secret', path: 'secret.md' }]));

    window.dispatchEvent(new CustomEvent('cowd:authorization-invalidated', {
      detail: { reason: 'operator logged out' },
    }));

    expect(store.booted).toBe(false);
    expect(store.health).toBeNull();
    expect(store.settings).toBeNull();
    expect(store.sessions).toEqual([]);
    expect(store.workspaceRoot).toBe('');
    expect(store.workspaceFiles).toEqual([]);
    expect(store.authorizationState).toBe('invalidated');
    expect(store.authorizationViewGeneration).toBe(previousViewGeneration + 1);
    expect(localStorage.getItem('cowd.webui.sessions.pinned')).toBeNull();
    expect(localStorage.getItem('cowd.webui.workspace.recentFiles')).toBeNull();
  });

  it('unmounts protected route content behind one authorization gate after logout', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    expect(wrapper.find('.chat-page').exists()).toBe(true);

    window.dispatchEvent(new CustomEvent('cowd:authorization-invalidated', {
      detail: { reason: 'credential expired' },
    }));
    await settle();

    expect(wrapper.find('.authorization-gate').exists()).toBe(true);
    expect(wrapper.find('.chat-page').exists()).toBe(false);
    expect(wrapper.find('.authorization-gate').text()).toContain('Gateway');
    wrapper.unmount();
  });

  it('keeps Gateway credential recovery visible and mounted across authorization invalidation', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    store.authorizationState = 'invalidated';
    await settle();

    await wrapper.get('.authorization-gate button').trigger('click');
    await settleAsync();

    const credential = wrapper.get<HTMLInputElement>('[data-section="gateway"] input[type="password"]');
    expect(credential.isVisible()).toBe(true);
    await credential.setValue('temporary-test-credential');
    const credentialElement = credential.element;

    window.dispatchEvent(new CustomEvent('cowd:authorization-invalidated', {
      detail: { reason: 'credential expired again' },
    }));
    await settle();

    const stableCredential = wrapper.get<HTMLInputElement>('[data-section="gateway"] input[type="password"]');
    expect(stableCredential.element).toBe(credentialElement);
    expect(stableCredential.element.value).toBe('temporary-test-credential');
    expect(wrapper.get('[data-section="gateway"] button[type="submit"]').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('sends resource ids separately from message content', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ queued: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.sendMessage('session-1', '请分析附件', ['res-1']);
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ content: '请分析附件', resource_ids: ['res-1'] }),
    }));
  });

  it('adds session attachments through the backend endpoint', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ attachment: { ref_id: 'att-1', path: 'docs/a.md' } }), { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.addSessionAttachment('session-1', 'docs/a.md', 'A doc');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/attachments', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: 'docs/a.md', label: 'A doc', kind: 'workspace_file' }),
    }));
  });

  it('requests current session cancellation through a write receipt endpoint', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123_456);
    const fetchMock = vi.fn((_path: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || '{}'));
      return Promise.resolve(new Response(JSON.stringify({
        cancellation_id: request.cancellation_id,
        session_id: 'session-1',
        turn_id: 'turn-1',
        execution_id: 'execution-1',
        actor_id: 'principal:user',
        cause: 'user_requested',
        reason: request.reason,
        requested_at_ms: request.requested_at_ms,
        effective_at_ms: request.requested_at_ms,
        status: 'cancelled',
        journal_sequence: 1,
        projection_revision: 1,
      }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const receipt = await api.cancelSessionTurn('session-1');
    expect(receipt.ok).toBe(true);
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/cancel', expect.objectContaining({ method: 'POST' }));
    expect(request).toEqual({
      reason: 'cancel requested from WebUI',
      cancellation_id: expect.stringMatching(/^webui-cancel:/),
      requested_at_ms: 123_456,
      expected_execution_id: '',
      expected_turn_id: '',
    });
    expect(receipt.data?.cancellation_id).toBe(request.cancellation_id);
  });

  it('reuses cancellation identity and request time after an ambiguous lost response', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(456_789);
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((_path: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body || '{}'));
      requests.push(request);
      if (requests.length === 1) return Promise.reject(new Error('response lost'));
      return Promise.resolve(new Response(JSON.stringify({
        cancellation_id: request.cancellation_id,
        session_id: 'session-cancel-retry',
        turn_id: requests.length === 4 ? 'turn-next' : 'turn-retry',
        execution_id: requests.length === 4 ? 'execution-next' : 'execution-retry',
        actor_id: 'principal:user',
        cause: 'user_requested',
        reason: request.reason,
        requested_at_ms: request.requested_at_ms,
        effective_at_ms: requests.length === 2 ? null : request.requested_at_ms,
        status: requests.length === 2 ? 'requested' : 'cancelled',
        journal_sequence: requests.length,
        projection_revision: requests.length,
      }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const lost = await api.cancelSessionTurn(
      'session-cancel-retry',
      'execution-retry',
      'turn-retry',
    );
    const recovered = await api.cancelSessionTurn(
      'session-cancel-retry',
      'execution-retry',
      'turn-retry',
    );
    const finalized = await api.cancelSessionTurn(
      'session-cancel-retry',
      'execution-retry',
      'turn-retry',
    );
    const nextTurn = await api.cancelSessionTurn(
      'session-cancel-retry',
      'execution-next',
      'turn-next',
    );

    expect(lost.ok).toBe(false);
    expect(lost.retryable).toBe(true);
    expect(recovered.ok).toBe(true);
    expect(recovered.data?.status).toBe('requested');
    expect(finalized.ok).toBe(true);
    expect(finalized.data?.status).toBe('cancelled');
    expect(nextTurn.ok).toBe(true);
    expect(requests).toHaveLength(4);
    expect(requests[1].cancellation_id).toBe(requests[0].cancellation_id);
    expect(requests[1].requested_at_ms).toBe(requests[0].requested_at_ms);
    expect(requests[2].cancellation_id).toBe(requests[0].cancellation_id);
    expect(requests[2].requested_at_ms).toBe(requests[0].requested_at_ms);
    expect(requests[0].requested_at_ms).toBe(456_789);
    expect(requests[3].cancellation_id).not.toBe(requests[0].cancellation_id);
  });

  it('reads Mission Control projections through gateway endpoints', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => Promise.resolve(new Response(JSON.stringify({
      ok: true,
      snapshot: {
        schema_version: 1,
        kind: 'mission_control.materialized_snapshot',
        cursor: 4,
        revision: 2,
        needs_resync: false,
        projection: {
          schema_version: 1,
          kind: 'mission_control.projection',
          workspace: { active_session_id: 'mission-a' },
          sessions: [{ session_id: 'mission-a', title: 'Mission A', status: 'active' }],
        },
      },
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.missionControl();
    await api.missionApprovals();
    await api.missionRelations();
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/control', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/approvals', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/relations', expect.any(Object));
  });

  it('writes Mission Control operations through canonical control contracts', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await api.missionControlCommand({
      command_id: 'mission-team-create-1',
      action: 'create',
      target: { kind: 'team', team_id: 'team-1' },
      payload: {
        request_id: 'mission-team-create-1',
        team_id: 'team-1',
        session_id: 'mission-a',
        mission_id: 'mission-1',
        objective: 'inspect runtime evidence',
      },
    });
    await api.interpretMissionCommand({
      current_session_id: 'mission-a',
      target_ref: 'mission-b',
      command_text: 'summarize blockers',
      execute: true,
    });
    await api.decideMissionApproval('approval-1', false, 'unsafe');
    await api.runtimeRecoveryReport();
    await api.applyRuntimeRecovery();

    expect(fetchMock).toHaveBeenCalledWith('/api/mission/control', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        command_id: 'mission-team-create-1',
        action: 'create',
        target: { kind: 'team', team_id: 'team-1' },
        payload: {
          request_id: 'mission-team-create-1',
          team_id: 'team-1',
          session_id: 'mission-a',
          mission_id: 'mission-1',
          objective: 'inspect runtime evidence',
        },
      }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/control/interpret', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        current_session_id: 'mission-a',
        target_ref: 'mission-b',
        command_text: 'summarize blockers',
        execute: true,
      }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/approvals/approval-1/decision', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ approved: false, decided_by: 'webui', reason: 'unsafe' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/events/replay-report', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/events/recover', expect.objectContaining({ method: 'POST' }));
  });

  it('wraps write failures with endpoint method payload and retry metadata', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('write failed', { status: 503, statusText: 'Unavailable' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.saveFile('docs/a.md', 'content')).rejects.toMatchObject({
      endpoint: '/api/workspace/files',
      method: 'POST',
      status: 503,
      retryable: true,
    });
    const receipt = await api.writeReceipt('/api/test/write', {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(receipt.ok).toBe(false);
    expect(receipt.endpoint).toBe('/api/test/write');
    expect(receipt.payload_summary).toContain('hello');
  });

  it('calls critical Workspace write endpoints through the backend', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, to: 'docs/b.md' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.saveFile('docs/a.md', 'hello');
    await api.renameWorkspacePath('docs/a.md', 'docs/b.md');
    await api.deleteWorkspacePath('docs/b.md');
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/files', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: 'docs/a.md', content: 'hello' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/rename', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: 'docs/a.md', to: 'docs/b.md' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/files?path=docs%2Fb.md', expect.objectContaining({ method: 'DELETE' }));
  });

  it('calls critical Memory and Skills write endpoints through the backend', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.createMemoryEntry('L2', { title: 'fact' });
    await api.updateMemoryEntry('mem-1', { title: 'updated' });
    await api.deleteMemoryEntry('L2', 'mem-1');
    await api.skillAction('local:test', 'validate', { session_id: 's1' });
    await api.skillTranslate('local:test', '# Skill', 'SKILL.md');
    await api.branchSession('s1');
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/L2', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: 'fact' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/entry/mem-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ title: 'updated' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/L2/mem-1', expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/local%3Atest/actions/validate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session_id: 's1' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/local%3Atest/translate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ content: '# Skill', path: 'SKILL.md', locale: 'zh-CN' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/branch', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"idempotency_key":"session-branch:s1:'),
    }));
  });

  it('calls critical MFG write endpoints with explicit request bodies', async () => {
    const fetchMock = vi.fn((_request, init?: RequestInit) => Promise.resolve(
      canonicalMfgMutationResponse(init, { ok: true }),
    ));
    vi.stubGlobal('fetch', fetchMock);
    const sourcePack = {
      source_pack_id: 'sp-1', source_name: 'MES events', owner: 'operations', access_mode: 'file', refresh_mode: 'incremental',
      entity_mappings: [], fact_mappings: [{ source_table: 'events', fact_type: 'manufacturing.event', metric_key: 'event_count', dedup_key: 'event_id', delta_signature: 'updated_at' }],
    };
    await mfgApi.mfgSourcePackUpsert(sourcePack, mfgIntent('mfg.reality.source_pack.create', 'mfg:source-pack:sp-1', sourcePack));
    await mfgApi.mfgSourcePackValidate(
      'sp-1',
      mfgIntent('mfg.reality.source_pack.validate', 'matrix:source_pack:sp-1'),
    );
    await mfgApi.mfgSourcePackDeltaPlan(
      'sp-1',
      mfgIntent('mfg.reality.source_pack.delta_plan', 'matrix:source_pack:sp-1'),
    );
    const ingestPlan = { source_ref: 'source-pack://sp-1', fact_type: 'manufacturing.event', metric_ids: ['event_count'] };
    await mfgApi.mfgDataPlaneIngestPlan(
      ingestPlan,
      mfgIntent('mfg.reality.data_plane.ingest_plan', 'matrix:data-plane:ingest-plan', ingestPlan),
    );
    const connector = { resource_ref: 'file:///tmp/events.json', expected_rows: 10 };
    await mfgApi.mfgSourcePackConnectorPlan('sp-1', connector, mfgIntent('mfg.reality.connector_run.plan', 'mfg:source-pack:sp-1', connector));
    await mfgApi.mfgSourcePackConnectorRun('sp-1', connector, mfgIntent('mfg.reality.connector_run.execute', 'mfg:source-pack:sp-1', connector));
    const attentionPlan = { trigger_fact_type: 'manufacturing.event', entity_scope: 'line:a' };
    await mfgApi.mfgAttentionPlan(
      attentionPlan,
      mfgIntent('mfg.reality.metric.attention_plan', 'matrix:attention-plan', attentionPlan),
    );
    const computePlan = { trigger_fact_type: 'manufacturing.event', metric_ids: ['event_count'] };
    await mfgApi.mfgComputeJobPlan(computePlan, mfgIntent('mfg.reality.compute_job.plan', 'mfg:compute-plan:test', computePlan));
    await mfgApi.mfgEntityUpsert({ entity_id: 'entity-1' }, mfgIntent('mfg.reality.entity.create', 'mfg:entity:entity-1'));
    await mfgApi.mfgRelationUpsert({ relation_type: 'feeds' }, mfgIntent('mfg.reality.relation.create', 'mfg:relation:test'));
    const playbook = { playbook_id: 'playbook-1', domain: 'manufacturing', scenario: 'Recover line', quality_gate_policy: 'required', cross_plane_policy: 'governed', created_at: '2026-07-16T00:00:00Z', updated_at: '2026-07-16T00:00:00Z' };
    await mfgApi.mfgPlaybookUpsert(playbook, mfgIntent('mfg.playbook.create', 'mfg:playbook:playbook-1', playbook));
    await mfgApi.mfgEvidenceQualityGate('evidence-1', mfgIntent('mfg.reality.evidence.quality_gate', 'mfg:evidence:evidence-1'));
    await mfgApi.mfgRecommendPlaybooks(
      'incident-1',
      5,
      mfgIntent('mfg.incident.playbook.recommend', 'mfg:incident:incident-1', { limit: 5 }),
    );
    await mfgApi.mfgComputeJobRun('job-1', mfgIntent('mfg.reality.compute_job.execute', 'mfg:compute-job:job-1'));
    await mfgApi.mfgExecuteAction('analysis-1', 'action-1', { mode: 'dry_run', operator_id: 'forged' }, mfgIntent('mfg.analysis.action.dry_run', 'mfg:analysis:analysis-1'));
    await mfgApi.mfgExecutionBridge('exec-1', { mode: 'dry_run', actor_principal: 'forged' }, mfgIntent('mfg.execution.cross_plane.dry_run', 'mfg:execution:exec-1'));
    await mfgApi.mfgExecutionFeedback('exec-1', { outcome: 'resolved', note: 'verified', actor_ref: 'forged' }, mfgIntent('mfg.execution.feedback.create', 'mfg:execution:exec-1'));
    await mfgApi.mfgRetryReportDelivery('report-1', { mode: 'dry_run' }, mfgIntent('mfg.report.delivery.retry_dry_run', 'mfg:report:report-1'));
    const facts = [{ fact_type: 'quality', source_ref: 'source-pack://sp-1' }];
    await mfgApi.mfgIngestFact(facts, mfgIntent('mfg.reality.fact.ingest', 'mfg:fact-batch:test', facts));
    await mfgApi.mfgSeedDomain(mfgIntent('mfg.domain.server_manufacturing.seed', 'mfg:domain:server-manufacturing'));
    await mfgApi.mfgSeedOntology(mfgIntent('mfg.ontology.server_manufacturing.seed', 'mfg:ontology:server-manufacturing'));
    expectMfgMutation(fetchMock, '/api/apps/mfg/reality/source-packs/upsert', { source_pack: sourcePack, session_id: 'webui-mfg' });
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/source-packs/sp-1/validate', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/source-packs/sp-1/delta-plan', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/data-plane/ingest-plan', expect.objectContaining({ body: JSON.stringify({ ingest: { source_ref: 'source-pack://sp-1', fact_type: 'manufacturing.event', metric_ids: ['event_count'] }, session_id: 'webui-mfg' }) }));
    expectMfgMutation(fetchMock, '/api/apps/mfg/reality/source-packs/sp-1/connector-runs/plan', { run: { resource_ref: 'file:///tmp/events.json', expected_rows: 10 }, session_id: 'webui-mfg' });
    expectMfgMutation(fetchMock, '/api/apps/mfg/reality/source-packs/sp-1/connector-runs/run', { run: { resource_ref: 'file:///tmp/events.json', expected_rows: 10 }, session_id: 'webui-mfg' });
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/metrics/attention-plan', expect.objectContaining({ body: JSON.stringify({ trigger_fact_type: 'manufacturing.event', entity_scope: 'line:a' }) }));
    expectMfgMutation(fetchMock, '/api/apps/mfg/reality/compute/jobs/plan', { job: { trigger_fact_type: 'manufacturing.event', metric_ids: ['event_count'] }, session_id: 'webui-mfg' });
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/entities/upsert', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/relations/upsert', expect.objectContaining({ method: 'POST' }));
    expectMfgMutation(fetchMock, '/api/apps/mfg/playbooks/upsert', { playbook, session_id: 'webui-mfg' });
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/evidence/evidence-1/quality-gate', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/incidents/incident-1/playbooks/recommend', expect.objectContaining({ body: JSON.stringify({ limit: 5 }) }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/compute/jobs/job-1/run', expect.objectContaining({ method: 'POST' }));
    expectMfgMutation(fetchMock, '/api/apps/mfg/analyses/analysis-1/actions/action-1/execute', { mode: 'dry_run' });
    expectMfgMutation(fetchMock, '/api/apps/mfg/executions/exec-1/cross-plane/execute', { mode: 'dry_run' });
    expectMfgMutation(fetchMock, '/api/apps/mfg/executions/exec-1/feedback', { outcome: 'resolved', note: 'verified' });
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/cockpit/reports/report-1/delivery/retry', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/facts/ingest', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/domain/server-manufacturing/seed', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/ontology/server-manufacturing/seed', expect.objectContaining({ method: 'POST' }));
  });

  it('does not let compiled APP capabilities override the broker authentication catalogue', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      success: true,
      surface_id: 'webui',
      entitlement: { granted: ['mfg.read'], denied: ['mfg.data.manage'] },
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await api.authLogin('credential');

    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ token: 'credential', surface_id: 'webui' });
    expect(body.requested_capabilities).toEqual([]);
  });

  it('calls real MFG incident and cockpit report endpoints', async () => {
    const fetchMock = vi.fn((_request, init?: RequestInit) => Promise.resolve(
      canonicalMfgMutationResponse(init),
    ));
    vi.stubGlobal('fetch', fetchMock);
    await mfgApi.mfgCreateIncident({ title: 'Line A deviation' }, mfgIntent('mfg.incident.create', 'mfg:incident-draft:test'));
    await mfgApi.mfgAnalyzeIncident('incident-1', mfgIntent('mfg.incident.analyze', 'mfg:incident:incident-1'));
    await mfgApi.mfgSkills();
    await mfgApi.mfgGenerateReport('profile-1', { cadence: 'daily' }, mfgIntent('mfg.report.generate', 'mfg:cockpit-profile:profile-1'));
    expectMfgMutation(fetchMock, '/api/apps/mfg/incidents', { title: 'Line A deviation' });
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/incidents/incident-1/analyze', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/skills', expect.any(Object));
    expectMfgMutation(fetchMock, '/api/apps/mfg/cockpit/profiles/profile-1/reports/generate', { report: { cadence: 'daily' } });
  });

  it('calls revisioned MFG cockpit, alert, and assignment write endpoints', async () => {
    const fetchMock = vi.fn((_request, init?: RequestInit) => Promise.resolve(
      canonicalMfgMutationResponse(init),
    ));
    vi.stubGlobal('fetch', fetchMock);
    const draftIntent = mfgIntent('mfg.cockpit.draft.save', 'mfg:cockpit-profile:profile-1');
    const publishIntent = mfgIntent('mfg.cockpit.draft.publish', 'mfg:cockpit-profile:profile-1');
    const deleteIntent = mfgIntent('mfg.cockpit.profile.delete', 'mfg:cockpit-profile:profile-1');
    const cloneIntent = mfgIntent('mfg.cockpit.profile.clone', 'mfg:cockpit-profile:profile-1');
    const shareIntent = mfgIntent('mfg.cockpit.profile.share', 'mfg:cockpit-profile:profile-1');
    await mfgApi.mfgSaveCockpitDraft(
      'profile-1',
      { profile_id: 'profile-1', display_name: 'Plant cockpit', revision: 1 },
      [],
      undefined,
      draftIntent,
    );
    await mfgApi.mfgPublishCockpitDraft('profile-1', 1, publishIntent);
    await mfgApi.mfgDeleteCockpitProfile('profile-1', 1, deleteIntent);
    await mfgApi.mfgCloneCockpitProfile('profile-1', {}, cloneIntent);
    await mfgApi.mfgShareCockpitProfile('profile-1', {
      expected_revision: 1,
      sharing_policy: { visibility: 'team', viewer_refs: ['viewer-1'], editor_refs: [] },
    }, shareIntent);
    await mfgApi.mfgCockpitWidgetProjection('profile-1', 'widget-1');
    await mfgApi.mfgUpsertAlertRule({ rule_id: 'rule-1', name: 'Line A deviation', revision: 1 }, mfgIntent('mfg.alert_rule.update', 'mfg:alert-rule:rule-1'));
    await mfgApi.mfgAlertCommand('alert-1', { command: 'acknowledge', expected_revision: 1 }, mfgIntent('mfg.alert.acknowledge', 'mfg:alert:alert-1'));
    await mfgApi.mfgUpsertAlertSubscription({ subscription_id: 'subscription-1', rule_id: 'rule-1', revision: 1 }, mfgIntent('mfg.alert_subscription.update', 'mfg:alert-subscription:subscription-1'));
    await mfgApi.mfgUpsertAssignment({ assignment_id: 'assignment-1', task_ref: 'task-1', assignee_ref: 'operator-1', revision: 1 }, mfgIntent('mfg.assignment.update', 'mfg:assignment:assignment-1'));
    await mfgApi.mfgAssignmentCommand('assignment-1', { command: 'claim', expected_revision: 1 }, mfgIntent('mfg.assignment.claim', 'mfg:assignment:assignment-1'));
    expectMfgMutation(
      fetchMock,
      '/api/apps/mfg/cockpit/profiles/profile-1/draft',
      {
        profile: { profile_id: 'profile-1', display_name: 'Plant cockpit', revision: 1 },
        locks: [],
      },
      draftIntent.idempotency_key,
    );
    expectMfgMutation(
      fetchMock,
      '/api/apps/mfg/cockpit/profiles/profile-1/publish',
      { expected_active_revision: 1 },
      publishIntent.idempotency_key,
    );
    const deleteCall = fetchMock.mock.calls.find(([url]) => (
      String(url) === '/api/apps/mfg/cockpit/profiles/profile-1?expected_revision=1'
    ));
    expect(deleteCall).toBeTruthy();
    expect((deleteCall?.[1] as RequestInit).method).toBe('DELETE');
    expect(new Headers((deleteCall?.[1] as RequestInit).headers).get('Idempotency-Key'))
      .toBe(deleteIntent.idempotency_key);
    expect(String(deleteCall?.[0])).not.toContain('idempotency_key=');
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/cockpit/profiles/profile-1/clone', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/cockpit/profiles/profile-1/share', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/cockpit/profiles/profile-1/widgets/widget-1/projection', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/focus/alert-rules', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/focus/alerts/alert-1/command', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/focus/alert-subscriptions', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/assignments', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/assignments/assignment-1/command', expect.objectContaining({ method: 'POST' }));
  });

  it('renders the revisioned MFG cockpit workspaces from live projection contracts', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ version: 'test' })));
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/approval/config') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ files: [] })));
      if (url === '/api/auth/verify') return Promise.resolve(new Response(JSON.stringify({
        valid: true,
        auth_required: true,
        entitlement: {
          core_profile_id: 'core_operator',
          app_profiles: { mfg: 'mfg_operator' },
          profile_revision: 1,
          credential_epoch: 1,
          ceiling: ['mfg.read'],
          granted: ['mfg.read'],
          denied: [],
        },
      })));
      if (url === '/api/apps/mfg/cockpit/profiles') return Promise.resolve(new Response(JSON.stringify({ items: [{ profile_id: 'profile-1', owner_ref: 'principal:verified', display_name: 'Plant cockpit', focus_refs: [], focus_metric_ids: [], thresholds: {}, cadence: 'daily', revision: 1, scope: { kind: 'personal' }, layout: { columns: 12, row_height: 72, gap: 12 }, global_filters: {}, widget_instances: [], sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] } }] })));
      if (url === '/api/apps/mfg/cockpit/widget-catalog') return Promise.resolve(new Response(JSON.stringify({ items: [] })));
      if (url === '/api/apps/mfg/focus/alert-rules' || url === '/api/apps/mfg/focus/alerts' || url === '/api/apps/mfg/focus/alert-subscriptions' || url.startsWith('/api/apps/mfg/focus/forecasts')) return Promise.resolve(new Response(JSON.stringify({ items: [] })));
      if (url === '/api/apps/mfg/assignments') return Promise.resolve(new Response(JSON.stringify({ items: [] })));
      if (url === '/api/apps/mfg/live/snapshot') return Promise.resolve(new Response(JSON.stringify({
        kind: 'snapshot',
        view_epoch: 'epoch-1',
        cursor: 'cursor-1',
        generated_at: '2026-07-16T00:00:00Z',
        contract_version: 'mfg.frontend.v1',
        state: {
          cockpit: { profiles: [{ profile_id: 'profile-1', owner_ref: 'principal:verified', display_name: 'Plant cockpit', focus_refs: [], focus_metric_ids: [], thresholds: {}, cadence: 'daily', revision: 1, scope: { kind: 'personal' }, layout: { columns: 12, row_height: 72, gap: 12 }, global_filters: {}, widget_instances: [], sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] } }] },
          alerts: {}, assignments: {}, incidents: {}, executions: {}, reports: {}, reviews: {}, receipts: {}, data_compute: {},
        },
      })));
      if (url === '/api/apps/mfg/live') return Promise.resolve(new Response(
        'event: mfg_live\ndata: {"kind":"heartbeat","view_epoch":"epoch-1","cursor":"cursor-1","generated_at":"2026-07-16T00:00:01Z"}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ));
      if (url === '/api/apps/mfg/cockpit/profiles/profile-1') return Promise.resolve(new Response(JSON.stringify({ profile: { profile_id: 'profile-1', owner_ref: 'principal:verified', display_name: 'Plant cockpit', focus_refs: [], focus_metric_ids: [], thresholds: {}, cadence: 'daily', revision: 1, scope: { kind: 'personal' }, layout: { columns: 12, row_height: 72, gap: 12 }, global_filters: {}, widget_instances: [], sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] } } })));
      if (url === '/api/apps/mfg/cockpit/profiles/profile-1/projection') return Promise.resolve(new Response(JSON.stringify({ projection_id: 'projection-1', profile: { profile_id: 'profile-1', owner_ref: 'principal:verified', display_name: 'Plant cockpit', focus_refs: [], focus_metric_ids: [], thresholds: {}, cadence: 'daily', revision: 1, scope: { kind: 'personal' }, layout: { columns: 12, row_height: 72, gap: 12 }, global_filters: {}, widget_instances: [], sharing_policy: { visibility: 'private', viewer_refs: [], editor_refs: [] } }, widgets: [], summary: 'ready', generated_at: '2026-07-16T00:00:00Z' })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/apps/mfg');
    await settleAsync();
    await settleAsync();
    expect(wrapper.get('[data-section="dashboard"]').exists()).toBe(true);
    expect(wrapper.find('.mfg-cockpit').exists()).toBe(true);
    expect(wrapper.text()).toContain('制造运营工作台');
    expect(wrapper.text()).toContain('Plant cockpit');
    expect(wrapper.text()).toContain('独立的制造应用');
    const refreshButton = wrapper.get('[data-mfg-workspace-refresh]');
    expect(refreshButton.attributes('disabled')).toBeUndefined();
    await refreshButton.trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/cockpit/profiles', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/live/snapshot', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/live', expect.any(Object));
    useMfgCockpitStore().stopLive();
  });

  it('loads audit, usage, and release gate from real governance endpoints', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: 'governance.test' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.auditExport('approval', 25, 5);
    await api.usageSummary();
    await api.cowdReleaseGate();
    expect(fetchMock).toHaveBeenCalledWith('/api/audit/export?source=approval&limit=25&offset=5', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/usage', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/cowd/release-gate', expect.any(Object));
  });

  it('verifies same-origin gateway access through the backend instead of managing browser tokens', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/auth/verify') return Promise.resolve(new Response(JSON.stringify({ valid: true, auth_required: true }), { status: 200 }));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ dir: '', files: [] })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/settings');
    await settleAsync();
    expect(wrapper.get('.settings-nav').attributes('aria-label')).toBe('设置分区');
    expect(wrapper.text()).toContain('保存当前分区');
    const settingsButtons = () => wrapper.findAll('.settings-nav button');
    await settingsButtons()[1]?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('保存运行时模型配置');
    await settingsButtons()[3]?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('更新审批策略');
    await settingsButtons()[4]?.trigger('click');
    await settleAsync();
    await wrapper.findAll('button.ghost-action').find((button) => button.text().includes('验证 Gateway 访问'))?.trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify', expect.any(Object));
    expect(wrapper.text()).toContain('同源内部访问');
    await settingsButtons()[5]?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('设置写入回执');
  });

  it('renders runtime growth loop from gateway growth endpoints', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ version: 'test' })));
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({
        components: {
          provider: {
            configured_model: 'DeepSeek-v4-flash',
            provider_count: 1,
            model_count: 2,
          },
        },
      })));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/approval/config') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ files: [] })));
      if (url === '/api/runtime/config/effective') return Promise.resolve(new Response(JSON.stringify({ source: 'test' })));
      if (url === '/api/runtime/session-leases') return Promise.resolve(new Response(JSON.stringify({ leases: [] })));
      if (url === '/api/approval/pending') return Promise.resolve(new Response(JSON.stringify({ pending: [] })));
      if (url === '/api/mission/control') return Promise.resolve(new Response(JSON.stringify({
        projection: {
          mission: {
            active_session_id: 'mission-a',
            sessions: [{ session_id: 'mission-a', title: 'Mission A', status: 'active', active_team_ids: ['team-a'], active_agent_ids: ['agent-a'] }],
            events: [{ sequence: 1, event_type: 'mission.session.started', session_id: 'mission-a', message: 'started' }],
            approval_projection: { pending_count: 0 },
            relation_projection: { relation_count: 0 },
          },
          sessions: [{ session_id: 'mission-a', title: 'Mission A', status: 'active', active_team_ids: ['team-a'], active_agent_ids: ['agent-a'] }],
          teams: [],
          agents: [],
          approvals: { pending_count: 0, requests: [] },
          relations: { relation_count: 0, relations: [] },
          stewards: [],
          event_digest: { latest: [{ sequence: 1, kind: 'mission.session.started', status: 'complete', message: 'started' }] },
        },
      })));
      if (url === '/api/mission/approvals') return Promise.resolve(new Response(JSON.stringify({ approvals: { pending_count: 0, requests: [] } })));
      if (url === '/api/mission/relations') return Promise.resolve(new Response(JSON.stringify({ relations: { relation_count: 0, relations: [] } })));
      if (url.startsWith('/api/runtime/timeline')) return Promise.resolve(new Response(JSON.stringify({ events: [{ sequence: 1, kind: 'turn', status: 'complete', detail: 'done' }] })));
      if (url === '/api/tasks') return Promise.resolve(new Response(JSON.stringify({ tasks: [{ task_id: 'task-1', status: 'completed', objective: 'align webui', current_phase_id: 'review', revision: 1 }] })));
      if (url === '/api/growth/status') return Promise.resolve(new Response(JSON.stringify({ status: 'ready', event_count: 1, promotion_count: 1, sources: { risk_gate: 1 } })));
      if (url === '/api/growth/events') return Promise.resolve(new Response(JSON.stringify({
        events: [{ id: 'growth-1', source_event_kind: 'risk_gate', selected_mode: 'promote', risk: 'low', created_at: '2026-06-21T00:00:00Z' }],
        promotions: [{ target: 'memory', status: 'accepted', target_id: 'mem-1', summary: 'promoted stable lesson' }],
      })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/runtime?section=growth');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('成长闭环');
    expect(wrapper.text()).toContain('Mission 控制台');
    expect(wrapper.get('a[href="#/mission"]').text()).toContain('打开 Mission Control');
    expect(wrapper.find('.workflow-strip').exists()).toBe(false);
    expect(wrapper.text()).toContain('risk_gate');
    expect(wrapper.text()).toContain('memory');
    expect(wrapper.text()).toContain('运行时选中证据');
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('risk_gate'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('证据下钻载荷');
    expect(fetchMock).toHaveBeenCalledWith('/api/growth/status', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/growth/events', expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/mission/control', expect.any(Object));
  });

  it('uses the canonical writer attachment controller for Runtime lease actions', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({})))));
    const pinia = createPinia();
    setActivePinia(pinia);
    const appStore = useAppStore();
    appStore.activeSessionId = 'runtime-lease-session';
    const chat = useChatSessionsStore();
    const attach = vi.spyOn(chat, 'attachSurface').mockImplementation(
      async (sessionId, mode) => {
        chat.states[sessionId] = {
          sessionId,
          turns: [],
          executionId: '',
          executionTurnId: '',
          executionGeneration: 0,
          latestIngressSequence: -1,
          streamTurnId: '',
          terminalId: '',
          live: null,
          evidence: null,
          streamState: 'offline',
          loadEpoch: 0,
          submissionEpoch: 0,
          pending: false,
          lastError: '',
          unread: 0,
          lastEventAtMs: 0,
          lastProgressAtMs: 0,
          degradedReason: '',
          resyncCount: 0,
          attachmentRole: 'writer',
          writable: true,
        };
        return mode === 'exclusive';
      },
    );
    const detach = vi.spyOn(chat, 'detachSurface').mockImplementation(async (sessionId) => {
      chat.states[sessionId].attachmentRole = 'detached';
      chat.states[sessionId].writable = false;
    });
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/runtime', component: RuntimePage }],
    });
    await router.push('/runtime');
    await router.isReady();
    const wrapper = mount(RuntimePage, { global: { plugins: [pinia, router] } });
    await settleAsync();

    const leasePanel = wrapper.get('[data-section="runs"]');
    expect(leasePanel.find('input').exists()).toBe(false);
    const mode = leasePanel.get('select');
    expect(mode.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'collaborative',
      'exclusive',
    ]);
    await mode.setValue('exclusive');
    const buttons = leasePanel.findAll('button');
    await buttons[0].trigger('click');
    await settleAsync();
    expect(attach).toHaveBeenCalledWith('runtime-lease-session', 'exclusive');
    await buttons[1].trigger('click');
    await settleAsync();
    expect(detach).toHaveBeenCalledWith('runtime-lease-session');
  });

  it('uses explicit approval scope choices in the Runtime workbench', async () => {
    const pending = vi.spyOn(api, 'approvalPending').mockResolvedValue({
      pending: [{
        approval_id: 'runtime-approval-1',
        summary: 'Allow a governed write',
        action: 'tool.write',
        status: 'pending',
        allowed_scopes: ['once', 'session'],
        effect_assessment: { read_write_class: 'write' },
      }],
    } as any);
    vi.spyOn(api, 'approvalGrants').mockResolvedValue({ grants: [] });
    const respond = vi.spyOn(api, 'approvalRespond').mockResolvedValue({ status: 'approved' });
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/runtime', component: RuntimePage }],
    });
    await router.push('/runtime?section=policy');
    await router.isReady();
    const wrapper = mount(RuntimePage, {
      global: {
        plugins: [pinia, router],
        provide: { [activeCapabilitySectionKey as symbol]: computed(() => 'policy') },
      },
    });
    await settleAsync();

    const policyPanel = wrapper.get('[data-section="policy"]');
    expect(policyPanel.find('select').exists()).toBe(false);
    const scopeButtons = policyPanel.findAll('.runtime-approval-scope button');
    expect(scopeButtons).toHaveLength(2);
    expect(scopeButtons[0].classes()).toContain('active');
    await scopeButtons[1].trigger('click');
    expect(scopeButtons[1].classes()).toContain('active');
    const approve = policyPanel.findAll('button').find((button) => button.text().includes('批准'));
    expect(approve).toBeDefined();
    await approve!.trigger('click');
    await settleAsync();

    expect(pending).toHaveBeenCalledWith({}, expect.any(AbortSignal));
    expect(respond).toHaveBeenCalledWith(
      'runtime-approval-1',
      true,
      'session',
      'approved from Runtime Workbench',
    );
  });

  it('loads a truthful five-request Runtime overview projection', async () => {
    invalidateApiReadCache();
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/runtime/control-plane') {
        return Promise.resolve(new Response(JSON.stringify({
          status: 'healthy',
          config: { source: 'config' },
          config_reload: { status: 'applied', trigger: 'auto' },
          components: {
            provider: {
              configured_model: 'deepseek-pro',
              provider_count: 2,
              model_count: 4,
            },
          },
          health: {
            runtime: {
              provider_transport: { entries: 3, hits: 8, checkouts: 10 },
              hot_state: {
                pressure_high: false,
                metrics: { resident_bytes: 1024 },
                budget: { limit_bytes: 4096 },
              },
            },
            storage: {
              backend: 'postgres',
              postgres: { metrics: { query_count: 20, query_error_count: 0 } },
              session_execution: { active: 2, queued: 1 },
            },
          },
        })));
      }
      if (url === '/api/runtime/snapshot') return Promise.resolve(new Response(JSON.stringify({ status: 'ready' })));
      if (url === '/api/runtime/source-audit') return Promise.resolve(new Response(JSON.stringify({ report: { ok: true } })));
      if (url === '/api/runtime/source-repair-plan') return Promise.resolve(new Response(JSON.stringify({ repair_plan: [] })));
      if (url === '/api/runtime/config/effective') return Promise.resolve(new Response(JSON.stringify({ source: 'config', workspace_root: '/workspace' })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/runtime', component: RuntimePage }],
    });
    await router.push('/runtime');
    await router.isReady();
    const wrapper = mount(RuntimePage, { global: { plugins: [pinia, router] } });
    await settleAsync();

    expect(wrapper.text()).toContain('deepseek-pro');
    expect(wrapper.text()).toContain('1.0 KiB');
    expect(wrapper.text()).toContain('20');
    const runtimeReads = fetchMock.mock.calls
      .map(([path]) => String(path))
      .filter((path) => path.startsWith('/api/runtime/'));
    expect(runtimeReads).toEqual([
      '/api/runtime/control-plane',
      '/api/runtime/snapshot',
      '/api/runtime/source-audit',
      '/api/runtime/source-repair-plan',
      '/api/runtime/config/effective',
    ]);
  });

  it('renders Reality Core evidence object detail from flow rows', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ version: 'test' })));
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/approval/config') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ files: [] })));
      if (url === '/api/reality/status') return Promise.resolve(new Response(JSON.stringify({ reality_core: { status: 'ready' }, engines: { memory: { status: 'ready', role: 'recall' } } })));
      if (url === '/api/reality/static') return Promise.resolve(new Response(JSON.stringify({ core_map: [{ id: 'memory', label: 'Memory Engine', status: 'ready', writes: true, api: '/api/memory/*', role: 'unstructured facts' }] })));
      if (url.startsWith('/api/reality/flow')) return Promise.resolve(new Response(JSON.stringify({
        source: 'test',
        stages: [{ kind: 'memory.promotion', status: 'accepted', decision: 'promote', target_ref: 'memory:mem-1', confidence_bp: 9200, summary: 'stable fact' }],
        events: [{ id: 'event-1', source_event_kind: 'runtime', confidence_bp: 9200, evidence_refs: [{ reference: 'memory:mem-1', kind: 'memory.fact', summary: 'stable fact' }] }],
        promotions: [{ target: 'memory', status: 'accepted', target_id: 'mem-1', summary: 'stable fact' }],
      })));
      if (url.startsWith('/api/reality/promotions')) return Promise.resolve(new Response(JSON.stringify({ promotions: [{ target: 'memory', status: 'accepted', target_id: 'mem-1', summary: 'stable fact' }] })));
      if (url === '/api/reality/boundaries') return Promise.resolve(new Response(JSON.stringify({ boundaries: [{ id: 'held', label: 'Held facts', count: 1, meaning: 'conflict review' }] })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/reality');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('现实核心');
    expect(wrapper.text()).toContain('证据对象详情');
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('stable fact'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('现实选中证据');
    expect(wrapper.text()).toContain('memory.promotion');
    expect(wrapper.text()).toContain('证据下钻载荷');
  });

  it('renders Mission Control recovery and canonical relation controls', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      const url = String(path);
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ version: 'test' })));
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/approval/config') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ files: [] })));
      if (url === '/api/mission/control') return Promise.resolve(new Response(JSON.stringify({
        projection: {
          mission: {
            active_session_id: 'mission-a',
            sessions: [{ session_id: 'mission-a', title: 'Mission A', status: 'active', active_team_ids: ['team-a'], active_agent_ids: ['agent-a'] }],
            events: [{ event_type: 'mission.command.ready', status: 'ready', message: 'ready' }],
            session_command_summary: { total: 1, pending: 1, running: 0 },
            session_commands: [{ command_id: 'command-1', target_session_id: 'mission-a', status: 'pending', command: 'summarize' }],
          },
          teams: [{ team_id: 'team-a' }],
          agents: [{ agent_id: 'agent-a' }],
          approvals: { pending_count: 1, requests: [{ approval_id: 'approval-1', status: 'pending', summary: 'Need tool access', session_id: 'mission-a', risk: 'medium' }] },
          relations: { relation_count: 1, relations: [] },
          stewards: [{ id: 'steward-1', status: 'ready' }],
          event_digest: { latest: [] },
        },
      })));
      if (url === '/api/mission/approvals') return Promise.resolve(new Response(JSON.stringify({ approvals: { pending_count: 1, requests: [{ approval_id: 'approval-1', status: 'pending', summary: 'Need tool access', session_id: 'mission-a', risk: 'medium' }] } })));
      if (url === '/api/mission/relations') return Promise.resolve(new Response(JSON.stringify({ relations: { relation_count: 1, relations: [] } })));
      if (url === '/api/mission/sessions/mission-a') return Promise.resolve(new Response(JSON.stringify({ session_id: 'mission-a', tool_count: 2, memory_recall_count: 3 })));
      if (url === '/api/mission/sessions/mission-a/inbox') return Promise.resolve(new Response(JSON.stringify({ summary: { total: 1, pending: 1 }, commands: [{ command_id: 'command-1', status: 'pending', command: 'summarize blockers' }] })));
      if (url.startsWith('/api/runtime/timeline')) return Promise.resolve(new Response(JSON.stringify({ events: [{ kind: 'turn', status: 'ready', detail: 'running' }] })));
      if (url.startsWith('/api/reality/flow')) return Promise.resolve(new Response(JSON.stringify({ events: [{ kind: 'memory.recall', status: 'ready', summary: 'fact' }] })));
      if (url === '/api/mission/control/stewards/scheduler') return Promise.resolve(new Response(JSON.stringify({ status: init?.method === 'POST' ? 'ticked' : 'ready', decisions: [{ id: 'd1' }] })));
      if (url === '/api/mission/control/stewards/steward-1/handoff') return Promise.resolve(new Response(JSON.stringify({ steward_id: 'steward-1', summary: 'handoff ready' })));
      if (url === '/api/runtime/events/replay-report') return Promise.resolve(new Response(JSON.stringify({ gaps: [{ session_id: 'mission-a', kind: 'missing-event' }] })));
      if (url === '/api/runtime/events/recover') return Promise.resolve(new Response(JSON.stringify({ recovered: true })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/mission');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('治理动作');
    expect(wrapper.text()).toContain('运行时恢复');
    expect(wrapper.text()).not.toContain('Need tool access');
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/mission/approvals'))
      .toBe(false);
    expect(wrapper.get('button.danger-action[disabled]').text()).toContain('应用恢复');
    await wrapper.findAll('button.ghost-action').find((button) => button.text().includes('加载恢复报告'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('运行时恢复报告');
    expect(wrapper.text()).toContain('mission-a');
    await wrapper.findAll('button.danger-action').find((button) => button.text().includes('应用恢复'))?.trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/events/recover', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/mission/projection', expect.any(Object));
  });

  it('calls real cross-plane identity grant and action endpoints', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: 'cross-plane.test' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const action = {
      actor_principal: 'webui-operator',
      requested_capability: 'service.read',
      risk: 'medium',
      data_classification: 'internal',
      identity_trust: 'unknown',
    };
    await api.crossPlaneCreateIdentity({ id: 'idb-1', principal_id: 'webui-operator', identity_ref: 'user:webui-operator' });
    await api.crossPlaneCreateGrant({ id: 'grant-1', principal_id: 'webui-operator', capability: 'service.read' });
    await api.crossPlanePolicySimulate(action);
    await api.crossPlanePreflight(action);
    await api.crossPlaneExecute(action, 'dry_run', 'key-1');
    await api.crossPlaneRevokeIdentity('idb-1');
    await api.crossPlaneRevokeGrant('grant-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/cross-plane/identities', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ id: 'idb-1', principal_id: 'webui-operator', identity_ref: 'user:webui-operator' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/cross-plane/grants', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ id: 'grant-1', principal_id: 'webui-operator', capability: 'service.read' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/cross-plane/policy/simulate', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/cross-plane/action/preflight', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requested_capability: 'service.read', risk: 'medium', data_classification: 'internal', identity_trust: 'unknown' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/cross-plane/action/execute', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: { requested_capability: 'service.read', risk: 'medium', data_classification: 'internal', identity_trust: 'unknown' }, mode: 'dry_run', idempotency_key: 'key-1' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/cross-plane/identities/idb-1', expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/cross-plane/grants/grant-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('calls slash and surface host endpoints through the current gateway contracts', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, commands: [], history: [] }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.commands();
    await api.commandHistory();
    await api.resolveCommand('/status', 'webui', { source: 'test' });
    await api.executeCommand('/status', { verbose: true });
    await api.surfaceRegistry();
    await api.surfaceHostHealth();
    await api.surfaceDetail('webui');
    await api.surfaceRoutes('webui');
    await api.surfaceResources('webui');
    await api.surfaceStatus('webui');
    await api.surfaceHealth('webui');
    await api.surfaceHealthCheck('webui');
    await api.surfaceEvents('webui');
    await api.surfaceInbox('webui');
    await api.surfaceOutbox('webui');
    await api.surfaceMessages('webui');
    await api.surfaceTriggerEvents('webui');
    await api.surfaceRetryTriggerEvent('webui', 'surface-event-1');
    await api.surfaceDeliveries('webui');
    await api.surfaceReplayInbox('webui', 'msg-1');
    await api.surfaceRetryOutbox('webui', 'delivery-1');
    await api.surfaceDeadLetterOutbox('webui', 'delivery-1', 'test dead letter');
    await api.surfaceStart('webui');
    await api.surfaceStop('webui');
    await api.surfaceRestart('webui');
    await api.surfaceRepair('webui');
    await api.surfaceSend('webui', 'operator', 'hello');
    await api.surfaceAction('webui', 'health', { source: 'test' });
    await api.edgeRegistry();
    await api.edgeHealth();
    await api.edgeSurfaces();
    await api.edgeConnectors();
    await api.edgeMessageConnectors();
    await api.edgeSourceConnectors();
    await api.matrixSourcePackUpsert({ source_pack_id: 'pack-1' });
    await api.matrixSourceSnapshotPlan('pack-1', { resource_ref: 'file://orders.csv', estimated_rows: 2 });
    await api.matrixSourceSnapshotRun('pack-1', { source_read_plan: { adapter_id: 'csv', resource_ref: 'file://orders.csv' } });
    await api.matrixSourceSnapshots('pack-1');
    await api.messageConnectors();
    await api.messageConnectorStatus('webui');
    await api.messageConnectorRepair('webui');
    await api.messageEndpoints();
    await api.messageRoutes();
    await api.messageBindings();

    expect(fetchMock).toHaveBeenCalledWith('/api/slash?surface=webui', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/slash/history', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/slash/resolve', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/slash/dispatch', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/health', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/routes', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/resources', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/status', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/health', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/health-check', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/events', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/inbox', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/outbox', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/messages', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/trigger-events', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/trigger-events/retry', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ idempotency_key: 'surface-event-1' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/deliveries', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/inbox/msg-1/replay', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/outbox/delivery-1/retry', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/outbox/delivery-1/dead-letter', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/start', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/stop', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/restart', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/repair', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/send', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/action', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/edges', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/edges/health', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/edges/surfaces', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/edges/connectors', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/edges/connectors/message', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/edges/connectors/source', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/matrix/source-packs/upsert', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/matrix/source-packs/pack-1/snapshots/plan', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/matrix/source-packs/pack-1/snapshots/run', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ source_read_plan: { adapter_id: 'csv', resource_ref: 'file://orders.csv' }, session_id: 'webui-edge' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/matrix/source-packs/pack-1/snapshots', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/message-connectors', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/message-connectors/webui/status', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/message-connectors/webui/repair', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/message-endpoints', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/message-routes', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/message-bindings', expect.any(Object));
  });

  it('renders SurfaceHost registry, health, routes, resources, events, and dispatch controls', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ version: 'test' })));
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/approval/config') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ files: [] })));
      if (url === '/api/surfaces') return Promise.resolve(new Response(JSON.stringify({
        kind: 'surface.registry',
        registry: {
          surfaces: [
            { id: 'webui', name: 'WebUI', kind: 'web', status: 'ready', lifecycle: 'builtin', capabilities: ['chat'], routes: [{ path: '/s/webui/*path' }], resources: [{ path: '/' }] },
          ],
        },
      })));
      if (url === '/api/surfaces/health') return Promise.resolve(new Response(JSON.stringify({
        kind: 'surface.health',
        status: 'ready',
        host: { status: 'ready', surface_count: 1, external_surface_count: 0, route_count: 1, resource_count: 1, ready_count: 1, degraded_count: 0, failed_count: 0, circuit_open_count: 0 },
        runtime: [{ surface: 'webui', status: 'builtin', active: true, consecutive_failures: 0, restart_count: 0, circuit_open: false }],
      })));
      if (url === '/api/surfaces/webui') return Promise.resolve(new Response(JSON.stringify({ kind: 'surface.detail', surface: { id: 'webui', name: 'WebUI', kind: 'web' } })));
      if (url === '/api/surfaces/webui/routes') return Promise.resolve(new Response(JSON.stringify({ kind: 'surface.routes', routes: [{ method: 'GET', path: '/s/webui/*path', target: 'static' }] })));
      if (url === '/api/surfaces/webui/resources') return Promise.resolve(new Response(JSON.stringify({ kind: 'surface.resources', resources: [{ path: '/', file_path: 'dist/index.html', content_type: 'text/html', spa_fallback: true }] })));
      if (url === '/api/surfaces/webui/status') return Promise.resolve(new Response(JSON.stringify({ kind: 'surface.status', runtime: { surface: 'webui', status: 'builtin', active: true }, events: [] })));
      if (url === '/api/surfaces/webui/health') return Promise.resolve(new Response(JSON.stringify({ ok: true, status: 'ready' })));
      if (url === '/api/surfaces/webui/events') return Promise.resolve(new Response(JSON.stringify({ kind: 'surface.events', events: [{ kind: 'ready', status: 'ready', message: 'booted' }], supervisor_events: [{ status: 'ready', message: 'builtin surface healthy', timestamp: 'now' }] })));
      if (url === '/api/surfaces/webui/inbox') return Promise.resolve(new Response(JSON.stringify({
        kind: 'surface.inbox',
        inbox: [{ message_id: 'msg-1', status: 'replied', thread_id: 'thread-1', sender_id: 'operator', runtime_session_id: 'surface:webui', runtime_turn_id: 'turn-1' }],
        snapshot: {
          active_inbox: [],
          active_outbox: [{ delivery_id: 'delivery-1', status: 'retry_scheduled', recipient: 'operator', attempts: 1, max_attempts: 5, next_retry_at_ms: 1, last_error: 'timeout' }],
        },
      })));
      if (url === '/api/surfaces/webui/outbox') return Promise.resolve(new Response(JSON.stringify({ kind: 'surface.outbox', outbox: [{ delivery_id: 'delivery-1', status: 'retry_scheduled', recipient: 'operator', attempts: 1, max_attempts: 5, next_retry_at_ms: 1, last_error: 'timeout' }], dead_letters: [] })));
      if (url === '/api/surfaces/webui/messages') return Promise.resolve(new Response(JSON.stringify({
        kind: 'surface.messages',
        snapshot: {
          trigger_events: [{ idempotency_key: 'surface-event-1', event_type: 'message.received', status: 'dead_letter', attempts: 5, max_attempts: 5, last_error: 'runtime unavailable' }],
          active_trigger_events: [],
          failed_trigger_events: [{ idempotency_key: 'surface-event-1', event_type: 'message.received', status: 'dead_letter', attempts: 5, max_attempts: 5, last_error: 'runtime unavailable' }],
        },
      })));
      if (url === '/api/surfaces/webui/trigger-events') return Promise.resolve(new Response(JSON.stringify({
        kind: 'surface.trigger_events',
        events: [{ idempotency_key: 'surface-event-1', event_type: 'message.received', status: 'dead_letter', attempts: 5, max_attempts: 5, last_error: 'runtime unavailable' }],
      })));
      if (url === '/api/surfaces/webui/trigger-events/retry') return Promise.resolve(new Response(JSON.stringify({
        kind: 'surface.trigger_event.retry_accepted',
        event: { idempotency_key: 'surface-event-1', status: 'received' },
      })));
      if (url === '/api/surfaces/webui/deliveries') return Promise.resolve(new Response(JSON.stringify({ kind: 'surface.deliveries', deliveries: [{ kind: 'outbox.retry_scheduled', status: 'retry_scheduled', delivery_id: 'delivery-1', message_id: 'msg-1', created_at_ms: 1 }] })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/surfaces');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('Surface 宿主');
    expect(wrapper.text()).toContain('Surface 注册表');
    expect(wrapper.text()).toContain('Surface 诊断手册');
    expect(wrapper.find('.workflow-strip').exists()).toBe(false);
    expect(wrapper.text()).toContain('WebUI');
    expect(wrapper.text()).toContain('路由');
    expect(wrapper.text()).toContain('资源');
    expect(wrapper.text()).toContain('分发');
    expect(wrapper.text()).toContain('可靠投递');
    const triggerEvents = wrapper.get('[data-section="trigger-events"]');
    expect(triggerEvents.text()).toContain('运行时触发事件');
    expect(triggerEvents.text()).toContain('message.received');
    expect(triggerEvents.text()).toContain('runtime unavailable');
    await triggerEvents.get('[data-action="retry-trigger-event"]').trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/trigger-events/retry', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ idempotency_key: 'surface-event-1' }),
    }));
    expect(wrapper.text()).toContain('事件');
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/events', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/inbox', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/outbox', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/trigger-events', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/deliveries', expect.any(Object));
  });

  it('loads skill detail and files from real skill management endpoints', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ version: 'test' })));
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/approval/config') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ files: [] })));
      if (url === '/api/skills/catalog') return Promise.resolve(new Response(JSON.stringify({ items: [{ id: 'local:test', name: 'test', scope: 'local', status: 'ready', risk: 'review', tags: [] }] })));
      if (url === '/api/skills/projection?surface=webui') return Promise.resolve(new Response(JSON.stringify({ facets: { scopes: ['local'], domains: ['test-domain'], tags: ['test-tag'], statuses: ['ready'], risks: ['review'] } })));
      if (url === '/api/skills/runs') return Promise.resolve(new Response(JSON.stringify({ items: [{ run_id: 'run-1', skill_id: 'local:test', status: 'done' }] })));
      if (url === '/api/skills/runs/run-1') return Promise.resolve(new Response(JSON.stringify({ run: { run_id: 'run-1', status: 'done' } })));
      if (url === '/api/skills/local%3Atest') return Promise.resolve(new Response(JSON.stringify({ skill: { id: 'local:test', name: 'test', scope: 'local' } })));
      if (url === '/api/skills/local%3Atest/files') return Promise.resolve(new Response(JSON.stringify({ primary: 'SKILL.md', files: [{ path: 'SKILL.md', kind: 'file', primary: true }] })));
      if (url === '/api/skills/local%3Atest/files/raw?path=SKILL.md') return Promise.resolve(new Response(JSON.stringify({ path: 'SKILL.md', content: '# test' })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/skills?section=files');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('技能控制台');
    expect(wrapper.find('.workflow-strip').exists()).toBe(false);
    expect(wrapper.text()).toContain('运行技能动作');
    expect(wrapper.text()).toContain('技能证据链');
    expect(wrapper.text()).toContain('技能选中详情');
    expect(wrapper.text()).toContain('SKILL.md');
    expect(wrapper.find('.markdown-body h1').text()).toBe('test');
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/local%3Atest/files/raw?path=SKILL.md', expect.any(Object));
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/skills/local%3Atest/files').length).toBe(1);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/skills/local%3Atest/files/raw?path=SKILL.md').length).toBe(1);
  });

  it('loads only the skill catalog on the catalog section', async () => {
    invalidateApiReadCache();
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/skills/catalog') {
        return Promise.resolve(new Response(JSON.stringify({
          items: [{ id: 'local:test', name: 'test', scope: 'local', status: 'ready', risk: 'review', tags: [] }],
        })));
      }
      if (url.startsWith('/api/sessions?')) {
        return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      }
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = await mountApp('/skills');
    await settleAsync();
    await settleAsync();

    expect(wrapper.text()).toContain('test');
    const skillRequests = fetchMock.mock.calls
      .map(([path]) => String(path))
      .filter((path) => path.startsWith('/api/skills/'));
    expect(skillRequests).toEqual(['/api/skills/catalog']);
  });

  it('rehydrates skill detail after selecting A, B, then A again', async () => {
    invalidateApiReadCache();
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/skills/catalog') {
        return Promise.resolve(new Response(JSON.stringify({
          items: [
            { id: 'local:a', name: 'Skill A', scope: 'local', status: 'ready', risk: 'low', tags: [] },
            { id: 'local:b', name: 'Skill B', scope: 'local', status: 'ready', risk: 'low', tags: [] },
          ],
        })));
      }
      if (url === '/api/skills/projection?surface=webui') {
        return Promise.resolve(new Response(JSON.stringify({ facets: {} })));
      }
      if (url === '/api/skills/local%3Aa') {
        return Promise.resolve(new Response(JSON.stringify({ skill: { id: 'local:a', name: 'Skill A detail', scope: 'local' } })));
      }
      if (url === '/api/skills/local%3Ab') {
        return Promise.resolve(new Response(JSON.stringify({ skill: { id: 'local:b', name: 'Skill B detail', scope: 'local' } })));
      }
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/skills');
    await settleAsync();

    await wrapper.vm.$router.push('/skills?section=projection');
    await settleAsync();
    expect(wrapper.text()).toContain('Skill A detail');
    await wrapper.vm.$router.push('/skills');
    await settleAsync();
    await wrapper.findAll('.skill-row').find((row) => row.text().includes('Skill B'))?.trigger('click');
    await wrapper.vm.$router.push('/skills?section=projection');
    await settleAsync();
    expect(wrapper.text()).toContain('Skill B detail');
    await wrapper.vm.$router.push('/skills');
    await settleAsync();
    await wrapper.findAll('.skill-row').find((row) => row.text().includes('Skill A'))?.trigger('click');
    await wrapper.vm.$router.push('/skills?section=projection');
    await settleAsync();
    expect(wrapper.text()).toContain('Skill A detail');
  });

  it('loads the active memory section without eagerly loading unrelated sections', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ version: 'test' })));
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/approval/config') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ files: [] })));
      if (url === '/api/memory/status') return Promise.resolve(new Response(JSON.stringify({
        enabled: true,
        status: 'degraded',
        kernel_health: {
          degraded: true,
          background_extraction: {
            pending_requests: 3,
            failed_requests: 2,
            last_error: 'extractor unavailable',
          },
        },
      })));
      if (url === '/api/memory/stats') return Promise.resolve(new Response(JSON.stringify({ total_entries: 1, entity_count: 1, triple_count: 1, vector_count: 1 })));
      if (url === '/api/memory/layers') return Promise.resolve(new Response(JSON.stringify({ layers: [{ layer: 'L2', entry_count: 1 }] })));
      if (url === '/api/memory/L2') return Promise.resolve(new Response(JSON.stringify({ enabled: true, entries: [{ id: 'mem-1', title: 'Line A fact', content: 'Torque deviation', tags: ['quality'], priority: 'High' }] })));
      if (url.startsWith('/api/memory/search')) return Promise.resolve(new Response(JSON.stringify({ results: [{ id: 'mem-1' }] })));
      if (url.startsWith('/api/memory/recall/explain')) return Promise.resolve(new Response(JSON.stringify({ total: 1, results: [{ id: 'mem-1', title: 'Line A fact', source_layer: 'L2', priority: 'High', score: 1, snippet: 'Torque deviation' }] })));
      if (url.startsWith('/api/memory/packet')) return Promise.resolve(new Response(JSON.stringify({ packet: { items: ['mem-1'] } })));
      if (url === '/api/memory/links') return Promise.resolve(new Response(JSON.stringify({ total: 1, links: [] })));
      if (url.startsWith('/api/memory/clusters')) return Promise.resolve(new Response(JSON.stringify({ clusters: [] })));
      if (url === '/api/memory/entities') return Promise.resolve(new Response(JSON.stringify({ entities: [{ id: 'line-a', name: 'Line A' }] })));
      if (url === '/api/memory/triples') return Promise.resolve(new Response(JSON.stringify({ triples: [{ subject: 'line-a', predicate: 'has_issue', object: 'torque' }] })));
      if (url.startsWith('/api/memory/symbol-links')) return Promise.resolve(new Response(JSON.stringify({ entries: [] })));
      if (url.startsWith('/api/memory/maintenance')) return Promise.resolve(new Response(JSON.stringify({ candidates: [] })));
      if (url === '/api/memory/performance') return Promise.resolve(new Response(JSON.stringify({ latency_ms: 2 })));
      if (url === '/api/memory/runtime') return Promise.resolve(new Response(JSON.stringify({ runtime: { active: true } })));
      if (url.startsWith('/api/cowd/structured/')) return Promise.resolve(new Response(JSON.stringify({ items: [] })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/memory');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('记忆图谱');
    expect(wrapper.text()).toContain('分层条目');
    expect(wrapper.text()).toContain('Line A fact');
    expect(wrapper.text()).toContain('结构化数据核心');
    expect(wrapper.text()).toContain('记忆选中证据');
    expect(wrapper.text()).toContain('3 条待处理 / 2 条失败');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/memory/recall/explain?q=manufacturing%20quality%20anomaly&limit=12', expect.any(Object));
    await wrapper.get('.search-field input').setValue('manufacturing quality anomaly');
    await wrapper.get('.search-field input').trigger('keyup.enter');
    await settleAsync();
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('Line A fact'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('证据下钻载荷');
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/recall/explain?q=manufacturing%20quality%20anomaly&limit=12', expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/cowd/structured/sources', expect.any(Object));
    await wrapper.get('[data-section-id="structured-core"]').trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/cowd/structured/sources', expect.any(Object));
  });

  it('keeps manual memory governance disabled while a nightly run is active', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/memory/status') {
        return Promise.resolve(new Response(JSON.stringify({
          enabled: true,
          status: 'ready',
          layers: [],
          automatic_governance_run: {
            run_id: 'nightly-1',
            mode: 'nightly',
            started_at: '2026-08-01T03:00:00Z',
          },
        })));
      }
      if (url.startsWith('/api/memory/maintenance')) {
        return Promise.resolve(new Response(JSON.stringify({
          enabled: true,
          running: true,
          candidates: [],
          automatic_governance_run: {
            run_id: 'nightly-1',
            mode: 'nightly',
            started_at: '2026-08-01T03:00:00Z',
          },
        })));
      }
      if (url === '/api/memory/knowledge/maintenance') {
        return Promise.resolve(new Response(JSON.stringify({ maintenance_candidates: [] })));
      }
      if (url === '/api/memory/performance') {
        return Promise.resolve(new Response(JSON.stringify({})));
      }
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = await mountApp('/memory?section=maintenance');
    await settleAsync();
    const button = wrapper.get('[data-section="maintenance"] button.primary-action');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.text()).toContain('治理运行中');
    expect(wrapper.text()).toContain('nightly');
    await button.trigger('click');
    expect(fetchMock.mock.calls.filter(([path, init]) => (
      String(path) === '/api/memory/maintenance'
      && (init as RequestInit | undefined)?.method === 'POST'
    )).length).toBe(0);
    wrapper.unmount();
  });

  it('loads agents workbench from real agent and task endpoints', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => {
      const url = String(path);
      if (url === '/api/webui/manifest') return Promise.resolve(new Response(JSON.stringify({ status: 'test' })));
      if (url.startsWith('/api/sessions?')) return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      if (url === '/api/config') return Promise.resolve(new Response(JSON.stringify({ version: 'test' })));
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/slash?surface=webui') return Promise.resolve(new Response(JSON.stringify({ commands: [] })));
      if (url === '/api/config/providers') return Promise.resolve(new Response(JSON.stringify({ providers: [], models: [] })));
      if (url === '/api/profiles') return Promise.resolve(new Response(JSON.stringify({ profiles: [], active_profile: 'default' })));
      if (url === '/api/workspace') return Promise.resolve(new Response(JSON.stringify({ workspace_root: '', workspace_canonical: '' })));
      if (url === '/api/approval/config') return Promise.resolve(new Response(JSON.stringify({})));
      if (url === '/api/workspace/files') return Promise.resolve(new Response(JSON.stringify({ files: [] })));
      if (url === '/api/agents/catalog') return Promise.resolve(new Response(JSON.stringify({ summary: { total: 1, active: 1 }, agents: [{ name: 'planner', active: true, source: { id: 'project_cowd' }, description: 'Plans work' }] })));
      if (url === '/api/agents/directory') return Promise.resolve(new Response(JSON.stringify({ summary: { total: 1, active: 1 }, agents: [{ name: 'planner', active: true, source: { id: 'project_cowd' }, description: 'Plans work' }] })));
      if (url === '/api/agents/self-models') return Promise.resolve(new Response(JSON.stringify({ items: [{ definition_id: 'workspace/cowd/planner', definition_revision: 1, environment_fingerprint: 'env', run_count: 3, success_count: 2, failure_count: 1, total_tool_calls: 4 }] })));
      if (url === '/api/agents/execution-graphs') return Promise.resolve(new Response(JSON.stringify({ graphs: [{ graph_id: 'agent-graph-task-1' }] })));
      if (url === '/api/team-templates') return Promise.resolve(new Response(JSON.stringify({ templates: [] })));
      if (url === '/api/tasks') return Promise.resolve(new Response(JSON.stringify({ tasks: [{ task_id: 'task-1', objective: 'Ship UI', status: 'running', revision: 1, phases: [] }] })));
      if (url === '/api/tasks/task-1/execution-graph') return Promise.resolve(new Response(JSON.stringify({ status: 'running', nodes: [{ id: 'planner', title: 'Plan', role: 'planner', status: 'ready', objective: 'Ship UI', depends_on: [] }] })));
      if (url === '/api/runtime/managed-agents') return Promise.resolve(new Response(JSON.stringify({
        definitions: [{
          managed_agent_id: 'workspace/cowd/cron-review',
          revision: 2,
          target: { kind: 'agent', definition_id: 'workspace/cowd/reviewer' },
          trigger: { kind: 'schedule', trigger: { cron: { expression: '0 * * * *', timezone: 'UTC' } } },
          session_id: 'managed:cron-review',
          objective: 'Review current evidence.',
          acceptance: ['evidence-backed result'],
          permission_lease: 'read_only',
          model_lease: 'default',
          granted_capabilities: ['read'],
          enabled: true,
        }],
        invocations: [{
          invocation_id: 'managed-invocation-1', definition_id: 'workspace/cowd/cron-review', definition_revision: 2,
          status: 'completed', attempt_no: 1, trigger: { kind: 'schedule', trigger: { cron: { expression: '0 * * * *', timezone: 'UTC' } } },
          execution_ref: 'execution:1', error: null,
        }],
        health: [{ managed_agent_id: 'workspace/cowd/cron-review', revision: 2, status: 'healthy', consecutive_failures: 0, max_consecutive_failures: 3, active_invocation_ids: [] }],
        effects: [{ effect_id: 'effect-1', invocation_id: 'managed-invocation-1', effect_kind: 'tool', status: 'completed', receipt_ref: 'receipt:1', error: null }],
      })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/agents');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('Agent 工作台');
    expect(wrapper.text()).toContain('Agent 图证据');
    expect(wrapper.text()).toContain('Agent 选中详情');
    expect(wrapper.text()).toContain('Agent 目录');
    expect(wrapper.text()).toContain('发现团队');
    expect(wrapper.text()).toContain('任务控制');
    expect(wrapper.text()).toContain('Agent 执行图');
    expect(wrapper.text()).toContain('受管 Agent');
    expect(wrapper.text()).toContain('Cron 调度');
    expect(wrapper.text()).toContain('围栏副作用');
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/catalog', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/directory', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/self-models', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1/execution-graph', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents', expect.any(Object));
    const trigger = wrapper.findAll('[data-section="managed-agents"] button').find((button) => button.text().includes('立即触发'));
    await trigger?.trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/managed-agents/workspace%2Fcowd%2Fcron-review/trigger', expect.objectContaining({ method: 'POST' }));
  });

  it('posts agent discovery and Team template instantiation through Runtime contracts', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: 'agents.assemble', team: {} }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.agentAssemble('build a review team');
    await api.instantiateTeamTemplate({
      request_id: 'webui-test',
      team_id: 'team-test',
      session_id: 'session-test',
      selection_mode: 'explicit',
      template_selector: { kind: 'latest_stable', template_id: 'builtin/cowd/execute-review' },
      objective: 'review implementation',
      permission_lease: 'read_only',
      model_lease: 'default',
    });
    await api.teamWorkingState('team-test');
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/assemble', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ task: 'build a review team' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/team-templates/instantiate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        request_id: 'webui-test',
        team_id: 'team-test',
        session_id: 'session-test',
        selection_mode: 'explicit',
        template_selector: { kind: 'latest_stable', template_id: 'builtin/cowd/execute-review' },
        objective: 'review implementation',
        permission_lease: 'read_only',
        model_lease: 'default',
      }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/teams/team-test/working-state', expect.any(Object));
  });
});
