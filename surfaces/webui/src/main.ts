import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import ChatPage from './pages/ChatPage.vue';
import { configureEnabledAppPlugins, pluginRoutes } from './plugins/registry';
import { claimWebuiObserverId } from './api/client';
import { applyDocumentLocale } from './i18n';
import './styles/tokens.css';
import './styles/base.css';

const APP_MANIFEST_TIMEOUT_MS = 2_000;

async function configureGatewayApps() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), APP_MANIFEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/webui/manifest', {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Gateway manifest returned ${response.status}`);
    const manifest = await response.json() as { enabled_app_ids?: unknown };
    const enabledAppIds = Array.isArray(manifest.enabled_app_ids)
      ? manifest.enabled_app_ids.filter((id): id is string => typeof id === 'string')
      : [];
    configureEnabledAppPlugins(enabledAppIds);
  } catch {
    // A stale WebUI must fail closed for APP extensions. Core WebUI remains
    // available, and a later page reload will reconcile after Gateway returns.
    configureEnabledAppPlugins([]);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function bootstrap() {
  // sessionStorage is copied when a tab is duplicated. Claim a document-local
  // observer identity before any Gateway request can attach this Surface.
  await claimWebuiObserverId();
  await configureGatewayApps();
  const routes = [
    { path: '/', redirect: '/chat' },
    { path: '/chat', component: ChatPage, meta: { label: 'Chat' } },
    { path: '/mission', component: () => import('./pages/MissionControlPage.vue') },
    { path: '/runtime', component: () => import('./pages/RuntimePage.vue') },
    { path: '/context', component: () => import('./pages/ContextPage.vue') },
    { path: '/reality', component: () => import('./pages/RealityCorePage.vue') },
    { path: '/memory', component: () => import('./pages/MemoryPage.vue') },
    { path: '/skills', component: () => import('./pages/SkillsPage.vue') },
    { path: '/agents', component: () => import('./pages/AgentsPage.vue') },
    { path: '/tools', component: () => import('./pages/ToolsPage.vue') },
    { path: '/surfaces', component: () => import('./pages/SurfacePage.vue') },
    { path: '/gateway', component: () => import('./pages/GatewayPage.vue') },
    ...pluginRoutes,
    { path: '/audit', component: () => import('./pages/AuditPage.vue') },
    { path: '/settings', component: () => import('./pages/SettingsPage.vue') },
  ];

  const router = createRouter({
    history: createWebHashHistory(),
    routes,
  });

  const app = createApp(App);
  app.use(createPinia()).use(router).mount('#app');
  applyDocumentLocale();
}

void bootstrap();
