import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { parseAppCatalog } from '../apps/catalog';
import emptyFixture from '../apps/fixtures/catalog-empty.json';
import manyFixture from '../apps/fixtures/catalog-many.json';
import {
  appCatalogDiagnostic,
  appInternalRoute,
  appPluginForId,
  appPluginForRoute,
  applicationAppIdFromApproval,
  configureAppCatalog,
  configureAppCatalogFailure,
  pluginCapabilitySpecs,
  pluginNavItems,
  pluginRoutes,
  webuiPagePlugins,
} from './registry';

afterEach(() => configureAppCatalog(parseAppCatalog(emptyFixture)));

describe('Catalog-projected application registry', () => {
  it('projects only the strict user-visible Catalog into generic consumers', () => {
    configureAppCatalog(parseAppCatalog(manyFixture));

    expect(webuiPagePlugins.map((plugin) => plugin.appId)).toEqual(['alpha-app', 'zeta-app']);
    expect(pluginNavItems.map(({ id, route, group }) => ({ id, route, group }))).toEqual([
      { id: 'alpha-app', route: '/apps/alpha-app', group: 'Apps' },
      { id: 'zeta-app', route: '/apps/zeta-app', group: 'Apps' },
    ]);
    expect(pluginCapabilitySpecs['zeta-app'].sections.map((section) => section.id))
      .toEqual(['zeta.read', 'zeta.write']);
    expect(pluginCapabilitySpecs['zeta-app'].actions).toEqual([]);
  });

  it('uses one stable generic route for zero, one, or many applications', () => {
    expect(pluginRoutes).toHaveLength(1);
    expect(pluginRoutes[0].path).toBe('/apps/:appId/:pathMatch(.*)*');
    configureAppCatalog(parseAppCatalog(manyFixture));
    expect(pluginRoutes).toHaveLength(1);
    configureAppCatalog(parseAppCatalog(emptyFixture));
    expect(pluginRoutes).toHaveLength(1);
  });

  it('resolves deep links by explicit app identity and preserves their internal route', () => {
    configureAppCatalog(parseAppCatalog(manyFixture));

    expect(appPluginForRoute('/apps/alpha-app/reports/daily')?.appId).toBe('alpha-app');
    expect(appPluginForRoute('/apps/unknown/reports')).toBeNull();
    expect(appPluginForRoute('/runtime')).toBeNull();
    expect(appPluginForId('zeta-app')?.entry.display_name).toBe('Zeta');
    expect(appInternalRoute('reports/daily')).toBe('/reports/daily');
    expect(appInternalRoute(['reports', 'daily'])).toBe('/reports/daily');
    expect(appInternalRoute('reports/daily', { view: 'compact', tag: ['a', 'b'] }))
      .toBe('/reports/daily?tag=a&tag=b&view=compact');
    expect(appInternalRoute(undefined)).toBe('/');
  });

  it('fails closed without hiding the core Shell diagnostic', () => {
    configureAppCatalog(parseAppCatalog(manyFixture));
    configureAppCatalogFailure(new Error('catalog contract rejected'));

    expect(webuiPagePlugins).toEqual([]);
    expect(pluginNavItems).toEqual([]);
    expect(pluginCapabilitySpecs).toEqual({});
    expect(appCatalogDiagnostic).toEqual({ status: 'unavailable', message: 'catalog contract rejected' });
    expect(pluginRoutes).toHaveLength(1);
  });

  it('identifies approval ownership only from the explicit application envelope', () => {
    expect(applicationAppIdFromApproval({ source: { kind: 'alpha-app' } })).toBe('');
    expect(applicationAppIdFromApproval({
      source: { kind: 'unrelated', application: { app_id: 'zeta-app' } },
    })).toBe('zeta-app');
    expect(applicationAppIdFromApproval({ source: { application: { app_id: 7 } } })).toBe('');
  });

  it('replays deep links, query state, forward navigation and browser back through AppPage', async () => {
    configureAppCatalog(parseAppCatalog(manyFixture));
    const router = createRouter({ history: createMemoryHistory(), routes: pluginRoutes });
    await router.push('/apps/alpha-app/reports/daily?view=compact');
    await router.isReady();
    const shell = defineComponent(() => () => h(RouterView));
    const wrapper = mount(shell, { global: { plugins: [router] } });
    await nextTick();
    expect(wrapper.get('iframe').attributes('src'))
      .toBe('/apps/alpha-app/index.html#/reports/daily?view=compact');

    await router.push('/apps/alpha-app/incidents/open');
    await nextTick();
    expect(wrapper.get('iframe').attributes('src'))
      .toBe('/apps/alpha-app/index.html#/incidents/open');

    router.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(router.currentRoute.value.fullPath).toBe('/apps/alpha-app/reports/daily?view=compact');
    expect(wrapper.get('iframe').attributes('src'))
      .toBe('/apps/alpha-app/index.html#/reports/daily?view=compact');
    wrapper.unmount();
  });
});
