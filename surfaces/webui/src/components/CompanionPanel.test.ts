import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import CompanionPanel from './CompanionPanel.vue';

describe('Companion projection contract visibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the live execution graph materializing before the active turn completes', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    await router.isReady();
    const app = useAppStore();
    const chat = useChatSessionsStore();
    app.companionTab = 'activity';
    chat.states['live-graph-session'] = {
      sessionId: 'live-graph-session',
      turns: [],
      executionId: 'live-execution',
      executionGraphId: '',
      live: {
        status: 'calling_model',
        status_detail: 'waiting for the first graph projection',
      },
      evidence: null,
      streamState: 'connected',
      requestEpoch: 0,
      pending: true,
      lastError: '',
      unread: 0,
      lastEventAtMs: Date.now(),
      lastProgressAtMs: Date.now(),
      degradedReason: '',
      resyncCount: 0,
    };
    chat.activeSessionId = 'live-graph-session';

    const wrapper = mount(CompanionPanel, {
      global: {
        plugins: [pinia, router],
        stubs: {
          MarkdownBlock: { template: '<div />' },
          WorkspaceTree: { template: '<div />' },
        },
      },
    });
    await nextTick();

    expect(wrapper.find('.companion-execution-graph').exists()).toBe(true);
    expect(wrapper.find('.execution-graph-surface .empty-note').exists()).toBe(true);
    expect(wrapper.text()).toContain('正在加载运行图');
    wrapper.unmount();
  });

  it('shows nested strategy schema mismatch in Companion', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    await router.isReady();
    const app = useAppStore();
    const chat = useChatSessionsStore();
    const projections = useProjectionRegistryStore();
    app.companionTab = 'activity';
    chat.states['companion-contract-session'] = {
      sessionId: 'companion-contract-session',
      turns: [],
      executionId: 'companion-contract-execution',
      executionGraphId: 'companion-contract-execution',
      live: null,
      evidence: null,
      streamState: 'offline',
      requestEpoch: 0,
      pending: false,
      lastError: '',
      unread: 0,
      lastEventAtMs: 0,
      lastProgressAtMs: 0,
      degradedReason: '',
      resyncCount: 0,
    };
    chat.activeSessionId = 'companion-contract-session';
    vi.spyOn(api, 'executionProjection').mockResolvedValue({
      schema_version: 2,
      execution_id: 'companion-contract-execution',
      revision: 2,
      cursor: 2,
      detail_scope: 'full',
      authorization_revision: 1,
      redaction_revision: 'redaction-1',
      graph: {},
      agents: [],
      strategy: {
        schema_version: 2,
        id: 'strategy-v2',
        kind: 'strategy_decision',
        revision: 2,
        evidence_refs: [],
      },
    } as any);
    await projections.load('companion-contract-execution', 'full');

    const wrapper = mount(CompanionPanel, {
      global: {
        plugins: [pinia, router],
        stubs: {
          MarkdownBlock: { template: '<div />' },
          WorkspaceTree: { template: '<div />' },
        },
      },
    });

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toContain(
      'unsupported strategy projection schema_version 2',
    );
    wrapper.unmount();
  });

  it('unifies thought, tool, input, context, and evidence entry points in Activity', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    await router.isReady();
    const app = useAppStore();
    const chat = useChatSessionsStore();
    const evidence = vi.spyOn(api, 'resolveEvidenceBatch').mockResolvedValue({
      kind: 'evidence_batch_projection',
      count: 1,
      items: [],
    } as any);
    app.companionTab = 'activity';
    app.currentContextEnvelope = {
      selected: [{ id: 'context-1', summary: 'relevant context' }],
    };
    app.currentRealityFlow = { stage_count: 8, stages: [] };
    app.turnInbox = {
      items: [{
        input_id: 'input-1',
        turn_id: 'turn-1',
        status: 'supplemented',
        decision: 'supplement_current_turn',
        content_preview: '检查最新执行链',
      }],
    } as any;
    app.activity = [{
      id: 'thought-1',
      kind: 'think',
      title: '分析目标',
      detail: '先核对运行事实',
      status: 'complete',
      turn_id: 'turn-1',
    }, {
      id: 'tool-1',
      kind: 'tool',
      title: 'glob_search',
      detail: '12 matching files',
      status: 'complete',
      turn_id: 'turn-1',
      raw: { full_output_ref: 'tool://call-1/evidence/result' },
    }];
    chat.states['activity-session'] = {
      sessionId: 'activity-session',
      turns: [],
      activity: [],
      turnProjection: {
        kind: 'session.turn_projection',
        session_id: 'activity-session',
        turn_count: 1,
        turns: [{
          turn_id: 'turn-1',
          status: 'completed',
          user_preview: '检查最新执行链',
          evidence_refs: ['tool://call-1/evidence/result'],
          activity_events: [],
        }],
      },
      executionId: '',
      executionGraphId: '',
      live: {
        revision: 1,
        status: 'complete',
        started_at_ms: 1,
        updated_at_ms: 2,
        last_progress_at_ms: 2,
        metrics: {
          tool_calls: 5,
          memory_recalls: 4,
          memory_evidence: 3,
          approvals: 2,
          context_items: 6,
          files_touched: 7,
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
        },
        latency: {
          total_elapsed_ms: 190,
          harness_elapsed_ms: 40,
          provider_wall_ms: 150,
          first_token_latency_ms: 30,
          provider_active_stream_ms: 120,
        },
      },
      historyIndex: {
        schema_version: 1,
        session_id: 'activity-session',
        projection_generation: 9,
        durable_cursor: 12,
        event_cursor: 11,
        history_revision: 7,
        total_messages: 100_000,
        total_bytes: 8_000_000,
        index_generation: 4,
        indexed_through_sequence: 99_999,
        index_card_count: 250,
        index_complete: true,
        recovery_state: 'ready',
        recent_metadata: [],
        cards: [],
      },
      streamState: 'offline',
      pending: false,
    } as any;
    chat.activeSessionId = 'activity-session';

    const wrapper = mount(CompanionPanel, {
      global: {
        plugins: [pinia, router],
        stubs: {
          MarkdownBlock: { template: '<div />' },
          WorkspaceTree: { template: '<div />' },
        },
      },
    });

    expect(wrapper.text()).toContain('检查最新执行链');
    expect(wrapper.text()).toContain('分析目标');
    expect(wrapper.text()).toContain('glob_search');
    expect(wrapper.text()).toContain('12 matching files');
    expect(wrapper.find('.activity-metric-grid').text()).toContain('5');
    expect(wrapper.find('.activity-metric-grid').text()).toContain('8');
    expect(wrapper.find('.activity-metric-grid').text()).toContain('120');
    expect(wrapper.find('.activity-metric-grid').text()).toContain('100%');
    expect(wrapper.find('.activity-metric-grid').text()).toContain('40 ms');
    expect(wrapper.find('.activity-metric-grid').text()).toContain('150 ms');
    expect(wrapper.find('.activity-metric-grid').text()).toContain('9');
    expect(wrapper.get('.turn-title-action').text()).toContain('检查最新执行链');
    expect(wrapper.findAll('.companion-tabs button')).toHaveLength(3);
    expect(wrapper.text()).not.toContain('思考过程');
    expect(wrapper.text()).not.toContain('证据与状态');
    const turnInput = wrapper.get('.execution-turn-head');
    const firstActivity = wrapper.get('.execution-turn-group .timeline-list li');
    expect(
      turnInput.element.compareDocumentPosition(firstActivity.element)
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await wrapper.get('.turn-title-action').trigger('click');
    expect(evidence).not.toHaveBeenCalled();
    const drilldown = wrapper.get('.activity-evidence-drilldown');
    (drilldown.element as HTMLDetailsElement).open = true;
    await drilldown.trigger('toggle');
    await nextTick();
    expect(evidence).toHaveBeenCalledWith(
      ['tool://call-1/evidence/result'],
      'activity-session',
    );
    wrapper.unmount();
  });

  it('opens execution input, output, and raw event details by default', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    await router.isReady();
    const app = useAppStore();
    const chat = useChatSessionsStore();
    app.companionTab = 'activity';
    chat.states['detail-session'] = {
      sessionId: 'detail-session',
      turns: [],
      activity: [],
      streamState: 'offline',
      pending: false,
    } as any;
    chat.activeSessionId = 'detail-session';
    const evidence = vi.spyOn(api, 'resolveEvidenceBatch').mockResolvedValue({
      kind: 'evidence_batch_projection',
      count: 1,
      items: [],
    } as any);
    app.activity = [{
      id: 'tool-detail-1',
      kind: 'tool',
      title: 'read_file',
      detail: 'Read the requested file',
      status: 'complete',
      input: { path: 'README.md' },
      output: { bytes: 128 },
      raw: {
        tool_call_id: 'call-1',
        full_output_ref: 'tool://call-1/evidence/output',
      },
    }];

    const wrapper = mount(CompanionPanel, {
      global: {
        plugins: [pinia, router],
        stubs: {
          MarkdownBlock: { template: '<div />' },
          WorkspaceTree: { template: '<div />' },
        },
      },
    });

    await wrapper.get('.companion-timeline li').trigger('click');
    expect(evidence).not.toHaveBeenCalled();
    expect(wrapper.findAll('.activity-detail-content .activity-structured-section')).toHaveLength(2);
    const details = wrapper.findAll('.activity-detail-content .raw-payload');
    expect(details).toHaveLength(1);
    expect(details[0].attributes('open')).toBeUndefined();
    const drilldown = wrapper.get('.activity-evidence-drilldown');
    (drilldown.element as HTMLDetailsElement).open = true;
    await drilldown.trigger('toggle');
    await nextTick();
    expect(evidence).toHaveBeenCalledWith(
      ['tool://call-1/evidence/output'],
      'detail-session',
    );
    wrapper.unmount();
  });
});
