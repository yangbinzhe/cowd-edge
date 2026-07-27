import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
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
      schema_version: 1,
      execution_id: 'companion-contract-execution',
      revision: 2,
      cursor: 2,
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

  it('renders APP, Context, Surface, and Tool rows semantically with expandable raw evidence', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    await router.isReady();
    const app = useAppStore();
    app.companionTab = 'evidence';
    app.currentTimeline = {
      events: [
        {
          event_id: 'app-1',
          sequence: 1,
          type: 'application.execution_outcome',
          status: 'succeeded',
          payload: { title: 'Quality snapshot', summary: '12 facts synchronized' },
        },
        {
          event_id: 'context-1',
          sequence: 2,
          type: 'context.recommendation_action',
          payload: { action: 'accepted', note: 'needed by the active turn' },
        },
        {
          event_id: 'surface-1',
          sequence: 3,
          type: 'surface.message_received',
          payload: { surface: 'feishu', message_id: 'om-1', content_preview: 'inspect incident' },
        },
        {
          event_id: 'tool-1',
          sequence: 4,
          type: 'tool.invocation.completed',
          status: 'completed',
          payload: {
            tool_call_id: 'call-1',
            tool_name: 'glob_search',
            output_preview: '12 matching files',
          },
        },
      ],
    };

    const wrapper = mount(CompanionPanel, {
      global: {
        plugins: [pinia, router],
        stubs: {
          MarkdownBlock: { template: '<div />' },
          WorkspaceTree: { template: '<div />' },
        },
      },
    });

    expect(wrapper.text()).toContain('Quality snapshot');
    expect(wrapper.text()).toContain('Context recommendation action');
    expect(wrapper.text()).toContain('feishu · Message received');
    expect(wrapper.text()).toContain('glob_search completed');
    expect(wrapper.text()).toContain('12 matching files');
    expect(wrapper.text()).not.toContain('"tool_name"');
    const rawEvidence = wrapper.findAll('.activity-item .raw-payload');
    expect(rawEvidence).toHaveLength(4);
    const toolEvidence = rawEvidence[3];
    (toolEvidence.element as HTMLDetailsElement).open = true;
    await toolEvidence.trigger('toggle');
    expect(toolEvidence.text()).toContain('"tool_name": "glob_search"');
    wrapper.unmount();
  });
});
