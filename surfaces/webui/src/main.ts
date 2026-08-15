import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import ChatPage from './pages/ChatPage.vue';
import { configureAppCatalog, configureAppCatalogFailure, pluginRoutes } from './plugins/registry';
import { fetchAppCatalog } from './services/appCatalogClient';
import { claimWebuiObserverId } from './api/client';
import { applyDocumentLocale } from './i18n';
import './styles/tokens.css';
import './styles/base.css';
import { APP_PROTOCOL_DIGEST } from './generated/app-protocol-meta';

async function configureGatewayApps() {
  try {
    const catalog = await fetchAppCatalog({
      endpoint: '/api/apps',
      timeoutMs: 2_000,
      expectedProtocolDigest: APP_PROTOCOL_DIGEST,
    });
    configureAppCatalog(catalog);
  } catch (error) {
    configureAppCatalogFailure(error);
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
