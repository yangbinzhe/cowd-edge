import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import { api, capabilityPageEndpointsFromContract } from './api/client';
import ChatPage from './pages/ChatPage.vue';
import AgentsPage from './pages/AgentsPage.vue';
import AuditPage from './pages/AuditPage.vue';
import MemoryPage from './pages/MemoryPage.vue';
import RealityCorePage from './pages/RealityCorePage.vue';
import RuntimePage from './pages/RuntimePage.vue';
import ContextPage from './pages/ContextPage.vue';
import GatewayPage from './pages/GatewayPage.vue';
import MissionControlPage from './pages/MissionControlPage.vue';
import MfgPage from './pages/MfgPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import SkillsPage from './pages/SkillsPage.vue';
import SurfacePage from './pages/SurfacePage.vue';
import ToolsPage from './pages/ToolsPage.vue';
import { pluginRoutes, webuiPagePlugins } from './plugins/registry';
import { useAppStore } from './stores/app';
import { useProjectionRegistryStore } from './stores/projectionRegistry';
import mfgWriteContracts from './data/mfgWriteContracts.json';
import { cleanAssistantContent, collapseRepeatedText } from './utils/chatContent';
import { activitySummary, mergeTurnActivity } from './utils/turnSettlement';
import { createWorkspaceRoot, mergeWorkspaceTreeChildren } from './utils/workspaceTree';
import { isWorkspaceTextPreview, workspacePreviewKind } from './utils/workspacePreview';

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
vi.mock('vue-echarts', () => ({ default: { template: '<div class="chart"></div>' } }));

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
      { path: '/mfg', component: MfgPage },
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settle();
}

describe('Cowd Vue WebUI shell', () => {
  it('registers MFG as a pluggable page without a legacy nav item', async () => {
    const plugin = webuiPagePlugins.find((item) => item.id === 'mfg');
    expect(plugin).toBeTruthy();
    expect(plugin?.route).toBe('/apps/mfg');
    expect(plugin?.apiNamespace).toBe('/api/apps/mfg');
    expect(plugin?.requiredCapabilities).toContain('cowd.matrix.runtime');

    const wrapper = await mountApp('/chat');
    const railButtons = wrapper.findAll('.rail-button');
    expect(railButtons.some((button) => button.attributes('aria-label') === 'MFG')).toBe(true);
    const legacyLabel = ['IA', 'CC'].join('');
    expect(railButtons.some((button) => button.attributes('aria-label') === legacyLabel)).toBe(false);
  });

  it('keeps Workspace out of the left rail and inside the right companion panel', async () => {
    const wrapper = await mountApp('/chat');
    const rail = wrapper.get('.rail').text();
    expect(rail).not.toContain('工作区');
    expect(wrapper.get('.companion-tabs').text()).toContain('活动');
    expect(wrapper.get('.companion-tabs').text()).toContain('思考');
    expect(wrapper.get('.companion-tabs').text()).toContain('工作区');
    expect(wrapper.get('.companion-tabs').text()).toContain('证据');
    expect(wrapper.get('.companion-tabs').text()).toContain('检查器');
  });

  it('renders chat, composer, mode controls, markdown body, and bottom context stats', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    expect(wrapper.get('.transcript').exists()).toBe(true);
    expect(wrapper.get('.composer textarea').exists()).toBe(true);
    expect(wrapper.get('.context-ring').exists()).toBe(true);
    expect(wrapper.get('.mode-switch').text()).toContain('全景');
    expect(wrapper.find('.run-panorama').exists()).toBe(false);
    expect(wrapper.get('.composer-stats').text()).toContain('工具调用');
    expect(wrapper.get('.companion-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('上下文');
    expect(wrapper.text()).toContain('上下文 —');
    expect(wrapper.get('.chat-page').exists()).toBe(true);
  });

  it('keeps mobile Chat panorama usable by collapsing companion until requested', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const wrapper = await mountApp('/chat');
    await settle();
    expect(wrapper.get('.chat-page').exists()).toBe(true);
    expect(wrapper.find('.companion-panel').exists()).toBe(false);
    expect(wrapper.find('.companion-toggle').exists()).toBe(true);
    await wrapper.get('.companion-toggle').trigger('click');
    await settle();
    expect(wrapper.find('.companion-panel').exists()).toBe(true);
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

  it('switches Chat into clean mode and keeps stats in the composer footer', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.currentTimeline = { events: [{ kind: 'ToolStart' }, { kind: 'ToolComplete' }, { kind: 'memory_recall' }] };
    store.currentRealityFlow = { stages: [{ kind: 'memory.promoted' }, { kind: 'memory.held' }, { kind: 'context.fact' }] };
    await wrapper.findAll('.mode-switch button').find((button) => button.text() === '纯净')?.trigger('click');
    await settle();
    expect(store.chatDisplayMode).toBe('clean');
    expect(wrapper.find('.run-panorama').exists()).toBe(false);
    expect(wrapper.find('.companion-panel').exists()).toBe(false);
    expect(wrapper.find('.clean-counts').exists()).toBe(false);
    expect(wrapper.get('.composer-stats').text()).toContain('工具调用');
    expect(wrapper.get('.composer-stats').text()).toContain('记忆唤起');
    expect(wrapper.get('.composer-stats').text()).toContain('记忆证据');
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
      status: index === 0 ? 'running' : 'complete',
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
    store.markSessionViewed('session-0');
    expect(store.isSessionUnread(store.sessions[0])).toBe(false);
    wrapper.unmount();
  });

  it('renders Workspace file tree controls and Inspector tab from real store state', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    store.workspaceFiles = [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }];
    store.workspaceTreeRoot = mergeWorkspaceTreeChildren(createWorkspaceRoot(), '', store.workspaceFiles, new Set(['']));
    store.openCompanion('workspace');
    await settle();
    expect(wrapper.find('.workspace-tree').exists()).toBe(true);
    expect(wrapper.find('.workspace-tree-node').text()).toContain('a.md');
    await wrapper.get('button[aria-label="a.md 更多操作"]').trigger('click');
    await settle();
    expect(wrapper.find('.workspace-context-menu').exists()).toBe(true);
    expect(wrapper.find('.workspace-context-menu').text()).toContain('重命名');
    store.openCompanion('inspector');
    await settle();
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
    await settle();
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
    await settle();
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
    await settle();
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
    const files = [{ name: 'huge.md', path: 'docs/huge.md', kind: 'file' as const, size: 700 * 1024 }];
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
    await settle();
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
    const wrapper = await mountApp('/gateway');
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

  it('derives capability endpoint probes from Gateway Capability Contract safely', () => {
    const contract: any = {
      kind: 'gateway.capability_contract',
      schema_version: 1,
      owner: 'gateway',
      source: 'test',
      route_count: 7,
      capability_count: 7,
      coverage: {
        route_count: 7,
        capability_count: 7,
        p1_count: 2,
        ai_visible_count: 4,
        openapi_path_count: 6,
        openai_tool_count: 2,
        route_contract_parity: true,
      },
      capabilities: [
        { id: 'runtime-status', domain: 'runtime', title: 'Runtime status', http: { method: 'GET', path: '/api/runtime/status', criticality: 'p1' }, risk: 'read', surface_visibility: { webui: true } },
        { id: 'runtime-post', domain: 'runtime', title: 'Runtime write', http: { method: 'POST', path: '/api/runtime/turns', criticality: 'p1' }, risk: 'write', surface_visibility: { webui: true } },
        { id: 'hidden', domain: 'runtime', title: 'Hidden runtime', http: { method: 'GET', path: '/api/runtime/hidden' }, risk: 'read', surface_visibility: { webui: false } },
        { id: 'raw', domain: 'runtime', title: 'Raw runtime', http: { method: 'GET', path: '/api/runtime/raw' }, risk: 'read', surface_visibility: { webui: true } },
        { id: 'download', domain: 'runtime', title: 'Download runtime', http: { method: 'GET', path: '/api/runtime/download' }, risk: 'read', surface_visibility: { webui: true } },
        { id: 'session', domain: 'context', title: 'Session context', http: { method: 'GET', path: '/api/sessions/:id/context' }, risk: 'read', surface_visibility: { webui: true } },
        { id: 'unknown-param', domain: 'runtime', title: 'Unknown param', http: { method: 'GET', path: '/api/runtime/:run_id/detail' }, risk: 'read', surface_visibility: { webui: true } },
      ],
    };

    const runtime = capabilityPageEndpointsFromContract(contract, 'runtime', 'session-1');
    expect(runtime.map((item) => item[1])).toEqual(['/api/runtime/status']);
    const context = capabilityPageEndpointsFromContract(contract, 'context', 'session-1');
    expect(context.map((item) => item[1])).toContain('/api/sessions/session-1/context');
  });

  it('loads Gateway contract projections during WebUI boot', async () => {
    const calls: string[] = [];
    vi.mocked(fetch).mockImplementation((url: any) => {
      const path = String(url);
      calls.push(path);
      if (path.includes('/api/gateway/capability-contract')) {
        return Promise.resolve(new Response(JSON.stringify({
          kind: 'gateway.capability_contract',
          schema_version: 1,
          owner: 'gateway',
          source: 'test',
          route_count: 1,
          capability_count: 1,
          coverage: {
            route_count: 1,
            capability_count: 1,
            p1_count: 1,
            ai_visible_count: 1,
            openapi_path_count: 1,
            openai_tool_count: 1,
            route_contract_parity: true,
          },
          capabilities: [
            { id: 'gateway.test', domain: 'gateway', title: 'Gateway test', http: { method: 'GET', path: '/api/gateway/test' }, risk: 'read', surface_visibility: { webui: true } },
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
    const wrapper = await mountApp('/gateway');
    await settleAsync();
    const store = useAppStore();
    expect(store.gatewayCapabilityContract?.coverage.route_contract_parity).toBe(true);
    expect(store.gatewayOpenAiTools?.tool_count).toBe(1);
    expect(calls.some((path) => path.includes('/api/gateway/capability-contract'))).toBe(true);
    expect(calls.some((path) => path.includes('/api/gateway/openapi.json'))).toBe(true);
    expect(calls.some((path) => path.includes('/api/gateway/openai-tools'))).toBe(true);
    expect(wrapper.text()).toContain('Gateway 能力合同');
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
    await api.evolutionCreateSignal({ signal_type: 'slow_progress', summary: 'slow', source: { owner: 'test' }, severity: 'warning', suggested_action: 'review' });
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
    await api.evolutionCreateCandidate({ candidate_id: 'candidate-1', subject: { kind: 'agent_definition' }, baseline_revision: 1, evaluation_contract_digest: 'sha256:test', source_evidence_refs: ['eval:1'], protected_dimensions: ['policy'] });
    await api.evolutionCandidateCanaryReview('candidate-1');
    await api.evolutionCandidateStableReview('candidate-1');
    await api.evolutionReviews();
    await api.evolutionReview('review-1');
    await api.evolutionCreateReleaseReview({ request_id: 'rollback-1', subject: { kind: 'agent_definition' }, action: 'rollback', selector: { kind: 'exact_approved_revision', revision: 1 }, evidence_refs: ['run:1'] });
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

    const wrapper = mount(AuditPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
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

  it('keeps independent execution streams and merges detail scope per projection', async () => {
    const urls: string[] = [];
    const closed: string[] = [];
    class FakeEventSource {
      constructor(readonly url: string) { urls.push(url); }
      addEventListener() {}
      close() { closed.push(this.url); }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ execution_id: 'exec-1', cursor: 0 }), { status: 200 }))));
    setActivePinia(createPinia());
    const registry = useProjectionRegistryStore();
    registry.acquire('exec-1', 'chat:session-1', 'summary');
    registry.acquire('exec-1', 'mission', 'full');
    registry.release('mission');
    registry.acquire('exec-2', 'agents', 'full');
    expect(urls).toEqual([
      '/api/runtime/executions/exec-1/events?cursor=0&detail_scope=summary',
      '/api/runtime/executions/exec-1/events?cursor=0&detail_scope=full',
      '/api/runtime/executions/exec-1/events?cursor=0&detail_scope=summary',
      '/api/runtime/executions/exec-2/events?cursor=0&detail_scope=full',
    ]);
    expect(closed).toHaveLength(2);
    registry.release('chat:session-1');
    registry.release('agents');
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
      resource: { id: 'res-1', uri: 'resource://res-1', original_name: 'voice.mp3', kind: 'audio', size_bytes: 3, sha256: 'sha256:test', storage_path: '/tmp/voice.mp3', source: 'webui', created_at: 'now' },
    }), { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.uploadResource(new File(['mp3'], 'voice.mp3', { type: 'audio/mpeg' }), 'session-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/resources', expect.objectContaining({ method: 'POST' }));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
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
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ cancelled: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const receipt = await api.cancelSessionTurn('session-1');
    expect(receipt.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/cancel', expect.objectContaining({ method: 'POST' }));
  });

  it('reads Mission Control projections through gateway endpoints', async () => {
    const fetchMock = vi.fn((path: RequestInfo | URL) => Promise.resolve(new Response(JSON.stringify({
      mission: {
        active_session_id: 'mission-a',
        sessions: [{ session_id: 'mission-a', title: 'Mission A', status: 'active' }],
        events: [],
        approval_projection: { pending_count: 1 },
        relation_projection: { relation_count: 2 },
      },
      approvals: { pending_count: 1, requests: [] },
      relations: { relation_count: 2, relations: [] },
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

    await api.startMissionTeamRuntime('mission-a', 'inspect runtime evidence', 'register_only');
    await api.interpretMissionCommand({
      current_session_id: 'mission-a',
      target_ref: 'mission-b',
      command_text: 'summarize blockers',
      execute: true,
    });
    await api.decideMissionApproval('approval-1', false, 'unsafe');
    await api.runtimeRecoveryReport();
    await api.applyRuntimeRecovery();

    expect(fetchMock).toHaveBeenCalledWith('/api/mission/sessions/mission-a/teams/runtime', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ objective: 'inspect runtime evidence', execution_mode: 'register_only' }),
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
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/branch', expect.objectContaining({ method: 'POST' }));
  });

  it('calls critical MFG write endpoints with explicit request bodies', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.mfgSourcePackUpsert({ source_pack_id: 'sp-1' });
    await api.mfgEntityUpsert({ entity_id: 'entity-1' });
    await api.mfgRelationUpsert({ relation_type: 'feeds' });
    await api.mfgComputeJobRun('job-1');
    await api.mfgExecuteAction('analysis-1', 'action-1', { mode: 'dry_run' });
    await api.mfgExecutionBridge('exec-1', { mode: 'dry_run' });
    await api.mfgRetryReportDelivery('report-1', { mode: 'dry_run' });
    await api.mfgIngestFact([{ fact_type: 'quality', source_ref: 'source-pack://sp-1' }]);
    await api.mfgSeedDomain();
    await api.mfgSeedOntology();
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/source-packs/upsert', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/entities/upsert', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/relations/upsert', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/compute/jobs/job-1/run', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/analyses/analysis-1/actions/action-1/execute', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/executions/exec-1/cross-plane/execute', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/cockpit/reports/report-1/delivery/retry', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/facts/ingest', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/domain/server-manufacturing/seed', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/ontology/server-manufacturing/seed', expect.objectContaining({ method: 'POST' }));
  });

  it('calls real MFG incident and cockpit report endpoints', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: 'test.receipt' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.mfgCreateIncident({ title: 'Line A deviation' });
    await api.mfgAnalyzeIncident('incident-1');
    await api.mfgSkills();
    await api.mfgGenerateReport('profile-1', { cadence: 'daily' });
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/incidents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: 'Line A deviation' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/incidents/incident-1/analyze', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/skills', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/cockpit/profiles/profile-1/reports/generate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ report: { cadence: 'daily' } }),
    }));
  });

  it('renders MFG governed action chains from the write contract source', async () => {
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
      if (url === '/api/apps/mfg/reality/health') return Promise.resolve(new Response(JSON.stringify({ status: 'ready', fact_count: 2, schema_version: 'test' })));
      if (url === '/api/apps/mfg/reality/metrics') return Promise.resolve(new Response(JSON.stringify({ metrics: [{ metric_id: 'torque_deviation_rate', name: 'Torque deviation', unit: '%' }] })));
      if (url === '/api/apps/mfg/reality/entities') return Promise.resolve(new Response(JSON.stringify({ entities: [{ entity_id: 'line-a', entity_type: 'manufacturing_line', canonical_key: 'line:A', display_name: 'Line A' }] })));
      if (url === '/api/apps/mfg/decision-trace') return Promise.resolve(new Response(JSON.stringify({
        kind: 'mfg.decision_trace',
        chain: 'source -> fact -> metric -> evidence -> incident -> action -> report',
        rows: [
          { stage: 'source', ref: 'source-pack://line-a', domain: 'Matrix data plane', signal: 'mes', next: 'fact' },
          { stage: 'fact', ref: 'fact-1', domain: 'cowd structured core', signal: 'manufacturing_quality_event', next: 'metric' },
          { stage: 'action', ref: 'action-1', domain: 'MFG + cross-plane', signal: 'recommended', next: 'report' },
        ],
      })));
      if (url === '/api/apps/mfg/incidents') return Promise.resolve(new Response(JSON.stringify({ items: [{ incident_id: 'incident-1', title: 'Line A deviation' }] })));
      if (url === '/api/apps/mfg/skills') return Promise.resolve(new Response(JSON.stringify({ items: [{ skill_id: 'skill-1', name: 'Root cause analysis' }] })));
      if (url === '/api/apps/mfg/incidents/incident-1/room') return Promise.resolve(new Response(JSON.stringify({ analysis: { recommended_actions: [{ action_id: 'action-1', title: 'Notify QA' }] }, executions: [] })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/mfg');
    await settleAsync();
    await settleAsync();
    const domains = new Set((mfgWriteContracts as any[]).map((contract) => contract.domain));
    expect(domains).toEqual(new Set(['Cockpit', 'Data Plane', 'Entities', 'Evidence', 'Facts', 'Incidents', 'Metrics']));
    expect(wrapper.findAll('.governed-action-panel').length).toBeGreaterThanOrEqual(7);
    expect(wrapper.text()).toContain('现实输入');
    expect(wrapper.text()).toContain('现实核心投影');
    expect(wrapper.text()).toContain('/api/apps/mfg/reality/*');
    expect(wrapper.text()).toContain('现实核心管理事实、记忆、矩阵');
    expect(wrapper.text()).toContain('MFG 管理制造工作流');
    expect(wrapper.text()).not.toContain('打开现实核心');
    expect(wrapper.text()).toContain('源数据包写入');
    expect(wrapper.text()).toContain('制造事实摄入');
    expect(wrapper.text()).toContain('指标计算运行');
    expect(wrapper.text()).toContain('决策链路');
    expect(wrapper.text()).toContain('source -> fact -> metric -> evidence -> incident -> action -> report');
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/decision-trace', expect.any(Object));
    expect(wrapper.text()).toContain('Matrix 将结构化制造信号转化为事实');
    expect(wrapper.text()).toContain('cowd structured core');
    expect(wrapper.text()).toContain('MFG + cross-plane');
    const dataPlane = wrapper.get('[data-section="data-plane"]');
    await dataPlane.get('input').setValue('source-pack-real');
    await dataPlane.get('button[data-mfg-risk="mfgSourcePackUpsert"]').trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/reality/source-packs/upsert', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ source_pack: { source_pack_id: 'source-pack-real' }, session_id: 'webui-mfg' }),
    }));
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
      if (url === '/api/runtime/control-plane') return Promise.resolve(new Response(JSON.stringify({ configured_model: 'DeepSeek-v4-flash', provider_count: 1, provider_model_count: 2 })));
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
      if (url === '/api/tasks') return Promise.resolve(new Response(JSON.stringify({ tasks: [{ id: 'task-1', status: 'done', objective: 'align webui', current_phase: 'review' }] })));
      if (url === '/api/growth/status') return Promise.resolve(new Response(JSON.stringify({ status: 'ready', event_count: 1, promotion_count: 1, sources: { risk_gate: 1 } })));
      if (url === '/api/growth/events') return Promise.resolve(new Response(JSON.stringify({
        events: [{ id: 'growth-1', source_event_kind: 'risk_gate', selected_mode: 'promote', risk: 'low', created_at: '2026-06-21T00:00:00Z' }],
        promotions: [{ target: 'memory', status: 'accepted', target_id: 'mem-1', summary: 'promoted stable lesson' }],
      })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/runtime');
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
    expect(wrapper.text()).toContain('Need tool access');
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
    expect(fetchMock).toHaveBeenCalledWith('/api/cross-plane/action/execute', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action, mode: 'dry_run', idempotency_key: 'key-1' }),
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
    const wrapper = await mountApp('/skills');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('技能控制台');
    expect(wrapper.find('.workflow-strip').exists()).toBe(false);
    expect(wrapper.text()).toContain('运行技能动作');
    expect(wrapper.text()).toContain('技能证据链');
    expect(wrapper.text()).toContain('技能选中详情');
    expect(wrapper.text()).toContain('SKILL.md');
    expect(wrapper.find('.markdown-body h1').text()).toBe('test');
    await wrapper.find('.run-list article').trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/runs/run-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/local%3Atest/files/raw?path=SKILL.md', expect.any(Object));
  });

  it('loads memory graph workbench from real memory and structured-data endpoints', async () => {
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
      if (url === '/api/memory/status') return Promise.resolve(new Response(JSON.stringify({ enabled: true, status: 'ready', kernel_health: { degraded: false } })));
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
    expect(fetchMock).not.toHaveBeenCalledWith('/api/memory/recall/explain?q=manufacturing%20quality%20anomaly&limit=12', expect.any(Object));
    await wrapper.get('.search-field input').setValue('manufacturing quality anomaly');
    await wrapper.get('.search-field input').trigger('keyup.enter');
    await settleAsync();
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('Line A fact'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('证据下钻载荷');
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/recall/explain?q=manufacturing%20quality%20anomaly&limit=12', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/cowd/structured/sources', expect.any(Object));
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
      if (url === '/api/tasks') return Promise.resolve(new Response(JSON.stringify({ current: { id: 'task-1', objective: 'Ship UI', status: 'open', phases: [] }, tasks: [{ id: 'task-1', objective: 'Ship UI', status: 'open', phases: [] }] })));
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
