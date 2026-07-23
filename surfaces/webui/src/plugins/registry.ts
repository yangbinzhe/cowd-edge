import type { RouteRecordRaw } from 'vue-router';
import { Factory, type Icon } from 'lucide-vue-next';
import { registerMessages, t } from '../i18n';
import { setRequestedAppCapabilities } from '../api/client';
import { appContributions } from '../apps.generated';
import type { CowdWebUiAppContribution } from '../apps/types';
import type { CapabilitySpec, NavItem } from '../types';

export interface WebuiPagePlugin extends CowdWebUiAppContribution {
  icon: Icon;
  label: string;
  routeRecord: RouteRecordRaw;
}

const iconByName: Record<string, Icon> = { factory: Factory };

function capabilityFor(plugin: CowdWebUiAppContribution): CapabilitySpec {
  return {
    id: plugin.appId,
    title: t(plugin.capability.titleKey),
    subtitle: t(plugin.capability.subtitleKey),
    primaryAction: plugin.capability.actions[0] ? t(plugin.capability.actions[0].labelKey) : t('common.loading'),
    metrics: [], chartKind: 'bar', chartTitle: '', chartData: [], tableTitle: '', rows: [],
    sections: plugin.capability.sections.map((section) => ({
      id: section.id, label: t(section.labelKey), description: t(section.descriptionKey),
      displayMode: section.displayMode || 'detail', density: section.density || 'standard', primaryObject: section.primaryObject,
    })),
    actions: plugin.capability.actions.map((action) => ({ label: t(action.labelKey), kind: action.kind, endpoint: action.endpoint })),
    inspector: plugin.capability.inspector.map((item) => ({ label: t(item.labelKey), value: item.value })),
  };
}

function materializePlugins(contributions: CowdWebUiAppContribution[]): WebuiPagePlugin[] {
  return contributions.map((contribution) => {
    registerMessages(contribution.messages);
    const icon = iconByName[contribution.navigation.icon];
    if (!icon) throw new Error(`APP ${contribution.appId} declares unsupported navigation icon`);
    return {
      ...contribution,
      icon,
      label: t(contribution.navigation.titleKey),
      routeRecord: {
        path: contribution.route,
        component: contribution.page,
        meta: {
          pluginId: contribution.appId,
          requiredCapabilities: contribution.readiness.requiredCapabilities,
          apiNamespace: contribution.readiness.appApi.replace(/\/app$/, ''),
        },
      },
    };
  });
}

export let webuiPagePlugins: WebuiPagePlugin[] = [];
export let pluginRoutes: RouteRecordRaw[] = [];
export let pluginNavItems: NavItem[] = [];
export let pluginCapabilitySpecs: Record<string, CapabilitySpec> = {};

/**
 * Reconcile statically bundled contributions with the public Gateway startup
 * manifest. This is an activation filter only: it never downloads code or
 * trusts a client-side flag as an authorization decision.
 */
export function configureEnabledAppPlugins(enabledAppIds: readonly string[]) {
  const enabled = new Set(enabledAppIds);
  const contributions = appContributions.filter((contribution) => enabled.has(contribution.appId));
  webuiPagePlugins = materializePlugins(contributions);
  pluginRoutes = webuiPagePlugins.map((plugin) => plugin.routeRecord);
  pluginNavItems = webuiPagePlugins.map((plugin) => ({
    id: plugin.appId,
    label: plugin.label,
    labelKey: plugin.navigation.titleKey,
    route: plugin.route,
    icon: plugin.icon,
    group: plugin.navigation.group,
  }));
  pluginCapabilitySpecs = Object.fromEntries(
    webuiPagePlugins.map((plugin) => [plugin.appId, capabilityFor(plugin)]),
  ) as Record<string, CapabilitySpec>;
  setRequestedAppCapabilities(
    contributions.flatMap((contribution) => contribution.readiness.requiredCapabilities),
  );
}

// Unit mounts import the registry without the production bootstrap. Start
// with all compiled contributions there; main.ts immediately replaces this
// set with Gateway-confirmed ids before it creates the real application.
configureEnabledAppPlugins(appContributions.map((contribution) => contribution.appId));

export function appPluginForRoute(path: string) {
  return webuiPagePlugins.find((plugin) => path === plugin.route || path.startsWith(`${plugin.route}/`)) || null;
}

export function appPluginForId(appId: string) {
  return webuiPagePlugins.find((plugin) => plugin.appId === appId) || null;
}
