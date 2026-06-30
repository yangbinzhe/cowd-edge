import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import { api } from './api/client';
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
import mfgWriteContracts from './data/mfgWriteContracts.json';

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
    expect(rail).not.toContain('Workspace');
    expect(wrapper.get('.companion-tabs').text()).toContain('Activity');
    expect(wrapper.get('.companion-tabs').text()).toContain('Thinking');
    expect(wrapper.get('.companion-tabs').text()).toContain('Workspace');
    expect(wrapper.get('.companion-tabs').text()).toContain('Evidence');
    expect(wrapper.get('.companion-tabs').text()).toContain('Inspector');
  });

  it('renders chat, composer, panorama controls, markdown body, and context meter', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    expect(wrapper.get('.transcript').exists()).toBe(true);
    expect(wrapper.get('.composer textarea').exists()).toBe(true);
    expect(wrapper.get('.context-meter').exists()).toBe(true);
    expect(wrapper.get('.mode-switch').text()).toContain('全景');
    expect(wrapper.get('.run-panorama').exists()).toBe(true);
    expect(wrapper.get('.companion-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('Context not reported');
    expect(wrapper.get('.chat-page').exists()).toBe(true);
  });

  it('switches Chat into clean mode and hides panorama projections', async () => {
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
    expect(wrapper.get('.clean-counts').text()).toContain('工具调用');
    expect(wrapper.get('.clean-counts').text()).toContain('记忆唤起');
    expect(wrapper.get('.clean-counts').text()).toContain('记忆证据');
  });

  it('opens a Chat turn evidence drawer from current session projections', async () => {
    const wrapper = await mountApp('/chat');
    await settle();
    const store = useAppStore();
    store.turns = [{ id: 'turn-1', role: 'assistant', content: 'Done', status: 'complete', tool_name: 'workspace.read' }];
    store.currentTimeline = {
      events: [
        { kind: 'tool.call', status: 'complete', detail: 'workspace.read docs/a.md' },
        { kind: 'memory.recall', status: 'complete', detail: 'memory://m1' },
        { kind: 'approval.policy', status: 'ready', detail: 'low risk' },
      ],
    };
    store.currentRealityFlow = { stages: [{ kind: 'memory.promotion', status: 'accepted', summary: 'stable fact' }] };
    store.attachments = [{ ref_id: 'att-1', kind: 'workspace_file', path: 'docs/a.md', label: 'A', size: 1, sha256: 'hash', added_at_ms: 1 }];
    await settle();
    await wrapper.get('.message-meta button').trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('Turn evidence');
    expect(wrapper.text()).toContain('Session/currentRun projection');
    expect(wrapper.text()).toContain('workspace.read');
    expect(wrapper.text()).toContain('docs/a.md');
    expect(store.selectedTurnEvidence?.summary.map((item: any) => item.label)).toContain('Tools');
  });

  it('renders Workspace rename controls and Inspector tab from real store state', async () => {
    const wrapper = await mountApp('/chat');
    await settleAsync();
    const store = useAppStore();
    store.workspaceFiles = [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }];
    store.openCompanion('workspace');
    await settle();
    await wrapper.get('button[aria-label="Rename a.md"]').trigger('click');
    await settle();
    expect(wrapper.find('.rename-row').exists()).toBe(true);
    expect(wrapper.find('.rename-row input').element.value).toBe('docs/a.md');
    store.openCompanion('inspector');
    await settle();
    expect(wrapper.text()).toContain('Inspector');
    expect(wrapper.text()).toContain('Context');
  });

  it('renders tools management page with real registry controls', async () => {
    const wrapper = await mountApp('/tools');
    await settle();
    expect(wrapper.text()).toContain('Tools Registry');
    expect(wrapper.text()).toContain('Tool operation flow');
    expect(wrapper.findAll('.metric-card').length).toBe(4);
    expect(wrapper.find('.capability-sidebar').exists()).toBe(true);
    expect(wrapper.find('.session-sidebar').exists()).toBe(false);
    expect(wrapper.findAll('.section-row').length).toBe(7);
    expect(wrapper.text()).toContain('Execution planner');
    expect(wrapper.text()).toContain('Mutation transactions');
    expect(wrapper.text()).toContain('Apply workspace mutation');
    expect(wrapper.text()).toContain('Checkpoints');
    expect(wrapper.text()).toContain('Restore checkpoint');
    expect(wrapper.text()).toContain('Tool cache');
    expect(wrapper.text()).toContain('Tool ledger');
    expect(wrapper.text()).toContain('Risk preflight');
    expect(wrapper.find('.capability-sidebar').text()).not.toContain('Memory');
    expect(wrapper.find('.capability-sidebar').text()).not.toContain('Settings');
  });

  it('renders gateway governance panels and evidence surfaces', async () => {
    const wrapper = await mountApp('/gateway');
    await settle();
    expect(wrapper.text()).toContain('Gateway and Cross-plane');
    expect(wrapper.text()).toContain('Promote connector resource to memory');
    expect(wrapper.text()).toContain('Execute cross-plane action');
    expect(wrapper.text()).toContain('Manage cross-plane identity');
    expect(wrapper.text()).toContain('Create cross-plane grant');
    expect(wrapper.text()).toContain('Gateway evidence trace');
    expect(wrapper.text()).toContain('Gateway selected detail');
    expect(wrapper.text()).toContain('Gateway remediation');
  });

  it('renders context workbench evidence and detail surfaces', async () => {
    const wrapper = await mountApp('/context');
    await settle();
    expect(wrapper.text()).toContain('Context Builder');
    expect(wrapper.text()).toContain('Context assembly flow');
    expect(wrapper.text()).toContain('Context evidence trace');
    expect(wrapper.text()).toContain('Context selected detail');
  });

  it('renders audit workbench evidence and selected detail surfaces', async () => {
    const wrapper = await mountApp('/audit');
    await settle();
    expect(wrapper.text()).toContain('Audit and Governance');
    expect(wrapper.text()).toContain('Evidence flow');
    expect(wrapper.text()).toContain('GlobalTimeline');
    expect(wrapper.text()).toContain('Harness Eval');
    expect(wrapper.text()).toContain('Audit evidence trace');
    expect(wrapper.text()).toContain('Audit selected evidence');
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
    await api.harnessEvalRunSmoke();
    await api.harnessEvalCancelRun('run-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/reports/latest', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/reports', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/reports/report-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/scenarios', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs/run-1', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/harness-eval/runs/run-1/cancel', expect.objectContaining({ method: 'POST' }));
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

  it('marks HTML API fallback as offline instead of successful data', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const manifest = await api.health();
    expect(manifest.__offline).toBe(true);
    expect(manifest.__error).toContain('Expected JSON');
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

  it('writes Mission Control operations with gateway contracts', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await api.startMissionTeamRuntime('mission-a', 'inspect runtime evidence', 'register_only');
    await api.routeMissionCommand({
      from_session_id: 'mission-a',
      target_ref: 'mission-b',
      command: 'summarize blockers',
    });
    await api.consumeMissionSessionCommand('mission-b', 'command-1', 'start_turn');
    await api.decideMissionApproval('approval-1', false, 'unsafe');
    await api.stewardScheduler();
    await api.tickStewardScheduler();
    await api.stewardHandoff('steward-1');
    await api.runtimeRecoveryReport();
    await api.applyRuntimeRecovery();

    expect(fetchMock).toHaveBeenCalledWith('/api/mission/sessions/mission-a/teams/runtime', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ objective: 'inspect runtime evidence', execution_mode: 'register_only' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/route', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        from_session_id: 'mission-a',
        target_ref: 'mission-b',
        command: 'summarize blockers',
      }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/sessions/mission-b/inbox/command-1/consume', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ mode: 'start_turn' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/approvals/approval-1/decision', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ approved: false, decided_by: 'webui', reason: 'unsafe' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/control/stewards/scheduler', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/control/stewards/scheduler', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/control/stewards/steward-1/handoff', expect.any(Object));
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
    expect(wrapper.text()).toContain('MFG value flow');
    expect(wrapper.text()).toContain('Reality Core projection');
    expect(wrapper.text()).toContain('/api/apps/mfg/reality/*');
    expect(wrapper.text()).toContain('Reality Core owns fact, memory, matrix');
    expect(wrapper.text()).toContain('MFG owns manufacturing workflows');
    expect(wrapper.text()).not.toContain('Open Reality Core');
    expect(wrapper.text()).toContain('Source pack upsert');
    expect(wrapper.text()).toContain('Manufacturing fact ingest');
    expect(wrapper.text()).toContain('Metric compute run');
    expect(wrapper.text()).toContain('Decision Trace');
    expect(wrapper.text()).toContain('source -> fact -> metric -> evidence -> incident -> action -> report');
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/mfg/decision-trace', expect.any(Object));
    expect(wrapper.text()).toContain('Matrix turns structured manufacturing signals');
    expect(wrapper.text()).toContain('cowd structured core');
    expect(wrapper.text()).toContain('MFG + cross-plane');
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
    await wrapper.findAll('button.ghost-action').find((button) => button.text().includes('Verify gateway access'))?.trigger('click');
    await settleAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify', expect.any(Object));
    expect(wrapper.text()).toContain('same-origin internal access');
    expect(wrapper.text()).toContain('Configuration flow');
    expect(wrapper.text()).toContain('Save runtime model config');
    expect(wrapper.text()).toContain('Update approval policy');
    expect(wrapper.text()).toContain('Settings write receipt');
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
    expect(wrapper.text()).toContain('Growth loop');
    expect(wrapper.text()).toContain('Mission Control');
    expect(wrapper.text()).toContain('Mission A');
    expect(wrapper.text()).toContain('Runtime flow');
    expect(wrapper.text()).toContain('risk_gate');
    expect(wrapper.text()).toContain('memory');
    expect(wrapper.text()).toContain('Runtime selected evidence');
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('risk_gate'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('Evidence drill-down payload');
    expect(fetchMock).toHaveBeenCalledWith('/api/growth/status', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/growth/events', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/mission/control', expect.any(Object));
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
    expect(wrapper.text()).toContain('Reality Core');
    expect(wrapper.text()).toContain('Evidence object detail');
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('stable fact'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('Reality selected evidence');
    expect(wrapper.text()).toContain('memory.promotion');
    expect(wrapper.text()).toContain('Evidence drill-down payload');
  });

  it('renders Mission Control governed previews before stewardship and recovery writes', async () => {
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
    expect(wrapper.text()).toContain('Governed actions');
    expect(wrapper.text()).toContain('Dispatch session inbox');
    expect(wrapper.text()).toContain('Runtime recovery');
    expect(wrapper.text()).toContain('Need tool access');
    expect(wrapper.get('button.danger-action[disabled]').text()).toContain('Apply recovery');
    await wrapper.findAll('button.ghost-action').find((button) => button.text().includes('Load steward state'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('Steward scheduler state');
    await wrapper.findAll('button.ghost-action').find((button) => button.text().includes('Load recovery report'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('Runtime recovery report');
    expect(wrapper.text()).toContain('mission-a');
    await wrapper.findAll('button.danger-action').find((button) => button.text().includes('Apply recovery'))?.trigger('click');
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
    await api.channels();
    await api.channelStatus('webui');
    await api.channelRepair('webui');

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
    expect(fetchMock).toHaveBeenCalledWith('/api/channels', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/channels/webui/status', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/channels/webui/repair', expect.objectContaining({ method: 'POST' }));
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
      if (url === '/api/surfaces/webui/deliveries') return Promise.resolve(new Response(JSON.stringify({ kind: 'surface.deliveries', deliveries: [{ kind: 'outbox.retry_scheduled', status: 'retry_scheduled', delivery_id: 'delivery-1', message_id: 'msg-1', created_at_ms: 1 }] })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/surfaces');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('Surface Host');
    expect(wrapper.text()).toContain('Surface registry');
    expect(wrapper.text()).toContain('Surface diagnostic playbook');
    expect(wrapper.text()).toContain('Surface lifecycle');
    expect(wrapper.text()).toContain('WebUI');
    expect(wrapper.text()).toContain('Routes');
    expect(wrapper.text()).toContain('Resources');
    expect(wrapper.text()).toContain('Dispatch');
    expect(wrapper.text()).toContain('Reliable delivery');
    expect(wrapper.text()).toContain('Events');
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/events', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/inbox', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/surfaces/webui/outbox', expect.any(Object));
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
    expect(wrapper.text()).toContain('Skills Console');
    expect(wrapper.text()).toContain('Skill lifecycle');
    expect(wrapper.text()).toContain('Run skill action');
    expect(wrapper.text()).toContain('Skill evidence trace');
    expect(wrapper.text()).toContain('Skill selected detail');
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
    expect(wrapper.text()).toContain('Memory Graph');
    expect(wrapper.text()).toContain('Layer entries');
    expect(wrapper.text()).toContain('Line A fact');
    expect(wrapper.text()).toContain('Structured data core');
    expect(wrapper.text()).toContain('Memory selected evidence');
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('Line A fact'))?.trigger('click');
    await settleAsync();
    expect(wrapper.text()).toContain('Evidence drill-down payload');
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
      if (url === '/api/agents/reputation') return Promise.resolve(new Response(JSON.stringify({ items: [{ agent_id: 'planner', reputation: 91, status: 'active' }] })));
      if (url === '/api/agents/runs') return Promise.resolve(new Response(JSON.stringify({ runs: [{ graph_id: 'agent-graph-task-1' }] })));
      if (url === '/api/tasks') return Promise.resolve(new Response(JSON.stringify({ current: { id: 'task-1', objective: 'Ship UI', status: 'open', phases: [] }, tasks: [{ id: 'task-1', objective: 'Ship UI', status: 'open', phases: [] }] })));
      if (url === '/api/tasks/task-1/agent-graph') return Promise.resolve(new Response(JSON.stringify({ status: 'running', nodes: [{ id: 'planner', title: 'Plan', role: 'planner', status: 'ready', objective: 'Ship UI', depends_on: [] }] })));
      return Promise.resolve(new Response(JSON.stringify({})));
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountApp('/agents');
    await settleAsync();
    await settleAsync();
    expect(wrapper.text()).toContain('Agents Workbench');
    expect(wrapper.text()).toContain('Agent graph evidence');
    expect(wrapper.text()).toContain('Agent selected detail');
    expect(wrapper.text()).toContain('Agent directory');
    expect(wrapper.text()).toContain('Discover team');
    expect(wrapper.text()).toContain('Task control');
    expect(wrapper.text()).toContain('Agent execution graph');
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/catalog', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/directory', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/reputation', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1/agent-graph', expect.any(Object));
  });

  it('posts agent assemble requests through the backend contract', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: 'agents.assemble', team: {} }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.agentAssemble('build a review team');
    await api.createAgentTeamProfile({ id: 'qa-team', name: 'QA Team', members: ['planner'] });
    await api.updateAgentTeamProfile('qa-team', { name: 'QA Team', members: ['planner', 'reviewer'] });
    await api.deleteAgentTeamProfile('qa-team');
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/assemble', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ task: 'build a review team' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/team-profiles', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ id: 'qa-team', name: 'QA Team', members: ['planner'] }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/team-profiles/qa-team', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ name: 'QA Team', members: ['planner', 'reviewer'] }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/team-profiles/qa-team', expect.objectContaining({ method: 'DELETE' }));
  });
});
