import { afterEach, describe, expect, it } from 'vitest';
import { appContributions } from '../apps.generated';
import {
  configureEnabledAppPlugins,
  pluginCapabilitySpecs,
  pluginNavItems,
  pluginRoutes,
  webuiPagePlugins,
} from './registry';

afterEach(() => {
  configureEnabledAppPlugins(appContributions.map((contribution) => contribution.appId));
});

describe('Gateway-confirmed application activation', () => {
  it('removes a compiled APP from every WebUI registration projection when Gateway disables it', () => {
    configureEnabledAppPlugins([]);

    expect(webuiPagePlugins).toEqual([]);
    expect(pluginRoutes).toEqual([]);
    expect(pluginNavItems).toEqual([]);
    expect(pluginCapabilitySpecs).toEqual({});
  });

  it('mounts only APP ids confirmed by the Gateway manifest', () => {
    configureEnabledAppPlugins(['mfg', 'not-compiled']);

    expect(webuiPagePlugins.map((plugin) => plugin.appId)).toEqual(['mfg']);
    expect(pluginRoutes.map((route) => route.path)).toEqual(['/apps/mfg']);
    expect(pluginNavItems.map((item) => item.id)).toEqual(['mfg']);
  });
});
