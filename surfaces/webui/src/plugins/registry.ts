import { Boxes } from 'lucide-vue-next';
import { computed, defineComponent, h, type Component } from 'vue';
import { useRoute, useRouter, type RouteRecordRaw } from 'vue-router';
import type { AppCatalogEntryV1, AppCatalogV1 } from '../apps/catalog';
import AppPage from '../components/app/AppPage.vue';
import { t } from '../i18n';
import type { CapabilitySpec, NavItem } from '../types';

export interface WebuiPagePlugin {
  appId: string;
  label: string;
  route: string;
  icon: Component;
  entry: AppCatalogEntryV1;
}

export interface AppCatalogDiagnostic {
  status: 'ready' | 'unavailable';
  message: string;
}

let catalog: AppCatalogV1 | null = null;

export let webuiPagePlugins: WebuiPagePlugin[] = [];
export let pluginNavItems: NavItem[] = [];
export let pluginCapabilitySpecs: Record<string, CapabilitySpec> = {};
export let appCatalogDiagnostic: AppCatalogDiagnostic = {
  status: 'unavailable',
  message: 'Application Catalog has not been loaded.',
};

function capabilityFor(entry: AppCatalogEntryV1): CapabilitySpec {
  return {
    id: entry.app_id,
    title: entry.display_name,
    subtitle: entry.effective_authorization_profile,
    primaryAction: '',
    metrics: [],
    chartKind: 'bar',
    chartTitle: '',
    chartData: [],
    tableTitle: '',
    rows: [],
    sections: entry.effective_capabilities.map((capability) => ({
      id: capability,
      label: capability,
      description: capability,
      displayMode: 'detail',
      density: 'compact',
    })),
    actions: [],
    inspector: entry.effective_capabilities.map((capability) => ({
      label: capability,
      value: entry.effective_authorization_profile,
    })),
  };
}

export function configureAppCatalog(nextCatalog: AppCatalogV1) {
  catalog = nextCatalog;
  webuiPagePlugins = nextCatalog.apps.map((entry) => ({
    appId: entry.app_id,
    label: entry.display_name,
    route: `/apps/${encodeURIComponent(entry.app_id)}`,
    icon: Boxes,
    entry,
  }));
  pluginNavItems = webuiPagePlugins.map((plugin) => ({
    id: plugin.appId,
    label: plugin.label,
    route: plugin.route,
    icon: plugin.icon,
    group: 'Apps',
  }));
  pluginCapabilitySpecs = Object.fromEntries(
    nextCatalog.apps.map((entry) => [entry.app_id, capabilityFor(entry)]),
  ) as Record<string, CapabilitySpec>;
  appCatalogDiagnostic = { status: 'ready', message: '' };
}

export function configureAppCatalogFailure(reason: unknown) {
  catalog = null;
  webuiPagePlugins = [];
  pluginNavItems = [];
  pluginCapabilitySpecs = {};
  appCatalogDiagnostic = {
    status: 'unavailable',
    message: reason instanceof Error && reason.message
      ? reason.message
      : 'The Gateway Application Catalog is unavailable.',
  };
}

export function appPluginForId(appId: string) {
  return webuiPagePlugins.find((plugin) => plugin.appId === appId) || null;
}

export function applicationAppIdFromApproval(approval: unknown) {
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) return '';
  const source = (approval as Record<string, unknown>).source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return '';
  const application = (source as Record<string, unknown>).application;
  if (!application || typeof application !== 'object' || Array.isArray(application)) return '';
  const appId = (application as Record<string, unknown>).app_id;
  return typeof appId === 'string' ? appId : '';
}

export function appPluginForRoute(path: string) {
  const match = /^\/apps\/([^/]+)(?:\/|$)/.exec(path);
  if (!match) return null;
  let appId = '';
  try {
    appId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return appPluginForId(appId);
}

export function appInternalRoute(pathMatch: unknown, query: Record<string, unknown> = {}) {
  const segments = Array.isArray(pathMatch) ? pathMatch : [pathMatch];
  const route = segments.filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
    .join('/');
  const search = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const values = Array.isArray(query[key]) ? query[key] as unknown[] : [query[key]];
    for (const value of values) {
      if (value === null) search.append(key, '');
      else if (typeof value === 'string') search.append(key, value);
    }
  }
  const suffix = search.size ? `?${search.toString()}` : '';
  return `${route ? `/${route}` : '/'}${suffix}`;
}

function surfaceEntry(entry: AppCatalogEntryV1, internalRoute: string): AppCatalogEntryV1 {
  const entryPath = entry.web_surface.entry_path;
  if (!entryPath) return entry;
  const url = new URL(entryPath, 'http://cowd.invalid');
  url.hash = internalRoute;
  return {
    ...entry,
    web_surface: { ...entry.web_surface, entry_path: `${url.pathname}${url.search}${url.hash}` },
  };
}

const AppRoutePage = defineComponent({
  name: 'CowdCatalogAppRoute',
  setup() {
    const route = useRoute();
    const router = useRouter();
    const plugin = computed(() => appPluginForId(String(route.params.appId || '')));
    const internalRoute = computed(() => appInternalRoute(route.params.pathMatch, route.query));
    const routedEntry = computed(() => plugin.value
      ? surfaceEntry(plugin.value.entry, internalRoute.value)
      : null);
    const navigate = (path: string) => {
      const current = plugin.value;
      if (!current) return;
      void router.push(`${current.route}${path === '/' ? '' : path}`);
    };
    return () => {
      const entry = routedEntry.value;
      if (!entry || !catalog) {
        const unavailable = appCatalogDiagnostic.status === 'unavailable';
        return h('section', { class: 'app-route-diagnostic', role: 'status' }, [
          h('strong', unavailable ? t('app.catalog.unavailable') : t('app.catalog.notFound')),
          h('p', unavailable ? appCatalogDiagnostic.message : t('app.catalog.notFoundDetail')),
        ]);
      }
      return h(AppPage, {
        key: `${entry.app_id}:${entry.generation}`,
        entry,
        protocolDigest: catalog.protocol_digest,
        catalogGeneration: catalog.catalog_generation,
        onNavigate: navigate,
      });
    };
  },
});

export const pluginRoutes: RouteRecordRaw[] = [{
  path: '/apps/:appId/:pathMatch(.*)*',
  name: 'catalog-app',
  component: AppRoutePage,
  meta: { appCatalogRoute: true },
}];
