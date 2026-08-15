import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { defineComponent, h } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { adaptStrategyDecision } from '../../adapters/strategyDecision';
import fixture from '../../adapters/fixtures/strategy-projection-v1.json';
import { useProjectionRegistryStore } from '../../stores/projectionRegistry';
import type { StrategyDecisionProjection } from '../../types';
import GraphSurface from '../graph/GraphSurface.vue';
import StrategyDecisionSummary from './StrategyDecisionSummary.vue';

const strategyRoutes = [
  { path: '/', component: { template: '<div />' } },
  { path: '/runtime', component: { template: '<div />' } },
  { path: '/mission', component: { template: '<div />' } },
  { path: '/reality', component: { template: '<div />' } },
];

async function mountSummary(surface: 'runtime' | 'mission' | 'app') {
  const router = createRouter({
    history: createWebHistory(),
    routes: strategyRoutes,
  });
  await router.push(`/${surface === 'app' ? 'runtime' : surface}`);
  await router.isReady();
  const strategy = {
    ...fixture,
    resource_snapshot: {
      version: 'resource-v1',
      provider_available: true,
      tools_available: true,
      team_available: true,
      provider_concurrency: 8,
      tool_concurrency: 12,
      team_slots: 4,
      provider_concurrency_penalty_bp: 0,
      provider_effective_limit: 6,
      provider_queue_p95_ms: 80,
      provider_service_p95_ms: 1_200,
      provider_failure_timeout_upper_bound_bp: 100,
      provider_profile_fingerprint: 'public-fingerprint',
      sample_source: 'runtime',
      sample_count: 20,
      provenance: 'observed',
    },
    detail: {
      ...fixture.detail,
      prompt: 'private prompt /home/operator/secret',
      reasoning: 'hidden chain of thought',
    },
  } as unknown as StrategyDecisionProjection;
  return mount(StrategyDecisionSummary, {
    props: {
      strategy,
      agents: [
        {
          id: 'agent-matching',
          kind: 'agent',
          revision: 1,
          status: 'running',
          evidence_refs: [],
          detail: { graph_id: 'execution-547' },
        },
        {
          id: 'agent-unrelated',
          kind: 'agent',
          revision: 1,
          status: 'running',
          evidence_refs: [],
          detail: { graph_id: 'execution-other' },
        },
      ],
      executionId: 'execution-547',
      connectionState: 'live',
      surface,
    },
    global: {
      plugins: [router],
      stubs: {
        GraphSurface: { template: '<div data-test="strategy-graph" />' },
        TimelineList: {
          props: ['items'],
          template: '<ol data-test="strategy-timeline"><li v-for="item in items" :key="item.id">{{ item.title }}|{{ item.status }}</li></ol>',
        },
      },
    },
  });
}

describe('StrategyDecisionSummary surface wiring', () => {
  it('renders Runtime, Mission and application strategy entrypoints from canonical projections', async () => {
    for (const surface of ['runtime', 'mission', 'app'] as const) {
      const wrapper = await mountSummary(surface);
      expect(wrapper.attributes('data-surface')).toBe(surface);
      expect(wrapper.text()).toContain('team');
      expect(wrapper.text()).toContain('calibrated');
      expect(wrapper.get('.strategy-summary__resources').text()).toContain('1.2s');
      expect(wrapper.get('.strategy-summary__resources').text()).toContain('6');
      expect(wrapper.find('a[href*="/runtime?"]').exists()).toBe(true);
      expect(wrapper.find('a[href*="/mission?"]').exists()).toBe(true);
      expect(wrapper.find('a[href*="/reality?"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain('/home/operator/secret');
      expect(wrapper.text()).not.toContain('hidden chain of thought');

      const details = wrapper.get('details');
      (details.element as HTMLDetailsElement).open = true;
      await details.trigger('toggle');
      expect(wrapper.find('[data-test="strategy-graph"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="strategy-timeline"]').text()).toContain(
        'strategy selected|selected',
      );
      expect(wrapper.find('[data-test="strategy-timeline"]').text()).toContain(
        'strategy downgraded|degraded',
      );
      wrapper.unmount();
    }
  });

  it('removes a mounted full Surface projection after authorization recrop', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createWebHistory(),
      routes: strategyRoutes,
    });
    await router.push('/');
    await router.isReady();
    vi.spyOn(api, 'executionProjection')
      .mockResolvedValueOnce({
        schema_version: 2,
        execution_id: 'execution-sensitive',
        revision: 4,
        cursor: 4,
        detail_scope: 'full',
        authorization_revision: 1,
        redaction_revision: 'redaction-1',
        graph: {},
        agents: [],
        strategy: fixture,
      } as any)
      .mockResolvedValueOnce({
        __state: 'forbidden',
        __error: 'credential epoch changed',
      } as any);
    const registry = useProjectionRegistryStore();
    const Harness = defineComponent({
      setup() {
        return () => {
          const projection = registry.projectionFor('execution-sensitive');
          return projection?.strategy
            ? h(StrategyDecisionSummary, {
              strategy: projection.strategy,
              agents: projection.agents,
              executionId: projection.execution_id,
              surface: 'runtime',
            })
            : h('div', { 'data-test': 'projection-cleared' });
        };
      },
    });
    const wrapper = mount(Harness, { global: { plugins: [pinia, router] } });

    await registry.load('execution-sensitive', 'full');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.strategy-summary').exists()).toBe(true);
    expect(wrapper.html()).toContain('evidence-strategy-547');
    await registry.load('execution-sensitive', 'full');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.strategy-summary').exists()).toBe(false);
    expect(wrapper.find('[data-test="projection-cleared"]').exists()).toBe(true);
    expect(wrapper.html()).not.toContain('evidence-strategy-547');
    wrapper.unmount();
  });

  it('keeps malicious legacy detail out of the real GraphSurface evidence inspector', async () => {
    vi.spyOn(api, 'resolveEvidenceBatch').mockResolvedValue({ items: [] } as any);
    const router = createRouter({
      history: createWebHistory(),
      routes: strategyRoutes,
    });
    await router.push('/');
    await router.isReady();
    const view = adaptStrategyDecision({
      id: 'legacy-inspector',
      kind: 'strategy',
      revision: 1,
      summary: 'hidden prompt /home/operator/secret',
      evidence_refs: ['file:///tmp/private'],
      detail: {
        prompt: 'private prompt',
        reasoning: 'hidden chain of thought',
        workspace_path: '/home/operator/project',
      },
    } as unknown as StrategyDecisionProjection);
    const wrapper = mount(GraphSurface, {
      props: { model: view!.graph },
      global: {
        plugins: [router],
        stubs: {
          VueFlow: { template: '<div data-test="flow" />' },
          Panel: { template: '<div><slot /></div>' },
        },
      },
    });

    await wrapper.get('.graph-surface').trigger('keydown', { key: 'ArrowRight' });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.evidence-inspector').exists()).toBe(true);
    expect(wrapper.html()).not.toContain('/home/operator');
    expect(wrapper.html()).not.toContain('private prompt');
    expect(wrapper.html()).not.toContain('hidden chain of thought');
    expect(wrapper.html()).not.toContain('file:///tmp/private');
    wrapper.unmount();
  });
});
