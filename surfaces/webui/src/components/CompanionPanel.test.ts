import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { useAppStore } from '../stores/app';
import { useChatSessionsStore } from '../stores/chatSessions';
import { useProjectionRegistryStore } from '../stores/projectionRegistry';
import CompanionPanel from './CompanionPanel.vue';

describe('Companion projection contract visibility', () => {
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
});
